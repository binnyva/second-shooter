package com.secondshooter.nativepoc.session

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.graphics.Bitmap
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
import com.secondshooter.nativepoc.media.VideoTarget
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.mapLatest
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
    private val store = CaptureStore(app, app.settingsDataStore)
    private val settingsRepository = SettingsRepository(app.settingsDataStore)

    val eglBase: EglBase get() = engine.eglBase
    val videoTrack: VideoTrack get() = camera.videoTrack

    val settings: StateFlow<AppSettings> = settingsRepository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppSettings())

    /** The shutter thumbnail: the newest photo saved to the current destination. */
    @OptIn(ExperimentalCoroutinesApi::class)
    val lastPhoto: StateFlow<Bitmap?> = settings
        .map { it.saveFolderUri }
        .distinctUntilChanged()
        .flatMapLatest { folder -> store.lastPhoto(folder) }
        .distinctUntilChanged()
        .mapLatest { uri -> uri?.let { store.loadThumbnail(it) } }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _ui = MutableStateFlow(CameraUiState())
    val ui: StateFlow<CameraUiState> = _ui.asStateFlow()

    private var signaling: Signaling? = null
    private var rtc: RtcSession? = null
    private val statsTracker = StatsTracker()
    private var firstBind = true
    private var serviceStarted = false
    private var sessionJob: Job? = null
    private var reconnectJob: Job? = null
    /** The current connection's offer is in Firestore (so a "waiting" status is a remote's request). */
    private var offerSent = false

    private var recording: Recording? = null
    private var videoTarget: VideoTarget? = null
    private var startingRecording = false
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

    /**
     * Call once the camera permission is granted. Starts the foreground
     * service and binds the camera to its lifecycle, not the screen's, so
     * the session outlives screen-off and config changes. Safe to repeat.
     */
    fun onCameraPermissionGranted() {
        if (serviceStarted) return
        serviceStarted = true
        CameraSessionService.start(getApplication())
        viewModelScope.launch {
            val service = CameraSessionService.running.filterNotNull().first()
            try {
                camera.bind(service)
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

                // Answers and candidates go to whichever connection is current.
                sig.onAnswer { sdp ->
                    val session = rtc ?: return@onAnswer
                    viewModelScope.launch {
                        runCatching { session.setAnswer(sdp) }
                            .onFailure { Log.e(TAG, "setAnswer failed", it) }
                    }
                }
                sig.onAnswerCandidate { rtc?.addRemoteCandidate(it) }
                sig.onStatus { status ->
                    // A remote found the session already answered and wants
                    // a connection of its own (reload, second device).
                    if (status == "waiting" && offerSent && signaling === sig) {
                        Log.i(TAG, "A remote asked for a fresh offer; starting a new connection")
                        viewModelScope.launch { connectPeer(sig) }
                    }
                }

                connectPeer(sig)
                _ui.update { it.copy(sessionId = sig.sessionId) }
            } catch (e: Exception) {
                Log.e(TAG, "Session setup failed", e)
                _ui.update { it.copy(status = "Setup failed: ${e.message}", canRestart = true) }
            }
        }
    }

    /**
     * A new peer connection on the current session, replacing any previous
     * one: the first remote, or a remote taking over. The video track is
     * reused, so the camera doesn't notice.
     */
    private suspend fun connectPeer(sig: Signaling) {
        reconnectJob?.cancel()
        rtc?.close()
        rtc = null
        offerSent = false
        statsTracker.reset()
        _ui.update { it.copy(connected = false, canRestart = false, status = "Waiting for remote") }

        val ice = IceServers.fetch()
        if (signaling !== sig) return
        var self: RtcSession? = null
        val session = RtcSession(engine.factory, camera.videoTrack, ice.servers, rtcListener(sig) { self })
        self = session
        rtc = session

        sig.sendOffer(session.createOffer())
        offerSent = true
        _ui.update {
            it.copy(status = "Waiting for remote" + if (ice.hasTurn) "" else " (no TURN, STUN only)")
        }
    }

    /**
     * After a drop, renegotiate with an ICE restart on the same connection,
     * paced as in the RN app: a grace period (short drops recover on their
     * own), then a fresh offer every few seconds. The data channel survives,
     * so the remote picks up where it left off without re-pairing.
     */
    private fun startReconnect(sig: Signaling, session: RtcSession) {
        if (reconnectJob?.isActive == true) return
        reconnectJob = viewModelScope.launch {
            delay(RECONNECT_GRACE_MS)
            repeat(RECONNECT_MAX_ATTEMPTS) { attempt ->
                if (rtc !== session || signaling !== sig || _ui.value.connected) return@launch
                try {
                    sig.sendOffer(session.createOffer(iceRestart = true))
                    Log.i(TAG, "Sent ICE-restart offer (attempt ${attempt + 1})")
                } catch (e: CancellationException) {
                    throw e // reconnected meanwhile
                } catch (e: Exception) {
                    Log.w(TAG, "Reconnect attempt ${attempt + 1} failed", e)
                }
                delay(RECONNECT_RETRY_MS)
            }
            if (rtc === session && !_ui.value.connected) {
                Log.i(TAG, "Remote didn't come back; waiting for one to join")
                _ui.update { it.copy(status = "Remote gone. Scan to reconnect", canRestart = true) }
            }
        }
    }

    private fun rtcListener(sig: Signaling, self: () -> RtcSession?) = object : RtcSession.Listener {
        private fun isCurrent() = signaling === sig && rtc != null && rtc === self()

        override fun onLocalCandidate(candidate: IceCandidate) {
            viewModelScope.launch {
                if (!isCurrent()) return@launch
                runCatching { sig.addOfferCandidate(candidate) }
                    .onFailure { Log.w(TAG, "Failed to send ICE candidate", it) }
            }
        }

        override fun onConnectionState(state: PeerConnection.PeerConnectionState) {
            viewModelScope.launch(Dispatchers.Main) {
                if (!isCurrent()) return@launch
                Log.i(TAG, "Connection state: $state")
                when (state) {
                    PeerConnection.PeerConnectionState.CONNECTED -> {
                        reconnectJob?.cancel()
                        _ui.update { it.copy(status = "Connected", connected = true, canRestart = false) }
                    }
                    PeerConnection.PeerConnectionState.CONNECTING ->
                        _ui.update { it.copy(status = if (it.connected) "Reconnecting…" else "Connecting…") }
                    PeerConnection.PeerConnectionState.DISCONNECTED,
                    PeerConnection.PeerConnectionState.FAILED -> {
                        _ui.update { it.copy(status = "Reconnecting…", connected = false) }
                        self()?.let { startReconnect(sig, it) }
                    }
                    PeerConnection.PeerConnectionState.CLOSED ->
                        _ui.update { it.copy(status = "Connection closed", connected = false, canRestart = true) }
                    else -> Unit
                }
            }
        }

        override fun onDataChannelOpen() {
            viewModelScope.launch(Dispatchers.Main) { sendState() }
        }

        override fun onMessage(text: String) {
            val decoded = Protocol.decodeCommand(text) ?: return
            viewModelScope.launch(Dispatchers.Main) {
                if (!isCurrent()) return@launch
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
        viewModelScope.launch { switchCameraNow() }
    }

    private suspend fun switchCameraNow() {
        try {
            camera.switchFacing()
        } catch (e: Exception) {
            Log.e(TAG, "switchCamera failed", e)
            _ui.update { it.copy(lastEvent = "Camera switch failed: ${e.message}") }
        }
        refreshCameraUi()
        sendState()
    }

    fun setZoomFromUi(level: Float) {
        viewModelScope.launch { setZoom(level) }
    }

    /**
     * A lens button on this phone: "S" switches to the front camera; a back
     * lens switches back first if needed, then zooms. In order, so no delay
     * is needed between the two (the RN app waited 500ms).
     */
    fun selectLensFromUi(lensId: String, zoom: Float) {
        if (recording != null) return
        viewModelScope.launch {
            if (lensId == "selfie") {
                if (camera.facing != CameraFacing.FRONT) switchCameraNow()
                return@launch
            }
            if (camera.facing == CameraFacing.FRONT) switchCameraNow()
            setZoom(zoom)
        }
    }

    /** Messages are shown briefly; the screen clears them. */
    fun clearEvent() {
        _ui.update { it.copy(lastEvent = null) }
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
            // Capture and save both happen inside the queue, so a burst lands
            // in the folder in the order it was shot.
            val (saved, started) = captureQueue.withLock {
                val started = System.currentTimeMillis()
                val (options, temp) = store.newPhotoCapture()
                camera.takePhoto(options)
                store.savePhoto(temp, settings.value.saveFolderUri) to started
            }
            val uri = saved.uri
            val elapsed = System.currentTimeMillis() - started
            if (started - queuedAt > 50) Log.i(TAG, "Photo waited ${started - queuedAt}ms in the queue")
            val where = if (saved.inFolder) "folder" else "camera roll"
            Log.i(TAG, "Photo saved to $where in ${elapsed}ms (remote=$fromRemote)")
            if (!saved.inFolder && settings.value.saveFolderUri != null) {
                _ui.update { it.copy(lastEvent = "Couldn't write to the folder; saved to the camera roll") }
            }
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
        if (recording != null || startPendingOnMic || startingRecording) return
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
        // Claim the microphone service type, so recordings keep their sound
        // with the screen off.
        if (granted) CameraSessionService.running.value?.goForeground()
        if (startPendingOnMic) {
            startPendingOnMic = false
            startRecording(withAudio = granted)
        }
    }

    private fun startRecording(withAudio: Boolean) {
        startingRecording = true
        // Recording means the camera is in video mode; tell the remote so its
        // shutter becomes a stop button.
        _ui.update { it.copy(captureMode = CaptureMode.VIDEO) }
        viewModelScope.launch {
            val target = store.newVideoTarget(settings.value.saveFolderUri)
            // Video has no flash; "on" or "auto" means the torch, as in the RN app.
            if (settings.value.flash != FlashMode.OFF) camera.setTorch(true)
            try {
                videoTarget = target
                recording = camera.startRecording(target.options, withAudio, ::onRecordEvent)
                if (!withAudio) {
                    _ui.update { it.copy(lastEvent = "Recording without sound (microphone not allowed)") }
                }
            } catch (e: Exception) {
                Log.e(TAG, "startRecording failed", e)
                recording = null
                videoTarget = null
                target.close()
                camera.setTorch(false)
                _ui.update { it.copy(lastEvent = "Recording failed: ${e.message}") }
                send(Response.ErrorMessage("Couldn't start recording: ${e.message}"))
                sendState()
            } finally {
                startingRecording = false
            }
        }
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
                videoTarget?.close()
                videoTarget = null
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
                    _ui.update { it.copy(isRecording = false) }
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
        reconnectJob?.cancel()
        offerSent = false
        rtc?.close()
        rtc = null
        signaling?.close()
        signaling = null
        statsTracker.reset()
    }

    override fun onCleared() {
        CameraSessionService.stop(getApplication())
        orientationListener.disable()
        recording?.stop()
        teardownSession()
        camera.release()
        engine.release()
    }

    companion object {
        private const val TAG = "SSSession"
        private const val STATS_TAG = "SSStats"

        // Same pacing as app/index.tsx.
        private const val RECONNECT_GRACE_MS = 3000L
        private const val RECONNECT_RETRY_MS = 5000L
        private const val RECONNECT_MAX_ATTEMPTS = 12
    }
}
