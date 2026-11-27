package com.secondshooter.app.media

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import androidx.camera.core.ImageCapture
import androidx.camera.video.FileDescriptorOutputOptions
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.OutputOptions
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.util.Date

/** Where a capture ended up. */
data class SavedCapture(val uri: Uri, val inFolder: Boolean)

/** A video destination; [close] once the recording has finalized. */
class VideoTarget(
    val options: OutputOptions,
    /** The folder document, or null when MediaStore picks the URI. */
    val documentUri: Uri?,
    private val descriptor: ParcelFileDescriptor?,
) {
    fun close() {
        runCatching { descriptor?.close() }
    }
}

/**
 * Where captures go: the folder the user picked (a Storage Access Framework
 * tree, `saveFolderUri`), or the camera roll when there's no folder, or when
 * writing to it fails. The camera roll is the fallback, not a choice.
 *
 * Compared to the React Native app (src/services/MediaService.ts):
 * - Bytes are streamed into the folder through a ContentResolver stream. No
 *   base64 round trip, so nothing holds the whole file in memory.
 * - Photos are captured to a cache file first and then copied, so a folder
 *   that fails mid-write still leaves the shot in the camera roll. Videos go
 *   straight to their destination (a copy of a long recording would double
 *   the wait at stop); a folder that can't be opened falls back before the
 *   recording starts.
 * - **Nothing ever lists the folder.** The last photo is remembered when
 *   it's saved, and a broken folder is noticed when a save fails. AGENTS.md
 *   ("Save Folder") has the measurements behind both rules.
 */
