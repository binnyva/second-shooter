# AGENTS.md

## Project Overview

Second Shooter lets one Android phone remotely control another phone's camera over a peer-to-peer WebRTC connection. The camera phone captures photos and videos; a second phone (or any browser) shows a live preview and has the shutter. If the second device doesn't have the app, a browser-based remote (in `web-remote/`) runs at `https://apps.binnyva.com/second-shooter/s/{sessionId}`; the same URLs open the app when it's installed.

The app is native Kotlin (Jetpack Compose, CameraX, WebRTC) in `android/`. It replaced an Expo React Native app in November 2026. The plan it followed is `android/PORTING_PLAN.md`, and the React Native code is in git history before that (`git log -- src/`). There is no iOS app.

## Build Commands

Gradle needs `ANDROID_HOME` (`export ANDROID_HOME="$HOME/Library/Android/sdk"`).

```bash
cd android
./gradlew :app:installDebug          # debug build, installs as com.secondshooter.app.debug
./gradlew :app:installRelease        # R8-minified, installs as com.secondshooter.app
./gradlew :app:installRelease -PappIdSuffix=.preview   # a release build beside the installed app
./gradlew :app:testDebugUnitTest     # JUnit tests (no device)
```

The build reads the Firebase config from the repo root's `.env` (see Firebase Setup); a build without it fails at startup with a clear message.

```bash
npm test                  # Jest tests for shared/ (the protocol fixtures)
npm run web-remote:dev    # the browser remote locally (Vite)
npm run web-remote:build  # build it; deploy web-remote/dist
```

## Architecture

### Device Roles
- **Camera**: creates the Firestore session, shows the QR code on demand, owns the camera, saves media. Start screen (`ui/CameraScreen.kt`, `session/CameraSessionViewModel.kt`).
- **Remote**: scans the QR code or opens a session link, shows the preview, sends commands (`ui/RemoteScreen.kt`, `session/RemoteViewModel.kt`). The web remote does the same in a browser.

The camera/remote switch replaces one screen with the other (navigation `popUpTo`), so leaving camera mode ends the camera session and frees the camera for the QR scanner.

### Connection Flow
1. The camera creates `sessions/{id}` in Firestore (6 characters, no look-alikes) and an offer, with the `camera-commands` data channel and its video track.
2. The remote gets the ID from the QR code or link (`SessionIds.parse` mirrors `shared/session-link.ts`), joins, and answers.
3. ICE candidates go through `offerCandidates` / `answerCandidates`; TURN credentials come from the `getIceServers` function.
4. Once connected the remote sends `GET_STATE` and gets `STATE_UPDATE` back.

### Camera pipeline (`camera/CameraStreamer.kt`)

**CameraX is the only owner of the camera; WebRTC never opens it.** Preview, ImageCapture and VideoCapture are bound together. Preview renders into a SurfaceTexture owned by WebRTC's `SurfaceTextureHelper`, and each frame goes to a WebRTC `VideoSource` as a GPU texture. So the stream follows zoom and lens switches, and photos and recordings never interrupt it. This is the reason for the rewrite: the React Native app had to hand the lens between vision-camera and `getUserMedia`, with a timed handoff, retries, and a JPEG-frames fallback for zoom.

