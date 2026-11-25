package com.secondshooter.app.signaling

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.tasks.await
import org.webrtc.IceCandidate
import java.util.Date

/**
 * The remote's half of the Firestore signaling: the Kotlin version of
 * web-remote/src/lib/signaling.ts (BrowserSignalingClient). The remote
 * answers the camera's offer and writes its candidates to answerCandidates.
 */
class RemoteSignaling(val sessionId: String) {
    private val sessionRef = FirebaseFirestore.getInstance().collection("sessions").document(sessionId)
    private val listeners = mutableListOf<ListenerRegistration>()
    private var processedOfferSdp: String? = null

    /** False if there's no such session (expired, or a typo in the link). */
    suspend fun join(): Boolean = sessionRef.get().await().exists()

    /**
     * Takes over a session another remote already answered: marks its offer
     * as seen and asks the camera for a fresh one. See claimSession in the
     * web remote, and "Reconnection" in AGENTS.md.
     */
    suspend fun claim() {
        val snapshot = sessionRef.get().await()
        val offerSdp = (snapshot.get("offer") as? Map<*, *>)?.get("sdp") as? String
        if (snapshot.getString("status") != "connected" || offerSdp == null) return
        processedOfferSdp = offerSdp
        sessionRef.set(mapOf("status" to "waiting"), SetOptions.merge()).await()
    }

    /** Every new offer: the first one, ICE restarts, and new connections. */
    fun onOffer(callback: (String) -> Unit) {
        listeners += sessionRef.addSnapshotListener { snapshot, _ ->
            val sdp = (snapshot?.get("offer") as? Map<*, *>)?.get("sdp") as? String ?: return@addSnapshotListener
            if (sdp != processedOfferSdp) {
                processedOfferSdp = sdp
                callback(sdp)
            }
        }
    }

    /** The camera ended the session (its doc was deleted). */
    fun onSessionMissing(callback: () -> Unit) {
        listeners += sessionRef.addSnapshotListener { snapshot, _ ->
            if (snapshot != null && !snapshot.exists()) callback()
        }
    }

    fun onOfferCandidate(callback: (IceCandidate) -> Unit) {
        listeners += sessionRef.collection("offerCandidates").addSnapshotListener { snapshot, _ ->
            snapshot?.documentChanges
                ?.filter { it.type == DocumentChange.Type.ADDED }
                ?.forEach { change ->
                    val doc = change.document
                    val candidate = doc.getString("candidate") ?: return@forEach
                    callback(IceCandidate(doc.getString("sdpMid"), doc.getLong("sdpMLineIndex")?.toInt() ?: 0, candidate))
                }
        }
    }

    suspend fun sendAnswer(sdp: String) {
        sessionRef.set(
            mapOf("answer" to mapOf("type" to "answer", "sdp" to sdp), "status" to "connected"),
            SetOptions.merge(),
        ).await()
    }

    suspend fun addAnswerCandidate(candidate: IceCandidate) {
        sessionRef.collection("answerCandidates").add(
            mapOf(
                "candidate" to candidate.sdp,
                "sdpMLineIndex" to candidate.sdpMLineIndex,
                "sdpMid" to candidate.sdpMid,
                "expireAt" to Timestamp(Date(System.currentTimeMillis() + 60 * 60 * 1000L)),
            )
        ).await()
    }

    fun close() {
        listeners.forEach { it.remove() }
        listeners.clear()
    }
}
