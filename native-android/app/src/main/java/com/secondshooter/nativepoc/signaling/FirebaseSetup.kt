package com.secondshooter.nativepoc.signaling

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.secondshooter.nativepoc.BuildConfig
import kotlinx.coroutines.tasks.await

/**
 * Firebase is configured in code from the Expo app's .env (see app/build.gradle.kts),
 * so this app shares the project, rules, sessions and TURN function with the
 * React Native app and the web remote.
 */
object FirebaseSetup {
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
