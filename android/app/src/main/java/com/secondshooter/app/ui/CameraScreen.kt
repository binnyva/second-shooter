package com.secondshooter.app.ui

import android.Manifest
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cameraswitch
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SettingsRemote
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.secondshooter.app.MainActivity
import com.secondshooter.app.camera.Lenses
import com.secondshooter.app.media.GalleryApps
import com.secondshooter.app.protocol.CameraFacing
import com.secondshooter.app.protocol.CaptureMode
import com.secondshooter.app.protocol.LensInfo
import com.secondshooter.app.session.CameraSessionViewModel
import com.secondshooter.app.signaling.SessionIds
import kotlinx.coroutines.delay

// Colours from src/components/CameraControls.tsx.
internal val White20 = Color(0x33FFFFFF)
internal val White10 = Color(0x1AFFFFFF)
internal val Red = Color(0xFFFF3B30)
private val LensYellow = Color(0xE6FFCC00)

/**
 * The camera screen, laid out as the React Native app's (app/index.tsx and
 * src/components/CameraControls.tsx): a full-screen viewfinder and three rows
 * at the bottom (Photo/Video; gallery thumbnail, shutter, camera/remote
 * toggle; settings, lens selector, QR code). Flash lives in Settings and on
 * the remote, not here. The QR code is shown on demand.
 */
