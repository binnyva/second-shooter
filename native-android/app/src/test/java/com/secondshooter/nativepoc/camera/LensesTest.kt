package com.secondshooter.nativepoc.camera

import android.view.Surface
import com.secondshooter.nativepoc.protocol.CameraFacing
import org.junit.Assert.assertEquals
import org.junit.Test

class LensesTest {
    private fun ids(lenses: List<Lens>) = lenses.map { it.id }
    private fun labels(lenses: List<Lens>) = lenses.map { it.label }

    @Test
    fun pixel9Pro() {
        // Measured on the phone: 12.4mm, 24.4mm and 110mm equivalent.
        val lenses = Lenses.backLenses(0.5f, 30f, listOf(0.509f, 1f, 4.508f))
        assertEquals(listOf("0.5", "1", "2", "5"), labels(lenses))
        assertEquals(listOf("ultra-wide", "wide", "digital-2x", "telephoto-1"), ids(lenses))
    }

    @Test
    fun samsungUltraWithTwoTelephotos() {
        val lenses = Lenses.backLenses(0.6f, 100f, listOf(0.6f, 1f, 3.05f, 9.8f))
        assertEquals(listOf("0.6", "1", "2", "3", "10"), labels(lenses))
    }

    @Test
    fun twoXTelephotoReplacesTheDigitalCrop() {
        assertEquals(listOf("1", "2"), labels(Lenses.backLenses(1f, 10f, listOf(1f, 2.05f))))
    }

    @Test
    fun withoutPhysicalLensInfoFallsBackToTheZoomRange() {
        assertEquals(listOf("0.5", "1", "2"), labels(Lenses.backLenses(0.5f, 8f, emptyList())))
        assertEquals(listOf("1"), labels(Lenses.backLenses(1f, 1f, emptyList())))
    }

    @Test
    fun telephotoBeyondTheZoomRangeIsDropped() {
        assertEquals(listOf("1", "2"), labels(Lenses.backLenses(1f, 4f, listOf(1f, 5f))))
    }

    @Test
    fun snapsTelephotoFactors() {
        assertEquals(5f, Lenses.snapTelephoto(4.508f))
        assertEquals(3f, Lenses.snapTelephoto(3.05f))
        assertEquals(3f, Lenses.snapTelephoto(2.9f))
        assertEquals(2.5f, Lenses.snapTelephoto(2.5f))
        assertEquals(10f, Lenses.snapTelephoto(9.8f))
    }

    @Test
    fun formatsZoomLabels() {
        assertEquals("0.6", Lenses.formatZoom(0.6000001f))
        assertEquals("1", Lenses.formatZoom(1f))
        assertEquals("2.5", Lenses.formatZoom(2.5f))
    }

    private val pixel = Lenses.backLenses(0.5f, 30f, listOf(0.509f, 1f, 4.508f))

    @Test
    fun lensInfoStartsWithSelfieAndMarksTheMatchingLens() {
        val info = Lenses.toLensInfo(pixel, 2.02f, CameraFacing.BACK, hasFrontCamera = true)
        assertEquals(listOf("selfie", "ultra-wide", "wide", "digital-2x", "telephoto-1"), info.map { it.id })
        assertEquals(listOf(false, false, false, true, false), info.map { it.isActive })
    }

    @Test
    fun inBetweenZoomMarksTheClosestLens() {
        val info = Lenses.toLensInfo(pixel, 3.8f, CameraFacing.BACK, hasFrontCamera = true)
        assertEquals("telephoto-1", info.single { it.isActive }.id)
    }

    @Test
    fun onTheFrontCameraOnlySelfieIsActive() {
        val info = Lenses.toLensInfo(pixel, 1f, CameraFacing.FRONT, hasFrontCamera = true)
        assertEquals("selfie", info.single { it.isActive }.id)
    }

    @Test
    fun noSelfieWithoutAFrontCamera() {
        val info = Lenses.toLensInfo(pixel, 1f, CameraFacing.BACK, hasFrontCamera = false)
        assertEquals("ultra-wide", info.first().id)
    }

    @Test
    fun captureRotationFollowsTheDevice() {
        assertEquals(Surface.ROTATION_0, captureRotationFor(0))
        assertEquals(Surface.ROTATION_0, captureRotationFor(350))
        assertEquals(Surface.ROTATION_270, captureRotationFor(90))
        assertEquals(Surface.ROTATION_180, captureRotationFor(180))
        assertEquals(Surface.ROTATION_90, captureRotationFor(270))
    }
}
