package com.secondshooter.app.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.secondshooter.app.MainActivity
import com.secondshooter.app.protocol.CameraFacing
import com.secondshooter.app.protocol.StreamMode
import com.secondshooter.app.session.HistoryPhoto
import com.secondshooter.app.session.RemotePhase
import com.secondshooter.app.session.RemoteViewModel
import com.secondshooter.app.settings.AppSettings
import com.secondshooter.app.settings.SettingsRepository
import com.secondshooter.app.settings.settingsDataStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.webrtc.VideoTrack

/**
 * This phone as the remote: src/screens/RemoteScreen.tsx with
 * HybridPreview's overlays and PhotoViewer. The scanner shows until a session
 * is joined (a link skips it).
 */
@Composable
fun RemoteScreen(
    viewModel: RemoteViewModel,
    linkedSessionId: String?,
    onOpenSettings: () -> Unit,
    onSwitchToCamera: () -> Unit,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val track by viewModel.videoTrack.collectAsStateWithLifecycle()
    val thumbnail by viewModel.lastThumbnail.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val settings by remember { SettingsRepository(context.settingsDataStore).settings }
        .collectAsState(AppSettings())

    LaunchedEffect(linkedSessionId) { linkedSessionId?.let(viewModel::connect) }

    val view = LocalView.current
    DisposableEffect(settings.keepScreenAwake) {
        view.keepScreenOn = settings.keepScreenAwake
        onDispose { view.keepScreenOn = false }
    }

    if (ui.phase == RemotePhase.SCANNING) {
        QrScanner(onScan = viewModel::connect, onCancel = onSwitchToCamera)
        return
    }

    val activity = context as? MainActivity
    DisposableEffect(activity, settings.volumeShutter) {
        activity?.volumeKeyListener = if (settings.volumeShutter) viewModel::shutter else null
        onDispose { activity?.volumeKeyListener = null }
    }

    var showViewer by remember { mutableStateOf(false) }
    val connected = ui.phase == RemotePhase.CONNECTED
    val currentTrack = track
    val showVideo = ui.streamMode == StreamMode.WEBRTC && ui.hasVideo && currentTrack != null &&
        (ui.phase == RemotePhase.CONNECTED || ui.phase == RemotePhase.RECONNECTING)

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (showVideo) {
            RemoteVideo(viewModel, currentTrack!!, mirror = ui.camera.facing == CameraFacing.FRONT)
        } else {
            Placeholder(ui.phase, ui.streamMode, ui.failure)
        }

        if (ui.capturing) {
            Row(
                Modifier.align(Alignment.Center)
                    .background(Color(0x99000000), RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text("Capturing...", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        if (showVideo && ui.stalled) {
            Column(
                Modifier.fillMaxSize().background(Color(0xBF000000)),
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(color = Color.White)
                Spacer(Modifier.height(20.dp))
                Text("Reconnecting to camera...", color = Color.White, fontSize = 16.sp)
                Spacer(Modifier.height(16.dp))
                Text(
                    "Wake the camera phone and open Second Shooter on it",
                    color = Color(0xFF888888), fontSize = 14.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 40.dp),
                )
            }
        }

        // Top: "Live" / "Reconnecting..." on the left, the session in the middle.
        Box(Modifier.statusBarsPadding().padding(top = 16.dp).align(Alignment.TopCenter)) {
            ui.sessionId?.let {
                Text(
                    "Session: $it",
                    color = Color(0xFF888888), fontSize = 10.sp, fontFamily = FontFamily.Monospace,
                    modifier = Modifier.background(Color(0x80000000), RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
        if (showVideo) {
            Box(Modifier.statusBarsPadding().padding(start = 20.dp, top = 52.dp)) {
                Pill(
                    if (connected) "Live" else "Reconnecting...",
                    dot = if (connected) Color(0xFF4CD964) else Color(0xFFFF9500),
                )
            }
        }

        CameraControls(
            mode = ControlsMode.REMOTE,
            captureMode = ui.camera.captureMode,
            isRecording = ui.camera.isRecording,
            recordedSeconds = null,
            showModeSelector = true,
            lenses = ui.lenses,
            enabled = connected,
            thumbnail = thumbnail,
            onCaptureModeChange = viewModel::setCaptureMode,
            onShutter = viewModel::shutter,
            onLensSelect = viewModel::selectLens,
            onOpenGallery = { if (ui.photos.isNotEmpty()) showViewer = true },
            onOpenSettings = onOpenSettings,
            onQr = viewModel::rescan,
            onModeToggle = onSwitchToCamera,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    if (showViewer && ui.photos.isNotEmpty()) {
        PhotoViewer(ui.photos, onClose = { showViewer = false })
    }

    ui.lastEvent?.let { message ->
        AlertDialog(
            onDismissRequest = viewModel::clearEvent,
            title = { Text("Error") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = viewModel::clearEvent) { Text("OK") } },
        )
    }
}

@Composable
private fun RemoteVideo(viewModel: RemoteViewModel, track: VideoTrack, mirror: Boolean) {
    // The camera sends the shot cropped to its aspect ratio setting; show all
    // of it. A front camera is shown mirrored, as the web remote does.
    FittedVideo(viewModel.eglBase, track, mirror)
}

@Composable
private fun Placeholder(phase: RemotePhase, streamMode: StreamMode, failure: String?) {
    Column(
        Modifier.fillMaxSize().background(Color(0xFF1A1A1A)),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val frameBased = streamMode == StreamMode.FRAME_BASED
        val (message, hint) = when {
            phase == RemotePhase.FAILED -> (failure ?: "Connection failed. Please try again.") to
                "Go back and scan the QR code again"
            frameBased -> "The camera is sending its preview as still frames, which this app doesn't show." to
                "On the camera phone, set Preview Mode to Auto in Settings."
            phase == RemotePhase.CONNECTED || phase == RemotePhase.RECONNECTING -> "Waiting for video stream..." to null
            else -> "Connecting to camera..." to null
        }
        if (phase != RemotePhase.FAILED && !frameBased) {
            CircularProgressIndicator(color = Color.White)
            Spacer(Modifier.height(20.dp))
        }
        Text(message, color = Color.White, fontSize = 16.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 40.dp))
        hint?.let {
            Spacer(Modifier.height(16.dp))
            Text(it, color = Color(0xFF888888), fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 40.dp))
        }
    }
}

/** src/components/PhotoViewer.tsx: page through this session's shots, newest last. */
@Composable
private fun PhotoViewer(photos: List<HistoryPhoto>, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        // Opens on the newest; a photo arriving meanwhile doesn't move the page.
        val pager = rememberPagerState(initialPage = photos.size - 1) { photos.size }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
                val path = photos[page].path
                val bitmap by produceState<Bitmap?>(null, path) {
                    value = withContext(Dispatchers.IO) { BitmapFactory.decodeFile(path) }
                }
                bitmap?.let {
                    Image(it.asImageBitmap(), null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                }
            }
            if (photos.size > 1) {
                Text(
                    "${pager.currentPage + 1} / ${photos.size}",
                    color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 16.dp)
                        .background(Color(0x80000000), RoundedCornerShape(14.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
            Box(
                Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 16.dp, end = 16.dp)
                    .size(44.dp).clip(CircleShape).background(Color(0x80000000)).clickable(onClick = onClose),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, "Close", tint = Color.White, modifier = Modifier.size(28.dp))
            }
        }
    }
}
