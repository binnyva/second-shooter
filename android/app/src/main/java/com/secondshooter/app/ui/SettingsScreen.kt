package com.secondshooter.app.ui

import android.Manifest
import android.app.Application
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.secondshooter.app.BuildConfig
import com.secondshooter.app.media.CaptureStore
import com.secondshooter.app.media.GalleryApp
import com.secondshooter.app.media.GalleryApps
import com.secondshooter.app.media.SaveFolder
import com.secondshooter.app.protocol.FlashMode
import com.secondshooter.app.settings.AppSettings
import com.secondshooter.app.settings.AspectRatioSetting
import com.secondshooter.app.settings.GridOverlay
import com.secondshooter.app.settings.SYSTEM_DEFAULT_GALLERY
import com.secondshooter.app.settings.SettingsRepository
import com.secondshooter.app.settings.TimerDuration
import com.secondshooter.app.settings.settingsDataStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(app: Application) : AndroidViewModel(app) {
    private val repository = SettingsRepository(app.settingsDataStore)
    private val store = CaptureStore(app, app.settingsDataStore)

    val settings: StateFlow<AppSettings> = repository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppSettings())

    /**
     * Why the chosen folder may not be working, or null. Two cheap signals,
     * neither of which touches the folder: the last save to it failed, or
     * the system no longer holds our write grant.
     */
    val folderProblem: StateFlow<String?> = combine(repository.settings, store.brokenFolder) { s, broken ->
        val folder = s.saveFolderUri ?: return@combine null
        when {
            !SaveFolder.hasWriteGrant(app, folder) ->
                "Access to this folder was removed. Photos are going to the camera roll until you choose it again."
            broken == folder ->
                "The last save to this folder failed (was it deleted?). It went to the camera roll instead."
            else -> null
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val galleryApps: List<GalleryApp> by lazy { GalleryApps.list(app) }

    fun galleryLabel(choice: String): String =
        if (choice == SYSTEM_DEFAULT_GALLERY) "System default"
        // An uninstalled choice still shows, by package name.
        else GalleryApps.label(getApplication(), choice) ?: choice

    fun update(transform: (AppSettings) -> AppSettings) {
        viewModelScope.launch { repository.update(transform) }
    }

    /** The picker's answer. The grant is seconds old, so no write check. */
    fun onFolderPicked(uri: Uri?) {
        uri ?: return
        val app = getApplication<Application>()
        try {
            SaveFolder.persistGrant(app, uri)
        } catch (e: SecurityException) {
            return
        }
        val previous = settings.value.saveFolderUri
        viewModelScope.launch {
            repository.update {
                it.copy(saveFolderUri = uri.toString(), saveFolderName = SaveFolder.describe(uri.toString()))
            }
            store.clearBrokenFolder()
            if (previous != null && previous != uri.toString()) SaveFolder.releaseGrant(app, Uri.parse(previous))
        }
    }

    fun useCameraRoll() {
        val previous = settings.value.saveFolderUri ?: return
        viewModelScope.launch {
            repository.update { it.copy(saveFolderUri = null, saveFolderName = null) }
            store.clearBrokenFolder()
            SaveFolder.releaseGrant(getApplication(), Uri.parse(previous))
        }
    }
}

/**
 * The settings from app/settings.tsx, in the same sections, minus the
 * "Remote Preview" section: preview mode and quality only existed for
 * frame-based preview. Every change is written straight to DataStore and
 * read live by the camera screen, so nothing needs a restart.
 */
@Composable
fun SettingsScreen(viewModel: SettingsViewModel, onBack: () -> Unit) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val folderProblem by viewModel.folderProblem.collectAsStateWithLifecycle()
    var choosingGallery by remember { mutableStateOf(false) }
    // No initial URI on purpose: passing the current folder makes the picker
    // enumerate it before drawing, which took 5s+ on a large folder (AGENTS.md).
    val pickFolder = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree(),
        viewModel::onFolderPicked,
    )

    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
                Text("Settings", style = MaterialTheme.typography.titleLarge)
            }

            Section("Camera")
            ChoiceRow(
                title = "Self-timer",
                subtitle = "For the shutter on this phone and the volume keys",
                options = TimerDuration.entries,
                selected = settings.timer,
                label = { if (it == TimerDuration.OFF) "Off" else "${it.seconds}s" },
                onSelect = { v -> viewModel.update { it.copy(timer = v) } },
            )
            ChoiceRow(
                title = "Photo framing",
                subtitle = "Crops photos, videos and the preview to this shape",
                options = AspectRatioSetting.entries,
                selected = settings.aspectRatio,
                label = { it.wire },
                onSelect = { v -> viewModel.update { it.copy(aspectRatio = v) } },
            )
            ChoiceRow(
                title = "Grid",
                options = GridOverlay.entries,
                selected = settings.gridOverlay,
                label = { if (it == GridOverlay.NONE) "None" else it.wire },
                onSelect = { v -> viewModel.update { it.copy(gridOverlay = v) } },
            )
            ChoiceRow(
                title = "Flash",
                subtitle = "Also set from the remote. Video uses the torch",
                options = FlashMode.entries,
                selected = settings.flash,
                label = { it.wire.replaceFirstChar(Char::uppercase) },
                onSelect = { v -> viewModel.update { it.copy(flash = v) } },
            )

            Section("Media")
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable { pickFolder.launch(null) }
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Text("Save to", style = MaterialTheme.typography.bodyLarge)
                Text(
                    settings.saveFolderName ?: "Camera roll. Tap to choose a folder.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                folderProblem?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                if (settings.saveFolderUri != null) {
                    TextButton(onClick = viewModel::useCameraRoll, contentPadding = PaddingValues(0.dp)) {
                        Text("Use the camera roll instead")
                    }
                }
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable { choosingGallery = true }
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Text("Gallery app", style = MaterialTheme.typography.bodyLarge)
                Text("Opened by the thumbnail next to the shutter", style = MaterialTheme.typography.bodySmall)
                Text(viewModel.galleryLabel(settings.galleryApp), style = MaterialTheme.typography.bodyMedium)
            }

            Section("General")
            ToggleRow(
                title = "Keep screen awake",
                checked = settings.keepScreenAwake,
                onChange = { on -> viewModel.update { it.copy(keepScreenAwake = on) } },
            )
            ToggleRow(
                title = "Volume button shutter",
                checked = settings.volumeShutter,
                onChange = { on -> viewModel.update { it.copy(volumeShutter = on) } },
            )
            ToggleRow(
                title = "Show connection stats",
                subtitle = "Frame rate, resolution, bitrate and encoder, over the viewfinder",
                checked = settings.showDebugStats,
                onChange = { on -> viewModel.update { it.copy(showDebugStats = on) } },
            )

            Section("Permissions")
            PermissionRow(
                title = "Camera",
                permission = Manifest.permission.CAMERA,
                whenMissing = "Needed for everything. Without it the camera stays black.",
            )
            PermissionRow(
                title = "Microphone",
                permission = Manifest.permission.RECORD_AUDIO,
                whenMissing = "Videos are recorded without sound.",
            )

            Text(
                "Second Shooter ${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(16.dp),
            )
        }
    }

    if (choosingGallery) {
        val options = listOf(SYSTEM_DEFAULT_GALLERY to "System default") +
            viewModel.galleryApps.map { it.packageName to it.label }
        AlertDialog(
            onDismissRequest = { choosingGallery = false },
            title = { Text("Gallery app") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    options.forEach { (value, label) ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.update { it.copy(galleryApp = value) }
                                    choosingGallery = false
                                }
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = settings.galleryApp == value, onClick = null)
                            Text(label, Modifier.padding(start = 12.dp))
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { choosingGallery = false }) { Text("Close") } },
        )
    }
}

