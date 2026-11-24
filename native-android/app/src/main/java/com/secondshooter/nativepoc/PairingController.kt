package com.secondshooter.nativepoc

import android.content.Context
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory

data class UiState(
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
 * Ties the camera, Firestore signaling and the peer connection together, and
 * answers the web remote's commands. All state changes happen on the main
 * thread (`scope` is the activity's lifecycleScope).
 */
class PairingController(
    context: Context,
    private val scope: CoroutineScope,
) {
    val eglBase: EglBase = EglBase.create()
    private val factory: PeerConnectionFactory
    val camera: CameraStreamer

    var ui by mutableStateOf(UiState())
        private set

    private var signaling: Signaling? = null
    private var rtc: RtcSession? = null
    private var statsJob: Job? = null
    private val statsTracker = StatsTracker()

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                .createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
        camera = CameraStreamer(context, eglBase, factory)
    }

    fun start(owner: LifecycleOwner) {
        scope.launch {
            try {
                camera.bind(owner, INITIAL_ZOOM)
                ui = ui.copy(zoom = camera.zoom, lenses = camera.lenses())
            } catch (e: Exception) {
                Log.e(TAG, "Camera bind failed", e)
                ui = ui.copy(status = "Camera failed: ${e.message}")
                return@launch
            }
            startSession()
        }
        startStatsLoop()
    }

    fun startSession() {
        scope.launch {
            teardownSession()
            ui = ui.copy(status = "Creating session…", sessionId = null, connected = false, canRestart = false)
            try {
                FirebaseSetup.ensureSignedIn()
                val sig = Signaling(Signaling.generateSessionId())
                signaling = sig
                sig.create()

                val ice = IceServers.fetch()
                val session = RtcSession(factory, camera.videoTrack, ice.servers, rtcListener(sig))
                rtc = session

                sig.sendOffer(session.createOffer())
                sig.onAnswer { sdp ->
                    scope.launch {
                        runCatching { session.setAnswer(sdp) }
                            .onFailure { Log.e(TAG, "setAnswer failed", it) }
                    }
                }
                sig.onAnswerCandidate { session.addRemoteCandidate(it) }

                ui = ui.copy(
                    sessionId = sig.sessionId,
                    status = "Waiting for remote" + if (ice.hasTurn) "" else " (no TURN, STUN only)",
                )
            } catch (e: Exception) {
                Log.e(TAG, "Session setup failed", e)
                ui = ui.copy(status = "Setup failed: ${e.message}", canRestart = true)
            }
        }
    }

    private fun rtcListener(sig: Signaling) = object : RtcSession.Listener {
        override fun onLocalCandidate(candidate: IceCandidate) {
            scope.launch {
                runCatching { sig.addOfferCandidate(candidate) }
                    .onFailure { Log.w(TAG, "Failed to send ICE candidate", it) }
            }
        }

        override fun onConnectionState(state: PeerConnection.PeerConnectionState) {
            scope.launch(Dispatchers.Main) {
                if (signaling !== sig) return@launch
                Log.i(TAG, "Connection state: $state")
                ui = when (state) {
                    PeerConnection.PeerConnectionState.CONNECTED ->
                        ui.copy(status = "Connected", connected = true, canRestart = false)
                    PeerConnection.PeerConnectionState.CONNECTING ->
                        ui.copy(status = "Connecting…")
                    PeerConnection.PeerConnectionState.DISCONNECTED ->
                        ui.copy(status = "Disconnected", connected = false, canRestart = true)
                    PeerConnection.PeerConnectionState.FAILED,
                    PeerConnection.PeerConnectionState.CLOSED ->
                        ui.copy(status = "Connection ${state.name.lowercase()}", connected = false, canRestart = true)
                    else -> ui
                }
            }
        }

        override fun onDataChannelOpen() {
            scope.launch(Dispatchers.Main) { sendState() }
        }

        override fun onMessage(text: String) {
            val command = Protocol.parseCommand(text) ?: return
            scope.launch(Dispatchers.Main) {
                if (signaling !== sig) return@launch
                handle(command)
            }
        }
    }

    private suspend fun handle(command: Command) {
        when (command) {
            Command.GetState -> sendState()
            is Command.SetZoom -> setZoom(command.level)
            Command.TakePhoto -> takePhoto(fromRemote = true)
            is Command.Unsupported ->
                rtc?.send(Protocol.error("${command.type} isn't supported by the native test app"))
        }
    }

    fun setZoomFromUi(level: Float) {
        scope.launch { setZoom(level) }
    }

    private suspend fun setZoom(level: Float) {
        runCatching { camera.setZoom(level) }
            .onFailure { Log.w(TAG, "setZoom($level) failed", it) }
        ui = ui.copy(zoom = camera.zoom)
        sendState()
    }

    fun takePhotoFromUi() {
        scope.launch { takePhoto(fromRemote = false) }
    }

    private suspend fun takePhoto(fromRemote: Boolean) {
        val started = System.currentTimeMillis()
        try {
            val uri = camera.takePhoto()
            val elapsed = System.currentTimeMillis() - started
            Log.i(TAG, "Photo saved in ${elapsed}ms (remote=$fromRemote)")
            ui = ui.copy(lastEvent = "Photo saved in ${elapsed}ms")
            rtc?.send(Protocol.photoTaken(true))
            if (rtc != null) {
                val thumb = camera.thumbnailBase64(uri)
                Log.i(TAG, "Sending PHOTO_DATA, size=${thumb.length}")
                rtc?.send(Protocol.photoData(thumb))
            }
        } catch (e: Exception) {
            Log.e(TAG, "takePhoto failed", e)
            ui = ui.copy(lastEvent = "Photo failed: ${e.message}")
            rtc?.send(Protocol.photoTaken(false, e.message ?: "Capture failed"))
        }
    }

    private fun sendState() {
        rtc?.send(Protocol.stateUpdate(camera.zoom, camera.lenses()))
    }

    /** Once a second: camera fps always, encoder stats while connected. */
    private fun startStatsLoop() {
        statsJob?.cancel()
        statsJob = scope.launch {
            while (isActive) {
                delay(1000)
                val cameraFps = camera.takeFrameCount()
                val size = camera.streamSize?.let { "${it.width}x${it.height}" } ?: "?"
                val session = rtc
                val outbound = if (session != null && ui.connected) {
                    runCatching { statsTracker.summarize(session.stats()) }.getOrNull()
                } else null
                val line = buildString {
                    append("Camera $size @ ${cameraFps}fps · zoom ${"%.1f".format(camera.zoom)}x")
                    if (outbound != null) append("\n").append(outbound)
                }
                Log.i(STATS_TAG, line.replace('\n', ' '))
                ui = ui.copy(stats = line)
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

    fun release() {
        statsJob?.cancel()
        teardownSession()
        camera.release()
        factory.dispose()
        eglBase.release()
    }

    companion object {
        private const val TAG = "SSPairing"
        private const val STATS_TAG = "SSStats"
    }
}
