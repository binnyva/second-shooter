package com.secondshooter.app.session

/**
 * When the camera session keeps the camera. It's held while Second Shooter
 * is the app in front, including with the screen off (a camera phone on a
 * tripod, screen dark to save battery, is still in use). Another app in
 * front releases it, except mid-recording: a recording is never cut short,
 * so the camera goes once it ends.
 */
object CameraHold {
    enum class Visibility {
        /** Second Shooter is on screen. */
        IN_FRONT,

        /** Stopped because the screen went off, with Second Shooter still the app in front. */
        SCREEN_OFF,

        /** Stopped because the user went to another app. */
        OTHER_APP,
    }

    /** Why the app stopped: with the screen still on, the user left for another app. */
    fun visibilityWhenStopped(screenInteractive: Boolean): Visibility =
        if (screenInteractive) Visibility.OTHER_APP else Visibility.SCREEN_OFF

    fun shouldHoldCamera(visibility: Visibility, recording: Boolean): Boolean =
        visibility != Visibility.OTHER_APP || recording
}
