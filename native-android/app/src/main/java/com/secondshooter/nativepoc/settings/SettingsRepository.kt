package com.secondshooter.nativepoc.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.secondshooter.nativepoc.protocol.FlashMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class SettingsRepository(private val dataStore: DataStore<Preferences>) {
    val settings: Flow<AppSettings> = dataStore.data.map(::read)

    suspend fun update(transform: (AppSettings) -> AppSettings) {
        dataStore.edit { prefs -> write(prefs, transform(read(prefs))) }
    }

    companion object {
        private val TIMER = intPreferencesKey("timer")
        private val ASPECT_RATIO = stringPreferencesKey("aspectRatio")
        private val GRID_OVERLAY = stringPreferencesKey("gridOverlay")
        private val FLASH = stringPreferencesKey("flash")
        private val SAVE_FOLDER_URI = stringPreferencesKey("saveFolderUri")
        private val SAVE_FOLDER_NAME = stringPreferencesKey("saveFolderName")
        private val GALLERY_APP = stringPreferencesKey("galleryApp")
        private val KEEP_SCREEN_AWAKE = booleanPreferencesKey("keepScreenAwake")
        private val VOLUME_SHUTTER = booleanPreferencesKey("volumeShutter")
        private val SHOW_DEBUG_STATS = booleanPreferencesKey("showDebugStats")

        /** Missing or unrecognised values fall back to the defaults. */
        fun read(prefs: Preferences): AppSettings {
            val defaults = AppSettings()
            return AppSettings(
                timer = TimerDuration.fromSeconds(prefs[TIMER]) ?: defaults.timer,
                aspectRatio = AspectRatioSetting.fromWire(prefs[ASPECT_RATIO]) ?: defaults.aspectRatio,
                gridOverlay = GridOverlay.fromWire(prefs[GRID_OVERLAY]) ?: defaults.gridOverlay,
                flash = FlashMode.entries.firstOrNull { it.wire == prefs[FLASH] } ?: defaults.flash,
                saveFolderUri = prefs[SAVE_FOLDER_URI],
                saveFolderName = prefs[SAVE_FOLDER_NAME],
                galleryApp = prefs[GALLERY_APP] ?: defaults.galleryApp,
                keepScreenAwake = prefs[KEEP_SCREEN_AWAKE] ?: defaults.keepScreenAwake,
                volumeShutter = prefs[VOLUME_SHUTTER] ?: defaults.volumeShutter,
                showDebugStats = prefs[SHOW_DEBUG_STATS] ?: defaults.showDebugStats,
            )
        }

        fun write(prefs: MutablePreferences, settings: AppSettings) {
            prefs[TIMER] = settings.timer.seconds
            prefs[ASPECT_RATIO] = settings.aspectRatio.wire
            prefs[GRID_OVERLAY] = settings.gridOverlay.wire
            prefs[FLASH] = settings.flash.wire
            settings.saveFolderUri?.let { prefs[SAVE_FOLDER_URI] = it } ?: prefs.remove(SAVE_FOLDER_URI)
            settings.saveFolderName?.let { prefs[SAVE_FOLDER_NAME] = it } ?: prefs.remove(SAVE_FOLDER_NAME)
            prefs[GALLERY_APP] = settings.galleryApp
            prefs[KEEP_SCREEN_AWAKE] = settings.keepScreenAwake
            prefs[VOLUME_SHUTTER] = settings.volumeShutter
            prefs[SHOW_DEBUG_STATS] = settings.showDebugStats
        }
    }
}