- **The SurfaceTexture's transform matrix already contains the sensor rotation (and, for the front camera, a horizontal flip).** The buffer is still sensor-shaped, so passing it on as-is gives a rotated, squashed image. The frame listener undoes both in the matrix and sends the rotation as frame metadata (CVO), exactly as WebRTC's own `Camera2Session` does. The remotes mirror front-camera video themselves; only the local viewfinder calls `setMirror`.
- **The sensor modes are 4:3, 1440x1080 at 30fps for the stream.** On a Pixel 9 Pro: photos 4080x3072, video 1920x1080, all three bound at once. If a phone can't bind all three, video is dropped (`videoSupported`) and the rest keeps working.
- **The aspect ratio setting (1:1, 4:5, 9:16) crops everything to the same part of the sensor**: a `ViewPort` on the `UseCaseGroup` crops photos and videos, and the frame listener crops the stream to the Preview's `cropRect`. So the stream *is* the shot, and the camera screen and both remotes show all of it (fit, not fill; `ui/FittedVideo.kt`, `object-fit: contain` on the web). The ViewPort is portrait and fixed to the sensor, so a shot taken sideways comes out turned (9:16 held sideways is 16:9). Changing the ratio re-binds the camera, so a change made mid-recording waits for it to end.
- **H.264 is put first in the offer** (`RtcSession.preferHardwareFriendlyCodecs`) so the hardware encoder is used.
- **The stream stays portrait**, as the portrait-locked RN app's did. Only captures follow the device's orientation (`OrientationEventListener` → `targetRotation`); a recording keeps the rotation it started with.
- **Re-binding resets zoom to 1x**, and a new lifecycle owner binds after the old one already unbound. So `CameraStreamer` re-applies the last *requested* zoom rather than reading it back.
- **Lens buttons come from the physical cameras' focal lengths** (`physicalZoomRatios`, `camera/Lenses.kt`), not a guess from max zoom. Pixels list each lens twice, the full sensor and a half-size "physical camera" that is its 2x crop mode; grouping by focal length and keeping the largest sensor leaves one per lens. Telephotos from 3x up are labelled by the nearest whole number (the Pixel's 4.51x is "5"). A digital 2x is offered unless a lens covers it.
- **Pinch to zoom** (`ui/PinchZoom.kt`) tracks the zoom locally during the gesture and sends each step with `CameraStreamer.requestZoom`, which doesn't wait: each CameraX request cancels the one before. It works while recording. The remote hears the zoom at most every 100ms during a pinch and once at the end. Between lens stops the lens in use (the highest at or below the zoom) shows the zoom as its label ("1.4" on the 1x button); its `zoom` stays the stop's, so tapping it goes back.

### Session lifetime

