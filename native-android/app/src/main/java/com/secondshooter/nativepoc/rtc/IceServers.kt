package com.secondshooter.nativepoc.rtc

import android.util.Log
import com.google.firebase.functions.FirebaseFunctions
import com.secondshooter.nativepoc.signaling.FirebaseSetup
import kotlinx.coroutines.tasks.await
import org.webrtc.PeerConnection
import java.util.concurrent.TimeUnit

/** Mirrors shared/ice.ts. */
object IceServers {
    private const val TAG = "SSIce"
    private const val FUNCTION_NAME = "getIceServers"
    private const val FUNCTION_REGION = "us-central1"
    private const val FETCH_TIMEOUT_MS = 8000L

    private val STUN_URLS = listOf(
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302",
        "stun:stun4.l.google.com:19302",
    )

    data class Result(val servers: List<PeerConnection.IceServer>, val hasTurn: Boolean)

    private fun stunOnly(): List<PeerConnection.IceServer> =
        STUN_URLS.map { PeerConnection.IceServer.builder(it).createIceServer() }

    /** STUN plus Cloudflare TURN from the Cloud Function; STUN only if that fails. */
    suspend fun fetch(): Result {
        return try {
            FirebaseSetup.ensureSignedIn()
            val callable = FirebaseFunctions.getInstance(FUNCTION_REGION)
                .getHttpsCallable(FUNCTION_NAME)
            callable.setTimeout(FETCH_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            val turn = parse(callable.call().await().getData())
            if (turn.isEmpty()) {
                Log.w(TAG, "getIceServers returned no TURN servers, using STUN only")
                Result(stunOnly(), hasTurn = false)
            } else {
                Result(stunOnly() + turn, hasTurn = true)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch TURN credentials, using STUN only", e)
            Result(stunOnly(), hasTurn = false)
        }
    }

    private fun parse(data: Any?): List<PeerConnection.IceServer> {
        val list = (data as? Map<*, *>)?.get("iceServers") as? List<*> ?: return emptyList()
        return list.mapNotNull { entry ->
            val server = entry as? Map<*, *> ?: return@mapNotNull null
            val urls = when (val raw = server["urls"]) {
                is String -> listOf(raw)
                is List<*> -> raw.filterIsInstance<String>()
                else -> emptyList()
            }
            if (urls.isEmpty()) return@mapNotNull null
            PeerConnection.IceServer.builder(urls)
                .setUsername(server["username"] as? String ?: "")
                .setPassword(server["credential"] as? String ?: "")
                .createIceServer()
        }
    }
}
