package com.secondshooter.app.ui

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeWriter
import com.secondshooter.app.signaling.SessionIds
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The scanner's decode path (a luminance plane through ZXing, as QrAnalyzer
 * does with the camera's Y plane) reads the code the camera screen draws.
 */
class QrRoundTripTest {
    @Test
    fun readsTheCameraScreensCode() {
        val url = SessionIds.remoteUrl("WT56V9")
        val size = 400
        val matrix = QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, size, size)
        // A camera-like frame: the code on a grey background, wider than tall.
        val width = 640
        val height = 480
        val luma = ByteArray(width * height) { 128.toByte() }
        for (y in 0 until size) for (x in 0 until size) {
            luma[(y + 40) * width + (x + 120)] = if (matrix[x, y]) 0 else 255.toByte()
        }
        val source = PlanarYUVLuminanceSource(luma, width, height, 0, 0, width, height, false)
        val reader = MultiFormatReader().apply {
            setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)))
        }
        val text = reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
        assertEquals("WT56V9", SessionIds.parse(text))
    }
}