@Composable
fun CameraScreen(viewModel: CameraSessionViewModel, onOpenSettings: () -> Unit, onSwitchToRemote: () -> Unit) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val lastPhoto by viewModel.lastPhoto.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // Camera permission: asked for once on its own; after that the gate
    // below explains and offers the prompt or Android's settings. Re-read on
    // every resume, since the answer can change in system settings.
    var cameraStatus by remember { mutableStateOf(permissionStatus(context, Manifest.permission.CAMERA)) }
    val requestCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        cameraStatus = permissionStatus(context, Manifest.permission.CAMERA)
    }
    val askForCamera = {
        markAsked(context, Manifest.permission.CAMERA)
        requestCamera.launch(Manifest.permission.CAMERA)
    }
    LifecycleResumeEffect(Unit) {
        cameraStatus = permissionStatus(context, Manifest.permission.CAMERA)
        onPauseOrDispose { }
    }
    LaunchedEffect(cameraStatus) {
        when {
            cameraStatus == PermissionStatus.GRANTED -> viewModel.onCameraPermissionGranted()
            !wasAsked(context, Manifest.permission.CAMERA) -> askForCamera()
        }
    }
    if (cameraStatus != PermissionStatus.GRANTED) {
        CameraPermissionGate(
            blocked = cameraStatus == PermissionStatus.BLOCKED,
            onAllow = askForCamera,
            onOpenSettings = { openAppSettings(context) },
        )
        return
    }

    val micPermissionRequest by viewModel.micPermissionRequest.collectAsStateWithLifecycle()
    val requestMic = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
        viewModel::onMicPermissionResult,
    )
    LaunchedEffect(micPermissionRequest) {
        if (!micPermissionRequest) return@LaunchedEffect
        if (permissionStatus(context, Manifest.permission.RECORD_AUDIO) == PermissionStatus.BLOCKED) {
            // Android won't show the prompt again; don't pretend to ask.
            viewModel.onMicPermissionResult(false)
        } else {
            markAsked(context, Manifest.permission.RECORD_AUDIO)
            requestMic.launch(Manifest.permission.RECORD_AUDIO)
        }
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

    // Messages (failures, fallbacks) show briefly, then go.
    LaunchedEffect(ui.lastEvent) {
        if (ui.lastEvent != null) {
            delay(3500)
            viewModel.clearEvent()
        }
    }

    var showQr by remember { mutableStateOf(false) }
    // A remote connecting is the QR code's job done.
    LaunchedEffect(ui.connected) { if (ui.connected) showQr = false }

    val pinch = rememberPinchZoomState(
        zoom = { ui.zoom },
        range = { viewModel.zoomRange },
        stops = { if (ui.facing == CameraFacing.BACK) ui.lenses.map { it.zoom } else emptyList() },
        onZoom = viewModel::pinchZoomFromUi,
        onEnd = viewModel::pinchEndedFromUi,
    )

    val exposure = rememberExposureControlState()

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        // The whole shot, at the aspect ratio setting (the stream is cropped
        // to it), so what's on screen is what gets saved. Pinching anywhere
        // around it zooms, the letterbox included.
        FittedVideo(
            viewModel.eglBase,
            viewModel.videoTrack,
            mirror = ui.facing == CameraFacing.FRONT,
            modifier = Modifier.pinchToZoom(pinch).tapToShowExposure(exposure, enabled = true),
        ) {
            ViewfinderGrid(settings.gridOverlay)
        }
        PinchZoomReadout(pinch, Modifier.align(Alignment.Center))
        ExposureSlider(
            exposure,
            ev = ui.exposure,
            min = ui.exposureRange.minEv,
            max = ui.exposureRange.maxEv,
            step = ui.exposureRange.step,
            onChange = viewModel::exposureFromUi,
            onEnd = viewModel::exposureEndedFromUi,
            modifier = Modifier.align(Alignment.CenterEnd).padding(end = 12.dp),
        )

        // Top: connection state (the RN app's "Remote Connected" pill), then
        // any message, then the optional stats.
        Column(
            Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ConnectionPill(ui.connected, ui.status)
            ui.lastEvent?.let {
                Spacer(Modifier.height(8.dp))
                Pill(it, dot = null)
            }
            if (settings.showDebugStats) {
                ui.stats?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        it,
                        color = Color(0xFFB8F5B0),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        modifier = Modifier
                            .background(Color(0x99000000), RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }
        }

        ui.countdown?.let { TimerCountdown(it) }

        CameraControls(
            mode = ControlsMode.CAMERA,
            captureMode = ui.captureMode,
            isRecording = ui.isRecording,
            recordedSeconds = if (ui.isRecording) ui.recordedSeconds else null,
            showModeSelector = ui.videoSupported,
            lenses = Lenses.toLensInfo(ui.lenses, ui.zoom, ui.facing, ui.hasFrontCamera),
            enabled = true,
            thumbnail = lastPhoto,
            onCaptureModeChange = viewModel::setCaptureModeFromUi,
            onShutter = viewModel::shutterFromUi,
            onLensSelect = { viewModel.selectLensFromUi(it.id, it.zoom.toFloat()) },
            onOpenGallery = { GalleryApps.open(context, settings.galleryApp) },
            onOpenSettings = onOpenSettings,
            onQr = {
                // No live session (setup failed, or gave up reconnecting):
                // the QR button starts a fresh one, as in the RN app.
                if (ui.sessionId == null || ui.canRestart) viewModel.startSession()
                showQr = true
            },
            onModeToggle = onSwitchToRemote,
            modifier = Modifier.align(Alignment.BottomCenter),
            // A still mid-recording. The web remote locks itself to video
            // while recording, so this is the only way to ask for one.
            rightSlot = if (ui.isRecording) ({ SnapshotButton(viewModel::takePhotoFromUi) }) else null,
        )

        if (showQr) {
            QrOverlay(sessionId = ui.sessionId, onClose = { showQr = false })
        }
    }
}

enum class ControlsMode { CAMERA, REMOTE }

/**
 * The bottom controls from src/components/CameraControls.tsx, shared by the
 * camera and remote screens as they were in the RN app. [rightSlot] replaces
 * the camera/remote switch (the camera puts its snapshot button there while
 * recording).
 */
