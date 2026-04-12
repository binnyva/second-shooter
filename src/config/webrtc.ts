import { IceServer } from '../types';

// ICE servers for NAT traversal
// Using free public STUN servers
// For production, consider adding TURN servers for better reliability
const iceServers: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

if (process.env.EXPO_PUBLIC_TURN_URL) {
  iceServers.push({
    urls: process.env.EXPO_PUBLIC_TURN_URL,
    username: process.env.EXPO_PUBLIC_TURN_USERNAME,
    credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL,
  });
}

export const ICE_SERVERS: IceServer[] = iceServers;

// WebRTC configuration
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10,
};

// Data channel configuration
export const DATA_CHANNEL_CONFIG: RTCDataChannelInit = {
  ordered: true,
};

// Data channel name for camera commands
export const COMMAND_CHANNEL_NAME = 'camera-commands';
