# AGENTS.md

## Project Overview

Second Shooter is an Expo React Native mobile app that enables one device to remotely control another device's camera over a peer-to-peer WebRTC connection. The main phone captures photos/videos while a secondary phone provides a live preview and remote shutter control. If the second device doesn't have the app, a browser-based remote (in `web-remote/`) is available at `https://apps.binnyva.com/second-shooter/s/{sessionId}`; the same URLs act as deep links that open the app when installed.

## Build Commands

### Initial Setup (one-time per device)

```bash
# Install dependencies
npm install

# Build and install the development client on your Android device
npx expo run:android
```

This builds the native app with all required modules (react-native-vision-camera, react-native-webrtc) and installs it on your device.

### Ongoing Development

```bash
# Start the development server
npx expo start --dev-client
```

Your device connects to this server and hot-reloads JavaScript changes instantly - no new APK needed.

**When to rebuild**: Only run `npx expo run:android` again if you add/remove native dependencies, add or change native code in `modules/`, change `app.json` config, or modify the `android/` directory.

### Release Build

```bash
npx expo run:android --variant release
```

### Tests

```bash
npm test              # Run Jest unit tests (src/__tests__/)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### Web Remote

```bash
npm run web-remote:dev    # Start the browser remote locally (Vite dev server)
npm run web-remote:build  # Build the browser remote
```

## Architecture

### Device Roles
- **Camera Device**: Displays QR code for pairing, hosts the camera, stores captured media (Home screen - index.tsx)
- **Remote Device**: Scans QR code, receives live preview stream, sends control commands (Remote screen - remote.tsx)

### Connection Flow
1. Camera device creates Firebase signaling session and displays QR code
2. Remote device scans QR code to obtain session ID
3. Remote device joins signaling session
4. WebRTC offer/answer exchange via Firebase Firestore
5. ICE candidates exchanged for NAT traversal
6. Direct P2P WebRTC connection established
7. Data channel created for camera commands
8. Media stream sends live camera preview to remote

### Hybrid Preview Streaming
The remote preview uses one of two stream modes (see `src/utils/streamMode.ts` and `src/components/HybridPreview.tsx`):
- **`webrtc`**: Native WebRTC video stream — front camera, and back camera at exactly 1x zoom
- **`frame-based`**: JPEG frames sent over the data channel — back camera at any other zoom level, because WebRTC's `getUserMedia` can't capture vision-camera's zoomed preview

WebRTC and vision-camera compete for the camera; the WebRTC lock is temporarily released when taking remote photos, and a "preview paused" overlay is shown when WebRTC holds the camera.

**The `previewMode` setting gates all of this, and defaults to `'frames'`.** Every switch between the two modes is a physical close/open of the camera module — the AF actuator resets and OIS drops and re-centres, which is audible and felt through the camera bump, and a photo taken in `webrtc` mode costs two of them. `previewMode: 'frames'` pins the preview to frame-based so the lens is never handed over: vision-camera holds it for the whole session, at the cost of a lower-quality, more bandwidth-hungry preview. `'auto'` is the zoom-dependent behaviour described above.

There is deliberately no "always WebRTC" — the back camera above 1x can't be streamed by `getUserMedia` at all, so `'auto'` is as close to it as the hardware allows.

`'frames'` still calls `startLocalStream()` once at pairing (one open/close), because the video track must be in the SDP before the offer for a later switch to `'auto'` to be a plain resume instead of a renegotiation. The track then sits paused for the session.

**`'auto'` is on probation.** It is the reason `CAMERA_HANDOFF_MS`, the contention retry budget, and the reconnect's forced fallback to frame-based all exist. If frame-based preview proves good enough on its own, that branch and everything propping it up should be deleted.

**The handoff between them is a race.** Neither releases the camera synchronously and neither reports when it's done, so each switch just waits `CAMERA_HANDOFF_MS` (`app/index.tsx`). Measured on a Pixel with `adb logcat -s Camera2CameraImpl:D org.webrtc.Logging:I`, the old 200ms lost in *both* directions: CameraX logged `onClosed()` 58ms after WebRTC had begun opening, and WebRTC's device closed 106ms after CameraX started force-opening. It only appeared to work because CameraX force-opens and retries. When the HAL declines the resulting stream combination you get `CameraState.ERROR_STREAM_CONFIG`, surfaced as `session/invalid-output-configuration`.

So the timeout is a mitigation, not a fix — the `<Camera>`'s `onError` is what makes it safe, remounting on the contention codes (`session/invalid-output-configuration`, `session/camera-not-ready`, `session/hardware-cost-too-high`, `device/camera-already-in-use`) up to `CAMERA_MAX_RETRIES`. Keep an `onError` on any `<Camera>` that shares the device with WebRTC: without one the failure escapes as an unhandled error and the preview stays dead with no way back.

### Reconnection

Turning a device's screen off backgrounds the app, and neither half of a pairing survives that on its own: Android ends every `getUserMedia` track and tears down vision-camera's session, and once ICE consent checks go unanswered both peer connections drop. Recovery (`src/hooks/useAppState.ts` plus the reconnect effects in `app/index.tsx`):

- **A resume only remounts the camera when the camera screen is the focused one.** Leaving the app for the folder picker or the gallery resumes it too, and rebuilding a CameraX session behind whatever screen the user is actually looking at is wasted work landing exactly where they're waiting for a tap to respond. The camera is inactive while unfocused, and the navigation-focus effect remounts it on the way back.
- **The camera device owns recovery**, because it is the offerer. It retries from `connectionState`, not from its own resume, so it also covers the case where only the remote's screen was off.
- **Renegotiation is an ICE restart** (`createOffer({ iceRestart: true })`), not a new connection. SCTP survives an ICE restart, so the data channel and the negotiated media sections carry over and neither side has to re-pair. Retries are paced by `RECONNECT_GRACE_MS` / `RECONNECT_RETRY_MS` / `RECONNECT_MAX_ATTEMPTS`.
- **A dropped connection falls back to `frame-based`** and stops the WebRTC track. Frame-based needs no lens, so the local preview works again and the reconnect has one less thing to get right; the stream-mode effect promotes it back to `webrtc` once connected.
- **Because the data channel is reused, `onDataChannelOpen` fires only once per pairing.** The remote therefore re-issues `GET_STATE` on every transition to connected — without it, a remote that dropped in `webrtc` mode comes back rendering an `RTCView` for a track the camera has since abandoned.
- **A resume can also find a dead track under a still-`connected` connection** (a short screen-off doesn't outlast ICE consent). The camera checks `hasLiveVideoTrack()` on every resume, independently of connection state.

### Save Folder

Captures go to the folder the user browsed to, addressed by the persisted SAF tree URI in the `saveFolderUri` setting (`src/utils/saveFolder.ts`). `MediaService.savePhoto()`/`saveVideo()` are the only readers of that setting — every shutter path goes through them, so nothing should call `MediaLibrary.createAssetAsync` directly.

**The camera roll is the fallback, not a choice.** There's exactly one option in Settings — the folder — and `expo-media-library` catches everything it can't cover: before the user has picked a folder, off Android, and when a folder write fails. Settings shows which of those is in effect rather than presenting the camera roll as something to select.

**Folders are Android-only.** They're built on the Storage Access Framework, which is the only way to write outside the sandbox under scoped storage; expo-file-system's SAF namespace throws `UnavailabilityError` off Android, and iOS has no equivalent grant that survives a restart (security-scoped bookmarks aren't persisted). `isSaveFolderSupported()` hides the row elsewhere.

Two consequences worth knowing:

- **The bytes go through base64.** expo-file-system has no native `file://` → `content://` copy (its `copyAsync` resolves the destination as a java `File`), so a folder save reads the capture as base64 and writes it back out. That holds ~4/3 of the file in memory, on the background save queue.
- **A grant can die without warning** — revoked in system settings, or the folder deleted. Saves that fail fall back to the camera roll rather than losing the shot, and record the folder they failed against (`MediaService.getBrokenSaveFolder()`); Settings warns from that. Re-picking a folder clears it.

