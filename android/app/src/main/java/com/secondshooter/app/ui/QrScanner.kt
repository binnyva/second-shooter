package com.secondshooter.app.ui

import android.Manifest
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.secondshooter.app.signaling.SessionIds
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * src/components/QRCodeScanner.tsx: a full-screen camera with a framed scan
 * area. CameraX streams frames to ZXing (already used for drawing QR codes,
 * so no ML Kit download); the first code holding a session ID wins.
 */
@Composable
fun QrScanner(onScan: (String) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var status by remember { mutableStateOf(permissionStatus(context, Manifest.permission.CAMERA)) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        status = permissionStatus(context, Manifest.permission.CAMERA)
    }
    LaunchedEffect(Unit) {
        if (status != PermissionStatus.GRANTED) {
            markAsked(context, Manifest.permission.CAMERA)
            request.launch(Manifest.permission.CAMERA)
        }
    }

    var error by remember { mutableStateOf<String?>(null) }
    var scanned by remember { mutableStateOf(false) }
    // Set from the analyzer thread; blocks duplicate scans synchronously.
    val locked = remember { AtomicBoolean(false) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (status == PermissionStatus.GRANTED) {
            val analyzerExecutor = remember { Executors.newSingleThreadExecutor() }
            DisposableEffect(Unit) { onDispose { analyzerExecutor.shutdown() } }
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    val previewView = PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
                    val providerFuture = ProcessCameraProvider.getInstance(ctx)
                    providerFuture.addListener({
                        val provider = providerFuture.get()
                        val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                        val analysis = ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                        analysis.setAnalyzer(analyzerExecutor, QrAnalyzer { text ->
                            if (locked.get()) return@QrAnalyzer
                            val sessionId = SessionIds.parse(text)
                            ContextCompat.getMainExecutor(ctx).execute {
                                if (sessionId == null) {
                                    error = "Invalid QR code. Please scan a Second Shooter QR code."
                                } else if (locked.compareAndSet(false, true)) {
                                    scanned = true
                                    error = null
                                    onScan(sessionId)
                                }
                            }
                        })
                        try {
                            provider.unbindAll()
                            provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                        } catch (e: Exception) {
                            Log.e("SSScanner", "Camera bind failed", e)
                            error = "Couldn't open the camera."
                        }
                    }, ContextCompat.getMainExecutor(ctx))
                    previewView
                },
            )
        }

        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Column(
                Modifier.fillMaxWidth().background(Color(0xB3000000)).statusBarsPadding().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(40.dp))
                Text("Scan QR Code", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Point your camera at the QR code on the camera device",
                    color = Color(0xFFAAAAAA),
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                )
            }
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                ScanFrame(Modifier.size(250.dp))
            }
            Column(
                Modifier.fillMaxWidth().background(Color(0xB3000000)).navigationBarsPadding().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                when {
                    status != PermissionStatus.GRANTED -> {
                        Text(
                            "Camera permission is needed to scan QR codes",
                            color = Color.White, fontSize = 16.sp, textAlign = TextAlign.Center,
                        )
                        Spacer(Modifier.height(16.dp))
                        ScannerButton(if (status == PermissionStatus.BLOCKED) "Open settings" else "Grant Permission", Color(0xFF007AFF)) {
                            if (status == PermissionStatus.BLOCKED) openAppSettings(context)
                            else request.launch(Manifest.permission.CAMERA)
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                    error != null -> {
                        Text(error!!, color = Color(0xFFFF3B30), fontSize = 14.sp, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(16.dp))
                        ScannerButton("Try Again", Color(0xFF333333)) {
                            error = null
                            scanned = false
                            locked.set(false)
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                    scanned -> {
                        Text("Connecting...", color = Color(0xFF4CD964), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(24.dp))
                    }
                    else -> {
                        Text("Position the QR code within the frame", color = Color(0xFF888888), fontSize = 14.sp)
                        Spacer(Modifier.height(24.dp))
                    }
                }
                ScannerButton("Cancel", Color(0x26FFFFFF), onCancel)
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}

@Composable
private fun ScannerButton(label: String, background: Color, onClick: () -> Unit) {
    Text(
        label,
        color = Color.White,
        fontSize = 16.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .clickable(onClick = onClick)
            .padding(horizontal = 40.dp, vertical = 14.dp),
    )
}

/** The four corner marks: 40dp arms, 4dp wide, rounded corners, as in the RN scanner. */
@Composable
private fun ScanFrame(modifier: Modifier) {
    Canvas(modifier) {
        val arm = 40.dp.toPx()
        val w = 4.dp.toPx()
        val r = 12.dp.toPx()
        val half = w / 2
        // (corner x, corner y, x direction, y direction)
        listOf(
            floatArrayOf(0f, 0f, 1f, 1f),
            floatArrayOf(size.width, 0f, -1f, 1f),
            floatArrayOf(0f, size.height, 1f, -1f),
            floatArrayOf(size.width, size.height, -1f, -1f),
        ).forEach { (cx, cy, dx, dy) ->
            val x = cx + dx * half
            val y = cy + dy * half
            val path = Path().apply {
                moveTo(x, y + dy * arm)
                lineTo(x, y + dy * r)
                quadraticTo(x, y, x + dx * r, y)
                lineTo(x + dx * arm, y)
            }
            drawPath(path, Color.White, style = Stroke(w))
        }
    }
}

/** Y plane → ZXing. QR codes decode at any rotation, so no rotation handling. */
private class QrAnalyzer(private val onText: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val reader = MultiFormatReader().apply {
        setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)))
    }

    override fun analyze(image: ImageProxy) {
        try {
            val plane = image.planes[0]
            val buffer = plane.buffer
            val data = ByteArray(buffer.remaining()).also { buffer.get(it) }
            val source = PlanarYUVLuminanceSource(
                data, plane.rowStride, image.height, 0, 0, image.width, image.height, false,
            )
            val result = reader.decodeWithState(BinaryBitmap(HybridBinarizer(source)))
            onText(result.text)
        } catch (_: NotFoundException) {
            // No code in this frame.
        } catch (e: Exception) {
            Log.w("SSScanner", "Decode failed", e)
        } finally {
            reader.reset()
            image.close()
        }
    }
}
