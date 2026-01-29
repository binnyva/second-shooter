import { StreamMode, CameraFacing } from '../types';
import { isFrameStreamingAvailable } from '../hooks/useFrameStreaming';

/**
 * Determines which stream mode to use based on camera settings.
 *
 * WebRTC's getUserMedia on Android doesn't support zoom - it accesses cameras directly
 * and bypasses vision-camera's zoom settings. We use frame-based streaming as a workaround
 * for zoom levels other than 1x on the back camera.
 *
 * Note: Frame-based streaming requires the native frameToJpeg plugin to be built into the app.
 * If the plugin is not available, we fall back to webrtc mode (zoom won't work in remote preview).
 *
 * @param facing - Current camera facing direction
 * @param zoom - Current zoom level
 * @returns The appropriate stream mode
 */
export function determineStreamMode(facing: CameraFacing, zoom: number): StreamMode {
  // Front camera: always use WebRTC (zoom is typically not useful/supported anyway)
  if (facing === 'front') {
    return 'webrtc';
  }

  // Back camera at approximately 1x zoom: use WebRTC (native stream works fine)
  // Using a tolerance of 0.1 around 1.0 to account for small adjustments
  if (zoom >= 0.9 && zoom <= 1.1) {
    return 'webrtc';
  }

  // Check if frame-based streaming is available (requires native plugin)
  // If not available, fall back to webrtc (zoom won't work in remote preview)
  if (!isFrameStreamingAvailable()) {
    console.log('[StreamMode] Frame-based streaming not available (plugin missing), using webrtc mode');
    return 'webrtc';
  }

  // Other zoom levels (0.5x ultra-wide, 2x+, etc.): use frame-based streaming
  // because WebRTC can't respect vision-camera's zoom setting
  return 'frame-based';
}

/**
 * Checks if the stream mode should change based on new settings.
 * Returns the new stream mode if it changed, or null if no change.
 */
export function shouldStreamModeChange(
  currentMode: StreamMode,
  facing: CameraFacing,
  zoom: number
): StreamMode | null {
  const newMode = determineStreamMode(facing, zoom);
  return newMode !== currentMode ? newMode : null;
}
