package com.secondshooter.app.ui

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * A video track shown whole, centred, at its own aspect ratio, with
 * [overlay] drawn over exactly the picture.
 *
 * The stream is the shot (the camera crops it to the aspect ratio setting),
 * so showing all of it is what makes the viewfinder honest. SurfaceViewRenderer
 * always crops to its own view's shape whatever its scaling type, so the view
 * itself is sized to the frame, from the renderer's resolution events.
 */
@Composable
fun FittedVideo(
    eglBase: EglBase,
    track: VideoTrack,
    mirror: Boolean,
    modifier: Modifier = Modifier,
    overlay: @Composable BoxScope.() -> Unit = {},
) {
    var aspect by remember { mutableStateOf<Float?>(null) }
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(aspect?.let { Modifier.aspectRatio(it) } ?: Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    val main = Handler(Looper.getMainLooper())
                    SurfaceViewRenderer(ctx).apply {
                        init(
                            eglBase.eglBaseContext,
                            object : RendererCommon.RendererEvents {
                                override fun onFirstFrameRendered() {}

                                override fun onFrameResolutionChanged(width: Int, height: Int, rotation: Int) {
                                    if (width <= 0 || height <= 0) return
                                    val sideways = rotation % 180 != 0
                                    val ratio = if (sideways) height.toFloat() / width else width.toFloat() / height
                                    main.post { aspect = ratio }
                                }
                            },
                        )
                        setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                        setEnableHardwareScaler(true)
                        track.addSink(this)
                    }
                },
                // The track carries the camera's true image; a front camera is
                // shown mirrored, as every camera app does.
                update = { it.setMirror(mirror) },
                onRelease = { renderer ->
                    runCatching { track.removeSink(renderer) }
                    renderer.release()
                },
            )
            overlay()
        }
    }
}
