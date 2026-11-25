package com.secondshooter.app.camera

import android.view.Surface
import com.secondshooter.app.protocol.CameraFacing
import com.secondshooter.app.protocol.LensInfo
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

data class Lens(val id: String, val label: String, val zoom: Float)

/**
 * Zoom buttons, the Kotlin side of src/utils/lensDetection.ts.
 *
 * The React Native version had to guess telephoto factors from the maximum
 * zoom. Here they come from the physical cameras' focal lengths (see
 * CameraStreamer.physicalZoomRatios), so a 3x, 5x or 10x lens is labelled as
 * what it is. On a logical multi-camera the zoom ratio alone moves CameraX
 * between the physical lenses.
 */
object Lenses {
    private const val ACTIVE_TOLERANCE = 0.05f

    /**
     * @param physicalZoomRatios each back lens's focal length over the main
     *   lens's; empty when the camera doesn't report its physical lenses.
     */
    fun backLenses(minZoom: Float, maxZoom: Float, physicalZoomRatios: List<Float>): List<Lens> {
        val telephotos = physicalZoomRatios
            .filter { it >= 1.8f }
            .map(::snapTelephoto)
            .filter { it <= maxZoom + ACTIVE_TOLERANCE }
            .distinct()
            .sorted()
        return buildList {
            if (minZoom < 0.95f) add(Lens("ultra-wide", formatZoom(minZoom), minZoom))
            add(Lens("wide", "1", 1f))
            // The 2x crop of a high-resolution main sensor is a real stop on
            // most phones (Pixel, iPhone). Offer it unless a lens covers it.
            if (maxZoom >= 2f && telephotos.none { it < 2.6f }) add(Lens("digital-2x", "2", 2f))
            telephotos.forEachIndexed { i, zoom -> add(Lens("telephoto-${i + 1}", formatZoom(zoom), zoom)) }
        }
    }

    /**
     * The factor phones put on the button. From 3x up that's the nearest
     * whole number (the Pixel 9 Pro's telephoto measures 4.51x and is sold
     * and switched to as 5x); below, the nearest half (2.5x lenses exist).
     */
    fun snapTelephoto(ratio: Float): Float =
        if (ratio >= 3f) ratio.roundToInt().toFloat() else (ratio * 2).roundToInt() / 2f

    fun isActive(currentZoom: Float, lensZoom: Float) = abs(currentZoom - lensZoom) < ACTIVE_TOLERANCE

    /**
     * What STATE_UPDATE sends: "S" (selfie) first when there's a front
     * camera, then the back lenses. On the back camera exactly one lens is
     * active: the matching one, or the closest if the zoom is in between.
     */
    fun toLensInfo(
        back: List<Lens>,
        currentZoom: Float,
        facing: CameraFacing,
        hasFrontCamera: Boolean,
    ): List<LensInfo> {
        val onFront = facing == CameraFacing.FRONT
        val closest = if (onFront) null else back.minByOrNull { abs(it.zoom - currentZoom) }
        return buildList {
            if (hasFrontCamera) add(LensInfo("selfie", "S", 1.0, onFront))
            back.forEach { add(LensInfo(it.id, it.label, it.zoom.toDouble(), it == closest)) }
        }
    }

    /** 0.5 → "0.5", 1.0 → "1", 0.6000001 → "0.6". */
    fun formatZoom(zoom: Float): String =
        String.format(Locale.US, "%.1f", zoom).trimEnd('0').trimEnd('.')
}

/** OrientationEventListener degrees → the Surface rotation captures should use. */
fun captureRotationFor(degrees: Int): Int = when (degrees) {
    in 45 until 135 -> Surface.ROTATION_270
    in 135 until 225 -> Surface.ROTATION_180
    in 225 until 315 -> Surface.ROTATION_90
    else -> Surface.ROTATION_0
}
