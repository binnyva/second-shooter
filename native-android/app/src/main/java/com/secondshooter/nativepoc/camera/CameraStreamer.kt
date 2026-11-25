package com.secondshooter.nativepoc.camera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Matrix
import android.hardware.camera2.CameraCharacteristics
import android.net.Uri
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileDescriptorOutputOptions
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.OutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.secondshooter.nativepoc.protocol.CameraFacing
import com.secondshooter.nativepoc.protocol.FlashMode
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
import kotlin.math.hypot

/**
 * CameraX is the only owner of the camera, and WebRTC never opens it.
 *
 * CameraX's Preview use case renders into a SurfaceTexture owned by WebRTC's
 * SurfaceTextureHelper. Every frame that lands there is handed to a WebRTC
 * VideoSource as a GPU texture, so the stream is exactly what CameraX
 * produces, zoom and lens switches included. The local on-screen preview is a
 * sink on the same track. ImageCapture and VideoCapture are bound alongside
 * Preview on the same camera, so photos and recordings never interrupt the
 * stream.
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

    // Front camera frames arrive mirrored (see the frame listener).
    @Volatile private var mirrorFrames = false

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
    // show more than ~1080p anyway.
    private val recorder = Recorder.Builder()
        .setQualitySelector(
            QualitySelector.from(Quality.FHD, FallbackStrategy.lowerQualityOrHigherThan(Quality.FHD))
        )
        .build()
    private val videoCapture = VideoCapture.withOutput(recorder)

    private var camera: Camera? = null

    /**
     * The lifecycle the camera follows. Kept so a camera switch can re-bind;
     * replaced by every bind() from the screen, so it never outlives the
     * current activity for long.
     */
    private var owner: LifecycleOwner? = null

    var facing: CameraFacing = CameraFacing.BACK
        private set

    /** False when this camera can't bind video alongside preview and photo. */
    var videoSupported = true
        private set

    var hasFrontCamera = false
        private set

    /** Optical zoom factors of the back camera's lenses, relative to the main one. */
    private var physicalZoomRatios: List<Float> = emptyList()

    var streamSize: Size? = null
        private set

    private var requestedZoom: Float? = null

    init {
        videoSource.capturerObserver.onCapturerStarted(true)
        textureHelper.startListening { frame ->
            framesThisSecond.incrementAndGet()
            val rotation = rotationDegrees
            // The camera service bakes the sensor orientation (and, for the
            // front camera, a horizontal flip) into the SurfaceTexture's
            // transform matrix, so the texture is drawn rotated inside a
            // buffer still sized as the sensor: rotated *and* squashed. Undo
            // both in the matrix and carry the rotation as frame metadata
            // instead, as WebRTC's own Camera2Session does. The remotes then
            // mirror front-camera video themselves, as they do today.
            val buffer = frame.buffer as TextureBufferImpl
            val upright = Matrix().apply {
                preTranslate(0.5f, 0.5f)
                if (mirrorFrames) preScale(-1f, 1f)
                preRotate(-rotation.toFloat())
                preTranslate(-0.5f, -0.5f)
            }
            val out = VideoFrame(
                buffer.applyTransformMatrix(upright, buffer.width, buffer.height),
                rotation,
                frame.timestampNs,
            )
            videoSource.capturerObserver.onFrameCaptured(out)
            out.release()
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
        this.owner = owner
        bindCurrent(owner)
    }

    /** Re-binds to the other camera at 1x. Refused while recording (by the caller). */
    suspend fun switchFacing(): CameraFacing {
        val target = if (facing == CameraFacing.BACK) CameraFacing.FRONT else CameraFacing.BACK
        val currentOwner = owner ?: return facing
        facing = target
        requestedZoom = null
        bindCurrent(currentOwner)
        return facing
    }

    private suspend fun bindCurrent(owner: LifecycleOwner) {
        val provider = ProcessCameraProvider.getInstance(context).await()
        hasFrontCamera = provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)
        if (facing == CameraFacing.FRONT && !hasFrontCamera) facing = CameraFacing.BACK
        val selector = if (facing == CameraFacing.FRONT) {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            CameraSelector.DEFAULT_BACK_CAMERA
        }
        mirrorFrames = facing == CameraFacing.FRONT

        provider.unbindAll()
        val cam = try {
            provider.bindToLifecycle(owner, selector, preview, imageCapture, videoCapture)
                .also { videoSupported = true }
        } catch (e: IllegalArgumentException) {
            // The three-way combination isn't supported here: keep the
            // stream and photos, give up video.
            Log.w(TAG, "Preview + ImageCapture + VideoCapture not supported, binding without video", e)
            provider.unbindAll()
            videoSupported = false
            provider.bindToLifecycle(owner, selector, preview, imageCapture)
        }
        camera = cam
        if (facing == CameraFacing.BACK) physicalZoomRatios = physicalZoomRatios(cam.cameraInfo)
        Log.i(
            TAG,
            "Bound $facing: preview=${preview.resolutionInfo?.resolution} " +
                "photo=${imageCapture.resolutionInfo?.resolution} " +
                "video=${if (videoSupported) videoCapture.resolutionInfo?.resolution else "unbound"} " +
                "lenses=$physicalZoomRatios",
        )
        // A fresh binding starts back at 1x, and by the time a new owner
        // binds, the old owner's destruction has already unbound the camera.
        // So re-apply the zoom we last asked for rather than reading it back.
        requestedZoom?.let { setZoom(it) }
    }

    /**
     * Each physical lens's 35mm-equivalent focal length over the main lens's.
     * The logical camera reports the main lens's optics. Empty for a camera
     * that isn't a logical multi-camera.
     *
     * Pixels list each lens twice: the full sensor, and a "physical camera"
     * with half the sensor size that is really its 2x crop mode. Grouping by
     * focal length and keeping the largest sensor leaves one entry per lens.
     */
    @OptIn(ExperimentalCamera2Interop::class)
    private fun physicalZoomRatios(info: CameraInfo): List<Float> = try {
        val main = optics(Camera2CameraInfo.from(info))?.equivalentFocalLength
        if (main == null) {
            emptyList()
        } else {
            info.physicalCameraInfos
                .mapNotNull { optics(Camera2CameraInfo.from(it)) }
                .groupBy { it.focalLength }
                .map { (_, sameLens) -> sameLens.maxBy { it.sensorDiagonal }.equivalentFocalLength / main }
                .sorted()
        }
    } catch (e: Exception) {
        Log.w(TAG, "Couldn't read physical cameras", e)
        emptyList()
    }

    private data class Optics(val focalLength: Float, val sensorDiagonal: Float) {
        // 43.27mm is the diagonal of a 35mm frame.
        val equivalentFocalLength get() = focalLength * 43.27f / sensorDiagonal
    }

    @OptIn(ExperimentalCamera2Interop::class)
    private fun optics(info: Camera2CameraInfo): Optics? {
        val focal = info.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
            ?.minOrNull() ?: return null
        val sensor = info.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
            ?: return null
        return Optics(focal, hypot(sensor.width, sensor.height))
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
        requestedZoom = clamped
        cam.cameraControl.setZoomRatio(clamped).await()
        return clamped
    }

    /** Zoom buttons for the back camera. */
    fun backLenses(): List<Lens> {
        // The front camera's zoom range says nothing about the back's; keep
        // showing the back lenses (the remote lists them alongside "S").
        val range = if (facing == CameraFacing.BACK) zoomRange else lastBackRange
        if (facing == CameraFacing.BACK) lastBackRange = range
        return Lenses.backLenses(range.start, range.endInclusive, physicalZoomRatios)
    }

    private var lastBackRange: ClosedFloatingPointRange<Float> = 1f..1f

    fun setFlash(mode: FlashMode) {
        imageCapture.flashMode = when (mode) {
            FlashMode.OFF -> ImageCapture.FLASH_MODE_OFF
            FlashMode.ON -> ImageCapture.FLASH_MODE_ON
            FlashMode.AUTO -> ImageCapture.FLASH_MODE_AUTO
        }
    }

    /** Video has no flash, only the torch; recording with flash on uses it. */
    fun setTorch(on: Boolean) {
        val cam = camera ?: return
        if (cam.cameraInfo.hasFlashUnit()) cam.cameraControl.enableTorch(on)
    }

    /**
     * Which way up photos and videos are saved. The app (and so the stream)
     * stays portrait; only captures follow the device. A recording keeps the
     * rotation it started with.
     */
    fun setCaptureRotation(rotation: Int, recording: Boolean) {
        imageCapture.targetRotation = rotation
        if (!recording) videoCapture.targetRotation = rotation
    }

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
        output: OutputOptions,
        withAudio: Boolean,
        onEvent: (VideoRecordEvent) -> Unit,
    ): Recording {
        check(videoSupported) { "Video isn't supported on this camera" }
        var pending = when (output) {
            is MediaStoreOutputOptions -> recorder.prepareRecording(context, output)
            is FileDescriptorOutputOptions -> recorder.prepareRecording(context, output)
            is FileOutputOptions -> recorder.prepareRecording(context, output)
            else -> error("Unsupported output: $output")
        }
        if (withAudio) pending = pending.withAudioEnabled()
        return pending.start(mainExecutor) { onEvent(it) }
    }

    fun release() {
        owner = null
        textureHelper.stopListening()
        textureHelper.dispose()
        videoTrack.dispose()
        videoSource.dispose()
    }

    companion object {
        private const val TAG = "SSCamera"
    }
}
