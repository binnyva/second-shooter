package com.secondshooter.app.ui

import android.app.Activity
import android.app.Application
import android.app.RecoverableSecurityException
import android.content.IntentSender
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.secondshooter.app.media.CaptureNames
import com.secondshooter.app.media.CaptureStore
import com.secondshooter.app.media.GalleryApps
import com.secondshooter.app.media.LibraryPhoto
import com.secondshooter.app.media.PhotoLibrary
import com.secondshooter.app.media.SaveFolder
import com.secondshooter.app.settings.AppSettings
import com.secondshooter.app.settings.SYSTEM_DEFAULT_GALLERY
import com.secondshooter.app.settings.SettingsRepository
import com.secondshooter.app.settings.settingsDataStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.FileNotFoundException
import java.text.DateFormat
import java.util.Date

/** A 12 MP photo (4080 on the long side on a Pixel 9 Pro) loads at full size; bigger ones are halved. */
private const val MAX_PHOTO_EDGE = 4096

/** The result of reading one photo for the viewer. */
sealed interface PhotoLoad {
    data class Loaded(val bitmap: Bitmap) : PhotoLoad
    /** Deleted elsewhere: it's dropped from the list. */
    data object Missing : PhotoLoad
    /** There, but we can't read it (e.g. access to its folder was given up in Settings). */
    data object Unreadable : PhotoLoad
}

class GalleryViewModel(app: Application) : AndroidViewModel(app) {
    private val store = CaptureStore(app, app.settingsDataStore)

    @OptIn(ExperimentalCoroutinesApi::class)
    val photos: StateFlow<List<LibraryPhoto>?> = PhotoLibrary.changes
        .mapLatest { store.libraryPhotos() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val settings: StateFlow<AppSettings> = SettingsRepository(app.settingsDataStore).settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppSettings())

    fun openInLabel(choice: String): String =
        if (choice == SYSTEM_DEFAULT_GALLERY) "Open in…"
        else "Open in ${GalleryApps.label(getApplication(), choice) ?: "gallery app"}"

    suspend fun load(photo: LibraryPhoto, maxEdge: Int): PhotoLoad = try {
        PhotoLoad.Loaded(store.loadPhoto(Uri.parse(photo.uri), maxEdge))
    } catch (e: FileNotFoundException) {
        Log.i(TAG, "A listed photo is gone; dropping it")
        viewModelScope.launch { store.forgetPhoto(photo) }
        PhotoLoad.Missing
    } catch (e: Exception) {
        Log.w(TAG, "Couldn't read a listed photo", e)
        PhotoLoad.Unreadable
    }

    /**
     * Deletes [photo]. A camera-roll photo this install didn't save needs the
     * user's say in a system dialog: [onNeedsConsent] gets it, and the
     * result goes to [deletedWithConsent].
     */
    fun delete(photo: LibraryPhoto, onNeedsConsent: (IntentSender) -> Unit) {
        viewModelScope.launch {
            try {
                store.deletePhoto(photo)
            } catch (e: SecurityException) {
                val resolver = getApplication<Application>().contentResolver
                val consent = when {
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
                        MediaStore.createDeleteRequest(resolver, listOf(Uri.parse(photo.uri))).intentSender
                    e is RecoverableSecurityException -> e.userAction.actionIntent.intentSender
                    else -> null
                }
                if (consent != null) onNeedsConsent(consent) else failed(e)
            } catch (e: Exception) {
                failed(e)
            }
        }
    }

    /** After the system's delete dialog was accepted. */
    fun deletedWithConsent(photo: LibraryPhoto) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // The system deleted it.
            viewModelScope.launch { store.forgetPhoto(photo) }
        } else {
            // Android 10 only granted access; delete it now.
            delete(photo) { failed(null) }
        }
    }

    private fun failed(e: Exception?) {
        Log.w(TAG, "Delete failed", e)
        Toast.makeText(getApplication(), "Couldn't delete the photo", Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val TAG = "SSGallery"
    }
}

/**
 * The photo viewer: the photos this app saved, opening on the newest. Swipe
 * for the previous and next, pinch or double-tap to zoom, tap to hide the
 * controls. "Open in" hands the photo to the gallery app chosen in Settings.
 */
