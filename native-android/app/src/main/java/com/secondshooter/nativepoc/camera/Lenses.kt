package com.secondshooter.nativepoc.camera

import com.secondshooter.nativepoc.protocol.LensInfo
import java.util.Locale
import kotlin.math.abs

data class Lens(val id: String, val label: String, val zoom: Float)

/**
 * Zoom buttons for the back camera. On a Pixel the back camera is a logical
 * multi-camera, so the zoom ratio alone moves between the ultra-wide, main
 * and telephoto sensors.
 *
 * Placeholder until Phase 3 ports src/utils/lensDetection.ts using the
 * physical cameras' focal lengths: for now 5x is assumed whenever the zoom
 * range reaches it, which is right for the Pixel 9 Pro and not much else.
 */
object Lenses {
    private const val ACTIVE_TOLERANCE = 0.05f

    fun forZoomRange(minZoom: Float, maxZoom: Float): List<Lens> = buildList {
        if (minZoom < 0.95f) add(Lens("ultra-wide", formatZoom(minZoom), minZoom))
        add(Lens("wide", "1", 1f))
        if (maxZoom >= 2f) add(Lens("digital-2x", "2", 2f))
        if (maxZoom >= 5f) add(Lens("telephoto-1", "5", 5f))
    }

    fun isActive(currentZoom: Float, lensZoom: Float) = abs(currentZoom - lensZoom) < ACTIVE_TOLERANCE

    fun toLensInfo(lenses: List<Lens>, currentZoom: Float): List<LensInfo> = lenses.map {
        LensInfo(it.id, it.label, it.zoom.toDouble(), isActive(currentZoom, it.zoom))
    }

    /** 0.5 → "0.5", 1.0 → "1", 0.6000001 → "0.6". */
    fun formatZoom(zoom: Float): String =
        String.format(Locale.US, "%.1f", zoom).trimEnd('0').trimEnd('.')
}
