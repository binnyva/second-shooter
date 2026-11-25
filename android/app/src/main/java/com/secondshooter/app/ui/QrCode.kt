package com.secondshooter.app.ui

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

/** A QR code on a white tile, as QRCodeDisplay.tsx draws it. */
@Composable
fun QrCode(text: String, modifier: Modifier = Modifier) {
    val qr = remember(text) { qrBitmap(text, 640) }
    Image(
        qr.asImageBitmap(),
        contentDescription = "Pairing QR code",
        modifier = modifier
            .background(Color.White, RoundedCornerShape(12.dp))
            .padding(16.dp),
    )
}

private fun qrBitmap(text: String, size: Int): Bitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
    val pixels = IntArray(size * size) { i ->
        if (matrix[i % size, i / size]) AndroidColor.BLACK else AndroidColor.WHITE
    }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
}
