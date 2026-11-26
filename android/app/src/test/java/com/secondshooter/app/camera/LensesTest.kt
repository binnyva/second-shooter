package com.secondshooter.app.camera

import android.view.Surface
import com.secondshooter.app.protocol.CameraFacing
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
    fun inBetweenZoomMarksTheLensInUseWithTheZoomAsItsLabel() {
        val info = Lenses.toLensInfo(pixel, 3.8f, CameraFacing.BACK, hasFrontCamera = true)
        val active = info.single { it.isActive }
        assertEquals("digital-2x", active.id)
        assertEquals("3.8", active.label)
        // Tapping it still goes to the stop.
        assertEquals(2.0, active.zoom, 0.0)
        assertEquals(listOf("S", "0.5", "3.8", "5"), info.filter { it.id != "wide" }.map { it.label })
    }

    @Test
    fun onAStopTheLabelStaysTheLenss() {
        val info = Lenses.toLensInfo(pixel, 4.97f, CameraFacing.BACK, hasFrontCamera = true)
        assertEquals("telephoto-1", info.single { it.isActive }.id)
        assertEquals("5", info.single { it.isActive }.label)
    }

    @Test
    fun belowEveryLensTheLowestIsInUse() {
        val oneLens = Lenses.backLenses(1f, 8f, emptyList())
        assertEquals("wide", Lenses.lensInUse(oneLens, 0.8f)?.id)
    }

    @Test
    fun pinchScalesAndClampsTheZoom() {
        assertEquals(2f, Lenses.pinchedZoom(1f, 2f, 0.5f..30f))
        assertEquals(0.5f, Lenses.pinchedZoom(0.6f, 0.5f, 0.5f..30f))
        assertEquals(30f, Lenses.pinchedZoom(20f, 2f, 0.5f..30f))
    }

    @Test
    fun pinchTicksOnReachingOrPassingAStop() {
        val stops = listOf(0.5f, 1f, 2f, 5f)
        assertEquals(true, Lenses.crossesStop(1.9f, 2.1f, stops))
        assertEquals(true, Lenses.crossesStop(2.1f, 1.9f, stops))
        assertEquals(true, Lenses.crossesStop(1.9f, 2f, stops))
        assertEquals(false, Lenses.crossesStop(2f, 2.1f, stops))
        assertEquals(false, Lenses.crossesStop(2.2f, 4f, stops))
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
