// Device roles in the peer-to-peer connection
export type DeviceRole = 'camera' | 'remote';

// Camera facing direction
export type CameraFacing = 'front' | 'back';

// Flash modes
export type FlashMode = 'off' | 'on' | 'auto';

// Capture modes
export type CaptureMode = 'photo' | 'video';

// Recording state
export type RecordingState = 'idle' | 'recording';

// Camera state shared between devices
export interface CameraState {
  zoom: number;
  flash: FlashMode;
  facing: CameraFacing;
  captureMode: CaptureMode;
  isRecording: boolean;
}

// Commands sent from remote to camera device via data channel
export type Command =
  | { type: 'TAKE_PHOTO' }
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'SET_ZOOM'; level: number }
  | { type: 'SET_FLASH'; mode: FlashMode }
  | { type: 'SWITCH_CAMERA' }
  | { type: 'GET_STATE' };

// Responses sent from camera to remote device via data channel
export type Response =
  | { type: 'PHOTO_TAKEN'; success: boolean; error?: string }
  | { type: 'RECORDING_STARTED' }
  | { type: 'RECORDING_STOPPED'; success: boolean; error?: string }
  | { type: 'STATE_UPDATE'; state: CameraState; lenses?: LensInfo[]; videoNeedsRotation?: boolean }
  | { type: 'ERROR'; message: string };

// WebRTC connection states
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed';

// Session info for pairing
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
}

// ICE server configuration
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Signaling message types
export interface SignalingOffer {
  type: 'offer';
  sdp: string;
}

export interface SignalingAnswer {
  type: 'answer';
  sdp: string;
}

export interface IceCandidate {
  candidate: string;
  sdpMLineIndex: number | null;
  sdpMid: string | null;
}

// Camera lens information for lens selector UI
export interface LensInfo {
  id: string;
  label: string;     // "F", ".6", "1", "3", "5" etc.
  zoom: number;      // Actual zoom factor
  isActive: boolean;
}
