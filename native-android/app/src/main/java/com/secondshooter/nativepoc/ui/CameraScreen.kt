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

    val view = LocalView.current
    DisposableEffect(settings.keepScreenAwake) {
        view.keepScreenOn = settings.keepScreenAwake
        onDispose { view.keepScreenOn = false }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        // SurfaceViewRenderer crops frames to its own aspect ratio, so give it
        // the stream's 3:4 rather than the screen's, or the viewfinder shows
        // less than the photo will.
        AndroidView(
            modifier = Modifier.align(Alignment.Center).fillMaxWidth().aspectRatio(3f / 4f),
            factory = { ctx ->
                SurfaceViewRenderer(ctx).apply {
                    init(viewModel.eglBase.eglBaseContext, null)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                    setEnableHardwareScaler(true)
                    viewModel.videoTrack.addSink(this)
                }
            },
            onRelease = { renderer ->
                runCatching { viewModel.videoTrack.removeSink(renderer) }
                renderer.release()
            },
        )

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
            IconButton(onClick = onOpenSettings) {
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
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
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
            Box(
                Modifier
                    .size(72.dp)
                    .border(4.dp, Color.White, CircleShape)
                    .padding(8.dp)
                    .clip(CircleShape)
                    .background(Color.White)
                    .clickable(onClick = viewModel::takePhotoFromUi)
            )
        }
    }
}
