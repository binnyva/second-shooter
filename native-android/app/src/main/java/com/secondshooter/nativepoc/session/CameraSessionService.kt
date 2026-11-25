package com.secondshooter.nativepoc.session

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import com.secondshooter.nativepoc.MainActivity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Keeps a camera session alive when the screen turns off or the user leaves
 * the app.
 *
 * In the React Native app, a screen-off tore down both the camera and the
 * connection, and most of its reconnection logic (AGENTS.md, "Reconnection")
 * exists to rebuild them afterwards. Here the camera is bound to this
 * service's lifecycle instead of the screen's, and the service runs in the
 * foreground with the camera type, so Android lets it keep the camera, and
 * the process stays up for the peer connection. The screen coming and going
 * no longer touches the session.
 *
 * Started by [CameraSessionViewModel] once the camera permission is granted
 * (the camera FGS type requires it), and stopped when the ViewModel is
 * cleared, i.e. when the user backs out of the app.
 */
class CameraSessionService : LifecycleService() {
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()
        goForeground()
        // Wi-Fi power saving adds latency spikes to a 30fps stream once the
        // screen is off.
        wifiLock = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "SecondShooter:stream")
            .apply { setReferenceCounted(false); acquire() }
        _running.value = this
        Log.i(TAG, "Started")
    }

    /** Re-declares the service types, e.g. once the microphone is granted. */
    fun goForeground() {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        // The microphone type may only be claimed with RECORD_AUDIO granted.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), types)
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Camera session", NotificationManager.IMPORTANCE_LOW)
        )
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Camera is on")
            .setContentText("Streaming to your remote. Open the app and go back to stop.")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        _running.value = null
        wifiLock?.release()
        Log.i(TAG, "Stopped")
        super.onDestroy()
    }

    companion object {
        private const val TAG = "SSService"
        private const val CHANNEL_ID = "camera-session"
        private const val NOTIFICATION_ID = 1

        private val _running = MutableStateFlow<CameraSessionService?>(null)

        /** The running service, whose lifecycle the camera binds to. */
        val running: StateFlow<CameraSessionService?> = _running.asStateFlow()

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, CameraSessionService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CameraSessionService::class.java))
        }
    }
}