@Composable
internal fun CameraControls(
    mode: ControlsMode,
    captureMode: CaptureMode,
    isRecording: Boolean,
    recordedSeconds: Long?,
    showModeSelector: Boolean,
    lenses: List<LensInfo>,
    enabled: Boolean,
    thumbnail: Bitmap?,
    onCaptureModeChange: (CaptureMode) -> Unit,
    onShutter: () -> Unit,
    onLensSelect: (LensInfo) -> Unit,
    onOpenGallery: () -> Unit,
    onOpenSettings: () -> Unit,
    onQr: () -> Unit,
    onModeToggle: () -> Unit,
    modifier: Modifier = Modifier,
    rightSlot: (@Composable () -> Unit)? = null,
) {
    val bottomInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    Column(
        modifier
            .fillMaxWidth()
            .background(Color(0x4D000000))
            .padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = maxOf(bottomInset, 20.dp) + 20.dp),
    ) {
        // Row 1: Photo / Video
        if (showModeSelector) {
            ModeSelector(
                mode = captureMode,
                enabled = enabled && !isRecording,
                onSelect = onCaptureModeChange,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            Spacer(Modifier.height(20.dp))
        }

        // Row 2: thumbnail | shutter | camera/remote toggle
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Thumbnail(thumbnail, onOpenGallery)
            Shutter(captureMode, isRecording, enabled, onShutter)
            if (rightSlot != null) rightSlot() else CameraRemoteToggle(mode, onModeToggle)
        }
        if (recordedSeconds != null) {
            Text(
                "%d:%02d".format(recordedSeconds / 60, recordedSeconds % 60),
                color = Red,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 6.dp),
            )
        }
        Spacer(Modifier.height(20.dp))

        // Row 3: settings | lenses | QR
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoundIconButton(Icons.Outlined.Settings, "Settings", 22.dp, onOpenSettings)
            LensSelector(lenses = lenses, enabled = enabled && !isRecording, onSelect = onLensSelect)
            Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
                if (mode == ControlsMode.CAMERA) {
                    RoundIconButton(Icons.Outlined.QrCode2, "Show the pairing QR code", 24.dp, onQr)
                } else {
                    RoundIconButton(Icons.Outlined.QrCodeScanner, "Scan another QR code", 22.dp, onQr)
                }
            }
        }
    }
}

