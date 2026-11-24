# Second Shooter: native Android test app

A throwaway Kotlin app to answer one question before a full rewrite: **can
CameraX own the camera, stream it over WebRTC at 2x zoom, and take photos at
the same time, smoothly, on a real phone?**

It pairs with the existing web remote (`web-remote/`) through the same
Firestore signaling and TURN function as the React Native app. It does not
replace or touch the Expo app; it installs alongside it as
`com.secondshooter.nativepoc` ("SS Native Test").

## How it works

- `CameraStreamer.kt`: CameraX binds **Preview + ImageCapture** to the back
  camera. Preview renders into a SurfaceTexture owned by WebRTC's
  `SurfaceTextureHelper`, and each frame goes to a WebRTC `VideoSource` as a
  GPU texture. WebRTC never opens the camera, so there is no handoff, and the
  stream follows zoom (including the switch to the 5x telephoto) because it is
  the same Preview stream. The on-screen preview is a sink on the same track.
- `Signaling.kt`: same Firestore layout as `src/services/SignalingService.ts`.
  The phone is the offerer and creates the `camera-commands` data channel.
- `FirebaseSetup.kt`: Firebase is configured in code from the repo's `.env`
  (`EXPO_PUBLIC_FIREBASE_*`, read at build time), so there is no
  `google-services.json`. Also fetches TURN credentials from `getIceServers`.
- `PairingController.kt`: answers `GET_STATE`, `SET_ZOOM` and `TAKE_PHOTO`;
  everything else gets an `ERROR`. Photos go to `Pictures/SecondShooter`.
- `RtcSession.kt`: H.264 is put first in the offer so the hardware encoder
  can be used.

Out of scope: video, flash, front camera, settings, save folders, reconnection.

## Build and run

```bash
cd native-android
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:installDebug
```

Open "SS Native Test", then open the QR code's link on another device.

## What to look at

The overlay at the top shows, once a second:

- `Camera WxH @ Nfps`: frames CameraX actually delivered.
- `Sent WxH @ Nfps · kbps`: what the encoder is sending.
- codec, encoder implementation, `limit` (`none`, `cpu` or `bandwidth`) and the
  ICE path (`host`, `srflx` or `relay`).

The same line is logged under the `SSStats` tag:

```bash
adb logcat -s SSStats SSPairing SSCamera SSRtc
```

On the remote side, `chrome://webrtc-internals` shows the received frame rate.
