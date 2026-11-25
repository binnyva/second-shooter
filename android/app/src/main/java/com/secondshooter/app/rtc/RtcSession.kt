package com.secondshooter.app.rtc

import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RTCStatsReport
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * One peer connection to one remote. The camera side is the offerer and
 * creates the "camera-commands" data channel, matching src/config/webrtc.ts.
 *
 * Listener callbacks arrive on WebRTC's signaling thread.
 */
class RtcSession(
    factory: PeerConnectionFactory,
    videoTrack: VideoTrack,
    iceServers: List<PeerConnection.IceServer>,
    private val listener: Listener,
) {
    interface Listener {
        fun onLocalCandidate(candidate: IceCandidate)
        fun onConnectionState(state: PeerConnection.PeerConnectionState)
        fun onDataChannelOpen()
        fun onMessage(text: String)
    }

    private val pendingRemoteCandidates = mutableListOf<IceCandidate>()
    private var hasRemoteDescription = false

    private val observer = object : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) = listener.onLocalCandidate(candidate)
        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) =
            listener.onConnectionState(newState)
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            Log.i(TAG, "ICE connection state: $state")
        }
        override fun onSignalingChange(state: PeerConnection.SignalingState) {}
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) {}
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onDataChannel(channel: DataChannel) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
    }

    private val peerConnection: PeerConnection
    private val dataChannel: DataChannel

    init {
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            iceCandidatePoolSize = 10
        }
        peerConnection = factory.createPeerConnection(config, observer)
            ?: error("createPeerConnection returned null")

        peerConnection.addTrack(videoTrack, listOf("camera"))
        preferHardwareFriendlyCodecs(factory)

        dataChannel = peerConnection.createDataChannel(
            "camera-commands",
            DataChannel.Init().apply { ordered = true },
        )
        dataChannel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {}
            override fun onStateChange() {
                Log.i(TAG, "Data channel state: ${dataChannel.state()}")
                if (dataChannel.state() == DataChannel.State.OPEN) listener.onDataChannelOpen()
            }
            override fun onMessage(buffer: DataChannel.Buffer) {
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                listener.onMessage(String(bytes, StandardCharsets.UTF_8))
            }
        })
    }

    /**
     * Put H.264 first so the browser's answer picks it and the phone can use
     * its hardware encoder. VP8 stays as a fallback.
     */
    private fun preferHardwareFriendlyCodecs(factory: PeerConnectionFactory) {
        val transceiver = peerConnection.transceivers
            .firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO } ?: return
        val codecs = factory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs
        Log.i(TAG, "Sender video codecs: ${codecs.joinToString { it.name }}")
        val (h264, rest) = codecs.partition { it.name.equals("H264", ignoreCase = true) }
        runCatching { transceiver.setCodecPreferences(h264 + rest) }
            .onFailure { Log.w(TAG, "setCodecPreferences failed", it) }
    }

    /**
     * @param iceRestart new ICE credentials on the same connection: the data
     *   channel and media carry over (SCTP survives an ICE restart), so the
     *   remote reconnects without re-pairing.
     */
    suspend fun createOffer(iceRestart: Boolean = false): String {
        if (iceRestart) peerConnection.restartIce()
        val offer = suspendCancellableCoroutine { cont ->
            peerConnection.createOffer(object : SdpObserverAdapter() {
                override fun onCreateSuccess(sdp: SessionDescription) = cont.resume(sdp)
                override fun onCreateFailure(error: String) =
                    cont.resumeWithException(IllegalStateException("createOffer: $error"))
            }, MediaConstraints())
        }
        setDescription(local = true, offer)
        return offer.description
    }

    /** False (and nothing applied) when no offer of ours is waiting for an answer. */
    suspend fun setAnswer(sdp: String): Boolean {
        if (peerConnection.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
            Log.w(TAG, "Ignoring an answer in state ${peerConnection.signalingState()}")
            return false
        }
        setDescription(local = false, SessionDescription(SessionDescription.Type.ANSWER, sdp))
        val queued = synchronized(pendingRemoteCandidates) {
            hasRemoteDescription = true
            pendingRemoteCandidates.toList().also { pendingRemoteCandidates.clear() }
        }
        queued.forEach { peerConnection.addIceCandidate(it) }
        return true
    }

    /** The remote's candidates can arrive before its answer; queue those. */
    fun addRemoteCandidate(candidate: IceCandidate) {
        synchronized(pendingRemoteCandidates) {
            if (!hasRemoteDescription) {
                pendingRemoteCandidates += candidate
                return
            }
        }
        peerConnection.addIceCandidate(candidate)
    }

    private suspend fun setDescription(local: Boolean, description: SessionDescription) {
        suspendCancellableCoroutine { cont ->
            val observer = object : SdpObserverAdapter() {
                override fun onSetSuccess() = cont.resume(Unit)
                override fun onSetFailure(error: String) =
                    cont.resumeWithException(IllegalStateException("setDescription: $error"))
            }
            if (local) peerConnection.setLocalDescription(observer, description)
            else peerConnection.setRemoteDescription(observer, description)
        }
    }

    fun send(text: String): Boolean {
        if (dataChannel.state() != DataChannel.State.OPEN) return false
        val bytes = text.toByteArray(StandardCharsets.UTF_8)
        return dataChannel.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false))
    }

    suspend fun stats(): RTCStatsReport = suspendCancellableCoroutine { cont ->
        peerConnection.getStats { cont.resume(it) }
    }

    fun close() {
        dataChannel.unregisterObserver()
        dataChannel.close()
        dataChannel.dispose()
        peerConnection.dispose()
    }

    private open class SdpObserverAdapter : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) {}
        override fun onSetFailure(error: String) {}
    }

    companion object {
        private const val TAG = "SSRtc"
    }
}