A folder save produces no `MediaLibrary.Asset`, so `SavedMedia.uri` (not `asset.uri`) is what the shutter thumbnail follows.

**Never list a save folder to find the newest photo.** `SAF.readDirectoryAsync` is `DocumentFile.listFiles()`: it queries every entry and marshals one URI string per file across the bridge. Measured on a folder of ~2000 files it costs over a second, and the paths that wanted it — the thumbnail, and the folder's writability check — both key on `saveFolderUri`, so picking a folder ran two of them back to back and the Settings row visibly froze.

Instead `savePhoto()` writes the URI down (`@secondshooter_last_photo`, stored with the folder it belongs to) and `getLastPhotoUri()` reads it back. A folder we haven't saved to in this install shows no thumbnail until the next capture — a cold start and one empty button, against a freeze every time the folder is picked. Settings skips the writability check for a folder the picker just returned, since that grant is seconds old.

**The folder picker has one pending request, and losing its result wedges it for the process.** `requestDirectoryPermissionsAsync` stores the promise in a single slot on the native module and clears it only in `OnActivityResult`; if that result never arrives — a dev-client reload or an activity recreation while the picker is in front will do it — every later request is rejected with "You have an unfinished permission request" until the process restarts. There is no JS-side reset. `pickSaveFolder()` therefore returns a status rather than a nullable folder, because 'cancelled' and 'stuck' look identical on screen (no picker, nothing changed) and only one of them is the user's doing; Settings tells them to relaunch. It also refuses to issue a second request while one is open, which is the one way our own code could cause the same rejection.

