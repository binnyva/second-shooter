package com.secondshooter.app

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink
import com.secondshooter.app.session.RemoteViewModel
import com.secondshooter.app.signaling.SessionIds
import com.secondshooter.app.ui.RemoteScreen
import kotlinx.coroutines.flow.MutableSharedFlow
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.secondshooter.app.session.CameraSessionViewModel
import com.secondshooter.app.ui.CameraScreen
import com.secondshooter.app.ui.SettingsScreen
import com.secondshooter.app.ui.SettingsViewModel

private object Routes {
    const val CAMERA = "camera"
    const val SETTINGS = "settings"
    const val REMOTE = "remote"
    const val REMOTE_PATTERN = "remote?sessionId={sessionId}"
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
                // A session link while the app is already open.
                LaunchedEffect(nav) {
                    newIntents.collect { nav.handleDeepLink(it) }
                }
                NavHost(nav, startDestination = Routes.CAMERA) {
                    composable(Routes.CAMERA) {
                        // Scoped to this back-stack entry: kept while Settings
                        // is open and across activity recreation.
                        val session: CameraSessionViewModel = viewModel()
                        CameraScreen(
                            session,
                            onOpenSettings = { nav.navigate(Routes.SETTINGS) },
                            // Replace, not push: leaving camera mode ends the
                            // camera session and frees the camera for the
                            // scanner, as the RN app's router.replace did.
                            onSwitchToRemote = {
                                nav.navigate(Routes.REMOTE) { popUpTo(Routes.CAMERA) { inclusive = true } }
                            },
                        )
                    }
                    composable(
                        Routes.REMOTE_PATTERN,
                        arguments = listOf(navArgument("sessionId") { type = NavType.StringType; nullable = true }),
                        deepLinks = listOf(
                            navDeepLink { uriPattern = "https://apps.binnyva.com/second-shooter/s/{sessionId}" },
                            navDeepLink { uriPattern = "secondshooter://s/{sessionId}" },
                        ),
                    ) { entry ->
                        val remote: RemoteViewModel = viewModel()
                        RemoteScreen(
                            remote,
                            linkedSessionId = entry.arguments?.getString("sessionId")?.let(SessionIds::parse),
                            onOpenSettings = { nav.navigate(Routes.SETTINGS) },
                            onSwitchToCamera = {
                                nav.navigate(Routes.CAMERA) { popUpTo(nav.graph.id) { inclusive = true } }
                            },
                        )
                    }
                    composable(Routes.SETTINGS) {
                        val settings: SettingsViewModel = viewModel()
                        SettingsScreen(settings, onBack = { nav.popBackStack() })
                    }
                }
            }
        }
    }

    private val newIntents = MutableSharedFlow<Intent>(extraBufferCapacity = 1)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        newIntents.tryEmit(intent)
    }
}
