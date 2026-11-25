package com.secondshooter.nativepoc

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.secondshooter.nativepoc.session.CameraSessionViewModel
import com.secondshooter.nativepoc.ui.CameraScreen
import com.secondshooter.nativepoc.ui.SettingsScreen
import com.secondshooter.nativepoc.ui.SettingsViewModel

private object Routes {
    const val CAMERA = "camera"
    const val SETTINGS = "settings"
    // Phase 7 adds "remote" (this phone as the remote).
}

class MainActivity : ComponentActivity() {
    /** Set by the camera screen while the volume keys should fire the shutter. */
    var volumeKeyListener: (() -> Unit)? = null

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val listener = volumeKeyListener
        if (listener != null && keyCode.isVolumeKey()) {
            // One shot per press: holding the key repeats ACTION_DOWN.
            if (event.repeatCount == 0) listener()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (volumeKeyListener != null && keyCode.isVolumeKey()) return true
        return super.onKeyUp(keyCode, event)
    }

    private fun Int.isVolumeKey() =
        this == KeyEvent.KEYCODE_VOLUME_UP || this == KeyEvent.KEYCODE_VOLUME_DOWN

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Like the system camera: usable from the lock screen, so a phone on a
        // tripod doesn't need unlocking to start a session.
        setShowWhenLocked(true)
        setTurnScreenOn(true)

        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                val nav = rememberNavController()
                NavHost(nav, startDestination = Routes.CAMERA) {
                    composable(Routes.CAMERA) {
                        // Scoped to this back-stack entry: kept while Settings
                        // is open and across activity recreation.
                        val session: CameraSessionViewModel = viewModel()
                        CameraScreen(session, onOpenSettings = { nav.navigate(Routes.SETTINGS) })
                    }
                    composable(Routes.SETTINGS) {
                        val settings: SettingsViewModel = viewModel()
                        SettingsScreen(settings, onBack = { nav.popBackStack() })
                    }
                }
            }
        }
    }
}
