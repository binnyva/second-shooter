package com.secondshooter.nativepoc.camera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Matrix
import android.net.Uri
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
import org.webrtc.SurfaceTextureHelper
import org.webrtc.TextureBufferImpl
import org.webrtc.VideoFrame
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
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
 * track. ImageCapture and VideoCapture are bound alongside Preview on the
 * same camera, so photos and recordings never interrupt the stream.
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

    // How far the sensor-oriented image must turn to be upright. WebRTC
    // carries it as frame rotation (CVO), which the browser applies.
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

    // FHD, not UHD: binding Preview + ImageCapture + VideoCapture together is
    // the combination the HAL is least generous with, and the remote can't
    // show more than ~1080p anyway. Revisit with measurements (PORTING_PLAN
    // Phase 2).
    private val recorder = Recorder.Builder()
        .setQualitySelector(
            QualitySelector.from(Quality.FHD, FallbackStrategy.lowerQualityOrHigherThan(Quality.FHD))
        )
        .build()
    private val videoCapture = VideoCapture.withOutput(recorder)

    private var camera: Camera? = null

    /** False when this camera can't bind video alongside preview and photo. */
    var videoSupported = true
        private set

    var streamSize: Size? = null
        private set

    init {
        videoSource.capturerObserver.onCapturerStarted(true)
        textureHelper.startListening { frame ->
            framesThisSecond.incrementAndGet()
            val rotation = rotationDegrees
            // The camera service bakes the sensor orientation into the
            // SurfaceTexture's transform matrix, so the texture is already
            // drawn rotated inside a buffer still sized as the sensor
            // (landscape): rotated *and* squashed. Undo that rotation in the
            // matrix and carry it as frame metadata instead, the same way
            // WebRTC's own Camera2Session does. The new buffer is retained;
            // the helper releases the original after this callback.
            val buffer = frame.buffer as TextureBufferImpl
            val unrotate = Matrix().apply {
                preTranslate(0.5f, 0.5f)
                preRotate(-rotation.toFloat())
                preTranslate(-0.5f, -0.5f)
            }
            val upright = VideoFrame(
                buffer.applyTransformMatrix(unrotate, buffer.width, buffer.height),
                rotation,
                frame.timestampNs,
            )
            videoSource.capturerObserver.onFrameCaptured(upright)
            upright.release()
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

    /**
     * Bind to a lifecycle. Called again with each new owner (a recreated
     * activity, a new navigation entry): the use cases and the WebRTC track
     * live in the ViewModel, so the stream carries on with the same track.
     */
    suspend fun bind(owner: LifecycleOwner) {
        val provider = ProcessCameraProvider.getInstance(context).await()
        provider.unbindAll()
        val cam = try {
            provider.bindToLifecycle(
                owner,
                CameraSelector.DEFAULT_BACK_CAMERA,
                preview,
                imageCapture,
                videoCapture,
            ).also { videoSupported = true }
        } catch (e: IllegalArgumentException) {
            // The three-way combination isn't supported here: keep the
            // stream and photos, give up video.
            Log.w(TAG, "Preview + ImageCapture + VideoCapture not supported, binding without video", e)
            provider.unbindAll()
            videoSupported = false
            provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
        }
        Log.i(
            TAG,
            "Bound: preview=${preview.resolutionInfo?.resolution} " +
                "photo=${imageCapture.resolutionInfo?.resolution} " +
                "video=${if (videoSupported) videoCapture.resolutionInfo?.resolution else "unbound"}",
        )
        camera = cam
        // A fresh binding starts back at 1x, and by the time a new owner
        // binds, the old owner's destruction has already unbound the camera.
        // So re-apply the zoom we last asked for rather than reading it back.
        requestedZoom?.let { setZoom(it) }
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

    private var requestedZoom: Float? = null

    suspend fun setZoom(level: Float): Float {
        val cam = camera ?: return 1f
        val clamped = level.coerceIn(zoomRange)
        requestedZoom = clamped
        cam.cameraControl.setZoomRatio(clamped).await()
        return clamped
    }

    /** Zoom buttons for the current camera's zoom range. */
    fun lenses(): List<Lens> = zoomRange.let { Lenses.forZoomRange(it.start, it.endInclusive) }

    suspend fun takePhoto(options: ImageCapture.OutputFileOptions): Uri =
        suspendCancellableCoroutine { cont ->
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

    /** Starts recording; [onEvent] gets CameraX's Start/Status/Finalize events on the main thread. */
    @SuppressLint("MissingPermission") // withAudio is only true once RECORD_AUDIO is granted
    fun startRecording(
        output: MediaStoreOutputOptions,
        withAudio: Boolean,
        onEvent: (VideoRecordEvent) -> Unit,
    ): Recording {
        check(videoSupported) { "Video isn't supported on this camera" }
        var pending = recorder.prepareRecording(context, output)
        if (withAudio) pending = pending.withAudioEnabled()
        return pending.start(mainExecutor) { onEvent(it) }
    }

    fun release() {
        textureHelper.stopListening()
        textureHelper.dispose()
        videoTrack.dispose()
        videoSource.dispose()
    }

    companion object {
        private const val TAG = "SSCamera"
    }
}
