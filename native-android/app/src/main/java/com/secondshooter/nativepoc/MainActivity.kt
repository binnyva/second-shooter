package com.secondshooter.nativepoc

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

class MainActivity : ComponentActivity() {
    private lateinit var controller: PairingController

    private val requestCamera =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) controller.start(this)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Like the system camera: usable from the lock screen, so a phone on a
        // tripod doesn't need unlocking to start a session.
        setShowWhenLocked(true)
        setTurnScreenOn(true)

        FirebaseSetup.init(applicationContext)
        controller = PairingController(this, lifecycleScope)

        setContent { CameraScreen(controller) }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            controller.start(this)
        } else {
            requestCamera.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) controller.release()
    }
}

@Composable
private fun CameraScreen(controller: PairingController) {
    val ui = controller.ui
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        // SurfaceViewRenderer crops frames to its own aspect ratio, so give it
        // the stream's 3:4 rather than the screen's, or the viewfinder shows
        // less than the photo will.
        AndroidView(
            modifier = Modifier.align(Alignment.Center).fillMaxWidth().aspectRatio(3f / 4f),
            factory = { context ->
                SurfaceViewRenderer(context).apply {
                    init(controller.eglBase.eglBaseContext, null)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                    setEnableHardwareScaler(true)
                    controller.camera.videoTrack.addSink(this)
                }
            },
            onRelease = { renderer ->
                runCatching { controller.camera.videoTrack.removeSink(renderer) }
                renderer.release()
            },
        )

        Column(
            Modifier
                .safeDrawingPadding()
                .padding(12.dp)
                .fillMaxWidth()
                .background(Color(0x99000000), RoundedCornerShape(8.dp))
                .padding(10.dp)
        ) {
            Text(
                text = ui.status + (ui.sessionId?.let { " · $it" } ?: ""),
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
            )
            ui.stats?.let {
                Text(it, color = Color(0xFFB8F5B0), fontFamily = FontFamily.Monospace, fontSize = 12.sp)
            }
            ui.lastEvent?.let { Text(it, color = Color(0xFFFFE08A), fontSize = 12.sp) }
        }

        val sessionId = ui.sessionId
        if (!ui.connected && sessionId != null) {
            QrCard(Signaling.remoteUrl(sessionId), Modifier.align(Alignment.Center))
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .safeDrawingPadding()
                .padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (ui.canRestart) {
                Button(onClick = { controller.startSession() }) { Text("New session") }
                Spacer(Modifier.height(12.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ui.lenses.forEach { lens ->
                    val active = Protocol.isActive(ui.zoom, lens.zoom)
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(if (active) Color(0xFFFFD54F) else Color(0x99000000))
                            .clickable { controller.setZoomFromUi(lens.zoom) },
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
                    .clickable { controller.takePhotoFromUi() }
            )
        }
    }
}

@Composable
private fun QrCard(url: String, modifier: Modifier = Modifier) {
    val qr = remember(url) { qrBitmap(url, 640) }
    Column(
        modifier
            .background(Color.White, RoundedCornerShape(12.dp))
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(qr.asImageBitmap(), contentDescription = "Pairing QR code", Modifier.size(220.dp))
        Text(url, color = Color.Black, fontSize = 11.sp)
    }
}

private fun qrBitmap(text: String, size: Int): Bitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
    val pixels = IntArray(size * size) { i ->
        if (matrix[i % size, i / size]) AndroidColor.BLACK else AndroidColor.WHITE
    }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
}