**Nothing in the app lists a save folder any more**, and nothing should start. The writability probe that used to run on entry to Settings was the same `listFiles()` cost, aimed at the very provider the folder picker is about to need — it was replaced by the failed-save marker above. If a real permission check is ever needed, it has to be a native check against `contentResolver.persistedUriPermissions`; `getInfoAsync` is not an alternative, since on a tree URI it tries `openInputStream` and reports a perfectly good folder as missing.

**The picker is opened with no `EXTRA_INITIAL_URI`.** Passing the current folder made DocumentsUI resolve and enumerate it before drawing: measured on Android 17 with ~2700 photos in the target folder, over five seconds of blank screen after the tap, and the stale listing kept showing through the next directory browsed to. Reopening where the user left off is not worth that.

Two things about the picker that look like bugs and aren't: `ACTION_OPEN_DOCUMENT_TREE` lists only selectable items, i.e. **subfolders**, so a folder holding nothing but photos correctly appears empty; and DocumentsUI's own load of a large directory takes seconds, during which it shows the previous directory's contents.

### Gallery App

Tapping the shutter thumbnail calls `MediaService.openGallery()`, which opens the app named by the `galleryApp` setting — either the `'system-default'` sentinel or an Android package name. It's the only reader of that setting.

**This needs native code, which is why `modules/gallery-apps/` exists.** Neither half is reachable from JS: enumerating what's installed needs `PackageManager.queryIntentActivities`, and launching a *particular* app needs an explicit intent, which `Linking.openURL` can't express — the old implementation could only fire an implicit `content://media/…` VIEW intent and let the system decide, so the setting had nothing to act on and was rendered permanently disabled.

- **Android-only.** iOS has one Photos app and no way to see what else is installed, so `isGalleryAppChoiceSupported()` hides the row there. It's also false on Android when the native module is absent, which is what a *JS-only* reload of this feature looks like — adding a native module needs `npx expo run:android`, not just a Metro refresh.
- **The `<queries>` block in the module's `AndroidManifest.xml` must stay in step with `galleryQueryIntents()`.** Android 11+ hides packages you haven't declared an interest in, and an undeclared query returns an empty list rather than failing — a mismatch shows up as "no gallery apps installed", not as an error. Visibility is granted per package, so an app matched by those queries is also visible to `getLaunchIntentForPackage`, which is how the list filters out editors and share targets without needing a MAIN/LAUNCHER query (or `QUERY_ALL_PACKAGES`).
- **Launching resolves differently with and without a package.** With none, the intent goes out implicitly so the user's own default gallery wins. With one, the module pins the component itself, so any matching activity works — OEM galleries are inconsistent about declaring `CATEGORY_DEFAULT`.
- **A stored package can stop being installed**, and nothing tells the setting. `openGallery()` falls back to the system default and then to `Linking`; Settings shows the raw package name when it can't find a label for it.

