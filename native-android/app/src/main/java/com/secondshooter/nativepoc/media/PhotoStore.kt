package com.secondshooter.nativepoc.media

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import androidx.camera.core.ImageCapture
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Where photos go. For now always the camera roll (Pictures/SecondShooter);
 * Phase 4 adds the user's chosen folder, with this as the fallback.
 */
class PhotoStore(private val context: Context) {

    fun newPhotoOutput(): ImageCapture.OutputFileOptions {
        val name = "SS_" + SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/SecondShooter")
        }
        return ImageCapture.OutputFileOptions.Builder(
            context.contentResolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values,
        ).build()
    }

    /** A small JPEG of a saved photo for the remote's thumbnail (PHOTO_DATA). */
    suspend fun thumbnailBase64(uri: Uri, maxEdge: Int = 720): String =
        withContext(Dispatchers.IO) {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            // ImageDecoder applies the EXIF orientation.
            val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                val longEdge = maxOf(info.size.width, info.size.height)
                var sample = 1
                while (longEdge / (sample * 2) >= maxEdge) sample *= 2
                decoder.setTargetSampleSize(sample)
            }
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 70, out)
            bitmap.recycle()
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }
}
