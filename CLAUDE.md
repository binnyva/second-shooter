# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Second Shooter is an Expo React Native mobile app that enables one device to remotely control another device's camera over a peer-to-peer WebRTC connection. The main phone captures photos/videos while a secondary phone provides a live preview and remote shutter control.

## Build Commands

```bash
# Install dependencies
npm install

# Generate native projects (required for native modules)
npx expo prebuild

# Run on iOS (requires prebuild)
npx expo run:ios

# Run on Android (requires prebuild)
npx expo run:android

# Start Expo development server (for Expo Go - limited functionality)
npm start
```

**Note:** This app requires `npx expo prebuild` because it uses native modules (react-native-vision-camera, react-native-webrtc) that are not available in Expo Go. You must run the prebuild command first, then use `npx expo run:ios` or `npx expo run:android` to build and run on physical devices.

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

### Key Services
- `src/services/WebRTCService.ts` - P2P connection management
- `src/services/CameraService.ts` - Camera operations wrapper using react-native-vision-camera
- `src/services/SignalingService.ts` - Firebase Firestore signaling handler
- `src/services/MediaService.ts` - Photo/video save operations using expo-media-library

### Custom Hooks
- `src/hooks/useCamera.ts` - Camera state and controls
- `src/hooks/usePeerConnection.ts` - WebRTC connection hook
- `src/hooks/useSignaling.ts` - Firebase signaling hook

### Tech Stack
- **Framework**: Expo (with prebuild for native modules)
- **Navigation**: Expo Router
- **Camera**: react-native-vision-camera
- **P2P/Streaming**: react-native-webrtc
- **QR**: expo-camera (scanner), react-native-qrcode-svg (generator)
- **Signaling**: Firebase Firestore
- **NAT traversal**: STUN servers (configured in `src/config/webrtc.ts`)

## Project Structure

```
./
├── app/                          # Expo Router screens
│   ├── _layout.tsx               # Root layout
│   ├── index.tsx                 # Home = Camera mode (default)
│   └── remote.tsx                # Remote control screen
├── src/
│   ├── components/               # UI components
│   │   ├── CameraView.tsx
│   │   ├── CameraControls.tsx
│   │   ├── RemotePreview.tsx
│   │   ├── QRCodeDisplay.tsx
│   │   └── QRCodeScanner.tsx
│   ├── services/                 # Core services
│   │   ├── WebRTCService.ts
│   │   ├── SignalingService.ts
│   │   ├── CameraService.ts
│   │   └── MediaService.ts
│   ├── hooks/                    # React hooks
│   │   ├── useCamera.ts
│   │   ├── usePeerConnection.ts
│   │   └── useSignaling.ts
│   ├── types/                    # TypeScript definitions
│   │   └── index.ts
│   ├── config/                   # Configuration
│   │   ├── firebase.ts           # Firebase initialization
│   │   └── webrtc.ts             # ICE server config
│   └── utils/                    # Utilities
│       ├── permissions.ts
│       └── sessionId.ts
├── app.json                      # Expo configuration with permissions
└── package.json
```

## Firebase Setup

Before running the app, you need to:

1. Create a Firebase project at console.firebase.google.com
2. Enable Firestore Database
3. Update `src/config/firebase.ts` with your Firebase credentials
4. Set up Firestore security rules (example below)

### Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Sessions collection for WebRTC signaling
    match /sessions/{sessionId} {
      allow read, write: if true;  // For development

      // ICE candidates subcollections
      match /offerCandidates/{candidateId} {
        allow read, write: if true;
      }
      match /answerCandidates/{candidateId} {
        allow read, write: if true;
      }
    }
  }
}
```

## Data Channel Protocol

Commands sent as JSON over WebRTC data channel:

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
  | { type: 'STATE_UPDATE'; state: CameraState }
  | { type: 'ERROR'; message: string }
```

## Platform-Specific Configuration

- **iOS permissions**: Configured in `app.json` (infoPlist)
- **Android permissions**: Configured in `app.json` (permissions)

Both platforms require camera, microphone, and photo library permissions.

## Testing Requirements

- **Two physical devices required** - WebRTC and camera don't work in simulators
- Test on same WiFi network first, then different networks
- Firebase project must be set up with Firestore enabled
