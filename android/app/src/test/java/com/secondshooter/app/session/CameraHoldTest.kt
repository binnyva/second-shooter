package com.secondshooter.app.session

import com.secondshooter.app.session.CameraHold.Visibility
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraHoldTest {
    @Test
    fun stoppedWithTheScreenOnMeansAnotherApp() {
        assertEquals(Visibility.OTHER_APP, CameraHold.visibilityWhenStopped(screenInteractive = true))
    }

    @Test
    fun stoppedWithTheScreenOffMeansScreenOff() {
        assertEquals(Visibility.SCREEN_OFF, CameraHold.visibilityWhenStopped(screenInteractive = false))
    }

    @Test
    fun holdsWhileInFrontOrScreenOff() {
        assertTrue(CameraHold.shouldHoldCamera(Visibility.IN_FRONT, recording = false))
        assertTrue(CameraHold.shouldHoldCamera(Visibility.SCREEN_OFF, recording = false))
    }

    @Test
    fun releasesForAnotherApp() {
        assertFalse(CameraHold.shouldHoldCamera(Visibility.OTHER_APP, recording = false))
    }

    @Test
    fun keepsARecordingGoingBehindAnotherApp() {
        assertTrue(CameraHold.shouldHoldCamera(Visibility.OTHER_APP, recording = true))
    }
}
