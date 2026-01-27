import { CameraDevice, PhysicalCameraDeviceType } from 'react-native-vision-camera';
import { LensInfo, CameraFacing } from '../types';

/**
 * Physical device types and their typical zoom factors relative to wide-angle (1x).
 * These values are approximate and may vary by device manufacturer.
 */
const PHYSICAL_DEVICE_ZOOM_MAP: Record<PhysicalCameraDeviceType, number> = {
  'ultra-wide-angle-camera': 0.5,
  'wide-angle-camera': 1,
  'telephoto-camera': 2, // Can be 2x, 3x, 5x depending on device
};

/**
 * Detects available camera lenses from the device's physicalDevices array
 * and returns lens info for UI display with proper optical zoom levels.
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

  // Get physical devices from the camera device
  const physicalDevices = device.physicalDevices || [];
  const minZoom = device.minZoom ?? 1;
  const maxZoom = device.maxZoom ?? 10;
  const neutralZoom = device.neutralZoom ?? 1;

  console.log('[LensDetection] Device:', device.name);
  console.log('[LensDetection] Physical devices:', physicalDevices);
  console.log('[LensDetection] Zoom range:', minZoom, '-', maxZoom, 'neutral:', neutralZoom);

  // Build lens list based on physical devices
  const hasUltraWide = physicalDevices.includes('ultra-wide-angle-camera');
  const hasWide = physicalDevices.includes('wide-angle-camera');
  const hasTelephoto = physicalDevices.includes('telephoto-camera');

  // Ultra-wide lens (typically 0.5x or 0.6x)
  if (hasUltraWide && minZoom < 1) {
    // Use the actual minZoom reported by the device for ultra-wide
    const ultraWideZoom = minZoom;
    lenses.push({
      id: 'ultra-wide',
      label: formatZoomLabel(ultraWideZoom),
      zoom: ultraWideZoom,
      isActive: !isFrontCamera && isZoomActive(currentZoom, ultraWideZoom),
    });
  }

  // Wide/main lens (1x) - always present as it's the reference point
  lenses.push({
    id: 'wide',
    label: '1',
    zoom: 1,
    isActive: !isFrontCamera && isZoomActive(currentZoom, 1),
  });

  // Telephoto lens - detect the actual zoom factor
  if (hasTelephoto) {
    // The telephoto zoom is typically maxZoom for the optical range,
    // or we can estimate from common configurations
    const telephotoZoom = detectTelephotoZoom(device);
    lenses.push({
      id: 'telephoto',
      label: formatZoomLabel(telephotoZoom),
      zoom: telephotoZoom,
      isActive: !isFrontCamera && isZoomActive(currentZoom, telephotoZoom),
    });
  } else if (maxZoom >= 2) {
    // No dedicated telephoto, but device supports digital zoom
    // Add a 2x option for convenience
    lenses.push({
      id: 'digital-2x',
      label: '2',
      zoom: 2,
      isActive: !isFrontCamera && isZoomActive(currentZoom, 2),
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
 * Attempts to detect the telephoto zoom factor from device characteristics.
 * Modern phones typically have 2x, 3x, or 5x telephoto lenses.
 */
function detectTelephotoZoom(device: CameraDevice): number {
  const maxZoom = device.maxZoom ?? 10;
  const minZoom = device.minZoom ?? 1;

  // Common telephoto configurations:
  // - 2x telephoto: maxZoom often around 8-10x (4-5x digital on top of 2x optical)
  // - 3x telephoto: maxZoom often around 15-30x
  // - 5x telephoto: maxZoom often around 50-100x

  // Heuristic: the optical telephoto is usually where the device
  // can maintain good quality. We'll estimate based on maxZoom.
  if (maxZoom >= 50) {
    return 5; // 5x telephoto (like Samsung S21 Ultra, Pixel 7 Pro)
  } else if (maxZoom >= 15) {
    return 3; // 3x telephoto (like iPhone 13 Pro, Pixel 6 Pro)
  } else {
    return 2; // 2x telephoto (most common)
  }
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
