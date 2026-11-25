package com.secondshooter.nativepoc.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.secondshooter.nativepoc.camera.Lenses
import com.secondshooter.nativepoc.MainActivity
import com.secondshooter.nativepoc.protocol.CameraFacing
import com.secondshooter.nativepoc.protocol.CaptureMode
import com.secondshooter.nativepoc.session.CameraSessionViewModel
import com.secondshooter.nativepoc.signaling.SessionIds
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

@Composable
fun CameraScreen(viewModel: CameraSessionViewModel, onOpenSettings: () -> Unit) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var hasCamera by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    val requestCamera = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasCamera = granted }

    LaunchedEffect(hasCamera, lifecycleOwner) {
        if (hasCamera) viewModel.bindCamera(lifecycleOwner)
        else requestCamera.launch(Manifest.permission.CAMERA)
    }

    val micPermissionRequest by viewModel.micPermissionRequest.collectAsStateWithLifecycle()
    val requestMic = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
        viewModel::onMicPermissionResult,
    )
    LaunchedEffect(micPermissionRequest) {
        if (micPermissionRequest) requestMic.launch(Manifest.permission.RECORD_AUDIO)
    }

    // Volume keys as a shutter, while this screen is showing. The activity
    // owns key events; it hands them here.
    val activity = context as? MainActivity
    DisposableEffect(activity, settings.volumeShutter) {
        activity?.volumeKeyListener = if (settings.volumeShutter) viewModel::shutterFromUi else null
        onDispose { activity?.volumeKeyListener = null }
    }

    val view = LocalView.current
    DisposableEffect(settings.keepScreenAwake) {
        view.keepScreenOn = settings.keepScreenAwake
        onDispose { view.keepScreenOn = false }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        // SurfaceViewRenderer crops frames to its own aspect ratio, so give it
        // the stream's 3:4 rather than the screen's, or the viewfinder shows
        // less than the photo will.
        Box(Modifier.align(Alignment.Center).fillMaxWidth().aspectRatio(3f / 4f)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    SurfaceViewRenderer(ctx).apply {
                        init(viewModel.eglBase.eglBaseContext, null)
                        setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                        setEnableHardwareScaler(true)
                        viewModel.videoTrack.addSink(this)
                    }
                },
                // The track carries the camera's true image; the front camera
                // is shown mirrored, like a mirror, as every camera app does.
                update = { renderer -> renderer.setMirror(ui.facing == CameraFacing.FRONT) },
                onRelease = { renderer ->
                    runCatching { viewModel.videoTrack.removeSink(renderer) }
                    renderer.release()
                },
            )
            ViewfinderOverlay(
                mode = ui.captureMode,
                aspectRatio = settings.aspectRatio,
                grid = settings.gridOverlay,
                countdown = ui.countdown,
                modifier = Modifier.fillMaxSize(),
            )
        }

        Row(
            Modifier
                .safeDrawingPadding()
                .padding(12.dp)
                .fillMaxWidth()
                .background(Color(0x99000000), RoundedCornerShape(8.dp))
                .padding(start = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                Text(
                    text = ui.status + (ui.sessionId?.let { " · $it" } ?: ""),
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                )
                if (settings.showDebugStats) {
                    ui.stats?.let {
                        Text(it, color = Color(0xFFB8F5B0), fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                    }
                }
                ui.lastEvent?.let { Text(it, color = Color(0xFFFFE08A), fontSize = 12.sp) }
            }
            // Leaving the camera screen stops the camera, which would end a
            // recording; settings wait until it's done.
            IconButton(onClick = onOpenSettings, enabled = !ui.isRecording) {
                Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = Color.White)
            }
        }

        val sessionId = ui.sessionId
        if (!ui.connected && sessionId != null) {
            QrCard(SessionIds.remoteUrl(sessionId), Modifier.align(Alignment.Center))
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .safeDrawingPadding()
                .padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (ui.canRestart) {
                Button(onClick = viewModel::startSession) { Text("New session") }
                Spacer(Modifier.height(12.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Chip("Flash ${settings.flash.wire}", onClick = viewModel::cycleFlashFromUi)
                if (ui.hasFrontCamera) {
                    Chip(
                        if (ui.facing == CameraFacing.FRONT) "Back" else "Selfie",
                        enabled = !ui.isRecording,
                        onClick = viewModel::switchCamera,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            if (ui.facing == CameraFacing.BACK) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ui.lenses.forEach { lens ->
                    val active = Lenses.isActive(ui.zoom, lens.zoom)
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(if (active) Color(0xFFFFD54F) else Color(0x99000000))
                            .clickable { viewModel.setZoomFromUi(lens.zoom) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            lens.label + "×",
                            color = if (active) Color.Black else Color.White,
                            fontSize = 13.sp,
                        )
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            if (ui.videoSupported) {
                ModeSelector(
                    mode = ui.captureMode,
                    enabled = !ui.isRecording,
                    onSelect = viewModel::setCaptureModeFromUi,
                )
                Spacer(Modifier.height(12.dp))
            }
            if (ui.isRecording) {
                Text(
                    "● %d:%02d".format(ui.recordedSeconds / 60, ui.recordedSeconds % 60),
                    color = Color(0xFFFF5252),
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(8.dp))
            }
            Box(contentAlignment = Alignment.Center) {
                Shutter(
                    mode = ui.captureMode,
                    recording = ui.isRecording,
                    onClick = viewModel::shutterFromUi,
                )
                if (ui.isRecording) {
                    // A still mid-recording, like the system camera offers.
                    // The web remote locks itself to video while recording,
                    // so this is the only way to ask for one.
                    Box(
                        Modifier
                            .padding(start = 150.dp)
                            .size(44.dp)
                            .border(3.dp, Color.White, CircleShape)
                            .padding(6.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                            .semantics { contentDescription = "Take a photo while recording" }
                            .clickable(onClick = viewModel::takePhotoFromUi)
                    )
                }
            }
        }
    }
}

@Composable
private fun ModeSelector(mode: CaptureMode, enabled: Boolean, onSelect: (CaptureMode) -> Unit) {
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(Color(0x99000000))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        listOf(CaptureMode.PHOTO to "Photo", CaptureMode.VIDEO to "Video").forEach { (value, label) ->
            val selected = mode == value
            Text(
                label,
                color = if (selected) Color.Black else Color.White,
                fontSize = 14.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (selected) Color.White else Color.Transparent)
                    .clickable(enabled = enabled) { onSelect(value) }
                    .padding(horizontal = 16.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun Shutter(mode: CaptureMode, recording: Boolean, onClick: () -> Unit) {
    val red = Color(0xFFFF3B30)
    Box(
        Modifier
            .size(72.dp)
            .border(4.dp, Color.White, CircleShape)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        when {
            recording -> Box(Modifier.size(28.dp).clip(RoundedCornerShape(6.dp)).background(red))
            mode == CaptureMode.VIDEO -> Box(Modifier.size(56.dp).clip(CircleShape).background(red))
            else -> Box(Modifier.size(56.dp).clip(CircleShape).background(Color.White))
        }
    }
}

@Composable
private fun Chip(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        label,
        color = if (enabled) Color.White else Color(0x80FFFFFF),
        fontSize = 13.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(Color(0x99000000))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}
