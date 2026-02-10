import { FlashMode } from './index';

// Timer options (seconds, 0 = off)
export type TimerDuration = 0 | 2 | 5 | 10;

// Aspect ratio options
export type AspectRatio = '1:1' | '4:5' | '9:16';

// Save location options
export type SaveLocation = 'camera-roll' | 'app-storage';

// Preview quality options
export type PreviewQuality = 'low' | 'medium' | 'high';

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
  keepScreenAwake: true,
  volumeShutter: true,
};
