# Second Shooter: the Android app

Native Kotlin, replacing the earlier React Native app (see
[PORTING_PLAN.md](PORTING_PLAN.md)). It started as a prototype that proved
CameraX can own the camera, stream it over WebRTC at any zoom, and take photos
at the same time (1440x1080 at 30fps on a Pixel 9 Pro). [AGENTS.md](../AGENTS.md)
has the architecture and the reasoning; this file is a map of the code.

It pairs with the web remote (`web-remote/`) through Firestore signaling and
the TURN function. Release builds install as `com.secondshooter.app`, debug
builds as `com.secondshooter.app.debug`.

## How it works

Source is in `app/src/main/java/com/secondshooter/app/`:

- `camera/CameraStreamer.kt`: CameraX binds **Preview + ImageCapture +
  VideoCapture** to the back camera (on a Pixel 9 Pro it picks 1440x1080 for
  the stream, 4080x3072 for photos and 1920x1080 for video). If a phone can't
  bind all three, video is dropped and the rest keeps working. Front-camera
  frames are un-mirrored before streaming (the remotes mirror them on
  display, as they always have); only the local viewfinder mirrors.
- `camera/Lenses.kt`: zoom buttons from the physical lenses' focal lengths
  (Pixels list each lens twice, once as its 2x crop mode; see
  `physicalZoomRatios`). Preview renders into a SurfaceTexture owned by WebRTC's
  `SurfaceTextureHelper`, and each frame goes to a WebRTC `VideoSource` as a
  GPU texture. WebRTC never opens the camera, so there is no handoff, and the
  stream follows zoom (including the switch to the 5x telephoto) because it is
  the same Preview stream. The texture's built-in sensor rotation is undone and
  sent as frame metadata instead, as WebRTC's own `Camera2Session` does.
- `session/CameraSessionViewModel.kt`: owns the camera, the track, the
  Firestore session and the peer connection, and answers the remote's
  commands. Being a ViewModel, it survives activity recreation; the camera is
  re-bound to each new lifecycle and keeps its zoom.
- `session/CameraSessionService.kt`: a foreground service (camera, plus
  microphone once granted) that the camera binds to instead of the screen. The
  session keeps streaming with the screen off or the app in the background;
  backing out of the app ends it.
- Reconnection (`CameraSessionViewModel`): a dropped connection is renegotiated
  with an ICE restart after a 3s grace period, every 5s, up to 12 times, as in
  the RN app. A remote that joins an already-answered session (a reload, a
  second device) asks for a fresh offer by setting the status to `waiting`, and
  gets a new peer connection on the same session.
- `signaling/`: same Firestore layout as the React Native app's `SignalingService.ts`.
  The phone is the offerer and creates the `camera-commands` data channel.
  Firebase is configured in code from the repo's `.env` (`EXPO_PUBLIC_FIREBASE_*`,
  read at build time), so there is no `google-services.json`.
- `rtc/`: the peer connection (H.264 preferred so the hardware encoder is
  used), TURN credentials from `getIceServers`, and the stats line.
- `protocol/Protocol.kt`: the data-channel messages, typed with
  kotlinx.serialization. `shared/protocol.ts` is the source of truth; see
  "Protocol checks" below.
- `settings/`: DataStore, with the React Native app's keys and defaults.
- `media/`: where captures go. `CaptureStore` writes to the folder chosen in
  Settings (a Storage Access Framework tree) through a ContentResolver stream,
  and falls back to the camera roll (`Pictures/SecondShooter`,
  `Movies/SecondShooter`) when there's no folder or a write fails. Photos are
  captured to a cache file and then copied, so a failing folder never loses a
  shot. It never lists the folder: the shutter thumbnail and the broken-folder
  warning come from what the last save did (see "Save Folder" in AGENTS.md).
  `GalleryApps` is `modules/gallery-apps` without the Expo wrapper; its
  `<queries>` block is in this app's manifest.
- Remote mode (`session/RemoteViewModel.kt`, `rtc/RemoteRtcSession.kt`,
  `signaling/RemoteSignaling.kt`, `ui/RemoteScreen.kt`, `ui/QrScanner.kt`): this
  phone as the remote, the Kotlin version of the React Native app's `RemoteScreen.tsx` and
  the web remote. It answers the camera's offers, shows the video, keeps the
  last 20 photo previews, and claims sessions another remote answered. The QR
  scanner feeds CameraX frames to ZXing. Session links
  (`https://apps.binnyva.com/second-shooter/s/{id}`, `secondshooter://s/{id}`)
  open it directly. The camera/remote switch replaces one screen with the other,
  so leaving camera mode ends the camera session and frees the camera.
- `ui/`: Compose screens (camera, settings) under Navigation Compose. The
  viewfinder (`FittedVideo`) shows the whole stream, which the camera has
  already cropped to the aspect ratio setting, with the grid over it. Volume keys reach the camera screen through
  `MainActivity.volumeKeyListener`.

## Protocol checks

`shared/protocol-fixtures.json` has an example of every message.
`shared/protocol.ts` lists every message type, and the build fails if a type
is missing from that list. The Jest test `shared/__tests__/protocolFixtures.test.ts`
fails if the fixtures don't cover the list, and
`ProtocolFixturesTest.kt` decodes and re-encodes every example. A protocol
change therefore has to go into `shared/protocol.ts`, the fixtures, and
`Protocol.kt` together.

## Build and run

```bash
cd android
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:installDebug
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:testDebugUnitTest
```

Open "Second Shooter", tap the QR button, and open the link on another device.

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