`modules/` is autolinked by Expo without a config plugin (`nativeModulesDir` defaults to `./modules`), so `android/` — which is generated and gitignored — needs no edit.

### Key Services
- `src/services/WebRTCService.ts` - P2P connection management
- `src/services/CameraService.ts` - Camera operations wrapper using react-native-vision-camera
- `src/services/SignalingService.ts` - Firebase Firestore signaling handler
- `src/services/MediaService.ts` - Photo/video saves, routed by the `saveFolderUri` setting (see Save Folder); also opens the gallery app (see Gallery App)
- `src/services/SettingsService.ts` - Persistent app settings via AsyncStorage

### Custom Hooks
- `src/hooks/useCamera.ts` - Camera state and controls
- `src/hooks/usePeerConnection.ts` - WebRTC connection hook
- `src/hooks/useSignaling.ts` - Firebase signaling hook
- `src/hooks/useSettings.ts` - App settings hook
- `src/hooks/useVolumeShutter.ts` - Volume buttons as shutter trigger (react-native-volume-manager)
- `src/hooks/useAppState.ts` - Foreground/background tracking; drives reconnection after a screen-off

### Key Utilities
- `src/utils/lensDetection.ts` - Detects physical lenses (ultra-wide/wide/telephoto) for zoom buttons
- `src/utils/streamMode.ts` - Chooses WebRTC vs frame-based preview mode
- `src/utils/saveFolder.ts` - SAF folder picking, persistence check, and tree-URI display names
- `src/utils/galleryApps.ts` - Wraps the `gallery-apps` native module: support check, installed-app list, launch
- `src/utils/sessionId.ts` - Session ID generation

### Shared Code (`shared/`)
Shared between the mobile app and the web remote:
- `shared/protocol.ts` - Data channel command/response types (source of truth for the protocol)
- `shared/signaling.ts` - Signaling message types
- `shared/session-link.ts` - Session URL building/parsing (`/s/{sessionId}` links)
- `shared/ice.ts` - STUN server list, ICE tuning constants, and the `getIceServers` callable's name/region/response parsing

### Tech Stack
- **Framework**: Expo (with prebuild for native modules)
- **Navigation**: Expo Router
- **Camera**: react-native-vision-camera (frame processors disabled — frame-based preview uses `takeSnapshot()`, not a frame processor)
- **P2P/Streaming**: react-native-webrtc
- **QR**: expo-camera (scanner), react-native-qrcode-svg (generator)
- **Signaling**: Firebase Firestore
- **NAT traversal**: STUN servers (`shared/ice.ts`) plus Cloudflare Realtime TURN, with credentials minted per connection by the `getIceServers` Cloud Function
- **Settings storage**: @react-native-async-storage/async-storage
- **Volume shutter**: react-native-volume-manager
- **Web remote**: Vite + React (in `web-remote/`)

## Project Structure

