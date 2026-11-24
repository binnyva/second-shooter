package com.secondshooter.nativepoc

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.camera.core.AspectRatio
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * The thing this test app exists to try: CameraX is the only owner of the
 * camera, and WebRTC never opens it.
 *
 * CameraX's Preview use case renders into a SurfaceTexture owned by WebRTC's
 * SurfaceTextureHelper. Every frame that lands there is handed to a WebRTC
 * VideoSource as a GPU texture, so the stream is exactly what CameraX
 * produces, zoom included. The local on-screen preview is a sink on the same
 * track, and ImageCapture is bound alongside Preview on the same camera.
 * Preview + ImageCapture is the most widely guaranteed CameraX combination.
 */
class CameraStreamer(
    private val context: Context,
    eglBase: EglBase,
    factory: PeerConnectionFactory,
) {
    private val mainExecutor = ContextCompat.getMainExecutor(context)

    private val videoSource: VideoSource = factory.createVideoSource(false)
    val videoTrack: VideoTrack = factory.createVideoTrack("camera-video", videoSource)

    private val textureHelper =
        SurfaceTextureHelper.create("CameraXToWebRTC", eglBase.eglBaseContext)

    // CameraX delivers sensor-oriented buffers into a SurfaceTexture and tells
    // us how far to rotate them; WebRTC carries that as frame rotation (CVO),
    // which the browser applies.
    @Volatile private var rotationDegrees = 0

    private val framesThisSecond = AtomicInteger(0)

    private val resolutionSelector = ResolutionSelector.Builder()
        // 4:3 so the stream frames exactly what the photo will.
        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
        .setResolutionStrategy(
            ResolutionStrategy(
                Size(1440, 1080),
                ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
            )
        )
        .build()

    private val preview = Preview.Builder()
        .setResolutionSelector(resolutionSelector)
        .setTargetFrameRate(Range(30, 30))
        .build()

    private val imageCapture = ImageCapture.Builder()
        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
        .setResolutionSelector(
            ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .build()
        )
        .build()

    private var camera: Camera? = null

    var streamSize: Size? = null
        private set

    init {
        videoSource.capturerObserver.onCapturerStarted(true)
        textureHelper.startListening { frame ->
            framesThisSecond.incrementAndGet()
            // The helper releases `frame` after this callback; retain the
            // buffer for the re-rotated frame we pass on.
            frame.buffer.retain()
            val rotated = VideoFrame(frame.buffer, rotationDegrees, frame.timestampNs)
            videoSource.capturerObserver.onFrameCaptured(rotated)
            rotated.release()
        }

        preview.setSurfaceProvider(mainExecutor) { request ->
            val size = request.resolution
            streamSize = size
            Log.i(TAG, "Preview surface requested: ${size.width}x${size.height}")
            textureHelper.setTextureSize(size.width, size.height)
            request.setTransformationInfoListener(mainExecutor) { info ->
                rotationDegrees = info.rotationDegrees
                Log.i(TAG, "Preview rotation: ${info.rotationDegrees}")
            }
            val surface = Surface(textureHelper.surfaceTexture)
            request.provideSurface(surface, mainExecutor) { surface.release() }
        }
    }

    suspend fun bind(owner: LifecycleOwner, initialZoom: Float) {
        val provider = ProcessCameraProvider.getInstance(context).await()
        provider.unbindAll()
        val cam = provider.bindToLifecycle(
            owner,
            CameraSelector.DEFAULT_BACK_CAMERA,
            preview,
            imageCapture,
        )
        camera = cam
        setZoom(initialZoom)
    }

    /** Camera-side frames per second since the last call. */
    fun takeFrameCount(): Int = framesThisSecond.getAndSet(0)

    val zoomRange: ClosedFloatingPointRange<Float>
        get() {
            val state = camera?.cameraInfo?.zoomState?.value ?: return 1f..1f
            return state.minZoomRatio..state.maxZoomRatio
        }

    val zoom: Float
        get() = camera?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1f

    suspend fun setZoom(level: Float): Float {
        val cam = camera ?: return 1f
        val clamped = level.coerceIn(zoomRange)
        cam.cameraControl.setZoomRatio(clamped).await()
        return clamped
    }

    /**
     * Zoom buttons for the web remote. CameraX's back camera on a Pixel is a
     * logical multi-camera, so the zoom ratio alone moves between the
     * ultra-wide, main and 5x telephoto sensors.
     */
    fun lenses(): List<Lens> {
        val range = zoomRange
        return buildList {
            if (range.start < 0.95f) {
                add(Lens("ultra-wide", formatZoom(range.start), range.start))
            }
            add(Lens("wide", "1", 1f))
            add(Lens("digital-2x", "2", 2f))
            if (range.endInclusive >= 5f) add(Lens("telephoto-1", "5", 5f))
        }
    }

    suspend fun takePhoto(): Uri {
        val name = "SS_" + SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/SecondShooter")
        }
        val options = ImageCapture.OutputFileOptions.Builder(
            context.contentResolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values,
        ).build()

        return suspendCancellableCoroutine { cont ->
            imageCapture.takePicture(
                options,
                mainExecutor,
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                        val uri = result.savedUri
                        if (uri != null) cont.resume(uri)
                        else cont.resumeWithException(IllegalStateException("Saved without a URI"))
                    }

                    override fun onError(exception: ImageCaptureException) {
                        cont.resumeWithException(exception)
                    }
                },
            )
        }
    }

    /** A small JPEG of the saved photo for the remote's thumbnail (PHOTO_DATA). */
    suspend fun thumbnailBase64(uri: Uri, maxEdge: Int = 720): String =
        withContext(Dispatchers.IO) {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            // ImageDecoder applies the EXIF orientation for us.
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

    fun release() {
        textureHelper.stopListening()
        textureHelper.dispose()
        videoTrack.dispose()
        videoSource.dispose()
    }

    companion object {
        private const val TAG = "SSCamera"

        private fun formatZoom(zoom: Float): String =
            String.format(Locale.US, "%.1f", zoom).trimEnd('0').trimEnd('.')
    }
}
