package com.secondshooter.app.session

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.secondshooter.app.protocol.CameraFacing
import com.secondshooter.app.protocol.CameraState
import com.secondshooter.app.protocol.CaptureMode
import com.secondshooter.app.protocol.Command
import com.secondshooter.app.protocol.FlashMode
import com.secondshooter.app.protocol.LensInfo
import com.secondshooter.app.protocol.Protocol
import com.secondshooter.app.protocol.Response
import com.secondshooter.app.protocol.StreamMode
import com.secondshooter.app.rtc.IceServers
import com.secondshooter.app.rtc.RemoteRtcSession
import com.secondshooter.app.rtc.WebRtcEngine
import com.secondshooter.app.signaling.FirebaseSetup
import com.secondshooter.app.signaling.RemoteSignaling
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection
import org.webrtc.VideoTrack
import java.io.File

enum class RemotePhase { SCANNING, CONNECTING, CONNECTED, RECONNECTING, FAILED }

data class RemoteUiState(
    val phase: RemotePhase = RemotePhase.SCANNING,
    val sessionId: String? = null,
    /** Why the connection failed, for the placeholder. */
    val failure: String? = null,
    val camera: CameraState = CameraState(
        zoom = 1.0,
        flash = FlashMode.OFF,
        facing = CameraFacing.BACK,
        captureMode = CaptureMode.PHOTO,
        isRecording = false,
    ),
    val lenses: List<LensInfo> = emptyList(),
    val streamMode: StreamMode = StreamMode.WEBRTC,
    val hasVideo: Boolean = false,
    /** Reconnecting for longer than a blip: cover the stale image. */
    val stalled: Boolean = false,
    val photos: List<HistoryPhoto> = emptyList(),
    /** The React Native camera sends CAPTURE_STATE while its preview is down. */
    val capturing: Boolean = false,
    val lastEvent: String? = null,
)

/**
 * This phone as the remote: the Kotlin version of src/screens/RemoteScreen.tsx
 * and the web remote. Joins a session, answers the camera's offers (the first,
 * ICE restarts after a drop, and nothing from a connection made for another
 * remote), shows the video and sends commands. The camera owns reconnection;
 * this side only answers.
 */
class RemoteViewModel(app: Application) : AndroidViewModel(app) {
    private val engine = WebRtcEngine(app)
    val eglBase: EglBase get() = engine.eglBase

    private val _ui = MutableStateFlow(RemoteUiState())
    val ui: StateFlow<RemoteUiState> = _ui.asStateFlow()

    private val _videoTrack = MutableStateFlow<VideoTrack?>(null)
    val videoTrack: StateFlow<VideoTrack?> = _videoTrack.asStateFlow()

    private val _lastThumbnail = MutableStateFlow<Bitmap?>(null)
    val lastThumbnail: StateFlow<Bitmap?> = _lastThumbnail.asStateFlow()

    private var signaling: RemoteSignaling? = null
    private var rtc: RemoteRtcSession? = null
    private var connectJob: Job? = null
    private var stallJob: Job? = null
    private var dataChannelOpen = false

    private val photoDir = File(app.cacheDir, "remote-previews")

    init {
        FirebaseSetup.init(app)
    }