@Composable
fun GalleryScreen(viewModel: GalleryViewModel, onBack: () -> Unit) {
    val photos by viewModel.photos.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var showControls by remember { mutableStateOf(true) }
    var confirmDelete by remember { mutableStateOf<LibraryPhoto?>(null) }
    var awaitingConsent by remember { mutableStateOf<LibraryPhoto?>(null) }
    val consentLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val photo = awaitingConsent
        awaitingConsent = null
        if (photo != null && result.resultCode == Activity.RESULT_OK) viewModel.deletedWithConsent(photo)
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val list = photos
        when {
            list == null -> CircularProgressIndicator(color = Color.White, modifier = Modifier.align(Alignment.Center))
            list.isEmpty() -> NoPhotos(Modifier.align(Alignment.Center))
            else -> PhotoPager(
                photos = list,
                viewModel = viewModel,
                showControls = showControls,
                onToggleControls = { showControls = !showControls },
                openInLabel = viewModel.openInLabel(settings.galleryApp),
                onOpenIn = { photo ->
                    if (!GalleryApps.openPhoto(context, settings.galleryApp, Uri.parse(photo.uri))) {
                        Toast.makeText(context, "No app can open this photo", Toast.LENGTH_SHORT).show()
                    }
                },
                onDelete = { confirmDelete = it },
            )
        }

        // Back stays up when there's nothing to show.
        AnimatedVisibility(
            visible = showControls || list.isNullOrEmpty(),
            enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopStart),
        ) {
            IconButton(onClick = onBack, modifier = Modifier.statusBarsPadding().padding(4.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to the camera", tint = Color.White)
            }
        }
    }

    confirmDelete?.let { photo ->
        val where = if (photo.folder.isEmpty()) "the camera roll" else SaveFolder.describe(photo.folder)
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Delete this photo?") },
            text = { Text("${photo.name} will be deleted from $where. This can't be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = null
                    viewModel.delete(photo) { consent ->
                        awaitingConsent = photo
                        consentLauncher.launch(IntentSenderRequest.Builder(consent).build())
                    }
                }) { Text("Delete", color = Color(0xFFFF453A)) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PhotoPager(
    photos: List<LibraryPhoto>,
    viewModel: GalleryViewModel,
    showControls: Boolean,
    onToggleControls: () -> Unit,
    openInLabel: String,
    onOpenIn: (LibraryPhoto) -> Unit,
    onDelete: (LibraryPhoto) -> Unit,
) {
    // Opens on the newest; a shot arriving meanwhile (from the remote) is
    // added at the end and doesn't move the page.
    val pager = rememberPagerState(initialPage = photos.size - 1) { photos.size }
    val zoomStates = remember { HashMap<String, PhotoZoomState>() }
    val current = photos.getOrNull(pager.currentPage.coerceAtMost(photos.size - 1))
    val currentZoomed = current?.let { zoomStates.getOrPut(it.uri) { PhotoZoomState() }.zoomed } == true

    Box(Modifier.fillMaxSize()) {
        HorizontalPager(
            pager,
            Modifier.fillMaxSize(),
            beyondViewportPageCount = 1,
            // Zoomed in, one finger pans the photo rather than changing it.
            userScrollEnabled = !currentZoomed,
            key = { photos[it].uri },
        ) { page ->
            val photo = photos[page]
            val zoom = zoomStates.getOrPut(photo.uri) { PhotoZoomState() }
            PhotoPage(photo, zoom, isCurrent = page == pager.currentPage, viewModel, onToggleControls)
        }

        AnimatedVisibility(
            visible = showControls && current != null,
            enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            current?.let { PhotoInfo(it, pager.currentPage + 1, photos.size) }
        }

        AnimatedVisibility(
            visible = showControls && current != null,
            enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            current?.let { photo ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0x99000000))))
                        .navigationBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { onOpenIn(photo) }) {
                        Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, tint = Color.White, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(openInLabel, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    TextButton(onClick = { onDelete(photo) }) {
                        Icon(Icons.Outlined.Delete, null, tint = Color.White, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Delete", color = Color.White)
                    }
                }
            }
        }
    }
}

@Composable
private fun PhotoPage(
    photo: LibraryPhoto,
    zoom: PhotoZoomState,
    isCurrent: Boolean,
    viewModel: GalleryViewModel,
    onTap: () -> Unit,
) {
    // Full size, so zooming in shows the real detail (focus checks).
    val load by produceState<PhotoLoad?>(null, photo.uri) { value = viewModel.load(photo, MAX_PHOTO_EDGE) }

    // Swiped away: back to fit.
    LaunchedEffect(isCurrent) {
        if (!isCurrent) zoom.reset()
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when (val result = load) {
            null -> CircularProgressIndicator(color = Color(0x80FFFFFF))
            is PhotoLoad.Loaded -> {
                val image = remember(result.bitmap) { result.bitmap.asImageBitmap() }
                ZoomableImage(image, zoom, onTap)
            }
            PhotoLoad.Unreadable -> Text(
                "Can't open this photo.\nIts folder may no longer be shared with Second Shooter.",
                color = Color(0xFFAAAAAA), textAlign = TextAlign.Center, fontSize = 14.sp,
                modifier = Modifier.padding(32.dp),
            )
            PhotoLoad.Missing -> Unit
        }
    }
}

@Composable
private fun PhotoInfo(photo: LibraryPhoto, position: Int, count: Int) {
    val takenAt = CaptureNames.parse(photo.name) ?: photo.savedAt.takeIf { it > 0 }
    Column(
        Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent)))
            .statusBarsPadding()
            .padding(start = 56.dp, end = 56.dp, top = 8.dp, bottom = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("$position / $count", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        if (takenAt != null) {
            Text(
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.MEDIUM).format(Date(takenAt)),
                color = Color(0xCCFFFFFF), fontSize = 12.sp,
            )
        }
        Text(photo.name, color = Color(0x99FFFFFF), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun NoPhotos(modifier: Modifier = Modifier) {
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.PhotoLibrary, null, tint = Color(0x80FFFFFF), modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(12.dp))
        Text("No photos yet", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        Text(
            "Photos you take with Second Shooter show up here.",
            color = Color(0xAAFFFFFF), fontSize = 14.sp, textAlign = TextAlign.Center,
        )
    }
}