class CaptureStore(
    private val context: Context,
    private val dataStore: DataStore<Preferences>,
) {
    private val resolver get() = context.contentResolver

    /** The folder a save last failed against; Settings warns while it's still chosen. */
    val brokenFolder: Flow<String?> = dataStore.data.map { it[BROKEN_FOLDER] }

    /** The newest photo, if it was saved to [folderUri] ("" = the camera roll). */
    fun lastPhoto(folderUri: String?): Flow<Uri?> = dataStore.data.map { prefs ->
        val uri = prefs[LAST_PHOTO_URI] ?: return@map null
        if (prefs[LAST_PHOTO_FOLDER] == (folderUri ?: "")) Uri.parse(uri) else null
    }

    suspend fun clearBrokenFolder() {
        dataStore.edit { it.remove(BROKEN_FOLDER) }
    }

    // --- Photos -----------------------------------------------------------

    /** Where ImageCapture writes; [savePhoto] then moves it to its home. */
    fun newPhotoCapture(): Pair<ImageCapture.OutputFileOptions, File> {
        val dir = File(context.cacheDir, "captures").apply { mkdirs() }
        val file = File(dir, "${CaptureNames.photo()}.jpg")
        return ImageCapture.OutputFileOptions.Builder(file).build() to file
    }

    /** Copies a captured photo to the folder (or the camera roll) and forgets the temp file. */
    suspend fun savePhoto(temp: File, folderUri: String?): SavedCapture = withContext(Dispatchers.IO) {
        try {
            val name = temp.name
            val saved = folderUri?.let { folder ->
                try {
                    val doc = createInFolder(Uri.parse(folder), "image/jpeg", name)
                    try {
                        copyInto(temp, doc)
                    } catch (e: IOException) {
                        runCatching { DocumentsContract.deleteDocument(resolver, doc) }
                        throw e
                    }
                    SavedCapture(doc, inFolder = true)
                } catch (e: Exception) {
                    Log.w(TAG, "Saving to the folder failed, using the camera roll", e)
                    markBroken(folder)
                    null
                }
            } ?: SavedCapture(insertIntoCameraRoll(temp, name), inFolder = false)

            val folder = if (saved.inFolder) folderUri.orEmpty() else ""
            dataStore.edit {
                it[LAST_PHOTO_URI] = saved.uri.toString()
                it[LAST_PHOTO_FOLDER] = folder
            }
            PhotoLibrary.add(context, LibraryPhoto(saved.uri.toString(), name, System.currentTimeMillis(), folder))
            saved
        } finally {
            temp.delete()
        }
    }

    private fun copyInto(source: File, target: Uri) {
        val out = resolver.openOutputStream(target) ?: throw IOException("No output stream for $target")
        out.use { stream -> source.inputStream().use { it.copyTo(stream) } }
    }

    private fun insertIntoCameraRoll(source: File, name: String): Uri {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/SecondShooter")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("MediaStore refused the photo")
        try {
            copyInto(source, uri)
        } catch (e: IOException) {
            resolver.delete(uri, null, null)
            throw e
        }
        resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        return uri
    }

    /** A small JPEG for the remote's thumbnail (PHOTO_DATA). Never log the result. */
    suspend fun thumbnailBase64(uri: Uri, maxEdge: Int = 720): String = withContext(Dispatchers.IO) {
        val bitmap = decodeScaled(ImageDecoder.createSource(resolver, uri), maxEdge)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 70, out)
        bitmap.recycle()
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** The shutter thumbnail; null if the photo has gone. */
    suspend fun loadThumbnail(uri: Uri, maxEdge: Int = 256): Bitmap? = withContext(Dispatchers.IO) {
        runCatching { decodeScaled(ImageDecoder.createSource(resolver, uri), maxEdge) }.getOrNull()
    }

    /**
     * A photo for the viewer, at full size up to [maxEdge] on its long side
     * and halved until it fits beyond that. The cap keeps it drawable:
     * Android refuses to draw a bitmap over 100 MB. Throws if it can't be read.
     */
    suspend fun loadPhoto(uri: Uri, maxEdge: Int): Bitmap = withContext(Dispatchers.IO) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            val longEdge = maxOf(info.size.width, info.size.height)
            var sample = 1
            while (longEdge / sample > maxEdge) sample *= 2
            decoder.setTargetSampleSize(sample)
        }
    }

    // --- The photo viewer's list ------------------------------------------

    /**
     * The photos the viewer pages through, oldest first. A list that's still
     * empty (photos saved before it existed) starts with the shutter
     * thumbnail's photo, so the viewer always opens on the last shot.
     */
    suspend fun libraryPhotos(): List<LibraryPhoto> {
        val photos = PhotoLibrary.all(context)
        if (photos.isNotEmpty()) return photos
        val prefs = dataStore.data.first()
        val uri = prefs[LAST_PHOTO_URI] ?: return photos
        val name = withContext(Dispatchers.IO) { displayName(Uri.parse(uri)) } ?: Uri.parse(uri).lastPathSegment.orEmpty()
        val savedAt = CaptureNames.parse(name) ?: 0L
        PhotoLibrary.add(context, LibraryPhoto(uri, name, savedAt, prefs[LAST_PHOTO_FOLDER].orEmpty()))
        return PhotoLibrary.all(context)
    }

    /**
     * Deletes [photo] and forgets it. A document goes through its provider;
     * a camera-roll photo through MediaStore, which throws a
     * SecurityException (a RecoverableSecurityException on Android 10) when
     * the photo isn't ours any more, e.g. after a reinstall: the caller then
     * asks the user and calls [forgetPhoto].
     */
    suspend fun deletePhoto(photo: LibraryPhoto) {
        withContext(Dispatchers.IO) {
            val uri = Uri.parse(photo.uri)
            try {
                if (DocumentsContract.isDocumentUri(context, uri)) {
                    if (!DocumentsContract.deleteDocument(resolver, uri)) throw IOException("The folder refused to delete the photo")
                } else {
                    resolver.delete(uri, null, null)
                }
            } catch (e: FileNotFoundException) {
                Log.i(TAG, "Photo to delete was already gone")
            }
        }
        forgetPhoto(photo)
    }

    /** Drops [photo] from the list; the shutter thumbnail moves to the one before it. */
    suspend fun forgetPhoto(photo: LibraryPhoto) {
        PhotoLibrary.remove(context, photo.uri)
        val previous = PhotoLibrary.all(context).lastOrNull { it.folder == photo.folder }
        dataStore.edit { prefs ->
            if (prefs[LAST_PHOTO_URI] != photo.uri) return@edit
            if (previous != null) {
                prefs[LAST_PHOTO_URI] = previous.uri
                prefs[LAST_PHOTO_FOLDER] = previous.folder
            } else {
                prefs.remove(LAST_PHOTO_URI)
                prefs.remove(LAST_PHOTO_FOLDER)
            }
        }
    }

    private fun displayName(uri: Uri): String? = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }.getOrNull()

    // --- Videos -----------------------------------------------------------

    suspend fun newVideoTarget(folderUri: String?): VideoTarget = withContext(Dispatchers.IO) {
        val name = "${CaptureNames.video()}.mp4"
        if (folderUri != null) {
            try {
                val doc = createInFolder(Uri.parse(folderUri), "video/mp4", name)
                // "rw": the muxer seeks back to write the header.
                val fd = resolver.openFileDescriptor(doc, "rw") ?: throw IOException("No descriptor for $doc")
                return@withContext VideoTarget(FileDescriptorOutputOptions.Builder(fd).build(), doc, fd)
            } catch (e: Exception) {
                Log.w(TAG, "Recording to the folder failed, using the camera roll", e)
                markBroken(folderUri)
            }
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Movies/SecondShooter")
        }
        val options = MediaStoreOutputOptions.Builder(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI)
            .setContentValues(values)
            .build()
        VideoTarget(options, null, null)
    }

    // --- Shared -----------------------------------------------------------

    private fun createInFolder(treeUri: Uri, mimeType: String, name: String): Uri {
        val dir = DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri))
        return DocumentsContract.createDocument(resolver, dir, mimeType, name)
            ?: throw IOException("The folder refused a new file")
    }

    private suspend fun markBroken(folderUri: String) {
        dataStore.edit { it[BROKEN_FOLDER] = folderUri }
    }

    private fun decodeScaled(source: ImageDecoder.Source, maxEdge: Int): Bitmap =
        // ImageDecoder applies the EXIF orientation.
        ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            val longEdge = maxOf(info.size.width, info.size.height)
            var sample = 1
            while (longEdge / (sample * 2) >= maxEdge) sample *= 2
            decoder.setTargetSampleSize(sample)
        }

    private companion object {
        const val TAG = "SSStore"
        val BROKEN_FOLDER = stringPreferencesKey("brokenSaveFolder")
        val LAST_PHOTO_URI = stringPreferencesKey("lastPhotoUri")
        val LAST_PHOTO_FOLDER = stringPreferencesKey("lastPhotoFolder")
    }
}

/** File names as the React Native app made them: sortable, and recognisable in a shared folder. */
object CaptureNames {
    fun photo(date: Date = Date()) = name("IMG", date)
    fun video(date: Date = Date()) = name("VID", date)

    private fun name(prefix: String, date: Date) =
        // Milliseconds, because a burst can put several shots in the same second.
        "SecondShooter_${prefix}_" + format().format(date)

    private val NAME = Regex("""SecondShooter_(?:IMG|VID)_(\d{8}_\d{6}_\d{3})""")

    /** When a capture was taken, from its file name; null for a name we didn't make. */
    fun parse(name: String): Long? {
        val stamp = NAME.find(name)?.groupValues?.get(1) ?: return null
        return runCatching { format().parse(stamp)?.time }.getOrNull()
    }

    private fun format() = java.text.SimpleDateFormat("yyyyMMdd_HHmmss_SSS", java.util.Locale.US)
}
