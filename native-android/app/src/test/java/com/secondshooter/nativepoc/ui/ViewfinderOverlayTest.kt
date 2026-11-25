package com.secondshooter.nativepoc.ui

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import com.secondshooter.nativepoc.protocol.CaptureMode
import com.secondshooter.nativepoc.settings.AspectRatioSetting
import org.junit.Assert.assertEquals
import org.junit.Test

class ViewfinderOverlayTest {
    // A portrait 3:4 viewfinder.
    private val viewfinder = Size(300f, 400f)

    @Test
    fun squareMasksTopAndBottom() {
        assertEquals(Rect(0f, 50f, 300f, 350f), visibleArea(viewfinder, CaptureMode.PHOTO, AspectRatioSetting.SQUARE))
    }

    @Test
    fun fourFiveMasksLess() {
        assertEquals(Rect(0f, 12.5f, 300f, 387.5f), visibleArea(viewfinder, CaptureMode.PHOTO, AspectRatioSetting.FOUR_FIVE))
    }

    @Test
    fun nineSixteenShowsEverything() {
        assertEquals(Rect(0f, 0f, 300f, 400f), visibleArea(viewfinder, CaptureMode.PHOTO, AspectRatioSetting.NINE_SIXTEEN))
    }

    @Test
    fun videoKeepsTheFullHeightAndThreeQuartersOfTheWidth() {
        assertEquals(Rect(37.5f, 0f, 262.5f, 400f), visibleArea(viewfinder, CaptureMode.VIDEO, AspectRatioSetting.SQUARE))
    }
}
