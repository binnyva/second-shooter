package com.secondshooter.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.secondshooter.app.camera.Lenses
import kotlinx.coroutines.delay

/**
 * What a pinch on the viewfinder needs to know and do. The zoom is tracked
 * here during the gesture, from [zoom] at its start, so it doesn't wait on
 * the camera (or, on a remote, the round trip) to move.
 */
class PinchZoomState(
    val zoom: () -> Float,
    val range: () -> ClosedFloatingPointRange<Float>,
    /** Zoom stops that give a haptic tick when a pinch reaches them. */
    val stops: () -> List<Float>,
    val onZoom: (Float) -> Unit,
    val onEnd: () -> Unit,
) {
    var pinching by mutableStateOf(false)
        internal set

    /** Bumped on each pinch step, so the readout can stay up a moment after. */
    var lastChange by mutableIntStateOf(0)
        internal set

    var target by mutableStateOf(1f)
        internal set
}

@Composable
fun rememberPinchZoomState(
    zoom: () -> Float,
    range: () -> ClosedFloatingPointRange<Float>,
    stops: () -> List<Float>,
    onZoom: (Float) -> Unit,
    onEnd: () -> Unit,
): PinchZoomState {
    val currentZoom by rememberUpdatedState(zoom)
    val currentRange by rememberUpdatedState(range)
    val currentStops by rememberUpdatedState(stops)
    val currentOnZoom by rememberUpdatedState(onZoom)
    val currentOnEnd by rememberUpdatedState(onEnd)
    return remember {
        PinchZoomState(
            zoom = { currentZoom() },
            range = { currentRange() },
            stops = { currentStops() },
            onZoom = { currentOnZoom(it) },
            onEnd = { currentOnEnd() },
        )
    }
}

/**
 * Two-finger pinch to zoom, with a haptic tick at each lens stop. One finger
 * is left alone, so taps on the viewfinder (and the controls drawn over it)
 * work as before.
 */
@Composable
fun Modifier.pinchToZoom(state: PinchZoomState): Modifier {
    val haptics = LocalHapticFeedback.current
    return pointerInput(state) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            var pinching = false
            do {
                val event = awaitPointerEvent()
                if (event.changes.count { it.pressed } >= 2) {
                    val scale = event.calculateZoom()
                    if (!pinching && scale != 1f) {
                        pinching = true
                        state.target = state.zoom()
                        state.pinching = true
                    }
                    if (pinching && scale != 1f) {
                        val from = state.target
                        val to = Lenses.pinchedZoom(from, scale, state.range())
                        if (to != from) {
                            state.target = to
                            state.lastChange++
                            if (Lenses.crossesStop(from, to, state.stops())) {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            }
                            state.onZoom(to)
                        }
                    }
                    if (pinching) event.changes.forEach { it.consume() }
                }
            } while (event.changes.any { it.pressed })
            if (pinching) {
                state.pinching = false
                state.onEnd()
            }
        }
    }
}

/** "2.3×" in the middle of the viewfinder while pinching, and for a second after. */
@Composable
fun PinchZoomReadout(state: PinchZoomState, modifier: Modifier = Modifier) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(state.lastChange, state.pinching) {
        if (state.lastChange == 0) return@LaunchedEffect
        visible = true
        if (!state.pinching) {
            delay(1000)
            visible = false
        }
    }
    AnimatedVisibility(visible, modifier, enter = fadeIn(), exit = fadeOut()) {
        Text(
            "${Lenses.formatZoom(state.target)}×",
            color = Color.White,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .background(Color(0x99000000), RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 6.dp),
        )
    }
}