@Composable
private fun Section(title: String) {
    HorizontalDivider(Modifier.padding(top = 8.dp))
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
    )
}

/**
 * Where a permission stands, with the one action that can change it: the
 * prompt while Android will still show it, the app's system settings once
 * it won't. Re-checked whenever the screen comes back, e.g. from those
 * system settings.
 */
@Composable
private fun PermissionRow(title: String, permission: String, whenMissing: String) {
    val context = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        refresh++
        onPauseOrDispose { }
    }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refresh++ }
    val status = remember(refresh) { permissionStatus(context, permission) }

    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(
                when (status) {
                    PermissionStatus.GRANTED -> "Allowed"
                    PermissionStatus.ASKABLE -> "Not allowed. $whenMissing"
                    PermissionStatus.BLOCKED -> "Turned off in Android settings. $whenMissing"
                },
                style = MaterialTheme.typography.bodySmall,
                color = if (status == PermissionStatus.GRANTED) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.error
                },
            )
        }
        when (status) {
            PermissionStatus.GRANTED -> Unit
            PermissionStatus.ASKABLE -> TextButton(onClick = {
                markAsked(context, permission)
                request.launch(permission)
            }) { Text("Allow") }
            PermissionStatus.BLOCKED -> TextButton(onClick = { openAppSettings(context) }) { Text("Open settings") }
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
