# Second Shooter

A camera remote for Android: one phone takes the photos and videos, another phone (or any browser) shows a live preview and has the shutter.

Put the main phone on a tripod, open the QR code on it, and scan the code with a second phone. The second phone now shows what the main camera sees, so you can frame yourself, then take photos or start and stop videos from it. Everything is saved on the main phone.

If the second device doesn't have the app, the QR code opens the browser remote at `https://apps.binnyva.com/second-shooter/s/{sessionId}`. When the app is installed, the same link opens it.

## Features

- **Live preview** at up to 1440x1080, 30fps, that follows zoom and lens changes
- **Remote control** of the shutter, video recording, zoom and lenses, flash, and front/back camera
- **QR code pairing**, or a session link
- **Browser remote** for devices without the app
- **Peer-to-peer**: Firebase Firestore is only used to set the connection up; a Cloudflare TURN relay helps when the phones can't reach each other directly
- **Keeps going with the screen off**, and reconnects after a network change
- **Photo previews on the remote**, with a viewer for the session's shots
- **Volume buttons as a shutter**
- **Settings**: self-timer (2/5/10s), grid (3x3, 4x4), photo framing (1:1, 4:5, 9:16), flash, save folder, gallery app

## Getting started

1. Set up Firebase and fill in `.env` (see "Firebase Setup" in [AGENTS.md](AGENTS.md)).
2. Build and install:
   ```bash
   cd android
   ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:installRelease
   ```
3. Web remote: `npm run web-remote:build`, then deploy `web-remote/dist`.

## Project structure

- `android/` - the app (Kotlin, Jetpack Compose, CameraX, WebRTC). [android/README.md](android/README.md) covers its internals.
- `web-remote/` - the browser remote (Vite + React)
- `shared/` - protocol and signaling code shared with the web remote, with tests that keep the app's copy in step
- `functions/` - the Cloud Function that issues TURN credentials
- `firestore.rules` - the Firestore security rules

[AGENTS.md](AGENTS.md) has the architecture, setup and the reasons behind the less obvious decisions.

Until November 2026 the app was an Expo React Native app; it's in the git history, and [android/PORTING_PLAN.md](android/PORTING_PLAN.md) describes the move.
