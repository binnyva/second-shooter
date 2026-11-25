package com.secondshooter.nativepoc.session

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.view.OrientationEventListener
import android.util.Log
import androidx.camera.video.Recording
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.viewModelScope
import com.secondshooter.nativepoc.camera.CameraStreamer
import com.secondshooter.nativepoc.camera.Lens
import com.secondshooter.nativepoc.camera.Lenses
import com.secondshooter.nativepoc.camera.captureRotationFor
import com.secondshooter.nativepoc.protocol.FlashMode
import com.secondshooter.nativepoc.media.CaptureStore
import com.secondshooter.nativepoc.protocol.CameraFacing
import com.secondshooter.nativepoc.protocol.CameraState
import com.secondshooter.nativepoc.protocol.CaptureMode
import com.secondshooter.nativepoc.protocol.Command
import com.secondshooter.nativepoc.protocol.DecodedCommand
import com.secondshooter.nativepoc.protocol.Protocol
import com.secondshooter.nativepoc.protocol.Response
import com.secondshooter.nativepoc.protocol.StreamMode
import com.secondshooter.nativepoc.rtc.IceServers
import com.secondshooter.nativepoc.rtc.RtcSession
import com.secondshooter.nativepoc.rtc.StatsTracker
import com.secondshooter.nativepoc.rtc.WebRtcEngine
import com.secondshooter.nativepoc.settings.AppSettings
import com.secondshooter.nativepoc.settings.SettingsRepository
import com.secondshooter.nativepoc.settings.settingsDataStore
import com.secondshooter.nativepoc.signaling.FirebaseSetup
import com.secondshooter.nativepoc.signaling.SessionIds
import com.secondshooter.nativepoc.signaling.Signaling
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection
import org.webrtc.VideoTrack

data class CameraUiState(
    val status: String = "Starting camera…",
    val sessionId: String? = null,
    val connected: Boolean = false,
    val canRestart: Boolean = false,
    val zoom: Float = INITIAL_ZOOM,
    val lenses: List<Lens> = emptyList(),
    val stats: String? = null,
    val lastEvent: String? = null,
    val captureMode: CaptureMode = CaptureMode.PHOTO,
    val isRecording: Boolean = false,
    /** Elapsed recording time, while recording. */
    val recordedSeconds: Long = 0,
    val videoSupported: Boolean = true,
    val facing: CameraFacing = CameraFacing.BACK,
    val hasFrontCamera: Boolean = false,
    /** Seconds left on the self-timer, or null when it isn't running. */
    val countdown: Int? = null,
)

const val INITIAL_ZOOM = 2f

/**
 * Owns everything that must outlive the activity: the camera use cases, the
 * WebRTC track, the Firestore session and the peer connection. A recreated
 * activity (dark mode toggle, any config change) only re-binds the camera to
 * its new lifecycle; the remote stays connected.
 *
 * Runs on the main thread; WebRTC callbacks are hopped back onto it.
 */
class CameraSessionViewModel(app: Application) : AndroidViewModel(app) {
    private val engine = WebRtcEngine(app)
    private val camera = CameraStreamer(app, engine.eglBase, engine.factory)
    private val store = CaptureStore(app)
    private val settingsRepository = SettingsRepository(app.settingsDataStore)

    val eglBase: EglBase get() = engine.eglBase
    val videoTrack: VideoTrack get() = camera.videoTrack

