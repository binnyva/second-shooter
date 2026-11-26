package com.secondshooter.app.camera

import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Exposure compensation as CameraX gives it: whole steps of [step] EV from
 * [minIndex] to [maxIndex]. The protocol and the slider talk in EV, so a
 * remote doesn't need to know the step to say "+1".
 */
data class ExposureRange(val minIndex: Int, val maxIndex: Int, val step: Float) {
    val supported: Boolean get() = minIndex < maxIndex && step > 0f
    val minEv: Float get() = minIndex * step
    val maxEv: Float get() = maxIndex * step

    /** The nearest step to [ev], kept to the range. */
    fun indexFor(ev: Float): Int =
        if (!supported) 0 else (ev / step).roundToInt().coerceIn(minIndex, maxIndex)

    fun evFor(index: Int): Float = index * step

    companion object {
        val NONE = ExposureRange(0, 0, 0f)
    }
}

/** 0 → "0", 0.6667 → "+0.7", -1 → "-1". */
fun formatEv(ev: Float): String {
    if (abs(ev) < 0.05f) return "0"
    val number = String.format(Locale.US, "%.1f", abs(ev)).trimEnd('0').trimEnd('.')
    return (if (ev > 0) "+" else "-") + number
}
