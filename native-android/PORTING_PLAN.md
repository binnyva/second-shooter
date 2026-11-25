# Porting Second Shooter to Kotlin

The plan for replacing the React Native Android app with the native Kotlin app
in `native-android/`. Work through the phases in order. Each one ends with a
"Done when" list, and a phase isn't finished until every item on it has been
checked on the Pixel 9 Pro.

## Where we start

The prototype (`native-android/`, branch `native-poc`) settled the main
question. CameraX owns the camera. Its Preview frames go straight into WebRTC,
so the stream follows zoom and lens switches, and photos are taken without
handing the camera over. Measured on the Pixel 9 Pro:

- 1440x1080 at 30fps on the hardware H.264 encoder (`c2.exynos.h264.encoder`)
- 2x → 5x → 2x lens switches with no frame-rate drop
- photos saved in 210–400ms while streaming, with no drop either

It pairs with the existing web remote through the same Firestore layout and
TURN function. It handles `GET_STATE`, `SET_ZOOM` and `TAKE_PHOTO`.

## What stays, what goes

**Stays as it is:** `web-remote/`, `functions/`, `firestore.rules`,
`shared/` (the web remote still uses it), and the Firebase project.

**Is rewritten in Kotlin:** everything in `app/`, `src/` and `modules/`,
which is about 8,300 lines of TypeScript.

**Is dropped, not ported**, because CameraX owning the camera makes it
unnecessary:

- frame-based preview (`FRAME_DATA`, `takeSnapshot()` every 125ms)
- the `previewMode` and `previewQuality` settings
- the camera handoff wait (`CAMERA_HANDOFF_MS`), the contention retries, and
  the camera lock in the capture queue
- the reconnect's forced fallback to frame-based preview
- the iOS build

## Ground rules for the whole port

- **Keep the React Native app working until cutover (Phase 8).** The Kotlin
  app installs as `com.secondshooter.nativepoc` next to it, so both can be on
  the phone at once.
- **Merge `native-poc` into `main` now.** `native-android/` touches nothing
  else, so later phases can be ordinary feature branches off `main`.
- **The protocol has one source of truth.** `shared/protocol.ts` stays
  canonical. Phase 1 adds JSON fixtures that both Jest and JUnit check, so
  the Kotlin copy can't drift silently.
- **Port behaviour, not structure.** Many RN workarounds exist only because of
  Expo or react-native-webrtc. AGENTS.md explains why each one exists. Read
  the reason before porting the code.
- **Update AGENTS.md as you go.** It should describe the Kotlin app by the
  end of each phase, not only after cutover.

## Phase 1: Turn the prototype into a foundation

The prototype is one controller class. Give it a structure that the rest of
the port can grow into.

- Package layout: `camera/`, `rtc/`, `signaling/`, `protocol/`, `settings/`,
  `media/`, `ui/`.
- One activity with Navigation Compose. Routes: camera (home), settings,
  remote.
- A `ViewModel` holds the session state in place of `PairingController`, so
  a configuration change can't tear down the camera or the connection.
- Settings in Jetpack DataStore, with the same keys and defaults as
  `src/types/settings.ts` minus the dropped ones.
- Protocol fixtures: `shared/protocol-fixtures.json`, one example of every
  command and response. A Jest test and a JUnit test both parse all of them.
- Port the pure-logic tests to JUnit: session ID, lens detection, protocol.
- Keep the stats overlay, but behind a debug toggle.

**Done when**
- [ ] The app behaves exactly like the prototype, at the same measured fps.
- [ ] `./gradlew test` passes, and so does the shared fixture test in `npm test`.
- [ ] Rotating the phone or toggling dark mode doesn't drop the connection.

## Phase 2: Video recording (the remaining hardware risk)

This goes first among the features because it's the one thing the prototype
didn't prove. Recording means binding **Preview + ImageCapture +
VideoCapture** together. Not every phone supports that three-way combination
at full resolution. CameraX's stream sharing usually covers it, but that has
to be measured.

- `START_RECORDING` / `STOP_RECORDING` with `RECORDING_STARTED` /
  `RECORDING_STOPPED`, using CameraX `Recorder` with audio.
- Request the microphone permission only when the first recording starts.
- Photo and video mode in the UI, matching `captureMode` in `STATE_UPDATE`.

**Done when**
- [ ] A 5-minute recording on the Pixel 9 Pro keeps the remote stream at
  30fps from start to end.
- [ ] Taking a photo during recording either works or is refused with a
  clear `ERROR`. It must not crash or stall the stream.
