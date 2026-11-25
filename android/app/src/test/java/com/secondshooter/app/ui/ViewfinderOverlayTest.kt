package com.secondshooter.app.ui

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import com.secondshooter.app.settings.AspectRatioSetting
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Same geometry as src/components/AspectRatioContainer.tsx. */
class ViewfinderOverlayTest {
    private val screen = Size(1000f, 2000f)

    @Test
    fun squareIsAFullWidthSquareInTheMiddle() {
        assertEquals(Rect(0f, 500f, 1000f, 1500f), framedArea(screen, AspectRatioSetting.SQUARE))
    }

    @Test
    fun fourFiveIsTaller() {
        assertEquals(Rect(0f, 375f, 1000f, 1625f), framedArea(screen, AspectRatioSetting.FOUR_FIVE))
    }

    @Test
    fun nineSixteenMasksNothing() {
        assertNull(framedArea(screen, AspectRatioSetting.NINE_SIXTEEN))
    }
}