    /** Join [sessionId] (from a scan or a link). A no-op while already on it. */
    fun connect(sessionId: String) {
        if (_ui.value.sessionId == sessionId && _ui.value.phase != RemotePhase.FAILED &&
            _ui.value.phase != RemotePhase.SCANNING
        ) return
        disconnect()
        clearPhotos()
        _ui.update { RemoteUiState(phase = RemotePhase.CONNECTING, sessionId = sessionId) }
        connectJob = viewModelScope.launch {
            try {
                FirebaseSetup.ensureSignedIn()
                val sig = RemoteSignaling(sessionId)
                if (!sig.join()) {
                    fail("Session not found. Scan the QR code again.")
                    return@launch
                }
                signaling = sig
                val ice = IceServers.fetch()
                val session = RemoteRtcSession(engine.factory, ice.servers, listener(sig))
                rtc = session

                // A session someone already answered needs a fresh offer.
                runCatching { sig.claim() }.onFailure { Log.w(TAG, "claim failed", it) }

                sig.onSessionMissing { fail("The camera ended this session.") }
                sig.onOfferCandidate { session.addRemoteCandidate(it) }
                sig.onOffer { sdp ->
                    viewModelScope.launch {
                        if (rtc !== session) return@launch
                        if (session.isOfferForAnotherConnection(sdp)) {
                            fail("Another remote has taken over this session.")
                            return@launch
                        }
                        try {
                            sig.sendAnswer(session.answer(sdp))
                        } catch (e: Exception) {
                            Log.e(TAG, "Answering failed", e)
                            fail("Unable to connect to the camera.")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Connect failed", e)
                fail("Failed to connect to the camera. Please try again.")
            }
        }
    }

    private fun listener(sig: RemoteSignaling) = object : RemoteRtcSession.Listener {
        private fun current() = signaling === sig

        override fun onLocalCandidate(candidate: IceCandidate) {
            viewModelScope.launch {
                if (current()) runCatching { sig.addAnswerCandidate(candidate) }
            }
        }

        override fun onConnectionState(state: PeerConnection.PeerConnectionState) {
            viewModelScope.launch(Dispatchers.Main) {
                if (!current()) return@launch
                Log.i(TAG, "Connection state: $state")
                when (state) {
                    PeerConnection.PeerConnectionState.CONNECTED -> {
                        stallJob?.cancel()
                        _ui.update { it.copy(phase = RemotePhase.CONNECTED, stalled = false) }
                        // The data channel survives a reconnect, so its open
                        // event doesn't fire again; ask for state on every
                        // (re)connection (AGENTS.md, "Reconnection").
                        if (dataChannelOpen) send(Command.GetState)
                    }
                    PeerConnection.PeerConnectionState.DISCONNECTED,
                    PeerConnection.PeerConnectionState.FAILED -> {
                        if (_ui.value.phase == RemotePhase.CONNECTED || _ui.value.phase == RemotePhase.RECONNECTING) {
                            _ui.update { it.copy(phase = RemotePhase.RECONNECTING, capturing = false) }
                            startStallTimer()
                        }
                    }
                    else -> Unit
                }
            }
        }

        override fun onVideoTrack(track: VideoTrack) {
            viewModelScope.launch(Dispatchers.Main) {
                if (!current()) return@launch
                _videoTrack.value = track
                _ui.update { it.copy(hasVideo = true) }
            }
        }

        override fun onDataChannelOpen() {
            viewModelScope.launch(Dispatchers.Main) {
                if (!current()) return@launch
                dataChannelOpen = true
                send(Command.GetState)
            }
        }

        override fun onMessage(text: String) {
            val response = runCatching { Protocol.json.decodeFromString(Response.serializer(), text) }.getOrNull()
                ?: return
            viewModelScope.launch(Dispatchers.Main) {
                if (current()) handle(response)
            }
        }
    }

    private fun startStallTimer() {
        stallJob?.cancel()
        stallJob = viewModelScope.launch {
            delay(STALLED_RECONNECT_MS)
            if (_ui.value.phase == RemotePhase.RECONNECTING) _ui.update { it.copy(stalled = true) }
        }
    }

    private suspend fun handle(response: Response) {
        when (response) {
            is Response.StateUpdate -> _ui.update {
                it.copy(
                    camera = response.state,
                    lenses = response.lenses ?: it.lenses,
                    streamMode = response.streamMode ?: it.streamMode,
                )
            }
            is Response.PhotoData -> addPhoto(response.data, response.timestamp)
            is Response.PhotoTaken ->
                if (!response.success) event(response.error ?: "Failed to take photo")
            Response.RecordingStarted -> _ui.update { it.copy(camera = it.camera.copy(isRecording = true)) }
            is Response.RecordingStopped -> {
                _ui.update { it.copy(camera = it.camera.copy(isRecording = false)) }
                if (!response.success) event(response.error ?: "Failed to stop recording")
            }
            is Response.ErrorMessage -> event(response.message)
            is Response.CaptureState -> _ui.update { it.copy(capturing = response.capturing) }
            // Frame-based preview is the React Native camera's fallback; this
            // remote shows only the video track (see the placeholder text).
            is Response.FrameData -> Unit
        }
    }

    // --- Commands -------------------------------------------------------

    private fun send(command: Command) {
        rtc?.send(Protocol.json.encodeToString(Command.serializer(), command))
    }

    private val connected get() = _ui.value.phase == RemotePhase.CONNECTED

    /** The shutter (and volume keys): photo, or start/stop in video mode. */
    fun shutter() {
        if (!connected) return
        val camera = _ui.value.camera
        when {
            camera.captureMode == CaptureMode.PHOTO -> send(Command.TakePhoto)
            camera.isRecording -> send(Command.StopRecording)
            else -> send(Command.StartRecording)
        }
    }

    /** Local only: the camera reports its own mode, and STATE_UPDATE wins. */
    fun setCaptureMode(mode: CaptureMode) {
        _ui.update { it.copy(camera = it.camera.copy(captureMode = mode)) }
    }

    /** As CameraControls.tsx: the selfie button switches; a back lens from the front switches, then zooms. */
    fun selectLens(lens: LensInfo) {
        if (!connected) return
        val onFront = _ui.value.camera.facing == CameraFacing.FRONT
        if (lens.id == "selfie") {
            if (!onFront) send(Command.SwitchCamera)
            return
        }
        if (onFront) {
            send(Command.SwitchCamera)
            if (lens.zoom == 1.0) return
            viewModelScope.launch {
                delay(500) // let the switch land first, as the RN and web remotes do
                send(Command.SetZoom(lens.zoom))
            }
            return
        }
        send(Command.SetZoom(lens.zoom))
    }

    // --- Photos ---------------------------------------------------------

    private suspend fun addPhoto(base64: String, timestamp: Long) {
        val file = withContext(Dispatchers.IO) {
            photoDir.mkdirs()
            File(photoDir, "$timestamp.jpg").apply { writeBytes(Base64.decode(base64, Base64.DEFAULT)) }
        }
        Log.i(TAG, "Photo preview received, size=${base64.length}")
        val result = appendPhoto(_ui.value.photos, HistoryPhoto(file.path, timestamp), MAX_PHOTOS)
        result.evicted.forEach { File(it.path).delete() }
        _ui.update { it.copy(photos = result.list) }
        _lastThumbnail.value = withContext(Dispatchers.IO) {
            BitmapFactory.decodeFile(result.list.last().path, BitmapFactory.Options().apply { inSampleSize = 4 })
        }
    }

    private fun clearPhotos() {
        _ui.value.photos.forEach { File(it.path).delete() }
        _lastThumbnail.value = null
    }

    // --- Lifecycle ------------------------------------------------------

    private fun event(message: String) = _ui.update { it.copy(lastEvent = message) }

    fun clearEvent() = _ui.update { it.copy(lastEvent = null) }

    private fun fail(reason: String) {
        disconnect()
        _ui.update { it.copy(phase = RemotePhase.FAILED, failure = reason, hasVideo = false, stalled = false) }
    }

    /** Back to the scanner (the QR button). */
    fun rescan() {
        disconnect()
        clearPhotos()
        _ui.value = RemoteUiState(phase = RemotePhase.SCANNING)
    }

    private fun disconnect() {
        connectJob?.cancel()
        stallJob?.cancel()
        signaling?.close()
        signaling = null
        rtc?.close()
        rtc = null
        dataChannelOpen = false
        _videoTrack.value = null
    }

    override fun onCleared() {
        disconnect()
        clearPhotos()
        engine.release()
    }

    companion object {
        private const val TAG = "SSRemote"
        private const val MAX_PHOTOS = 20
        private const val STALLED_RECONNECT_MS = 8000L
    }
}
