package com.secondshooter.app.rtc

import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * The remote's peer connection: answers the camera's offer, receives its
 * video track and the "camera-commands" data channel. The Kotlin version of
 * web-remote/src/lib/webrtc.ts. Listener callbacks arrive on WebRTC's
 * signaling thread.
 */
class RemoteRtcSession(
    factory: PeerConnectionFactory,
    iceServers: List<PeerConnection.IceServer>,
    private val listener: Listener,
) {
    interface Listener {
        fun onLocalCandidate(candidate: IceCandidate)
        fun onConnectionState(state: PeerConnection.PeerConnectionState)
        fun onVideoTrack(track: VideoTrack)
        fun onDataChannelOpen()
        fun onMessage(text: String)
    }

    private val pendingCandidates = mutableListOf<IceCandidate>()
    private var dataChannel: DataChannel? = null

    private val observer = object : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) = listener.onLocalCandidate(candidate)
        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) =
            listener.onConnectionState(newState)
        override fun onTrack(transceiver: RtpTransceiver) {
            (transceiver.receiver.track() as? VideoTrack)?.let(listener::onVideoTrack)
        }
        override fun onDataChannel(channel: DataChannel) {
            dataChannel = channel
            channel.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(previousAmount: Long) {}
                override fun onStateChange() {
                    if (channel.state() == DataChannel.State.OPEN) listener.onDataChannelOpen()
                }
                override fun onMessage(buffer: DataChannel.Buffer) {
                    val bytes = ByteArray(buffer.data.remaining())
                    buffer.data.get(bytes)
                    listener.onMessage(String(bytes, StandardCharsets.UTF_8))
                }
            })
        }
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            Log.i(TAG, "ICE connection state: $state")
        }
        override fun onSignalingChange(state: PeerConnection.SignalingState) {}
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) {}
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
    }

    private val peerConnection: PeerConnection = factory.createPeerConnection(
        PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            iceCandidatePoolSize = 10
        },
        observer,
    ) ?: error("createPeerConnection returned null")

    /**
     * True when [offerSdp] comes from a different camera connection than the
     * one we're talking to: a fresh one the camera made for a remote that
     * took over. ICE restarts keep the DTLS fingerprint; new connections don't.
     */
    fun isOfferForAnotherConnection(offerSdp: String): Boolean {
        val current = peerConnection.remoteDescription?.description ?: return false
        val before = fingerprint(current)
        val after = fingerprint(offerSdp)
        return before != null && after != null && before != after
    }

    /** Applies an offer (first, or an ICE restart) and returns our answer. */
    suspend fun answer(offerSdp: String): String {
        setDescription(local = false, SessionDescription(SessionDescription.Type.OFFER, offerSdp))
        val queued = synchronized(pendingCandidates) { pendingCandidates.toList().also { pendingCandidates.clear() } }
        queued.forEach { peerConnection.addIceCandidate(it) }
        val answer = suspendCancellableCoroutine { cont ->
            peerConnection.createAnswer(object : SdpAdapter() {
                override fun onCreateSuccess(sdp: SessionDescription) = cont.resume(sdp)
                override fun onCreateFailure(error: String) =
                    cont.resumeWithException(IllegalStateException("createAnswer: $error"))
            }, MediaConstraints())
        }
        setDescription(local = true, answer)
        return answer.description
    }

    /** The camera's candidates can arrive before its offer; queue those. */
    fun addRemoteCandidate(candidate: IceCandidate) {
        synchronized(pendingCandidates) {
            if (peerConnection.remoteDescription == null) {
                pendingCandidates += candidate
                return
            }
        }
        peerConnection.addIceCandidate(candidate)
    }

    fun send(text: String): Boolean {
        val channel = dataChannel ?: return false
        if (channel.state() != DataChannel.State.OPEN) return false
        return channel.send(DataChannel.Buffer(ByteBuffer.wrap(text.toByteArray(StandardCharsets.UTF_8)), false))
    }

    fun close() {
        dataChannel?.unregisterObserver()
        dataChannel?.close()
        peerConnection.dispose()
    }

    private suspend fun setDescription(local: Boolean, description: SessionDescription) {
        suspendCancellableCoroutine { cont ->
            val observer = object : SdpAdapter() {
                override fun onSetSuccess() = cont.resume(Unit)
                override fun onSetFailure(error: String) =
                    cont.resumeWithException(IllegalStateException("setDescription: $error"))
            }
            if (local) peerConnection.setLocalDescription(observer, description)
            else peerConnection.setRemoteDescription(observer, description)
        }
    }

    private open class SdpAdapter : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) {}
        override fun onSetFailure(error: String) {}
    }

    companion object {
        private const val TAG = "SSRemoteRtc"
        private val FINGERPRINT = Regex("^a=fingerprint:(.+)$", RegexOption.MULTILINE)

        fun fingerprint(sdp: String): String? = FINGERPRINT.find(sdp)?.groupValues?.get(1)?.trim()
    }
}
