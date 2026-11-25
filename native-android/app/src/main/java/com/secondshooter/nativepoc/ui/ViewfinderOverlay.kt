package com.secondshooter.nativepoc.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import com.secondshooter.nativepoc.settings.AspectRatioSetting
import com.secondshooter.nativepoc.settings.GridOverlay

/**
 * The full-screen viewfinder's overlays, as the RN app drew them:
 * - AspectRatioContainer: for 1:1 and 4:5, a full-width frame centred on
 *   screen, with 70% black bars above and below and a faint border. It only
 *   frames the shot; the saved photo is the full frame, as before.
 * - GridOverlay: lines across the whole screen.
 */
@Composable
fun ViewfinderOverlay(aspectRatio: AspectRatioSetting, grid: GridOverlay, modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxSize()) {
        val lines = when (grid) {
            GridOverlay.NONE -> 0
            GridOverlay.THREE_BY_THREE -> 3
            GridOverlay.FOUR_BY_FOUR -> 4
        }
        val lineColor = Color(0x4DFFFFFF)
        for (i in 1 until lines) {
            val x = size.width * i / lines
            val y = size.height * i / lines
            drawLine(lineColor, Offset(x, 0f), Offset(x, size.height), 1.5f)
            drawLine(lineColor, Offset(0f, y), Offset(size.width, y), 1.5f)
        }

        val frame = framedArea(size, aspectRatio) ?: return@Canvas
        val mask = Color(0xB3000000)
        drawRect(mask, Offset.Zero, Size(size.width, frame.top))
        drawRect(mask, Offset(0f, frame.bottom), Size(size.width, size.height - frame.bottom))
        drawRect(Color(0x4DFFFFFF), frame.topLeft, frame.size, style = Stroke(1.5f))
    }
}

/** The framed part of a full-screen viewfinder, or null for 9:16 (no mask). */
fun framedArea(screen: Size, aspectRatio: AspectRatioSetting): Rect? {
    val heightForWidth = when (aspectRatio) {
        AspectRatioSetting.SQUARE -> 1f
        AspectRatioSetting.FOUR_FIVE -> 5f / 4f
        AspectRatioSetting.NINE_SIXTEEN -> return null
    }
    val height = (screen.width * heightForWidth).coerceAtMost(screen.height)
    val top = (screen.height - height) / 2
    return Rect(0f, top, screen.width, top + height)
}
