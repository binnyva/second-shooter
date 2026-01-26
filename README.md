# Second Shooter

A mobile camera remote control system that allows one device to remotely operate another device's camera over a peer-to-peer connection.

You can use this to take a video/photo of yourself by using a secondary phone to frame yourself and trigger the photo. You can set the main phone on a tripod and use the remote phone to see how you look on the main camera. Use that to frame yourself and then remotely trigger the shutter. Or start and end the video recording from the secondary phone. The photos and videos will be stored on the main phone.

This can be done by activating the remote mode on the main phone that will show a QR code. This QR code will be scanned by the secondary phone which will open the same app in the secondary phone. It should be installed already, and then you will get remote functions from the secondary phone. 

## Features

- **Remote Camera Control**: Take photos and record videos from another device
- **QR Code Pairing**: Simple, fast device pairing via QR code scanning
- **Peer-to-Peer Connection**: Direct device-to-device communication over the internet with no intermediary server
- **Cross-Platform**: Single codebase for both iOS and Android
- **Live Preview**: Real-time camera viewfinder streaming to the remote device
- **Full Camera Controls**: Access to focus, exposure, zoom, and other camera settings

## Tech Stack

### Framework
- **React Native** - Cross-platform mobile development

### Key Libraries
- **react-native-vision-camera** - Advanced camera functionality and control
- **react-native-webrtc** - Peer-to-peer connection and video streaming
- **react-native-qrcode-scanner** - QR code scanning for pairing
- **react-native-qrcode-svg** - QR code generation
- **Socket.io-client** (optional) - Signaling for WebRTC connection establishment

### Architecture
- **WebRTC** - Handles P2P connection, data channels, and media streaming
- **STUN/TURN servers** - NAT traversal (only for connection establishment, not for media relay)

## How It Works

### Pairing Process

1. **Camera Device**: User clicks on Remote option to generates a unique session ID and displays it as a QR code
2. **Remote Device**: Scans the QR code to obtain session credentials
3. **Connection Establishment**: 
   - Devices exchange WebRTC signaling data
   - P2P connection established using ICE candidates
   - Direct peer-to-peer data channel created
4. **Ready**: Remote device can now control the camera

### Connection Flow

```
┌─────────────┐                           ┌─────────────┐
│   Camera    │                           │   Remote    │
│   Device    │                           │   Device    │
└──────┬──────┘                           └──────┬──────┘
       │                                         │
       │  1. Generate QR Code                    │
       │     (Session ID + ICE config)           │
       │◄────────────────────────────────────────┤
       │  2. Scan QR Code                        │
       │                                         │
       │  3. WebRTC Offer/Answer Exchange        │
       │◄───────────────────────────────────────►│
       │     (via signaling channel)             │
       │                                         │
       │  4. P2P Connection Established          │
       │◄═══════════════════════════════════════►│
       │        (Direct connection)              │
       │                                         │
       │  5. Camera Control Commands             │
       │◄────────────────────────────────────────┤
       │                                         │
       │  6. Live Preview Stream                 │
       ├────────────────────────────────────────►│
       │                                         │
```

## Project Structure

```
second-shooter/
├── src/
│   ├── components/
│   │   ├── CameraView.tsx          # Camera interface and controls
│   │   ├── RemoteControl.tsx       # Remote control interface
│   │   ├── QRCodeGenerator.tsx     # QR code display for pairing
│   │   └── QRCodeScanner.tsx       # QR code scanning component
│   ├── services/
│   │   ├── WebRTCService.ts        # WebRTC connection management
│   │   ├── CameraService.ts        # Camera operations wrapper
│   │   ├── SignalingService.ts     # WebRTC signaling handler
│   │   └── PairingService.ts       # QR code pairing logic
│   ├── hooks/
│   │   ├── useCamera.ts            # Camera functionality hook
│   │   ├── usePeerConnection.ts    # WebRTC peer connection hook
│   │   └── useRemoteControl.ts     # Remote control state hook
│   ├── types/
│   │   └── index.ts                # TypeScript type definitions
│   ├── utils/
│   │   ├── permissions.ts          # Camera/mic permission helpers
│   │   └── constants.ts            # App constants
│   └── screens/
│       ├── HomeScreen.tsx          # Role selection (Camera/Remote)
│       ├── CameraScreen.tsx        # Camera device screen
│       └── RemoteScreen.tsx        # Remote control screen
├── android/                        # Android native code
├── ios/                            # iOS native code
├── package.json
└── README.md
```

