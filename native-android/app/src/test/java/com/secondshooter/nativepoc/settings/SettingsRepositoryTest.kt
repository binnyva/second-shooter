package com.secondshooter.nativepoc.settings

import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import com.secondshooter.nativepoc.protocol.FlashMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SettingsRepositoryTest {
    @Test
    fun emptyStoreGivesTheReactNativeDefaults() {
        val settings = SettingsRepository.read(emptyPreferences())
        assertEquals(AppSettings(), settings)
        // Same defaults as DEFAULT_SETTINGS in src/types/settings.ts.
        assertEquals(TimerDuration.OFF, settings.timer)
        assertEquals(AspectRatioSetting.NINE_SIXTEEN, settings.aspectRatio)
        assertEquals(GridOverlay.NONE, settings.gridOverlay)
        assertEquals(FlashMode.OFF, settings.flash)
        assertNull(settings.saveFolderUri)
        assertEquals(SYSTEM_DEFAULT_GALLERY, settings.galleryApp)
        assertEquals(true, settings.keepScreenAwake)
        assertEquals(true, settings.volumeShutter)
    }

    @Test
    fun roundTripsEveryField() {
        val custom = AppSettings(
            timer = TimerDuration.FIVE,
            aspectRatio = AspectRatioSetting.SQUARE,
            gridOverlay = GridOverlay.THREE_BY_THREE,
            flash = FlashMode.AUTO,
            saveFolderUri = "content://com.android.externalstorage.documents/tree/primary%3ADCIM",
            saveFolderName = "DCIM",
            galleryApp = "com.google.android.apps.photos",
            keepScreenAwake = false,
            volumeShutter = false,
            showDebugStats = true,
        )
        val prefs = mutablePreferencesOf()
        SettingsRepository.write(prefs, custom)
        assertEquals(custom, SettingsRepository.read(prefs))
    }

    @Test
    fun clearingTheSaveFolderRemovesIt() {
        val prefs = mutablePreferencesOf()
        SettingsRepository.write(prefs, AppSettings(saveFolderUri = "content://x", saveFolderName = "x"))
        SettingsRepository.write(prefs, AppSettings())
        assertNull(SettingsRepository.read(prefs).saveFolderUri)
        assertNull(SettingsRepository.read(prefs).saveFolderName)
    }

    @Test
    fun unrecognisedValuesFallBackToDefaults() {
        val prefs = mutablePreferencesOf(
            intPreferencesKey("timer") to 7,
            stringPreferencesKey("aspectRatio") to "16:9",
            stringPreferencesKey("flash") to "torch",
        )
        val settings = SettingsRepository.read(prefs)
        assertEquals(TimerDuration.OFF, settings.timer)
        assertEquals(AspectRatioSetting.NINE_SIXTEEN, settings.aspectRatio)
        assertEquals(FlashMode.OFF, settings.flash)
    }
}
