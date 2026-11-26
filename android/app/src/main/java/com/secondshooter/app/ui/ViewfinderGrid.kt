package com.secondshooter.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import com.secondshooter.app.settings.GridOverlay

/**
 * The grid setting's lines, over the picture only (it sits inside
 * FittedVideo). There's no aspect ratio mask any more: the stream itself is
 * cropped to the setting, so the picture is the shot.
 */
@Composable
fun ViewfinderGrid(grid: GridOverlay, modifier: Modifier = Modifier) {
    val lines = when (grid) {
        GridOverlay.NONE -> return
        GridOverlay.THREE_BY_THREE -> 3
        GridOverlay.FOUR_BY_FOUR -> 4
    }
    Canvas(modifier.fillMaxSize()) {
        val lineColor = Color(0x4DFFFFFF)
        for (i in 1 until lines) {
            val x = size.width * i / lines
            val y = size.height * i / lines
            drawLine(lineColor, Offset(x, 0f), Offset(x, size.height), 1.5f)
            drawLine(lineColor, Offset(0f, y), Offset(size.width, y), 1.5f)
        }
    }
}