## Installation

### Prerequisites

- Node.js (v18 or higher)
- React Native development environment set up
- iOS: Xcode and CocoaPods
- Android: Android Studio and JDK

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/second-shooter.git
cd second-shooter

# Install dependencies
npm install

# iOS only: Install pods
cd ios && pod install && cd ..

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## Configuration

### WebRTC Configuration

Configure STUN servers in `src/utils/constants.ts`:

```typescript
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
```

For better NAT traversal, you may optionally add TURN servers (only used as fallback when direct P2P fails):

```typescript
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:your-turn-server.com:3478',
    username: 'username',
    credential: 'password'
  }
];
```

### Camera Permissions

The app requires camera and microphone permissions. These are configured in:

- **iOS**: `ios/SecondShooter/Info.plist`
- **Android**: `android/app/src/main/AndroidManifest.xml`

## Usage

### As Camera Device

1. Launch the app. It will open in camera mode by default
2. Grant camera and microphone permissions
3. A QR code will be displayed
4. Wait for remote device to scan and connect
5. Your camera is now ready to be controlled remotely

### As Remote Device

1. Launch the app and select "Remote Mode".
2. Grant camera permissions (for QR scanning)
3. Scan the QR code from the camera device
4. Wait for P2P connection to establish
5. Use the on-screen controls to operate the remote camera

### Camera Controls

- **Capture Photo**: Single tap the shutter button
- **Record Video**: Change to video mode, then shutter button
- **Zoom**: Pinch gesture or zoom slider
- **Focus**: Tap on preview to focus
- **Flash**: Toggle flash modes
- **Switch Camera**: Front/back/different zoom camera toggle

## Technical Challenges & Solutions

### NAT Traversal

**Challenge**: Devices behind different NATs cannot directly connect.

**Solution**: Use STUN servers for NAT hole punching. For difficult network scenarios, TURN servers can relay traffic (though this reduces the "serverless" benefit).

### Signaling Without a Server

**Challenge**: WebRTC requires signaling to exchange connection information.

**Solutions**:
1. **QR Code Exchange**: Initial offer encoded in QR code
2. **Firebase Firestore** (lightweight option): Temporary signaling documents
3. **Public MQTT Broker**: Ephemeral signaling messages
4. **Manual Exchange**: Copy/paste connection strings (development only)

### Low Latency Streaming

**Challenge**: Minimizing delay between camera and remote preview.

**Solutions**:
- Use WebRTC's low-latency media streaming
- Configure camera for lower resolution during preview
- Optimize video encoding settings
- Use data channels for control commands (faster than media stream)

## Roadmap

- [ ] Basic camera control (photo/video)
- [ ] QR code pairing implementation
- [ ] WebRTC P2P connection
- [ ] Live camera preview streaming
- [ ] Advanced camera controls (ISO, shutter speed, white balance)
- [ ] Multiple camera device support
- [ ] Photo/video gallery and review
- [ ] Settings and preferences
- [ ] Gesture controls (swipe to adjust settings)
- [ ] Timer and burst mode
- [ ] Grid overlays and composition guides

## Known Limitations

- **Network Requirements**: Both devices need internet access for initial connection establishment
- **Battery Usage**: Streaming video consumes significant battery on both devices
- **Firewall Restrictions**: Some corporate/restrictive networks may block P2P connections
- **Platform Differences**: Some advanced camera features may only be available on one platform

## License

MIT License - feel free to use this project for your own purposes.

## Acknowledgments

- react-native-vision-camera for excellent camera APIs
- WebRTC for enabling peer-to-peer connections
- The React Native community

## Support

For issues, questions, or suggestions, please open an issue on GitHub.
