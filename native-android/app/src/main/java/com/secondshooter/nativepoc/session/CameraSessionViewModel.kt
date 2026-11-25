package com.secondshooter.nativepoc.session

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.viewModelScope
import com.secondshooter.nativepoc.camera.CameraStreamer
import com.secondshooter.nativepoc.camera.Lens
import com.secondshooter.nativepoc.camera.Lenses
import com.secondshooter.nativepoc.media.PhotoStore
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
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
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
    private val photos = PhotoStore(app)
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

    init {
        FirebaseSetup.init(app)
        startStatsLoop()
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
                _ui.update { it.copy(zoom = camera.zoom, lenses = camera.lenses()) }
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
            Command.StartRecording,
            Command.StopRecording,
            is Command.SetFlash,
            Command.SwitchCamera ->
                send(Response.ErrorMessage("${command::class.simpleName} isn't supported in this build yet"))
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
        val started = System.currentTimeMillis()
        try {
            val uri = camera.takePhoto(photos.newPhotoOutput())
            val elapsed = System.currentTimeMillis() - started
            Log.i(TAG, "Photo saved in ${elapsed}ms (remote=$fromRemote)")
            _ui.update { it.copy(lastEvent = "Photo saved in ${elapsed}ms") }
            send(Response.PhotoTaken(success = true))
            if (rtc != null) {
                val thumb = photos.thumbnailBase64(uri)
                Log.i(TAG, "Sending PHOTO_DATA, size=${thumb.length}")
                send(Response.PhotoData(thumb, System.currentTimeMillis()))
            }
        } catch (e: Exception) {
            Log.e(TAG, "takePhoto failed", e)
            _ui.update { it.copy(lastEvent = "Photo failed: ${e.message}") }
            send(Response.PhotoTaken(success = false, error = e.message ?: "Capture failed"))
        }
    }

    private fun sendState() {
        val zoom = camera.zoom
        send(
            Response.StateUpdate(
                state = CameraState(
                    zoom = zoom.toDouble(),
                    flash = settings.value.flash,
                    facing = CameraFacing.BACK,
                    captureMode = CaptureMode.PHOTO,
                    isRecording = false,
                    streamMode = StreamMode.WEBRTC,
                ),
                lenses = Lenses.toLensInfo(camera.lenses(), zoom),
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
        teardownSession()
        camera.release()
        engine.release()
    }

    companion object {
        private const val TAG = "SSSession"
        private const val STATS_TAG = "SSStats"
    }
}
