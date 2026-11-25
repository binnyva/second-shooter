package com.secondshooter.app.settings

import com.secondshooter.app.protocol.FlashMode

/*
 * Mirrors src/types/settings.ts, minus `previewMode` and `previewQuality`:
 * both only exist to manage frame-based preview, which this app doesn't have.
 * Keys and stored values match the React Native app's names.
 */

enum class TimerDuration(val seconds: Int) {
    OFF(0), TWO(2), FIVE(5), TEN(10);

    companion object {
        fun fromSeconds(seconds: Int?) = entries.firstOrNull { it.seconds == seconds }
    }
}

enum class AspectRatioSetting(val wire: String) {
    SQUARE("1:1"), FOUR_FIVE("4:5"), NINE_SIXTEEN("9:16");

    companion object {
        fun fromWire(value: String?) = entries.firstOrNull { it.wire == value }
    }
}

enum class GridOverlay(val wire: String) {
    NONE("none"), THREE_BY_THREE("3x3"), FOUR_BY_FOUR("4x4");

    companion object {
        fun fromWire(value: String?) = entries.firstOrNull { it.wire == value }
    }
}

const val SYSTEM_DEFAULT_GALLERY = "system-default"

data class AppSettings(
    val timer: TimerDuration = TimerDuration.OFF,
    val aspectRatio: AspectRatioSetting = AspectRatioSetting.NINE_SIXTEEN,
    val gridOverlay: GridOverlay = GridOverlay.NONE,
    val flash: FlashMode = FlashMode.OFF,
    /** SAF tree URI of the save folder; null means the camera roll. */
    val saveFolderUri: String? = null,
    val saveFolderName: String? = null,
    /** `SYSTEM_DEFAULT_GALLERY` or an Android package name. */
    val galleryApp: String = SYSTEM_DEFAULT_GALLERY,
    val keepScreenAwake: Boolean = true,
    val volumeShutter: Boolean = true,
    /** Kotlin app only: the fps/bitrate/encoder overlay. */
    val showDebugStats: Boolean = false,
)
