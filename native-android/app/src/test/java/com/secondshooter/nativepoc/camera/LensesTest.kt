package com.secondshooter.nativepoc.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class LensesTest {
    @Test
    fun pixel9ProRange() {
        val lenses = Lenses.forZoomRange(0.5f, 30f)
        assertEquals(listOf("ultra-wide", "wide", "digital-2x", "telephoto-1"), lenses.map { it.id })
        assertEquals(listOf("0.5", "1", "2", "5"), lenses.map { it.label })
    }

    @Test
    fun noUltraWideWithoutZoomBelowOne() {
        assertEquals(listOf("wide", "digital-2x"), Lenses.forZoomRange(1f, 4f).map { it.id })
    }

    @Test
    fun fixedFocusCameraOnlyHasOneX() {
        assertEquals(listOf("wide"), Lenses.forZoomRange(1f, 1f).map { it.id })
    }

    @Test
    fun formatsZoomLabels() {
        assertEquals("0.6", Lenses.formatZoom(0.6000001f))
        assertEquals("1", Lenses.formatZoom(1f))
        assertEquals("2.5", Lenses.formatZoom(2.5f))
    }

    @Test
    fun marksOnlyTheMatchingLensActive() {
        val info = Lenses.toLensInfo(Lenses.forZoomRange(0.5f, 30f), currentZoom = 2.02f)
        assertEquals(listOf(false, false, true, false), info.map { it.isActive })
    }
}
