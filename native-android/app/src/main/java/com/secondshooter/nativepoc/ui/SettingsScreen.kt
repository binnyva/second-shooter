package com.secondshooter.nativepoc.ui

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.secondshooter.nativepoc.settings.AppSettings
import com.secondshooter.nativepoc.settings.AspectRatioSetting
import com.secondshooter.nativepoc.settings.GridOverlay
import com.secondshooter.nativepoc.settings.TimerDuration
import com.secondshooter.nativepoc.settings.SettingsRepository
import com.secondshooter.nativepoc.settings.settingsDataStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(app: Application) : AndroidViewModel(app) {
    private val repository = SettingsRepository(app.settingsDataStore)

    val settings: StateFlow<AppSettings> = repository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppSettings())

    fun update(transform: (AppSettings) -> AppSettings) {
        viewModelScope.launch { repository.update(transform) }
    }
}

/** The settings that do something so far; Phase 6 adds the rest and the polish. */
@Composable
fun SettingsScreen(viewModel: SettingsViewModel, onBack: () -> Unit) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
                Text("Settings", style = MaterialTheme.typography.titleLarge)
            }
            ChoiceRow(
                title = "Self-timer",
                options = TimerDuration.entries,
                selected = settings.timer,
                label = { if (it == TimerDuration.OFF) "Off" else "${it.seconds}s" },
                onSelect = { v -> viewModel.update { it.copy(timer = v) } },
            )
            ChoiceRow(
                title = "Grid",
                options = GridOverlay.entries,
                selected = settings.gridOverlay,
                label = { if (it == GridOverlay.NONE) "None" else it.wire },
                onSelect = { v -> viewModel.update { it.copy(gridOverlay = v) } },
            )
            ChoiceRow(
                title = "Photo framing",
                subtitle = "Masks the viewfinder; the photo itself is always 4:3",
                options = AspectRatioSetting.entries,
                selected = settings.aspectRatio,
                label = { it.wire },
                onSelect = { v -> viewModel.update { it.copy(aspectRatio = v) } },
            )
            ToggleRow(
                title = "Volume keys take photos",
                checked = settings.volumeShutter,
                onChange = { on -> viewModel.update { it.copy(volumeShutter = on) } },
            )
            ToggleRow(
                title = "Keep screen awake",
                checked = settings.keepScreenAwake,
                onChange = { on -> viewModel.update { it.copy(keepScreenAwake = on) } },
            )
            ToggleRow(
                title = "Show connection stats",
                subtitle = "Frame rate, resolution, bitrate and encoder, over the viewfinder",
                checked = settings.showDebugStats,
                onChange = { on -> viewModel.update { it.copy(showDebugStats = on) } },
            )
        }
    }
}

@Composable
private fun ToggleRow(title: String, checked: Boolean, onChange: (Boolean) -> Unit, subtitle: String? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onChange(!checked) }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun <T> ChoiceRow(
    title: String,
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onSelect: (T) -> Unit,
    subtitle: String? = null,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { option ->
                FilterChip(
                    selected = option == selected,
                    onClick = { onSelect(option) },
                    label = { Text(label(option)) },
                )
            }
        }
    }
}
