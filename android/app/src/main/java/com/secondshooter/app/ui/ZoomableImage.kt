package com.secondshooter.app.ui

import androidx.compose.animation.core.animate
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.geometry.lerp
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.min

/** How far a pinch can go: 8x a fitted 12 MP photo is well past 1:1 on any phone screen. */
private const val MAX_SCALE = 8f

/** Double-tap zooms to this from fit, and back. */
private const val DOUBLE_TAP_SCALE = 2.5f

/**
 * The zoom and pan of one photo in the viewer. Scale 1 is the photo fitted
 * to the screen; the offset is kept so no edge of the photo comes inside the
 * screen's edge once it's bigger than the screen.
 */
@Stable
class PhotoZoomState {
    var scale by mutableFloatStateOf(1f)
        private set
    var offset by mutableStateOf(Offset.Zero)
        private set

    internal var container = IntSize.Zero
    internal var image = Size.Zero

    val zoomed: Boolean get() = scale > 1.01f

    /** Zooms by [zoom] about [centroid] (in the container) and moves by [pan]. */
    internal fun transform(centroid: Offset, pan: Offset, zoom: Float) {
        val newScale = (scale * zoom).coerceIn(1f, MAX_SCALE)
        val factor = newScale / scale
        // Keep the point under the fingers where it is.
        val fromCentre = centroid - Offset(container.width / 2f, container.height / 2f)
        val newOffset = fromCentre - (fromCentre - offset) * factor + pan
        scale = newScale
        offset = clamp(newOffset, newScale)
    }

    suspend fun animateTo(targetScale: Float, targetOffset: Offset) {
        val startScale = scale
        val startOffset = offset
        val endScale = targetScale.coerceIn(1f, MAX_SCALE)
        val endOffset = clamp(targetOffset, endScale)
        animate(0f, 1f) { t, _ ->
            scale = startScale + (endScale - startScale) * t
            offset = lerp(startOffset, endOffset, t)
        }
    }

    fun reset() {
        scale = 1f
        offset = Offset.Zero
    }

    private fun clamp(offset: Offset, scale: Float): Offset {
        if (container == IntSize.Zero || image == Size.Zero) return Offset.Zero
        val fit = min(container.width / image.width, container.height / image.height)
        val maxX = max(0f, (image.width * fit * scale - container.width) / 2f)
        val maxY = max(0f, (image.height * fit * scale - container.height) / 2f)
        return Offset(offset.x.coerceIn(-maxX, maxX), offset.y.coerceIn(-maxY, maxY))
    }
}

/**
 * A photo fitted to the screen that pinches, pans and double-taps to zoom.
 * At fit, one finger isn't handled here, so a swipe reaches the pager; zoomed
 * in, one finger pans the photo instead.
 */
@Composable
fun ZoomableImage(
    bitmap: ImageBitmap,
    state: PhotoZoomState,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    SideEffect { state.image = Size(bitmap.width.toFloat(), bitmap.height.toFloat()) }
    Box(
        modifier
            .fillMaxSize()
            .clipToBounds()
            .onSizeChanged { state.container = it }
            .pointerInput(state) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { tap ->
                        scope.launch {
                            if (state.zoomed) {
                                state.animateTo(1f, Offset.Zero)
                            } else {
                                val fromCentre = tap - Offset(size.width / 2f, size.height / 2f)
                                state.animateTo(DOUBLE_TAP_SCALE, fromCentre * (1 - DOUBLE_TAP_SCALE))
                            }
                        }
                    },
                )
            }
            .pointerInput(state) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val fingers = event.changes.count { it.pressed }
                        if (fingers > 1 || state.zoomed) {
                            val zoom = event.calculateZoom()
                            val pan = event.calculatePan()
                            val centroid = event.calculateCentroid(useCurrent = true)
                            if (centroid.isSpecified && (zoom != 1f || pan != Offset.Zero)) {
                                state.transform(centroid, pan, zoom)
                                event.changes.forEach { if (it.positionChanged()) it.consume() }
                            }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
    ) {
        Image(
            bitmap,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                scaleX = state.scale
                scaleY = state.scale
                translationX = state.offset.x
                translationY = state.offset.y
            },
        )
    }
}