```
./
├── app/                          # Expo Router screens
│   ├── _layout.tsx               # Root layout
│   ├── index.tsx                 # Home = Camera mode (default)
│   ├── remote.tsx                # Remote control screen
│   ├── settings.tsx              # Settings screen
│   ├── s/[sessionId].tsx         # Deep link handler for session URLs
│   └── ui-test.tsx               # UI test screen
├── src/
│   ├── components/               # UI components
│   │   ├── CameraView.tsx
│   │   ├── CameraControls.tsx
│   │   ├── HybridPreview.tsx     # WebRTC / frame-based preview switcher
│   │   ├── RemotePreview.tsx
│   │   ├── PhotoViewer.tsx       # Captured photo review on remote
│   │   ├── QRCodeDisplay.tsx
│   │   ├── QRCodeScanner.tsx
│   │   ├── GridOverlay.tsx
│   │   ├── TimerCountdown.tsx
│   │   └── AspectRatioContainer.tsx
│   ├── services/                 # Core services
│   │   ├── WebRTCService.ts
│   │   ├── SignalingService.ts
│   │   ├── CameraService.ts
│   │   ├── MediaService.ts
│   │   └── SettingsService.ts
│   ├── hooks/                    # React hooks
│   │   ├── useCamera.ts
│   │   ├── usePeerConnection.ts
│   │   ├── useSignaling.ts
│   │   ├── useSettings.ts
│   │   └── useVolumeShutter.ts
│   ├── types/                    # TypeScript definitions
│   │   ├── index.ts
│   │   └── settings.ts
│   ├── config/                   # Configuration
│   │   ├── firebase.ts           # Firebase initialization (env vars)
│   │   └── webrtc.ts             # ICE server config
│   ├── utils/                    # Utilities
│   │   ├── permissions.ts
│   │   ├── sessionId.ts
│   │   ├── lensDetection.ts
│   │   ├── saveFolder.ts
│   │   ├── galleryApps.ts
│   │   └── streamMode.ts
│   └── __tests__/                # Jest unit tests (with mocks)
├── modules/                      # Local Expo native modules (autolinked)
│   └── gallery-apps/             # Android: list & launch gallery apps
│       ├── expo-module.config.json
│       ├── src/GalleryApps.ts    # JS side (optional native module)
│       └── android/              # Kotlin module + <queries> manifest
├── shared/                       # Code shared with web remote
│   ├── protocol.ts               # Data channel protocol types
│   ├── signaling.ts              # Signaling message types
│   ├── session-link.ts           # Session URL helpers
│   └── ice.ts                    # STUN list + getIceServers callable contract
├── functions/                    # Firebase Cloud Functions
│   ├── src/index.ts              # getIceServers - mints Cloudflare TURN credentials
│   └── .env.example              # Cloudflare TURN key ID template (.env is untracked)
├── web-remote/                   # Browser-based remote (Vite + React)
│   └── src/lib/                  # firebase, signaling, webrtc clients
├── app.json                      # Expo configuration with permissions & deep links
├── .env.example                  # Firebase env var template
└── package.json
```

## Firebase Setup

Before running the app, you need to:

1. Create a Firebase project at console.firebase.google.com
2. Enable Firestore Database
3. Enable **Anonymous** authentication (Authentication → Sign-in method → Anonymous). Clients sign in anonymously before touching Firestore (`ensureSignedIn()` in `src/config/firebase.ts` and `web-remote/src/lib/firebase.ts`); without this provider enabled, session create/join fails.
4. Copy `.env.example` to `.env` and fill in the `EXPO_PUBLIC_FIREBASE_*` variables (read by `src/config/firebase.ts`)
5. Deploy the Firestore security rules from `firestore.rules` (paste into Firestore Database → Rules, or `firebase deploy --only firestore:rules`)
6. Create Firestore **TTL policies** on the `expireAt` field for the collection groups `sessions`, `offerCandidates`, and `answerCandidates` (Firestore Database → the TTL tab, or `gcloud firestore fields ttls update expireAt --collection-group=...`). Clients stamp `expireAt` (1 hour out) on session and candidate docs; TTL garbage-collects abandoned sessions and orphaned candidate docs. TTL deletion is lazy (typically within 24h of expiry) — that's fine, since the rules already prevent stale sessions from being discovered.

7. Deploy the `getIceServers` function (`firebase deploy --only functions`) after setting the Cloudflare API token: `firebase functions:secrets:set CLOUDFLARE_TURN_API_TOKEN`. `CLOUDFLARE_TURN_TOKEN_ID` goes in `functions/.env` (copy `functions/.env.example`); both files stay out of git.

The web remote uses the same Firebase public env vars.

### TURN Relay

STUN alone can't connect peers behind symmetric NAT or most carrier CGNAT, so both clients relay through Cloudflare Realtime TURN when no direct path exists. Cloudflare issues only short-lived credentials via its API — there is no static username/password — so `functions/src/index.ts` mints them:

