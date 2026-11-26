export type DeviceRole = 'camera' | 'remote';

export type CameraFacing = 'front' | 'back';

export type FlashMode = 'off' | 'on' | 'auto';

export type CaptureMode = 'photo' | 'video';

export type RecordingState = 'idle' | 'recording';

export type StreamMode = 'webrtc' | 'frame-based';

export interface CameraState {
  zoom: number;
  flash: FlashMode;
  facing: CameraFacing;
  captureMode: CaptureMode;
  isRecording: boolean;
  streamMode?: StreamMode;
}

export interface LensInfo {
  id: string;
  label: string;
  zoom: number;
  isActive: boolean;
}

// Exposure compensation in EV. The camera rounds to its nearest step.
export interface ExposureInfo {
  ev: number;
  min: number;
  max: number;
  step: number;
}

export type Command =
  | { type: 'TAKE_PHOTO' }
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'SET_ZOOM'; level: number }
  | { type: 'SET_FLASH'; mode: FlashMode }
  | { type: 'SET_EXPOSURE'; ev: number }
  | { type: 'SWITCH_CAMERA' }
  | { type: 'GET_STATE' };

export interface FrameDataMessage {
  type: 'FRAME_DATA';
  frameId: number;
  data: string;
  timestamp: number;
}

export interface PhotoDataMessage {
  type: 'PHOTO_DATA';
  data: string;
  timestamp: number;
}

export type Response =
  | { type: 'PHOTO_TAKEN'; success: boolean; error?: string }
  | { type: 'RECORDING_STARTED' }
  | { type: 'RECORDING_STOPPED'; success: boolean; error?: string }
  | {
      type: 'STATE_UPDATE';
      state: CameraState;
      lenses?: LensInfo[];
      videoNeedsRotation?: boolean;
      previewZoomLimited?: boolean;
      streamMode?: StreamMode;
      // The current camera's zoom range, so a remote can clamp a pinch.
      // Older cameras don't send it.
      minZoom?: number;
      maxZoom?: number;
      // Absent when the camera can't adjust exposure (or is too old to say).
      exposure?: ExposureInfo;
    }
  | { type: 'ERROR'; message: string }
  // The camera device is mid-capture, so the live preview is dead: WebRTC and
  // vision-camera can't hold the camera at once. Sent true when the camera is
  // taken and false once the stream is back, so the remote can show the
  // captured shot instead of a frozen frame.
  | { type: 'CAPTURE_STATE'; capturing: boolean }
  | FrameDataMessage
  | PhotoDataMessage;

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed';

// Every Command and Response `type`, as runtime values.
//
// `satisfies` rejects a name that isn't in the union, and the Assert types
// below fail to compile when a type is added to the union but not listed
// here. src/__tests__/protocolFixtures.test.ts then requires an example of
// each one in shared/protocol-fixtures.json, and the Kotlin app's tests
// decode every example, so a protocol change can't skip the native copy.
export const COMMAND_TYPES = [
  'TAKE_PHOTO',
  'START_RECORDING',
  'STOP_RECORDING',
  'SET_ZOOM',
  'SET_FLASH',
  'SET_EXPOSURE',
  'SWITCH_CAMERA',
  'GET_STATE',
] as const satisfies readonly Command['type'][];

export const RESPONSE_TYPES = [
  'PHOTO_TAKEN',
  'RECORDING_STARTED',
  'RECORDING_STOPPED',
  'STATE_UPDATE',
  'ERROR',
  'CAPTURE_STATE',
  'FRAME_DATA',
  'PHOTO_DATA',
] as const satisfies readonly Response['type'][];

type AssertNever<T extends never> = T;
export type AllCommandTypesListed = AssertNever<
  Exclude<Command['type'], (typeof COMMAND_TYPES)[number]>
>;
export type AllResponseTypesListed = AssertNever<
  Exclude<Response['type'], (typeof RESPONSE_TYPES)[number]>
>;
