import { StreamMode, CameraFacing } from '../types';

/**
 * Determines the appropriate stream mode based on camera facing and zoom level.
 *
 * - Front camera: Always WebRTC (no zoom support anyway)
 * - Back camera at 1x: WebRTC (native stream captures wide-angle lens directly)
 * - Back camera at other zoom levels: Frame-based (WebRTC can't capture vision-camera's zoomed preview)
 *
 * @param facing - Camera facing direction ('front' or 'back')
 * @param zoom - Current zoom level
 * @returns The appropriate stream mode
 */
export function determineStreamMode(facing: CameraFacing, zoom: number): StreamMode {
  // Front camera always uses WebRTC (no zoom support)
  if (facing === 'front') {
    return 'webrtc';
  }

  // Back camera: WebRTC only at exactly 1x (with small tolerance for floating point)
  return Math.abs(zoom - 1) < 0.05 ? 'webrtc' : 'frame-based';
}
