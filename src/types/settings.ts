import { FlashMode } from './index';

// Timer options (seconds, 0 = off)
export type TimerDuration = 0 | 2 | 5 | 10;

// Aspect ratio options
export type AspectRatio = '1:1' | '4:5' | '9:16';

// Save location options
export type SaveLocation = 'camera-roll' | 'app-storage';

// Preview quality options
export type PreviewQuality = 'low' | 'medium' | 'high';

// How the remote's live preview is fed.
//
// 'auto' streams native WebRTC video wherever it can (front camera, back camera
// at 1x) and falls back to JPEG frames elsewhere. That switch is a physical
// close/open of the camera module every time it happens - including twice per
// photo - which is slow on the shutter path and audible.
//
// 'frames' pins the preview to JPEG frames, so vision-camera holds the lens for
// the whole session and nothing ever hands it over. The preview is lower
// quality and costs more bandwidth; the camera stops clicking.
export type PreviewMode = 'auto' | 'frames';

// Grid overlay options
export type GridOverlay = 'none' | '3x3' | '4x4';

// Gallery app options
export type GalleryApp = 'system-default';

// Complete settings interface
export interface AppSettings {
  // Camera settings
  timer: TimerDuration;
  aspectRatio: AspectRatio;
  gridOverlay: GridOverlay;
  flash: FlashMode;

  // Media settings
  saveLocation: SaveLocation;
  galleryApp: GalleryApp;

  // Remote settings
  previewQuality: PreviewQuality;
  previewMode: PreviewMode;

  // General settings
  keepScreenAwake: boolean;
  volumeShutter: boolean;
}

// Default settings
export const DEFAULT_SETTINGS: AppSettings = {
  timer: 0,
  aspectRatio: '9:16',
  gridOverlay: 'none',
  flash: 'off',
  saveLocation: 'camera-roll',
  galleryApp: 'system-default',
  previewQuality: 'medium',
  // Defaults to 'frames' deliberately. The lens handoff 'auto' depends on is
  // the source of the camera clicking and of the contention errors the retry
  // machinery in app/index.tsx exists to absorb, so the quiet path is the one
  // that ships on by default. 'auto' is kept as an escape hatch while we find
  // out whether frame-based preview is good enough on its own - if it is, the
  // webrtc branch and everything propping it up should go.
  previewMode: 'frames',
  keepScreenAwake: true,
  volumeShutter: true,
};
