package com.secondshooter.app.signaling

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.tasks.await
import org.webrtc.IceCandidate
import java.util.Date

/**
 * Same Firestore layout as src/services/SignalingService.ts, so the existing
 * web remote can join. The camera is the offerer: it writes the offer and its
 * candidates, and listens for the answer and the remote's candidates.
 */
class Signaling(val sessionId: String) {
    private val sessionRef = FirebaseFirestore.getInstance()
        .collection("sessions")
        .document(sessionId)
    private val listeners = mutableListOf<ListenerRegistration>()

    suspend fun create() {
        sessionRef.set(
            mapOf(
                "createdAt" to FieldValue.serverTimestamp(),
                "expireAt" to expireAt(),
                "status" to "waiting",
            )
        ).await()
    }

    suspend fun sendOffer(sdp: String) {
        sessionRef.set(
            mapOf(
                "offer" to mapOf("type" to "offer", "sdp" to sdp),
                "status" to "offer_sent",
            ),
            SetOptions.merge(),
        ).await()
    }

    /**
     * An ICE-restart offer for the current connection, unless a remote has
     * claimed the session (status `waiting`): overwriting that would hide the
     * claim, and the new remote would answer an offer for someone else's
     * connection. A transaction, as the remote's claim is. False if skipped.
     */
    suspend fun sendIceRestartOffer(sdp: String): Boolean =
        sessionRef.firestore.runTransaction { tx ->
            if (tx.get(sessionRef).getString("status") == "waiting") {
                false
            } else {
                tx.set(
                    sessionRef,
                    mapOf("offer" to mapOf("type" to "offer", "sdp" to sdp), "status" to "offer_sent"),
                    SetOptions.merge(),
                )
                true
            }
        }.await()

    suspend fun addOfferCandidate(candidate: IceCandidate) {
        sessionRef.collection("offerCandidates").add(
            mapOf(
                "candidate" to candidate.sdp,
                "sdpMLineIndex" to candidate.sdpMLineIndex,
                "sdpMid" to candidate.sdpMid,
                "expireAt" to expireAt(),
            )
        ).await()
    }

    fun onAnswer(callback: (String) -> Unit) {
        var lastSdp: String? = null
        listeners += sessionRef.addSnapshotListener { snapshot, _ ->
            val answer = snapshot?.get("answer") as? Map<*, *> ?: return@addSnapshotListener
            val sdp = answer["sdp"] as? String ?: return@addSnapshotListener
            if (sdp != lastSdp) {
                lastSdp = sdp
                callback(sdp)
            }
        }
    }

    /**
     * Session status changes. A remote that finds the session already
     * answered sets it back to `waiting` to ask for a fresh offer (see
     * claimSession in web-remote/src/lib/signaling.ts).
     */
    fun onStatus(callback: (String) -> Unit) {
        var lastStatus: String? = null
        // MetadataChanges.INCLUDE: our own writes echo back first with pending
        // writes, and only act on what the server has. Without it the
        // server's confirmation of our own `offer_sent` never arrives (the
        // data didn't change), lastStatus stays `waiting`, and the next
        // remote's claim looks like no change and is ignored.
        listeners += sessionRef.addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, _ ->
            val status = snapshot?.getString("status") ?: return@addSnapshotListener
            if (snapshot.metadata.hasPendingWrites()) return@addSnapshotListener
            if (status != lastStatus) {
                lastStatus = status
                callback(status)
            }
        }
    }

    fun onAnswerCandidate(callback: (IceCandidate) -> Unit) {
        listeners += sessionRef.collection("answerCandidates").addSnapshotListener { snapshot, _ ->
            snapshot?.documentChanges
                ?.filter { it.type == DocumentChange.Type.ADDED }
                ?.forEach { change ->
                    val doc = change.document
                    val candidate = doc.getString("candidate") ?: return@forEach
                    callback(
                        IceCandidate(
                            doc.getString("sdpMid"),
                            doc.getLong("sdpMLineIndex")?.toInt() ?: 0,
                            candidate,
                        )
                    )
                }
        }
    }

    /** Candidate docs are left for the TTL policy, as in the RN app. */
    fun close() {
        listeners.forEach { it.remove() }
        listeners.clear()
        sessionRef.delete()
    }

    companion object {
        private const val SESSION_TTL_MS = 60 * 60 * 1000L

        private fun expireAt() = Timestamp(Date(System.currentTimeMillis() + SESSION_TTL_MS))
    }
}
