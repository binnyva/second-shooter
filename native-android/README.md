# Second Shooter: native Android app

The Kotlin replacement for the React Native Android app, being built phase by
phase per [PORTING_PLAN.md](PORTING_PLAN.md). It started as a prototype that
proved CameraX can own the camera, stream it over WebRTC at any zoom, and take
photos at the same time (1440x1080 at 30fps on a Pixel 9 Pro).

It pairs with the existing web remote (`web-remote/`) through the same
Firestore signaling and TURN function as the React Native app. It does not
replace or touch the Expo app; it installs alongside it as
`com.secondshooter.nativepoc` ("SS Native Test").

## How it works

Source is in `app/src/main/java/com/secondshooter/nativepoc/`:

- `camera/CameraStreamer.kt`: CameraX binds **Preview + ImageCapture +
  VideoCapture** to the back camera (on a Pixel 9 Pro it picks 1440x1080 for
  the stream, 4080x3072 for photos and 1920x1080 for video). If a phone can't
  bind all three, video is dropped and the rest keeps working. Preview renders into a SurfaceTexture owned by WebRTC's
  `SurfaceTextureHelper`, and each frame goes to a WebRTC `VideoSource` as a
  GPU texture. WebRTC never opens the camera, so there is no handoff, and the
  stream follows zoom (including the switch to the 5x telephoto) because it is
  the same Preview stream. The texture's built-in sensor rotation is undone and
  sent as frame metadata instead, as WebRTC's own `Camera2Session` does.
- `session/CameraSessionViewModel.kt`: owns the camera, the track, the
  Firestore session and the peer connection, and answers the remote's
  commands. Being a ViewModel, it survives activity recreation; the camera is
  re-bound to each new lifecycle and keeps its zoom.
- `signaling/`: same Firestore layout as `src/services/SignalingService.ts`.
  The phone is the offerer and creates the `camera-commands` data channel.
  Firebase is configured in code from the repo's `.env` (`EXPO_PUBLIC_FIREBASE_*`,
  read at build time), so there is no `google-services.json`.
- `rtc/`: the peer connection (H.264 preferred so the hardware encoder is
  used), TURN credentials from `getIceServers`, and the stats line.
- `protocol/Protocol.kt`: the data-channel messages, typed with
  kotlinx.serialization. `shared/protocol.ts` is the source of truth; see
  "Protocol checks" below.
- `settings/`: DataStore, with the React Native app's keys and defaults.
- `media/CaptureStore.kt`: photos go to `Pictures/SecondShooter`, videos to
  `Movies/SecondShooter`.
- `ui/`: Compose screens (camera, settings) under Navigation Compose.

## Protocol checks

`shared/protocol-fixtures.json` has an example of every message.
`shared/protocol.ts` lists every message type, and the build fails if a type
is missing from that list. The Jest test `src/__tests__/protocolFixtures.test.ts`
fails if the fixtures don't cover the list, and
`ProtocolFixturesTest.kt` decodes and re-encodes every example. A protocol
change therefore has to go into `shared/protocol.ts`, the fixtures, and
`Protocol.kt` together.

## Build and run

```bash
cd native-android
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:installDebug
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:testDebugUnitTest
```

Open "SS Native Test", then open the QR code's link on another device.

## What to look at

Turn on Settings → "Show connection stats". The overlay then shows, once a second:

- `Camera WxH @ Nfps`: frames CameraX actually delivered.
- `Sent WxH @ Nfps · kbps`: what the encoder is sending.
- codec, encoder implementation, `limit` (`none`, `cpu` or `bandwidth`) and the
  ICE path (`host`, `srflx` or `relay`).

The same line is always logged under the `SSStats` tag:

```bash
adb logcat -s SSStats SSSession SSCamera SSRtc
```

On the remote side, `chrome://webrtc-internals` shows the received frame rate.
