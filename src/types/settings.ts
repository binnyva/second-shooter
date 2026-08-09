import { FlashMode } from './index';

// Timer options (seconds, 0 = off)
export type TimerDuration = 0 | 2 | 5 | 10;

// Aspect ratio options
export type AspectRatio = '1:1' | '4:5' | '9:16';

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

// Which app the thumbnail button opens.
//
// Not a closed union: apart from the sentinel below the value is an Android
// package name, discovered at runtime from what's installed (see
// src/utils/galleryApps.ts). A stored package can stop being installed, so
// nothing may assume the value still names a real app.
export const SYSTEM_DEFAULT_GALLERY = 'system-default';
export type GalleryApp = string;

// Complete settings interface
export interface AppSettings {
  // Camera settings
  timer: TimerDuration;
  aspectRatio: AspectRatio;
  gridOverlay: GridOverlay;
  flash: FlashMode;

  // Media settings
  //
  // SAF tree URI of the folder the user browsed to. Null means nobody has
  // picked one, and saves fall back to the camera roll - which is also what
  // happens off Android, where there's no folder picker to persist (see
  // src/utils/saveFolder.ts).
  saveFolderUri: string | null;
  // Display name for that folder ('DCIM/Shoots'), derived from the URI at pick
  // time so Settings doesn't have to re-parse it on every render.
  saveFolderName: string | null;
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
  saveFolderUri: null,
  saveFolderName: null,
  galleryApp: SYSTEM_DEFAULT_GALLERY,
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
