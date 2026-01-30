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
  // De-duplicate the array as some devices (e.g., Pixel 9 Pro) report duplicate entries
  const rawPhysicalDevices = device.physicalDevices || [];
  const physicalDevices = [...new Set(rawPhysicalDevices)];
  const minZoom = device.minZoom ?? 1;
  const maxZoom = device.maxZoom ?? 10;
  const neutralZoom = device.neutralZoom ?? 1;

  console.log('[LensDetection] Device:', device.id, '(' + device.position.toUpperCase() + ')', device.name);
  console.log('[LensDetection] Physical devices (raw):', rawPhysicalDevices);
  console.log('[LensDetection] Physical devices (unique):', physicalDevices);
  console.log('[LensDetection] Zoom range:', minZoom, '-', maxZoom, 'neutral:', neutralZoom);
  console.log('[LensDetection] hasFlash:', device.hasFlash, 'hasTorch:', device.hasTorch);

  // Build lens list based on physical devices
  const hasUltraWide = physicalDevices.includes('ultra-wide-angle-camera');
  const hasWide = physicalDevices.includes('wide-angle-camera');

  // Count telephoto cameras - devices like Samsung S23 Ultra have multiple
  // After de-duplication, this gives 1 for most devices with a single telephoto
  const telephotoCount = physicalDevices.filter(
    (d) => d === 'telephoto-camera'
  ).length;

  console.log('[LensDetection] Telephoto camera count:', telephotoCount, 'hasUltraWide:', hasUltraWide);

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

  // Telephoto lenses - detect all available zoom factors
  if (telephotoCount > 0) {
    const telephotoZooms = detectTelephotoZooms(device, telephotoCount, hasUltraWide);
    console.log('[LensDetection] Detected telephoto zooms:', telephotoZooms);
    telephotoZooms.forEach((zoom, index) => {
      lenses.push({
        id: `telephoto-${index + 1}`,
        label: formatZoomLabel(zoom),
        zoom: zoom,
        isActive: !isFrontCamera && isZoomActive(currentZoom, zoom),
      });
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
 * Attempts to detect the telephoto zoom factors from device characteristics.
 * Handles devices with multiple telephoto cameras (like Samsung S23 Ultra with 3x and 10x).
 */
function detectTelephotoZooms(device: CameraDevice, telephotoCount: number, hasUltraWide: boolean): number[] {
  const maxZoom = device.maxZoom ?? 10;
  const minZoom = device.minZoom ?? 1;

  // Common telephoto configurations based on maxZoom and telephoto count:
  // Single telephoto:
  // - 2x telephoto: maxZoom often around 8-16x (2x × 4-8x digital)
  // - 3x telephoto: maxZoom often around 15-30x (3x × 5-10x digital)
  // - 5x telephoto: maxZoom often around 30-50x (5x × 6-10x digital)
  //
  // Dual telephoto (Samsung S21 Ultra, S22 Ultra, S23 Ultra, S24 Ultra):
  // - 3x + 10x: maxZoom typically 100x (10x digital on 10x optical)
  // - 3x + 5x: maxZoom typically 50x
  //
  // Triple telephoto (some Sony Xperia):
  // - 2.5x + 4x + 10x configurations exist

  if (telephotoCount >= 2) {
    // Device has multiple telephoto cameras
    if (maxZoom >= 80) {
      // Samsung S23 Ultra / S24 Ultra style: 3x + 10x
      return [3, 10];
    } else if (maxZoom >= 40) {
      // 3x + 5x configuration
      return [3, 5];
    } else if (maxZoom >= 20) {
      // 2x + 3x or similar
      return [2, 3];
    } else {
      // Unknown dual telephoto, estimate based on maxZoom
      return [2, Math.min(5, Math.floor(maxZoom / 2))];
    }
  }

  // Single telephoto camera
  // Flagship phones with ultra-wide + single telephoto typically have 5x
  // (Pixel 7 Pro, Pixel 8 Pro, Pixel 9 Pro, iPhone 15 Pro Max, etc.)
  // Mid-range phones typically have 2x or 3x telephoto
  if (maxZoom >= 50) {
    return [5]; // 5x telephoto with high digital zoom
  } else if (hasUltraWide && minZoom < 1 && maxZoom >= 20) {
    // Flagship pattern: ultra-wide + single telephoto + maxZoom 20-50
    // This is typically a 5x telephoto (e.g., Pixel 9 Pro: maxZoom=30, 5x×6=30)
    return [5];
  } else if (maxZoom >= 15) {
    return [3]; // 3x telephoto (like iPhone 13 Pro, Pixel 6 Pro)
  } else {
    return [2]; // 2x telephoto (most common)
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
    { id: 'telephoto-3x', label: '3', zoom: 3, isActive: !isFrontCamera && isZoomActive(currentZoom, 3) },
    { id: 'telephoto-10x', label: '10', zoom: 10, isActive: !isFrontCamera && isZoomActive(currentZoom, 10) },
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