    val settings: StateFlow<AppSettings> = settingsRepository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppSettings())

    private val _ui = MutableStateFlow(CameraUiState())
    val ui: StateFlow<CameraUiState> = _ui.asStateFlow()

    private var signaling: Signaling? = null
    private var rtc: RtcSession? = null
    private val statsTracker = StatsTracker()
    private var firstBind = true
    private var sessionJob: Job? = null

    private var recording: Recording? = null
    /** A start that's waiting on the microphone prompt. */
    private var startPendingOnMic = false
    private var askedForMic = false

    /** True while the screen should show the microphone permission prompt. */
    private val _micPermissionRequest = MutableStateFlow(false)
    val micPermissionRequest: StateFlow<Boolean> = _micPermissionRequest.asStateFlow()

    /**
     * One photo at a time, whoever asked (remote, screen, volume keys): a
     * burst queues up behind the shot in flight, as src/utils/captureQueue.ts
     * did. No camera lock to manage any more, so that's all it does.
     */
    private val captureQueue = Mutex()
    private var countdownJob: Job? = null

    private val orientationListener = object : OrientationEventListener(app) {
        override fun onOrientationChanged(degrees: Int) {
            if (degrees == ORIENTATION_UNKNOWN) return
            camera.setCaptureRotation(captureRotationFor(degrees), recording = recording != null)
        }
    }

    init {
        FirebaseSetup.init(app)
        startStatsLoop()
        orientationListener.enable()
        // Flash lives in settings, so a change from the remote, the screen or
        // a previous run all land here.
        viewModelScope.launch {
            settings.map { it.flash }.distinctUntilChanged().collect { flash ->
                camera.setFlash(flash)
                sendState()
            }
        }
    }

    /** Call with each lifecycle the camera should follow (after permission is granted). */
    fun bindCamera(owner: LifecycleOwner) {
        viewModelScope.launch {
            try {
                camera.bind(owner)
                if (firstBind) {
                    firstBind = false
                    camera.setZoom(INITIAL_ZOOM)
                    startSession()
                }
                refreshCameraUi()
            } catch (e: Exception) {
                Log.e(TAG, "Camera bind failed", e)
                _ui.update { it.copy(status = "Camera failed: ${e.message}") }
            }
        }
    }

    fun startSession() {
        sessionJob?.cancel()
        sessionJob = viewModelScope.launch {
            teardownSession()
            _ui.update {
                it.copy(status = "Creating session…", sessionId = null, connected = false, canRestart = false)
            }
            try {
                FirebaseSetup.ensureSignedIn()
                val sig = Signaling(SessionIds.generate())
                signaling = sig
                sig.create()

                val ice = IceServers.fetch()
                val session = RtcSession(engine.factory, camera.videoTrack, ice.servers, rtcListener(sig))
                rtc = session

                sig.sendOffer(session.createOffer())
                sig.onAnswer { sdp ->
                    viewModelScope.launch {
                        runCatching { session.setAnswer(sdp) }
                            .onFailure { Log.e(TAG, "setAnswer failed", it) }
                    }
                }
                sig.onAnswerCandidate { session.addRemoteCandidate(it) }

                _ui.update {
                    it.copy(
                        sessionId = sig.sessionId,
                        status = "Waiting for remote" + if (ice.hasTurn) "" else " (no TURN, STUN only)",
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Session setup failed", e)
                _ui.update { it.copy(status = "Setup failed: ${e.message}", canRestart = true) }
            }
        }
    }

    private fun rtcListener(sig: Signaling) = object : RtcSession.Listener {
        override fun onLocalCandidate(candidate: IceCandidate) {
            viewModelScope.launch {
                runCatching { sig.addOfferCandidate(candidate) }
                    .onFailure { Log.w(TAG, "Failed to send ICE candidate", it) }
            }
        }

        override fun onConnectionState(state: PeerConnection.PeerConnectionState) {
            viewModelScope.launch(Dispatchers.Main) {
                if (signaling !== sig) return@launch
                Log.i(TAG, "Connection state: $state")
                _ui.update { ui ->
                    when (state) {
                        PeerConnection.PeerConnectionState.CONNECTED ->
                            ui.copy(status = "Connected", connected = true, canRestart = false)
                        PeerConnection.PeerConnectionState.CONNECTING ->
                            ui.copy(status = "Connecting…")
                        PeerConnection.PeerConnectionState.DISCONNECTED ->
                            ui.copy(status = "Disconnected", connected = false, canRestart = true)
                        PeerConnection.PeerConnectionState.FAILED,
                        PeerConnection.PeerConnectionState.CLOSED ->
                            ui.copy(
                                status = "Connection ${state.name.lowercase()}",
                                connected = false,
                                canRestart = true,
                            )
                        else -> ui
                    }
                }
            }
        }

        override fun onDataChannelOpen() {
            viewModelScope.launch(Dispatchers.Main) { sendState() }
        }

        override fun onMessage(text: String) {
            val decoded = Protocol.decodeCommand(text) ?: return
            viewModelScope.launch(Dispatchers.Main) {
                if (signaling !== sig) return@launch
                when (decoded) {
                    is DecodedCommand.Known -> handle(decoded.command)
                    is DecodedCommand.Unknown -> send(Response.ErrorMessage("Unknown command ${decoded.type}"))
                }
            }
        }
    }

    private suspend fun handle(command: Command) {
        when (command) {
            Command.GetState -> sendState()
            is Command.SetZoom -> setZoom(command.level.toFloat())
            Command.TakePhoto -> takePhoto(fromRemote = true)
            Command.StartRecording -> requestStartRecording()
            Command.StopRecording -> stopRecording()
            is Command.SetFlash -> setFlash(command.mode)
            Command.SwitchCamera -> switchCamera()
        }
    }

    private fun refreshCameraUi() {
        _ui.update {
            it.copy(
                zoom = camera.zoom,
                lenses = camera.backLenses(),
                videoSupported = camera.videoSupported,
                facing = camera.facing,
                hasFrontCamera = camera.hasFrontCamera,
            )
        }
    }

    fun setFlash(mode: FlashMode) {
        viewModelScope.launch { settingsRepository.update { it.copy(flash = mode) } }
    }

    fun cycleFlashFromUi() {
        val next = when (settings.value.flash) {
            FlashMode.OFF -> FlashMode.ON
            FlashMode.ON -> FlashMode.AUTO
            FlashMode.AUTO -> FlashMode.OFF
        }
        setFlash(next)
    }

    fun switchCamera() {
        if (recording != null) {
            send(Response.ErrorMessage("Can't switch cameras while recording"))
            return
        }
        viewModelScope.launch {
            try {
                camera.switchFacing()
            } catch (e: Exception) {
                Log.e(TAG, "switchCamera failed", e)
                _ui.update { it.copy(lastEvent = "Camera switch failed: ${e.message}") }
            }
            refreshCameraUi()
            sendState()
        }
    }

    fun setZoomFromUi(level: Float) {
        viewModelScope.launch { setZoom(level) }
    }

    private suspend fun setZoom(level: Float) {
        runCatching { camera.setZoom(level) }
            .onFailure { Log.w(TAG, "setZoom($level) failed", it) }
        _ui.update { it.copy(zoom = camera.zoom) }
        sendState()
    }

    fun takePhotoFromUi() {
        viewModelScope.launch { takePhoto(fromRemote = false) }
    }

    private suspend fun takePhoto(fromRemote: Boolean) {
        val queuedAt = System.currentTimeMillis()
        try {
            val (uri, started) = captureQueue.withLock {
                val started = System.currentTimeMillis()
                camera.takePhoto(store.newPhotoOutput()) to started
            }
            val elapsed = System.currentTimeMillis() - started
            if (started - queuedAt > 50) Log.i(TAG, "Photo waited ${started - queuedAt}ms in the queue")
            Log.i(TAG, "Photo saved in ${elapsed}ms (remote=$fromRemote)")
            _ui.update { it.copy(lastEvent = "Photo saved in ${elapsed}ms") }
            send(Response.PhotoTaken(success = true))
            if (rtc != null) {
                val thumb = store.thumbnailBase64(uri)
                Log.i(TAG, "Sending PHOTO_DATA, size=${thumb.length}")
                send(Response.PhotoData(thumb, System.currentTimeMillis()))
            }
        } catch (e: Exception) {
            Log.e(TAG, "takePhoto failed", e)
            _ui.update { it.copy(lastEvent = "Photo failed: ${e.message}") }
            send(Response.PhotoTaken(success = false, error = e.message ?: "Capture failed"))
        }
    }

    fun setCaptureModeFromUi(mode: CaptureMode) {
        if (_ui.value.isRecording) return
        _ui.update { it.copy(captureMode = mode) }
        sendState()
    }

    /**
     * The phone's own shutter and the volume keys: a photo (after the
     * self-timer, if set), or start/stop in video mode. Pressing during a
     * countdown cancels it. Photos from the remote skip the timer, as before.
     */
    fun shutterFromUi() {
        when {
            countdownJob?.isActive == true -> cancelCountdown()
            _ui.value.isRecording -> stopRecording()
            _ui.value.captureMode == CaptureMode.VIDEO -> requestStartRecording()
            settings.value.timer.seconds > 0 -> startCountdown(settings.value.timer.seconds)
            else -> takePhotoFromUi()
        }
    }

    private fun startCountdown(seconds: Int) {
        countdownJob = viewModelScope.launch {
            for (left in seconds downTo 1) {
                _ui.update { it.copy(countdown = left) }
                delay(1000)
            }
            _ui.update { it.copy(countdown = null) }
            takePhoto(fromRemote = false)
        }
    }

    private fun cancelCountdown() {
        countdownJob?.cancel()
        countdownJob = null
        _ui.update { it.copy(countdown = null) }
    }

    private fun requestStartRecording() {
        if (recording != null || startPendingOnMic) return
        if (!camera.videoSupported) {
            send(Response.ErrorMessage("This camera can't record video while streaming"))
            return
        }
        val micGranted = ContextCompat.checkSelfPermission(
            getApplication(), Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        if (!micGranted && !askedForMic) {
            // Ask once per run, on the camera phone; the remote waits for
            // RECORDING_STARTED. Refusing still records, just without sound.
            askedForMic = true
            startPendingOnMic = true
            _ui.update { it.copy(lastEvent = "Allow the microphone on this phone to record sound") }
            _micPermissionRequest.value = true
            return
        }
        startRecording(withAudio = micGranted)
    }

    fun onMicPermissionResult(granted: Boolean) {
        _micPermissionRequest.value = false
        if (startPendingOnMic) {
            startPendingOnMic = false
            startRecording(withAudio = granted)
        }
    }

    private fun startRecording(withAudio: Boolean) {
        // Recording means the camera is in video mode; tell the remote so its
        // shutter becomes a stop button.
        _ui.update { it.copy(captureMode = CaptureMode.VIDEO) }
        // Video has no flash; "on" or "auto" means the torch, as in the RN app.
        if (settings.value.flash != FlashMode.OFF) camera.setTorch(true)
        try {
            recording = camera.startRecording(store.newVideoOutput(), withAudio, ::onRecordEvent)
        } catch (e: Exception) {
            Log.e(TAG, "startRecording failed", e)
            recording = null
            _ui.update { it.copy(lastEvent = "Recording failed: ${e.message}") }
            send(Response.ErrorMessage("Couldn't start recording: ${e.message}"))
            sendState()
        }
        if (!withAudio) _ui.update { it.copy(lastEvent = "Recording without sound (microphone not allowed)") }
    }

    private fun onRecordEvent(event: VideoRecordEvent) {
        when (event) {
            is VideoRecordEvent.Start -> {
                Log.i(TAG, "Recording started")
                _ui.update { it.copy(isRecording = true, recordedSeconds = 0) }
                send(Response.RecordingStarted)
                sendState()
            }
            is VideoRecordEvent.Status -> {
                val seconds = event.recordingStats.recordedDurationNanos / 1_000_000_000
                if (seconds != _ui.value.recordedSeconds) _ui.update { it.copy(recordedSeconds = seconds) }
            }
            is VideoRecordEvent.Finalize -> {
                recording = null
                camera.setTorch(false)
                val stats = event.recordingStats
                val seconds = stats.recordedDurationNanos / 1_000_000_000
                val megabytes = stats.numBytesRecorded / 1_000_000
                if (event.hasError()) {
                    // Some errors (e.g. size limit) still leave a playable file.
                    val reason = "error ${event.error}" + (event.cause?.message?.let { ": $it" } ?: "")
                    Log.e(TAG, "Recording ended with $reason after ${seconds}s, ${megabytes}MB", event.cause)
                    _ui.update { it.copy(isRecording = false, lastEvent = "Recording ended ($reason)") }
                    send(Response.RecordingStopped(success = false, error = "Recording ended ($reason)"))
                } else {
                    Log.i(TAG, "Recording saved: ${seconds}s, ${megabytes}MB, ${event.outputResults.outputUri}")
                    _ui.update { it.copy(isRecording = false, lastEvent = "Video saved: ${seconds}s, ${megabytes}MB") }
                    send(Response.RecordingStopped(success = true))
                }
                sendState()
            }
            else -> Unit
        }
    }

    private fun stopRecording() {
        val active = recording
        if (active == null) {
            send(Response.RecordingStopped(success = false, error = "Not recording"))
            return
        }
        // RECORDING_STOPPED goes out on Finalize, once the file is written.
        active.stop()
    }

    private fun sendState() {
        val zoom = camera.zoom
        send(
            Response.StateUpdate(
                state = CameraState(
                    zoom = zoom.toDouble(),
                    flash = settings.value.flash,
                    facing = camera.facing,
                    captureMode = _ui.value.captureMode,
                    isRecording = _ui.value.isRecording,
                    streamMode = StreamMode.WEBRTC,
                ),
                lenses = Lenses.toLensInfo(camera.backLenses(), zoom, camera.facing, camera.hasFrontCamera),
                videoNeedsRotation = false,
                previewZoomLimited = false,
                streamMode = StreamMode.WEBRTC,
            )
        )
    }

    private fun send(response: Response) {
        rtc?.send(Protocol.encode(response))
    }

    /** Once a second: camera fps always, encoder stats while connected. */
    private fun startStatsLoop() {
        viewModelScope.launch {
            while (isActive) {
                delay(1000)
                val cameraFps = camera.takeFrameCount()
                val size = camera.streamSize?.let { "${it.width}x${it.height}" } ?: "?"
                val session = rtc
                val outbound = if (session != null && _ui.value.connected) {
                    runCatching { statsTracker.summarize(session.stats()) }.getOrNull()
                } else null
                val line = buildString {
                    if (_ui.value.isRecording) append("REC ${_ui.value.recordedSeconds}s · ")
                    append("Camera $size @ ${cameraFps}fps · zoom ${"%.1f".format(camera.zoom)}x")
                    if (outbound != null) append("\n").append(outbound)
                }
                Log.i(STATS_TAG, line.replace('\n', ' '))
                _ui.update { it.copy(stats = line) }
            }
        }
    }

    private fun teardownSession() {
        rtc?.close()
        rtc = null
        signaling?.close()
        signaling = null
        statsTracker.reset()
    }

    override fun onCleared() {
        orientationListener.disable()
        recording?.stop()
        teardownSession()
        camera.release()
        engine.release()
    }

    companion object {
        private const val TAG = "SSSession"
        private const val STATS_TAG = "SSStats"
    }
}