- `getIceServers` is an authenticated v2 callable in `us-central1`. Anonymous auth is enough, which keeps the relay quota tied to app users rather than anyone who finds the endpoint.
- Credentials get a 2h TTL and are cached in-instance until 20 minutes before expiry, so a warm instance serves many pairings from one Cloudflare call. Credential values are never logged.
- Clients (`src/config/webrtc.ts`, `web-remote/src/lib/webrtc.ts`) fetch on every `createPeerConnection`/`createConnection` — both are async for this reason — and fall back to the STUN-only list if the call fails or times out (8s).

`invoker: 'public'` on the callable is load-bearing: without the `allUsers` → `roles/run.invoker` binding, Cloud Run rejects every client before the function's own auth check runs (the SDK surfaces this as `functions/permission-denied` or `functions/unauthenticated`, which looks exactly like an auth bug). The Firebase CLI only applies that binding when it **creates** the function — adding the option to an existing function and redeploying is silently a no-op. If the binding is ever missing, `firebase functions:delete getIceServers --region us-central1` then deploy again.

To verify TURN actually works, temporarily add `iceTransportPolicy: 'relay'` to the peer connection config on both ends: that forbids direct paths, so pairing succeeding proves the relay is in use.

### Firestore Security Rules

The production rules live in `firestore.rules` (the deployed copy in the Firebase console should always match that file). They enforce:

- **Auth required** — every operation requires `request.auth != null` (anonymous auth); the Firebase config embedded in the APK is not enough to touch the database.
- **No collection listing** — sessions can only be fetched by exact ID (`allow get`, `allow list: if false`), so joining requires knowing the 6-char session ID from the QR code/link. The ICE candidate subcollections do allow listing, but only within a session whose ID you already know.
- **Document shape/size validation** — session docs are limited to `createdAt`/`expireAt`/`status`/`offer`/`answer` with size-capped SDP strings; candidate docs to `candidate`/`sdpMLineIndex`/`sdpMid`/`expireAt`. The collection can't be used as free-form storage.
- **Bounded expiry** — `expireAt` is required on every doc and may be at most 2 hours in the future, so the TTL cleanup can't be sidestepped with a far-future expiry.

## Data Channel Protocol

Defined in `shared/protocol.ts` (shared with the web remote — update it there, not in per-app copies). Commands sent as JSON over the WebRTC data channel:

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
  | { type: 'FRAME_DATA'; frameId: number; data: string; timestamp: number }   // frame-based preview
  | { type: 'PHOTO_DATA'; data: string; timestamp: number }                    // photo preview on remote
```

`StreamMode` is `'webrtc' | 'frame-based'`; `FRAME_DATA` and `PHOTO_DATA` carry base64 JPEG data (never log the `data` field — see Logging Guidelines).

## Platform-Specific Configuration

- **iOS permissions**: Configured in `app.json` (infoPlist)
- **Android permissions**: Configured in `app.json` (permissions)
- **Deep links**: Universal links / app links for `apps.binnyva.com/second-shooter/s/*` configured in `app.json` (`ios.associatedDomains`, `android.intentFilters`); custom scheme is `secondshooter://`. Handled by `app/second-shooter/s/[sessionId].tsx` (and `app/s/[sessionId].tsx` for scheme links).

Both platforms require camera, microphone, and photo library permissions.

## Testing Requirements

- **Unit tests**: `npm test` runs Jest tests in `src/__tests__/` with mocks for firebase, vision-camera, and webrtc — no device needed
- **Manual testing: two physical devices required** - WebRTC and camera don't work in simulators
- Test on same WiFi network first, then different networks
- Firebase project must be set up with Firestore enabled and `.env` populated

## Logging Guidelines

- **Never log base64 content or data URIs** - Frame data contains large base64 strings that make logs unusable
- When logging frame-related state, use boolean checks (e.g., `!!frameData`) instead of the actual content
- Log frame metadata like `frameId` or `data.length` instead of the full `data` string
- Example: `console.log(\`Frame received: id=${frame.frameId}, size=${frame.data?.length}\`)` NOT `console.log(\`Frame: ${frame.data}\`)`