- [ ] Zoom changes during recording show up in both the file and the stream.

**If this fails**, record at a lower resolution, or pause the stream while
recording. Decide this before Phase 3.

## Phase 3: Camera parity

Everything the camera device does today, apart from storage.

- **Front camera** (`SWITCH_CAMERA`): rebind to `DEFAULT_FRONT_CAMERA`. The
  texture transform needs a mirror for the front sensor (`preScale(-1, 1)`,
  as in WebRTC's `Camera2Session`).
- **Flash** (`SET_FLASH`): `ImageCapture.flashMode`, persisted like today.
- **Real lens list:** port `src/utils/lensDetection.ts`. Use the physical
  cameras' focal lengths from `Camera2CameraInfo` so other phones get the
  right buttons, instead of the prototype's hard-coded 0.5/1/2/5.
- **Photo orientation:** the app is portrait-locked, but landscape shots must
  still come out landscape. Feed `ImageCapture.targetRotation` from an
  `OrientationEventListener`.
- **Timer** (2/5/10s) with the countdown overlay.
- **Grid overlay** (3x3, 4x4).
- **Aspect ratio** (1:1, 4:5, 9:16). Today this only masks the viewfinder
  (`AspectRatioContainer`) and the saved photo isn't cropped. Port it as it
  is, or decide here to crop the photo to match.
- **Volume shutter:** handle `KEYCODE_VOLUME_UP/DOWN` in the activity. This
  replaces react-native-volume-manager.
- **Keep screen awake** setting.
- **Capture queue:** port `src/utils/captureQueue.ts` without the camera lock.
  It still serialises shutter presses from the remote, the screen and the
  volume keys.
- **Remote photo preview:** `PHOTO_DATA` thumbnails, as in the prototype.

**Done when**
- [ ] Every command in `shared/protocol.ts` works from the web remote.
- [ ] A 10-shot burst from the volume keys saves 10 photos with no errors.
- [ ] Front camera photos and stream are mirrored the same way as today's app.

## Phase 4: Storage and gallery

- **Save folder:** pick the folder with `ACTION_OPEN_DOCUMENT_TREE` and keep
  the grant with `takePersistableUriPermission`. Write through
  `DocumentFile.createFile` + `ContentResolver.openOutputStream`, which
  streams the bytes directly. This removes the base64 copy. Also remove the
  single-pending-request trap, which only existed in expo-file-system.
- **Camera roll fallback:** MediaStore `Pictures/SecondShooter` (already in
  the prototype) when no folder is set or a folder write fails.
- **Broken folder warning:** check `contentResolver.persistedUriPermissions`
  directly. AGENTS.md says this is the right check. Keep the failed-save
  marker as a second signal.
- **Last photo thumbnail:** remember the last saved URI, as today. **Never
  list the folder.** The "Save Folder" section of AGENTS.md has the
  measurements.
- **Gallery app:** move the Kotlin in `modules/gallery-apps/android/` into
  the app, including its `<queries>` block, and drop the Expo module wrapper.
- Open the folder picker without `EXTRA_INITIAL_URI`. The reason is in
  AGENTS.md.

**Done when**
- [ ] Photos and videos land in a chosen folder holding 2,000+ files with no
  visible delay.
- [ ] Revoking the folder in system settings makes the next save fall back to
  the camera roll, and Settings shows the warning.
- [ ] The thumbnail opens the chosen gallery app, and falls back to the
  default when that app is uninstalled.

## Phase 5: Connection robustness

The prototype has no recovery at all. A dropped remote means tapping "New
session".

- **Foreground service** (`foregroundServiceType="camera"`) while a session
  is live, so turning the screen off doesn't kill the camera or the
  connection. Most of today's reconnection logic exists because Android
  stopped the camera in the background. Build this first and see how much of
  the rest is still needed.
- **ICE restart** on `FAILED`/`DISCONNECTED`, paced like today
  (`RECONNECT_GRACE_MS`, `RECONNECT_RETRY_MS`, `RECONNECT_MAX_ATTEMPTS`). The
  camera is the offerer and owns recovery.
- **Remote rejoin:** today a second answer is rejected with "Called in wrong
  state: stable" (seen in testing). A new answer while stable should trigger a
  fresh offer on the same session, so a reloaded browser tab can reconnect.
- Re-send `STATE_UPDATE` after every reconnect.
- **Why the relay is used on the same Wi-Fi:** in testing, the phone and a
  browser on the same network connected through TURN. Find out why (it may be
  the web remote dropping `.local` candidates) so local pairs connect
  directly.

**Done when**
- [ ] Screen off for 5 minutes on the camera phone: the stream is back within
  5 seconds of the screen turning on, with no re-pairing.
- [ ] Reloading the web remote's tab reconnects to the same session.
- [ ] Switching the remote from Wi-Fi to mobile data recovers without
  re-pairing.
- [ ] Two devices on the same Wi-Fi connect with a `host` or `srflx` path,
  not `relay`.

## Phase 6: Settings screen

- Port `app/settings.tsx` to Compose with the remaining settings: timer,
  grid, aspect ratio, flash, save folder, gallery app, keep awake, volume shutter.
- Handle denied permissions properly: explain what's needed and link to the
  app's system settings when the permission is permanently denied.

**Done when**
- [ ] Every setting survives an app restart and takes effect without one.

## Phase 7: The phone as a remote

Today a second phone with the app can be the remote (`src/screens/RemoteScreen.tsx`).
The web remote covers this role in the meantime, so this phase can wait if
needed.

- **QR scanner:** CameraX `ImageAnalysis` with ML Kit barcode scanning.
- **Live preview:** `SurfaceViewRenderer` on the received track. A native
  camera never sends `FRAME_DATA`, so there's no frame-based path to port.
- **Controls:** shutter, zoom/lens buttons, flash, camera switch, photo and
  video mode.
- **Photo history:** port `useRemotePhotoHistory` (last 20 shots, cached as
  files) and `PhotoViewer`.
- **Deep links:** App Links for `https://apps.binnyva.com/second-shooter/s/*`
  and the `secondshooter://` scheme, as in `app.json`. Joining from a link
  skips the scanner.

**Done when**
- [ ] Two phones with the Kotlin app pair by QR code and by link, and the
  remote can do everything the web remote can.

## Phase 8: Cutover

- **Package name:** switch the `applicationId` to `com.secondshooter.app`.
- **Signing:** sign with the same key as the current builds. Today that's the
  debug keystore in `android/app/`, so copy it to `native-android/` before
  `android/` is deleted. With the same key the Kotlin app installs over the RN
  app. With a different key the RN app has to be uninstalled first. Settings
  don't carry over either way (AsyncStorage vs DataStore), so re-pick the
  save folder after installing.
- **Release build:** turn on R8, add keep rules for `org.webrtc` and Firebase,
  and check that the release APK pairs and streams.
- **Soak test:** a real shoot. At least an hour of streaming, 200+ photos, a
  few recordings, a screen-off and a network switch. Watch battery and heat.
- **Delete the React Native app:** `app/`, `src/`, `modules/`, `android/`,
  `ios/`, `app.json`, `babel.config.js`, `jest.config.js`, and the Expo and
  React Native dependencies in `package.json`. Keep what `web-remote/` and
  `functions/` need, including `shared/` and its tests.
- Consider moving `native-android/` to the repo root as `android/`, now that
  the old generated folder is gone.
- Rewrite AGENTS.md for the Kotlin app.
- Follow-up, optional: remove the frame-based preview path from the web
  remote.

**Done when**
- [ ] The Kotlin app is the only Android app, installed as
  `com.secondshooter.app`.
- [ ] The soak test passed.
- [ ] The repo has no React Native code left.

## Rough effort

These are estimates, not measurements, for part-time work.

| Phase | Estimate |
|---|---|
| 1. Foundation | 2–3 days |
| 2. Video recording | 2–3 days |
| 3. Camera parity | 4–5 days |
| 4. Storage and gallery | 2–3 days |
| 5. Connection robustness | 3–4 days |
| 6. Settings screen | 1–2 days |
| 7. Phone as remote | 3–4 days |
| 8. Cutover | 2 days |
| **Total** | **about 4–5 weeks** |

## Risks to watch

- **Preview + ImageCapture + VideoCapture on one camera** (Phase 2). This is
  the biggest unknown left.
- **Other phones.** Everything was measured on a Pixel 9 Pro. Before cutover,
  test on at least one non-Pixel phone, ideally a Samsung, if anyone will use
  one. H.264 hardware encoding and the camera combinations both differ by
  vendor.
- **Heat and battery.** 30fps hardware encoding for an hour is new. The RN
  app's frame-based preview never ran the encoder.
- **Networks that block UDP.** Firefox on such a network couldn't reach any
  STUN or TURN server (error 701). Chrome got through over TCP relay. This
  affects the web remote whichever app is on the phone, so it's not a port
  task, but it's worth remembering.
