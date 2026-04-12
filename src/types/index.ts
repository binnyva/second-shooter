export type {
  DeviceRole,
  CameraFacing,
  FlashMode,
  CaptureMode,
  RecordingState,
  StreamMode,
  CameraState,
  Command,
  FrameDataMessage,
  PhotoDataMessage,
  Response,
  ConnectionState,
  LensInfo,
} from '../../shared/protocol';

export type {
  SignalingOffer,
  SignalingAnswer,
  IceCandidate,
} from '../../shared/signaling';

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

// Re-export settings types
export * from './settings';
