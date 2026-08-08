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

**When to rebuild**: Only run `npx expo run:android` again if you add/remove native dependencies, change `app.json` config, or modify the `android/` directory.

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

### Key Services
- `src/services/WebRTCService.ts` - P2P connection management
- `src/services/CameraService.ts` - Camera operations wrapper using react-native-vision-camera
- `src/services/SignalingService.ts` - Firebase Firestore signaling handler
- `src/services/MediaService.ts` - Photo/video save operations using expo-media-library
- `src/services/SettingsService.ts` - Persistent app settings via AsyncStorage

### Custom Hooks
- `src/hooks/useCamera.ts` - Camera state and controls
- `src/hooks/usePeerConnection.ts` - WebRTC connection hook
- `src/hooks/useSignaling.ts` - Firebase signaling hook
- `src/hooks/useSettings.ts` - App settings hook
- `src/hooks/useVolumeShutter.ts` - Volume buttons as shutter trigger (react-native-volume-manager)

### Key Utilities
- `src/utils/lensDetection.ts` - Detects physical lenses (ultra-wide/wide/telephoto) for zoom buttons
- `src/utils/streamMode.ts` - Chooses WebRTC vs frame-based preview mode
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
│   │   └── streamMode.ts
│   └── __tests__/                # Jest unit tests (with mocks)
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
