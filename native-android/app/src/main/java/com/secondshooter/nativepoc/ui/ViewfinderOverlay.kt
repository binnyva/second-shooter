package com.secondshooter.nativepoc.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.secondshooter.nativepoc.protocol.CaptureMode
import com.secondshooter.nativepoc.settings.AspectRatioSetting
import com.secondshooter.nativepoc.settings.GridOverlay

/**
 * Drawn over the 3:4 viewfinder: what the capture will actually contain,
 * the grid, and the self-timer.
 *
 * Photo mode: the aspect-ratio setting masks the viewfinder, as
 * AspectRatioContainer did. It only frames the shot; the saved photo is the
 * full 4:3 frame, as before. Video mode: video is 16:9, so in portrait it
 * keeps the full height and 3/4 of the width; the sides are dimmed.
 */
@Composable
fun ViewfinderOverlay(
    mode: CaptureMode,
    aspectRatio: AspectRatioSetting,
    grid: GridOverlay,
    countdown: Int?,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        Canvas(Modifier.fillMaxSize()) {
            val visible = visibleArea(size, mode, aspectRatio)
            val dim = if (mode == CaptureMode.VIDEO) Color(0x99000000) else Color.Black
            // Everything outside the visible area.
            drawRect(dim, Offset.Zero, Size(size.width, visible.top))
            drawRect(dim, Offset(0f, visible.bottom), Size(size.width, size.height - visible.bottom))
            drawRect(dim, Offset(0f, visible.top), Size(visible.left, visible.height))
            drawRect(dim, Offset(visible.right, visible.top), Size(size.width - visible.right, visible.height))

            val lines = when (grid) {
                GridOverlay.NONE -> 0
                GridOverlay.THREE_BY_THREE -> 3
                GridOverlay.FOUR_BY_FOUR -> 4
            }
            val stroke = 1.5f
            val lineColor = Color(0x80FFFFFF)
            for (i in 1 until lines) {
                val x = visible.left + visible.width * i / lines
                val y = visible.top + visible.height * i / lines
                drawLine(lineColor, Offset(x, visible.top), Offset(x, visible.bottom), stroke)
                drawLine(lineColor, Offset(visible.left, y), Offset(visible.right, y), stroke)
            }
        }
        if (countdown != null) {
            Text(
                countdown.toString(),
                color = Color.White,
                fontSize = 120.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.Center),
            )
        }
    }
}

/** The part of a portrait 3:4 viewfinder that the capture will contain. */
fun visibleArea(size: Size, mode: CaptureMode, aspectRatio: AspectRatioSetting): Rect {
    if (mode == CaptureMode.VIDEO) {
        val width = size.height * 9f / 16f
        val left = (size.width - width) / 2
        return Rect(left, 0f, left + width, size.height)
    }
    val heightForWidth = when (aspectRatio) {
        AspectRatioSetting.SQUARE -> 1f
        AspectRatioSetting.FOUR_FIVE -> 5f / 4f
        // Taller than the viewfinder itself: nothing to mask.
        AspectRatioSetting.NINE_SIXTEEN -> return Rect(Offset.Zero, size)
    }
    val height = (size.width * heightForWidth).coerceAtMost(size.height)
    val top = (size.height - height) / 2
    return Rect(0f, top, size.width, top + height)
}
