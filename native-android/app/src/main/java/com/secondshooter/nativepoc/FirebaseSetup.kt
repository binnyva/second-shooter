package com.secondshooter.nativepoc

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.tasks.await
import org.webrtc.PeerConnection
import java.util.concurrent.TimeUnit

/**
 * Firebase is configured in code from the Expo app's .env (see app/build.gradle.kts),
 * so this app shares the project, rules, sessions and TURN function with the
 * React Native app and the web remote.
 */
object FirebaseSetup {
    private const val TAG = "SSFirebase"

    fun init(context: Context) {
        if (FirebaseApp.getApps(context).isNotEmpty()) return
        check(BuildConfig.FIREBASE_PROJECT_ID.isNotEmpty()) {
            "Firebase config missing: the build reads EXPO_PUBLIC_FIREBASE_* from the repo's .env"
        }
        val options = FirebaseOptions.Builder()
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setStorageBucket(BuildConfig.FIREBASE_STORAGE_BUCKET)
            .setGcmSenderId(BuildConfig.FIREBASE_MESSAGING_SENDER_ID)
            .build()
        FirebaseApp.initializeApp(context, options)
    }

    /** Firestore rules require request.auth != null; anonymous auth is enough. */
    suspend fun ensureSignedIn() {
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser == null) {
            auth.signInAnonymously().await()
        }
    }
}

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
