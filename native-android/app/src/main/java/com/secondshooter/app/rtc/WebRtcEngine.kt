package com.secondshooter.app.rtc

import android.content.Context
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The process-wide WebRTC pieces: one EGL context shared by the camera
 * texture, the hardware encoder and the on-screen renderer, and the factory
 * that builds tracks and peer connections.
 */
class WebRtcEngine(context: Context) {
    val eglBase: EglBase = EglBase.create()
    val factory: PeerConnectionFactory

    init {
        if (initialized.compareAndSet(false, true)) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                    .createInitializationOptions()
            )
        }
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    fun release() {
        factory.dispose()
        eglBase.release()
    }

    private companion object {
        /** PeerConnectionFactory.initialize may only run once per process. */
        val initialized = AtomicBoolean(false)
    }
}