@Composable
internal fun ModeSelector(
    mode: CaptureMode,
    enabled: Boolean,
    onSelect: (CaptureMode) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier.clip(RoundedCornerShape(20.dp)).background(White20).padding(4.dp)) {
        listOf(CaptureMode.PHOTO to "Photo", CaptureMode.VIDEO to "Video").forEach { (value, label) ->
            val selected = mode == value
            Text(
                label,
                color = if (selected) Color.Black else Color.White,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (selected) Color.White else Color.Transparent)
                    .clickable(enabled = enabled) { onSelect(value) }
                    .padding(horizontal = 24.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
internal fun Thumbnail(photo: Bitmap?, onClick: () -> Unit) {
    Box(
        Modifier
            .size(56.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(White20)
            .border(2.dp, Color(0x66FFFFFF), RoundedCornerShape(10.dp))
            .semantics { contentDescription = "Open the gallery" }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (photo != null) {
            Image(
                photo.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Icon(Icons.Outlined.PhotoLibrary, null, tint = Color(0x80FFFFFF), modifier = Modifier.size(24.dp))
        }
    }
}

@Composable
private fun Shutter(mode: CaptureMode, recording: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val video = mode == CaptureMode.VIDEO
    Box(
        Modifier
            .size(80.dp)
            .clip(CircleShape)
            .background(if (recording) Color(0x4DFF3B30) else Color(0x4DFFFFFF))
            .border(4.dp, if (video) Red else Color.White, CircleShape)
            .semantics { contentDescription = if (recording) "Stop recording" else if (video) "Start recording" else "Take photo" }
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (recording) {
            Box(Modifier.size(30.dp).clip(RoundedCornerShape(6.dp)).background(Red))
        } else {
            Box(Modifier.size(64.dp).clip(CircleShape).background(if (video) Red else Color.White))
        }
    }
}

/** The RN app's camera/remote switch; the white knob marks the current mode. */
@Composable
private fun CameraRemoteToggle(mode: ControlsMode, onClick: () -> Unit) {
    val remote = mode == ControlsMode.REMOTE
    Box(
        Modifier
            .size(56.dp)
            .clickable(onClick = onClick)
            .semantics { contentDescription = if (remote) "Switch to camera mode" else "Switch to remote mode" },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.width(56.dp).height(30.dp).clip(RoundedCornerShape(15.dp)).background(White20)) {
            Box(
                Modifier.offset(x = if (remote) 28.dp else 2.dp, y = 2.dp).size(26.dp)
                    .clip(CircleShape).background(Color.White)
            )
            Row(
                Modifier.fillMaxSize().padding(horizontal = 7.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.PhotoCamera, null, tint = if (remote) Color.White else Color(0x80000000), modifier = Modifier.size(16.dp))
                Icon(Icons.Outlined.SettingsRemote, null, tint = if (remote) Color(0x80000000) else Color.White, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun SnapshotButton(onClick: () -> Unit) {
    Box(
        Modifier
            .size(56.dp)
            .semantics { contentDescription = "Take a photo while recording" }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(44.dp).border(3.dp, Color.White, CircleShape).padding(6.dp)
                .clip(CircleShape).background(Color.White)
        )
    }
}

@Composable
internal fun RoundIconButton(icon: ImageVector, description: String, iconSize: Dp, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).background(White20).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, description, tint = Color.White, modifier = Modifier.size(iconSize))
    }
}

@Composable
internal fun LensSelector(lenses: List<LensInfo>, enabled: Boolean, onSelect: (LensInfo) -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(20.dp)).background(White10).padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        lenses.forEach { lens ->
            Box(
                Modifier
                    .padding(horizontal = 2.dp)
                    .sizeIn(minWidth = 36.dp)
                    .height(36.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(if (lens.isActive) LensYellow else Color.Transparent)
                    .clickable(enabled = enabled) { onSelect(lens) }
                    .padding(horizontal = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                val color = if (lens.isActive) Color.Black else Color.White
                if (lens.id == "selfie") {
                    Icon(Icons.Outlined.Cameraswitch, "Selfie camera", tint = color, modifier = Modifier.size(18.dp))
                } else {
                    Text(lens.label, color = color, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun ConnectionPill(connected: Boolean, status: String) {
    when {
        connected -> Pill("Remote Connected", dot = Color(0xFF4CD964))
        status.startsWith("Reconnecting") -> Pill("Reconnecting…", dot = Color(0xFFFFCC00))
        status.startsWith("Setup failed") || status.startsWith("Camera failed") ->
            Pill(status, dot = Color(0xFFFF3B30))
    }
}

@Composable
internal fun Pill(text: String, dot: Color?) {
    Row(
        Modifier
            .widthIn(max = 320.dp)
            .background(Color(0x80000000), RoundedCornerShape(20.dp))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot != null) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
internal fun TimerCountdown(seconds: Int) {
    Box(Modifier.fillMaxSize().background(Color(0x80000000)), contentAlignment = Alignment.Center) {
        Text(seconds.toString(), color = Color.White, fontSize = 120.sp, fontWeight = FontWeight.Bold)
    }
}

/** src/components/QRCodeDisplay.tsx. */
@Composable
private fun QrOverlay(sessionId: String?, onClose: () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Color(0xE6000000)).clickable(enabled = false) {},
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(horizontal = 20.dp)
                .widthIn(max = 400.dp)
                .background(Color(0xFF1A1A1A), RoundedCornerShape(20.dp))
                .padding(30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Scan to Connect", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                "Scan this code to open the app or web remote on another device",
                color = Color(0xFF888888),
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            if (sessionId != null) {
                QrCode(SessionIds.remoteUrl(sessionId), Modifier.size(250.dp))
                Spacer(Modifier.height(16.dp))
                Text(
                    "Session: $sessionId",
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                )
            } else {
                Text("Creating session…", color = Color.White, fontSize = 16.sp)
            }
            Spacer(Modifier.height(16.dp))
            Text(
                "If Second Shooter is installed it will open in the app. Otherwise the web remote will load in the browser.",
                color = Color(0xFF666666),
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            Text(
                "Cancel",
                color = Color.White,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFF333333))
                    .clickable(onClick = onClose)
                    .padding(horizontal = 40.dp, vertical = 14.dp),
            )
        }
    }
}

@Composable
private fun CameraPermissionGate(blocked: Boolean, onAllow: () -> Unit, onOpenSettings: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Second Shooter needs the camera", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        Text(
            if (blocked) {
                "Camera access is turned off for this app. Turn it on under Permissions in Android's settings for Second Shooter."
            } else {
                "This phone is the camera: it streams what it sees to your remote and saves the photos and videos."
            },
            color = Color(0xFFCCCCCC),
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Button(onClick = if (blocked) onOpenSettings else onAllow) {
            Text(if (blocked) "Open settings" else "Allow camera")
        }
    }
}
