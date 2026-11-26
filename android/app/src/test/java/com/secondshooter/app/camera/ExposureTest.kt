package com.secondshooter.app.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExposureTest {
    // A typical camera: ±2 EV in sixths.
    private val sixths = ExposureRange(-12, 12, 1f / 6)

    @Test
    fun evRoundsToTheNearestStep() {
        assertEquals(4, sixths.indexFor(0.7f))
        assertEquals(-6, sixths.indexFor(-1f))
        assertEquals(0, sixths.indexFor(0.05f))
    }

    @Test
    fun evIsKeptToTheRange() {
        assertEquals(12, sixths.indexFor(5f))
        assertEquals(-12, sixths.indexFor(-5f))
        assertEquals(2f, sixths.maxEv, 0.0001f)
        assertEquals(-2f, sixths.minEv, 0.0001f)
    }

    @Test
    fun aCameraWithoutExposureCompensationStaysAtZero() {
        assertFalse(ExposureRange.NONE.supported)
        assertEquals(0, ExposureRange.NONE.indexFor(1f))
        assertTrue(sixths.supported)
    }

    @Test
    fun formatsEv() {
        assertEquals("0", formatEv(0f))
        assertEquals("0", formatEv(0.01f))
        assertEquals("+0.7", formatEv(4f / 6))
        assertEquals("-1", formatEv(-1f))
        assertEquals("+2", formatEv(2f))
    }
}
