import { CameraDevice } from 'react-native-vision-camera';
import { LensInfo, CameraFacing } from '../types';

/**
 * Detects available camera lenses and returns lens info for UI display.
 * Maps physical device zoom factors to user-friendly labels.
 */
export function detectLenses(
  device: CameraDevice | undefined,
  facing: CameraFacing,
  currentZoom: number
): LensInfo[] {
  if (!device) {
    return getDefaultLenses(facing, currentZoom);
  }

  const lenses: LensInfo[] = [];
  const isFrontCamera = facing === 'front';

  // Always start with selfie option
  lenses.push({
    id: 'selfie',
    label: 'S',
    zoom: 1,
    isActive: isFrontCamera,
  });

  // Always show back camera zoom levels (inactive when on front camera)
  // Detect available zoom levels
  // react-native-vision-camera exposes minZoom/maxZoom and neutralZoom
  const neutralZoom = device.neutralZoom ?? 1;
  const minZoom = device.minZoom ?? 1;
  const maxZoom = device.maxZoom ?? 10;

  // Common lens configurations on modern phones:
  // - Ultra-wide: 0.5x - 0.6x
  // - Wide (main): 1x
  // - Telephoto: 2x, 3x, or 5x

  // Check if device supports ultra-wide (minZoom less than 1)
  if (minZoom < 1) {
    const ultraWideZoom = Math.max(minZoom, 0.5);
    lenses.push({
      id: 'ultra-wide',
      label: formatZoomLabel(ultraWideZoom),
      zoom: ultraWideZoom,
      isActive: !isFrontCamera && isZoomActive(currentZoom, ultraWideZoom),
    });
  }

  // Main lens (1x)
  lenses.push({
    id: 'wide',
    label: '1',
    zoom: 1,
    isActive: !isFrontCamera && isZoomActive(currentZoom, 1),
  });

  // Check for telephoto capabilities
  if (maxZoom >= 2) {
    lenses.push({
      id: 'telephoto-2x',
      label: '2',
      zoom: 2,
      isActive: !isFrontCamera && isZoomActive(currentZoom, 2),
    });
  }

  if (maxZoom >= 3) {
    lenses.push({
      id: 'telephoto-3x',
      label: '3',
      zoom: 3,
      isActive: !isFrontCamera && isZoomActive(currentZoom, 3),
    });
  }

  if (maxZoom >= 5) {
    lenses.push({
      id: 'telephoto-5x',
      label: '5',
      zoom: 5,
      isActive: !isFrontCamera && isZoomActive(currentZoom, 5),
    });
  }

  // If on front camera, selfie is already active, just return
  if (isFrontCamera) {
    return lenses;
  }

  // If no lens is currently active (user zoomed to custom level),
  // mark the closest back camera lens as active
  const hasActive = lenses.some((l) => l.isActive);
  if (!hasActive && lenses.length > 1) {
    // Find closest lens (skip selfie at index 0)
    let closestIndex = 1;
    let minDiff = Math.abs(lenses[1].zoom - currentZoom);
    lenses.forEach((lens, index) => {
      if (index === 0) return; // Skip selfie
      const diff = Math.abs(lens.zoom - currentZoom);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = index;
      }
    });
    lenses[closestIndex].isActive = true;
  }

  return lenses;
}

/**
 * Returns default lenses when device info is not available.
 */
function getDefaultLenses(facing: CameraFacing, currentZoom: number): LensInfo[] {
  const isFrontCamera = facing === 'front';

  return [
    { id: 'selfie', label: 'S', zoom: 1, isActive: isFrontCamera },
    { id: 'ultra-wide', label: '.5', zoom: 0.5, isActive: !isFrontCamera && isZoomActive(currentZoom, 0.5) },
    { id: 'wide', label: '1', zoom: 1, isActive: !isFrontCamera && isZoomActive(currentZoom, 1) },
    { id: 'telephoto-2x', label: '2', zoom: 2, isActive: !isFrontCamera && isZoomActive(currentZoom, 2) },
    { id: 'telephoto-3x', label: '3', zoom: 3, isActive: !isFrontCamera && isZoomActive(currentZoom, 3) },
    { id: 'telephoto-5x', label: '5', zoom: 5, isActive: !isFrontCamera && isZoomActive(currentZoom, 5) },
  ];
}

/**
 * Format zoom level to a display label.
 */
function formatZoomLabel(zoom: number): string {
  if (zoom < 1) {
    // Show as decimal like ".6" for 0.6x
    return zoom.toFixed(1).replace('0.', '.');
  }
  // For >= 1, just show the integer or one decimal
  return zoom === Math.floor(zoom) ? zoom.toString() : zoom.toFixed(1);
}

/**
 * Determines if a zoom level should be considered "active" based on current zoom.
 * Allows for small tolerance to handle floating point comparisons.
 */
function isZoomActive(currentZoom: number, targetZoom: number): boolean {
  const tolerance = 0.1;
  return Math.abs(currentZoom - targetZoom) < tolerance;
}

/**
 * Updates the active state of all lenses based on current zoom.
 */
export function updateActiveLens(lenses: LensInfo[], currentZoom: number): LensInfo[] {
  return lenses.map((lens) => ({
    ...lens,
    isActive: isZoomActive(currentZoom, lens.zoom),
  }));
}
