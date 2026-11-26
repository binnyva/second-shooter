package com.secondshooter.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondshooter.app.camera.formatEv
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** The slider hides itself this long after the last touch. */
private const val HIDE_AFTER_MS = 3000L

/** Hidden until the viewfinder is tapped; see [tapToShowExposure]. */
class ExposureControlState {
    var visible by mutableStateOf(false)
        internal set
    var dragging by mutableStateOf(false)
        internal set

    /** Bumped on every touch, to restart the hide timer. */
    internal var lastTouch by mutableIntStateOf(0)

    /** The EV being asked for while dragging. */
    internal var dragEv by mutableFloatStateOf(0f)

    fun toggle() {
        visible = !visible
        lastTouch++
    }

    fun hide() {
        visible = false
    }
}

@Composable
fun rememberExposureControlState() = remember { ExposureControlState() }

/** A tap on the viewfinder shows the slider, and another hides it. */
fun Modifier.tapToShowExposure(state: ExposureControlState, enabled: Boolean): Modifier =
    if (!enabled) this else pointerInput(state) { detectTapGestures(onTap = { state.toggle() }) }

/**
 * A vertical exposure slider with a sun for a thumb, as phone cameras have:
 * drag up to brighten. Snaps to the camera's steps; tap the value to go back
 * to 0. Shown only after a tap on the viewfinder, and hides after a few
 * seconds without a touch.
 */
@Composable
fun ExposureSlider(
    state: ExposureControlState,
    ev: Float,
    min: Float,
    max: Float,
    step: Float,
    onChange: (Float) -> Unit,
    onEnd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val supported = max > min && step > 0f
    LaunchedEffect(state.visible, state.lastTouch, state.dragging) {
        if (state.visible && !state.dragging) {
            delay(HIDE_AFTER_MS)
            state.hide()
        }
    }
    val currentEv by rememberUpdatedState(ev)
    val currentOnChange by rememberUpdatedState(onChange)
    val currentOnEnd by rememberUpdatedState(onEnd)
    val shown = if (state.dragging) state.dragEv else ev
    val label = if (supported) formatEv((shown / step).roundToInt() * step) else "0"
    val trackHeight = 200.dp
    val thumbSize = 36.dp
    val trackPx = with(LocalDensity.current) { trackHeight.toPx() }
    val thumbPx = with(LocalDensity.current) { thumbSize.toPx() }

    AnimatedVisibility(state.visible && supported, modifier, enter = fadeIn(), exit = fadeOut()) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier
                    .width(56.dp)
                    .height(trackHeight)
                    .semantics { contentDescription = "Exposure $label" }
                    .pointerInput(min, max, step) {
                        detectVerticalDragGestures(
                            onDragStart = {
                                state.dragEv = currentEv
                                state.dragging = true
                                state.lastTouch++
                            },
                            onDragEnd = {
                                state.dragging = false
                                state.lastTouch++
                                currentOnEnd()
                            },
                            onDragCancel = {
                                state.dragging = false
                                currentOnEnd()
                            },
                        ) { change, dy ->
                            change.consume()
                            // The full height spans the whole range; up is brighter.
                            val raw = state.dragEv - dy / (trackPx - thumbPx) * (max - min)
                            val target = raw.coerceIn(min, max)
                            val snapped = ((target / step).roundToInt() * step).coerceIn(min, max)
                            val before = (state.dragEv / step).roundToInt()
                            state.dragEv = target
                            if ((target / step).roundToInt() != before) currentOnChange(snapped)
                        }
                    },
                contentAlignment = Alignment.TopCenter,
            ) {
                // Track, with a tick at 0.
                Canvas(Modifier.fillMaxSize()) {
                    val x = size.width / 2
                    val top = thumbPx / 2
                    val bottom = size.height - thumbPx / 2
                    drawLine(Color(0x99FFFFFF), Offset(x, top), Offset(x, bottom), strokeWidth = 2.dp.toPx())
                    val zeroY = top + (max - 0f) / (max - min) * (bottom - top)
                    drawLine(Color.White, Offset(x - 8.dp.toPx(), zeroY), Offset(x + 8.dp.toPx(), zeroY), strokeWidth = 2.dp.toPx())
                }
                val fraction = if (supported) (max - shown.coerceIn(min, max)) / (max - min) else 0.5f
                Box(
                    Modifier
                        .offset { IntOffset(0, (fraction * (trackPx - thumbPx)).roundToInt()) }
                        .size(thumbSize)
                        .clip(CircleShape)
                        .background(Color(0xE6FFCC00)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.WbSunny, null, tint = Color.Black, modifier = Modifier.size(20.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                label,
                color = Color.White,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0x99000000))
                    .clickable {
                        state.lastTouch++
                        currentOnChange(0f)
                        currentOnEnd()
                    }
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    }
}
