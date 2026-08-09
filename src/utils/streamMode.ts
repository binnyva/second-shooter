import { StreamMode, CameraFacing, PreviewMode } from '../types';

/**
 * Determines the appropriate stream mode based on the preview mode setting,
 * camera facing and zoom level.
 *
 * With `previewMode: 'frames'` the answer is always frame-based - the point of
 * that setting is that the lens is never handed to WebRTC, so nothing about the
 * camera state can talk it into a handoff.
 *
 * With `previewMode: 'auto'`:
 * - Front camera: WebRTC (no zoom support anyway)
 * - Back camera at 1x: WebRTC (native stream captures wide-angle lens directly)
 * - Back camera at other zoom levels: Frame-based (WebRTC can't capture vision-camera's zoomed preview)
 *
 * Note there is no "always WebRTC" - the back camera above 1x physically cannot
 * be streamed by getUserMedia, so 'auto' is as close to it as the hardware gets.
 *
 * @param facing - Camera facing direction ('front' or 'back')
 * @param zoom - Current zoom level
 * @param previewMode - The user's preview mode setting
 * @returns The appropriate stream mode
 */
export function determineStreamMode(
  facing: CameraFacing,
  zoom: number,
  previewMode: PreviewMode
): StreamMode {
  // Pinned by the user: never hand the camera over, whatever the framing.
  if (previewMode === 'frames') {
    return 'frame-based';
  }

  // Front camera always uses WebRTC (no zoom support)
  if (facing === 'front') {
    return 'webrtc';
  }

  // Back camera: WebRTC only at exactly 1x (with small tolerance for floating point)
  return Math.abs(zoom - 1) < 0.05 ? 'webrtc' : 'frame-based';
}
