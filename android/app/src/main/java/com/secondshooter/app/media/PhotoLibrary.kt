package com.secondshooter.app.media

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/** A photo this app saved. */
@Serializable
data class LibraryPhoto(
    val uri: String,
    val name: String,
    /** When it was saved, epoch milliseconds. */
    val savedAt: Long,
    /** The save folder's tree URI, or "" for the camera roll (as `lastPhotoFolder`). */
    val folder: String = "",
)

/**
 * The photos this app has saved, oldest first: what the photo viewer pages
 * through. It's our own list because a save folder must never be listed
 * (AGENTS.md, "Save Folder"), so photos saved before the list existed aren't
 * in it. A photo deleted in another app stays listed until the viewer fails
 * to open it, and is dropped then.
 *
 * One JSON object per line in `filesDir`, appended on each save; read once
 * and kept in memory. Shared by every [CaptureStore], hence an object.
 */
object PhotoLibrary {
    const val MAX_PHOTOS = 5000
    private const val FILE_NAME = "photo-library.jsonl"

    private val mutex = Mutex()
    private var cache: List<LibraryPhoto>? = null

    private val _changes = MutableStateFlow(0)

    /** Bumped on every change, so an open viewer sees new shots and deletions. */
    val changes: StateFlow<Int> = _changes.asStateFlow()

    suspend fun all(context: Context): List<LibraryPhoto> = mutex.withLock { load(context) }

    suspend fun add(context: Context, photo: LibraryPhoto) = mutex.withLock {
        val before = load(context)
        val after = PhotoLibraryList.append(before, photo, MAX_PHOTOS)
        withContext(Dispatchers.IO) {
            // The usual case is a plain append; a re-save or the cap rewrites.
            if (after.size == before.size + 1 && after.dropLast(1) == before) {
                file(context).appendText(PhotoLibraryList.encode(photo) + "\n")
            } else {
                write(context, after)
            }
        }
        cache = after
        _changes.update { it + 1 }
    }

    suspend fun remove(context: Context, uri: String) = mutex.withLock {
        val before = load(context)
        val after = before.filterNot { it.uri == uri }
        if (after.size == before.size) return@withLock
        withContext(Dispatchers.IO) { write(context, after) }
        cache = after
        _changes.update { it + 1 }
    }

    private suspend fun load(context: Context): List<LibraryPhoto> = cache ?: withContext(Dispatchers.IO) {
        val file = file(context)
        if (file.exists()) PhotoLibraryList.decode(file.readLines()) else emptyList()
    }.also { cache = it }

    private fun write(context: Context, photos: List<LibraryPhoto>) {
        val file = file(context)
        val temp = File(file.parentFile, "$FILE_NAME.tmp")
        temp.writeText(photos.joinToString("") { PhotoLibraryList.encode(it) + "\n" })
        if (!temp.renameTo(file)) {
            file.delete()
            temp.renameTo(file)
        }
    }

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}

/** The list logic, apart from files and Android so it can be unit tested. */
internal object PhotoLibraryList {
    private val json = Json { ignoreUnknownKeys = true }

    fun encode(photo: LibraryPhoto): String = json.encodeToString(LibraryPhoto.serializer(), photo)

    /** Skips lines that don't parse (a write cut short); a URI listed twice keeps its last place. */
    fun decode(lines: List<String>): List<LibraryPhoto> {
        val photos = lines.mapNotNull { line ->
            if (line.isBlank()) null
            else runCatching { json.decodeFromString(LibraryPhoto.serializer(), line) }.getOrNull()
        }
        return photos.asReversed().distinctBy { it.uri }.asReversed()
    }

    /** Adds [photo] as the newest, moving it there if it's already listed, and keeps the newest [max]. */
    fun append(photos: List<LibraryPhoto>, photo: LibraryPhoto, max: Int): List<LibraryPhoto> =
        (photos.filterNot { it.uri == photo.uri } + photo).takeLast(max)
}