- **`CameraSessionViewModel` owns the camera, the track, the Firestore session and the peer connection**, so activity recreation (dark mode, font size) doesn't drop the remote.
- **`CameraSessionService` is a foreground service (type camera, plus microphone once granted) and the camera binds to its lifecycle, not the screen's.** The session keeps streaming with the screen off; backing out of the app clears the ViewModel and stops the service. This removed most of the RN app's reconnection machinery, which existed because Android killed the camera on screen-off.
- **The camera is held only while Second Shooter is the app in front** (`session/CameraHold.kt`). The app stopping (`ProcessLifecycleOwner`, so config changes and the Settings screen don't count) with the screen still on means another app: the camera is unbound and the service stopped, so the "camera in use" indicator goes. With the screen off (`PowerManager.isInteractive` false) it's still the app in front, and the camera stays. A recording keeps the camera behind another app until it ends. The ViewModel, Firestore session, peer connection and track stay; coming back starts the service and re-binds at the requested zoom. Meanwhile the remote's picture freezes, and once Android freezes the process (about 10s without the service) the connection drops; the camera's ICE restart brings it back on return, without re-pairing.
- **The service is not sticky and checks the camera permission in `onCreate`.** When the camera permission was revoked mid-session, a sticky service was restarted by Android and crashed: starting a camera-type foreground service without the permission throws.
- A low-latency Wi-Fi lock is held while the service runs.

### Reconnection

- **The camera owns recovery**, because it's the offerer. A `DISCONNECTED` or `FAILED` connection is renegotiated with an ICE restart (`restartIce()` + a new offer) after `RECONNECT_GRACE_MS` (3s), every `RECONNECT_RETRY_MS` (5s), up to `RECONNECT_MAX_ATTEMPTS` (12). SCTP survives an ICE restart, so the data channel and media carry over and nobody re-pairs.
- **Because the data channel is reused, its open event fires once per connection.** The remote therefore sends `GET_STATE` on every transition to connected.
- **A remote joining a session that's already been answered asks for a fresh offer.** The camera makes one offer per connection, so a reloaded tab or a second device would answer a stale offer and hang on "Connecting". The remote (`claimSession()` in the web remote, `RemoteSignaling.claim()` in the app) sets the status back to `waiting`; the camera starts a new peer connection on the same session. The previous remote sees an offer with a different DTLS fingerprint and shows "Another remote has taken over this session". ICE-restart offers keep the fingerprint, so they're applied in place.
- The remote covers a stale image with "Reconnecting to camera..." after 8s of not being connected.

### Save Folder (`media/CaptureStore.kt`, `media/SaveFolder.kt`)

Captures go to the folder the user picked (a Storage Access Framework tree, the `saveFolderUri` setting) or to the camera roll (`Pictures/SecondShooter`, `Movies/SecondShooter`). **The camera roll is the fallback, not a choice**: it's used when no folder is set and when a folder write fails.

- **Photos are captured to a cache file, then copied** through a ContentResolver stream into the folder, so a folder that fails mid-write still leaves the shot in the camera roll. Videos record straight to the folder (`FileDescriptorOutputOptions`, opened `"rw"` because the muxer seeks); a folder that can't be opened falls back before recording starts. Nothing goes through base64.
- **Never list a save folder.** `DocumentFile.listFiles()` / `readDirectoryAsync` queries every entry: measured at over a second on ~2000 files, and the RN app's Settings froze on it. The shutter thumbnail is the last photo saved (`lastPhotoUri`, stored with the folder it belongs to); a broken folder is noticed when a save fails (`brokenSaveFolder`) or when `contentResolver.persistedUriPermissions` no longer holds our write grant. `getInfoAsync`-style probes are no alternative: on a tree URI they report a good folder as missing.
- **The picker is opened with no initial URI.** Passing the current folder made DocumentsUI enumerate it before drawing: over five seconds of blank screen with ~2700 photos (Android 17).
- Two picker behaviours that look like bugs and aren't: `ACTION_OPEN_DOCUMENT_TREE` lists only subfolders, so a folder of photos looks empty; and DocumentsUI takes seconds on a big directory, showing the previous one meanwhile.
- File names are `SecondShooter_IMG_yyyyMMdd_HHmmss_SSS.jpg` / `_VID_…mp4`, as the RN app made them.

### Gallery App (`media/GalleryApps.kt`)

The thumbnail opens the app in the `galleryApp` setting (`system-default` or a package name).

- **The `<queries>` block in `AndroidManifest.xml` must stay in step with `GalleryApps.queryIntents()`.** Android 11+ hides undeclared packages, and an undeclared query returns an empty list rather than failing. Visibility is per package, so an app matched there is also visible to `getLaunchIntentForPackage`, which filters out editors and share targets without `QUERY_ALL_PACKAGES`.
- Without a package the intent goes out implicitly, so the user's default wins. With one, the component is pinned, since OEM galleries are inconsistent about `CATEGORY_DEFAULT`. An uninstalled choice falls back to the system default.

### Remote mode
- **QR scanner** (`ui/QrScanner.kt`): CameraX frames' Y plane into ZXing (no ML Kit download). The first code holding a session ID wins.
- **Session links**: `https://apps.binnyva.com/second-shooter/s/{id}` (verified App Link) and `secondshooter://s/{id}`, cold or while running (`onNewIntent` → `handleDeepLink`).
- **Photo previews** (`PHOTO_DATA`) are kept as files, last 20, oldest first, in a pager viewer.
- **Frame-based preview (`FRAME_DATA`) isn't shown**: only the old React Native camera sends it. The remote says so.

### Settings and permissions
- Settings live in DataStore (`settings/`) with the RN app's keys and defaults, minus `previewMode` and `previewQuality`. Every setting is read live; none needs a restart.
- The camera permission is asked for once unprompted; afterwards the camera screen explains and offers the prompt, or Android's settings once the prompt is blocked (`ui/Permissions.kt`). The microphone is asked for on the first recording; refusing records without sound.
- Volume keys reach the camera and remote screens through `MainActivity.volumeKeyListener`.

### Code map (`android/app/src/main/java/com/secondshooter/app/`)
- `camera/` CameraX → WebRTC (`CameraStreamer`), lens buttons (`Lenses`)
- `rtc/` peer connections (`RtcSession` camera side, `RemoteRtcSession` remote side), TURN (`IceServers`), stats, `WebRtcEngine`
- `signaling/` Firestore (`Signaling` camera side, `RemoteSignaling` remote side), `SessionIds`, `FirebaseSetup`
- `protocol/` data-channel messages (kotlinx.serialization)
- `session/` ViewModels, the foreground service, photo history
- `media/` saving, save folder, gallery apps
- `settings/` DataStore settings
- `ui/` Compose screens; `CameraControls` is shared by the camera and remote screens, laid out as the RN app's

### Shared Code (`shared/`)
Used by the web remote, and the source of truth the app's copies are checked against:
- `shared/protocol.ts` - data-channel types. `COMMAND_TYPES` / `RESPONSE_TYPES` list every type and fail to compile if one is missing.
- `shared/protocol-fixtures.json` - an example of every message. `shared/__tests__/protocolFixtures.test.ts` (Jest) fails if it doesn't cover every type; `ProtocolFixturesTest.kt` (JUnit) decodes and re-encodes every example. **A protocol change goes into `protocol.ts`, the fixtures and `Protocol.kt` together.**
- `shared/signaling.ts`, `shared/session-link.ts`, `shared/ice.ts` - signaling types, session links, STUN list and the `getIceServers` contract. `Signaling.kt`, `SessionIds.kt` and `IceServers.kt` are hand-written copies.

### Tech Stack
- **App**: Kotlin, Jetpack Compose, Navigation Compose, ViewModel, DataStore
- **Camera**: CameraX (Preview + ImageCapture + VideoCapture; camera2 interop for lens info)
- **P2P/Streaming**: `io.getstream:stream-webrtc-android`
- **QR**: ZXing (drawing and scanning)
- **Signaling**: Firebase Firestore, anonymous auth (Firebase Android SDK)
- **NAT traversal**: STUN plus Cloudflare Realtime TURN, credentials from the `getIceServers` Cloud Function
- **Web remote**: Vite + React (`web-remote/`)

## Project Structure

```
./
├── android/                      # The app (Gradle project)
│   ├── app/src/main/java/com/secondshooter/app/   # see Code map
│   ├── app/src/test/             # JUnit tests
│   ├── app/debug.keystore        # signing key (see Signing)
│   ├── README.md                 # the app's internals
│   └── PORTING_PLAN.md           # how the React Native app was replaced
├── shared/                       # protocol, signaling and link code shared with the web remote
├── web-remote/                   # browser remote (Vite + React)
├── functions/                    # getIceServers: mints Cloudflare TURN credentials
├── firestore.rules
├── .env.example                  # Firebase config template (read by android/ and web-remote/)
└── package.json                  # Jest for shared/, web-remote scripts
```

## Signing and releases

- **The app is `com.secondshooter.app`, signed with `android/app/debug.keystore`** — the React Native template's public debug keystore, which the RN app's release builds also used. Keeping the key lets the app install over the RN app as an update, and `https://apps.binnyva.com/.well-known/assetlinks.json` already lists its fingerprint (`FA:C6:17:…:3B:9C`), which is what verifies the session links. The key is public, so it's no protection: moving to a private upload key means users reinstall once and assetlinks.json gets the new fingerprint.
- Bump `versionCode` in `android/app/build.gradle.kts` for every build that should install over a previous one (the RN app was 1).
- Release builds are minified with R8. WebRTC is kept whole for JNI (`proguard-rules.pro`); check a release build pairs and streams before handing it out (`-PappIdSuffix=.preview` installs it beside the real one).

## Firebase Setup

Before running the app, you need to:

1. Create a Firebase project at console.firebase.google.com
2. Enable Firestore Database
3. Enable **Anonymous** authentication (Authentication → Sign-in method → Anonymous). Clients sign in anonymously before touching Firestore (`FirebaseSetup.ensureSignedIn()` and `web-remote/src/lib/firebase.ts`); without this provider, session create/join fails.
4. Copy `.env.example` to `.env` and fill in the `EXPO_PUBLIC_FIREBASE_*` variables. The names are left over from Expo; the Android build (`android/app/build.gradle.kts`, into `BuildConfig`) and the web remote (Vite's `envPrefix`) both read them. The app is configured in code from these values, so there's no `google-services.json`, and it currently uses the web app's ID.
5. Deploy the Firestore security rules from `firestore.rules` (paste into Firestore Database → Rules, or `firebase deploy --only firestore:rules`)
6. Create Firestore **TTL policies** on the `expireAt` field for the collection groups `sessions`, `offerCandidates`, and `answerCandidates`. Clients stamp `expireAt` (1 hour out) on session and candidate docs; TTL garbage-collects abandoned sessions and orphaned candidate docs. TTL deletion is lazy (typically within 24h of expiry), which is fine, since the rules already prevent stale sessions from being discovered.
7. Deploy the `getIceServers` function (`firebase deploy --only functions`) after setting the Cloudflare API token: `firebase functions:secrets:set CLOUDFLARE_TURN_API_TOKEN`. `CLOUDFLARE_TURN_TOKEN_ID` goes in `functions/.env` (copy `functions/.env.example`); both files stay out of git.

### TURN Relay

STUN alone can't connect peers behind symmetric NAT or most carrier CGNAT, so both clients relay through Cloudflare Realtime TURN when no direct path exists. Cloudflare issues only short-lived credentials via its API, so `functions/src/index.ts` mints them:

- `getIceServers` is an authenticated v2 callable in `us-central1`. Anonymous auth is enough, which keeps the relay quota tied to app users.
- Credentials get a 2h TTL and are cached in-instance until 20 minutes before expiry. Credential values are never logged.
- Clients (`rtc/IceServers.kt`, `web-remote/src/lib/webrtc.ts`) fetch for every new peer connection and fall back to STUN only if the call fails or times out (8s).

`invoker: 'public'` on the callable is load-bearing: without the `allUsers` → `roles/run.invoker` binding, Cloud Run rejects every client before the function's own auth check runs (surfacing as `functions/permission-denied` or `functions/unauthenticated`, which looks like an auth bug). The Firebase CLI only applies that binding when it **creates** the function. If the binding is ever missing, `firebase functions:delete getIceServers --region us-central1` then deploy again.

To verify TURN works, temporarily set `iceTransportPolicy` to relay on both ends; pairing then proves the relay is in use.

A network that blocks UDP entirely (seen on one Mac connection) leaves only TURN over TCP: Chrome manages that, Firefox there failed with error 701 on every server. That's the network, not the app.

### Firestore Security Rules

The production rules live in `firestore.rules` (the deployed copy should always match it). They enforce:

- **Auth required**: every operation requires `request.auth != null` (anonymous auth).
- **No collection listing**: sessions can only be fetched by exact ID, so joining requires knowing the 6-character ID. The candidate subcollections allow listing, but only within a session whose ID you know.
- **Document shape and size**: session docs are limited to `createdAt`/`expireAt`/`status`/`offer`/`answer` with size-capped SDP; candidate docs to `candidate`/`sdpMLineIndex`/`sdpMid`/`expireAt`. `status` is one of `waiting`, `offer_sent`, `connected`; a remote setting it back to `waiting` is how it asks for a fresh offer.
- **Bounded expiry**: `expireAt` is required and at most 2 hours out.

## Data Channel Protocol

Defined in `shared/protocol.ts`; JSON over the `camera-commands` data channel:

```typescript
type Command =
  | { type: 'TAKE_PHOTO' }
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'SET_ZOOM'; level: number }
  | { type: 'SET_FLASH'; mode: 'off' | 'on' | 'auto' }
  | { type: 'SWITCH_CAMERA' }
  | { type: 'GET_STATE' }

type Response =
  | { type: 'PHOTO_TAKEN'; success: boolean; error?: string }
  | { type: 'RECORDING_STARTED' }
  | { type: 'RECORDING_STOPPED'; success: boolean; error?: string }
  | { type: 'STATE_UPDATE'; state: CameraState; lenses?: LensInfo[];
      videoNeedsRotation?: boolean; previewZoomLimited?: boolean;
      streamMode?: StreamMode }
  | { type: 'ERROR'; message: string }
  | { type: 'CAPTURE_STATE'; capturing: boolean }                              // RN camera only
  | { type: 'FRAME_DATA'; frameId: number; data: string; timestamp: number }   // RN camera only
  | { type: 'PHOTO_DATA'; data: string; timestamp: number }                    // photo preview on remote
```

The Kotlin camera always sends `streamMode: 'webrtc'` and never `FRAME_DATA` or `CAPTURE_STATE`. The web remote still handles them; that path can go once no React Native cameras remain. `PHOTO_DATA` carries a base64 JPEG (never log `data`).

The web remote takes its capture mode from `STATE_UPDATE`, so the camera reports `captureMode: 'video'` once recording starts; a photo can't be requested from the web remote mid-recording (the camera screen has a snapshot button for that).

## Testing Requirements

- **Unit tests**: `cd android && ./gradlew :app:testDebugUnitTest` (JUnit, no device) and `npm test` (shared protocol fixtures).
- **Manual testing needs a real camera phone.** An emulator works as the *other* end (its virtual camera streams, slowly, and its video encoder may fail to record), which is how remote mode was tested with one phone.
- Test on the same Wi-Fi first, then across networks (mobile data on one side).
- The overlay from Settings → "Show connection stats" shows fps, resolution, bitrate, encoder and ICE path; the same line is always logged: `adb logcat -s SSStats SSSession SSCamera SSRtc SSService SSRemote SSStore`.

## Logging Guidelines

- **Never log base64 content or data URIs.** Photo previews are large base64 strings.
- Log sizes and metadata instead, e.g. `Log.i(TAG, "Sending PHOTO_DATA, size=${thumb.length}")`.
- Never log TURN credentials.
