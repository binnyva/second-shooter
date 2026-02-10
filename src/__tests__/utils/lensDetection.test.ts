import { detectLenses, updateActiveLens } from '../../utils/lensDetection';
import { CameraDevice, PhysicalCameraDeviceType } from 'react-native-vision-camera';
import { CameraFacing, LensInfo } from '../../types';

// Helper to create mock camera devices
function createMockDevice(
  options: {
    id?: string;
    name?: string;
    position?: 'front' | 'back';
    physicalDevices?: PhysicalCameraDeviceType[];
    minZoom?: number;
    maxZoom?: number;
    neutralZoom?: number;
  } = {}
): CameraDevice {
  return {
    id: options.id ?? 'mock-camera-0',
    name: options.name ?? 'Mock Camera',
    position: options.position ?? 'back',
    physicalDevices: options.physicalDevices ?? ['wide-angle-camera'],
    minZoom: options.minZoom ?? 1,
    maxZoom: options.maxZoom ?? 10,
    neutralZoom: options.neutralZoom ?? 1,
    hasFlash: true,
    hasTorch: true,
  } as CameraDevice;
}

describe('lensDetection utilities', () => {
  describe('detectLenses', () => {
    describe('with no device', () => {
      it('should return default lenses when device is undefined', () => {
        const lenses = detectLenses(undefined, 'back', 1);

        expect(lenses).toHaveLength(5);
        expect(lenses.map(l => l.id)).toEqual([
          'selfie', 'ultra-wide', 'wide', 'telephoto-3x', 'telephoto-10x'
        ]);
      });

      it('should mark selfie as active for front camera with no device', () => {
        const lenses = detectLenses(undefined, 'front', 1);

        const selfie = lenses.find(l => l.id === 'selfie');
        expect(selfie?.isActive).toBe(true);
      });
    });

    describe('with basic device (wide-angle only)', () => {
      it('should include selfie and wide lenses', () => {
        const device = createMockDevice({
          physicalDevices: ['wide-angle-camera'],
          maxZoom: 8,
        });

        const lenses = detectLenses(device, 'back', 1);

        expect(lenses.some(l => l.id === 'selfie')).toBe(true);
        expect(lenses.some(l => l.id === 'wide')).toBe(true);
      });

      it('should add digital 2x when maxZoom >= 2 and no telephoto', () => {
        const device = createMockDevice({
          physicalDevices: ['wide-angle-camera'],
          maxZoom: 8,
        });

        const lenses = detectLenses(device, 'back', 1);

        expect(lenses.some(l => l.id === 'digital-2x')).toBe(true);
      });
    });

    describe('with ultra-wide camera', () => {
      it('should detect ultra-wide when minZoom < 1', () => {
        const device = createMockDevice({
          physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera'],
          minZoom: 0.5,
          maxZoom: 10,
        });

        const lenses = detectLenses(device, 'back', 1);

        const ultraWide = lenses.find(l => l.id === 'ultra-wide');
        expect(ultraWide).toBeDefined();
        expect(ultraWide?.zoom).toBe(0.5);
        expect(ultraWide?.label).toBe('.5');
      });

      it('should not add ultra-wide if minZoom is 1 or greater', () => {
        const device = createMockDevice({
          physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera'],
          minZoom: 1,
          maxZoom: 10,
        });

        const lenses = detectLenses(device, 'back', 1);

        expect(lenses.some(l => l.id === 'ultra-wide')).toBe(false);
      });
    });

    describe('with telephoto cameras', () => {
      it('should detect single 2x telephoto (maxZoom < 15)', () => {
        const device = createMockDevice({
          physicalDevices: ['wide-angle-camera', 'telephoto-camera'],
          minZoom: 1,
          maxZoom: 10,
        });

        const lenses = detectLenses(device, 'back', 1);

        const telephoto = lenses.find(l => l.id === 'telephoto-1');
        expect(telephoto).toBeDefined();
        expect(telephoto?.zoom).toBe(2);
      });

      it('should detect single 3x telephoto (maxZoom >= 15)', () => {
        const device = createMockDevice({
          physicalDevices: ['wide-angle-camera', 'telephoto-camera'],
          minZoom: 1,
          maxZoom: 20,
        });

        const lenses = detectLenses(device, 'back', 1);

        const telephoto = lenses.find(l => l.id === 'telephoto-1');
        expect(telephoto).toBeDefined();
        expect(telephoto?.zoom).toBe(3);
      });

      it('should detect single 5x telephoto (maxZoom >= 50)', () => {
        const device = createMockDevice({
          physicalDevices: ['wide-angle-camera', 'telephoto-camera'],
          minZoom: 1,
          maxZoom: 60,
        });

        const lenses = detectLenses(device, 'back', 1);

        const telephoto = lenses.find(l => l.id === 'telephoto-1');
        expect(telephoto).toBeDefined();
        expect(telephoto?.zoom).toBe(5);
      });

      it('should detect single 5x telephoto for high maxZoom with de-duplicated telephoto (Samsung S23 Ultra style)', () => {
        // physicalDevices are de-duplicated, so duplicate 'telephoto-camera' entries
        // collapse to a single telephoto with zoom estimated from maxZoom
        const device = createMockDevice({
          physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera', 'telephoto-camera'],
          minZoom: 0.5,
          maxZoom: 100,
        });

        const lenses = detectLenses(device, 'back', 1);

        const tele1 = lenses.find(l => l.id === 'telephoto-1');
        const tele2 = lenses.find(l => l.id === 'telephoto-2');

        expect(tele1?.zoom).toBe(5);
        expect(tele2).toBeUndefined();
      });

      it('should detect single 5x telephoto for moderate maxZoom with de-duplicated telephoto', () => {
        // physicalDevices are de-duplicated, so duplicate 'telephoto-camera' entries
        // collapse to a single telephoto with zoom estimated from maxZoom
        const device = createMockDevice({
          physicalDevices: ['wide-angle-camera', 'telephoto-camera', 'telephoto-camera'],
          minZoom: 1,
          maxZoom: 50,
        });

        const lenses = detectLenses(device, 'back', 1);

        const tele1 = lenses.find(l => l.id === 'telephoto-1');
        const tele2 = lenses.find(l => l.id === 'telephoto-2');

        expect(tele1?.zoom).toBe(5);
        expect(tele2).toBeUndefined();
      });
    });

    describe('active lens detection', () => {
      it('should mark correct lens as active based on currentZoom', () => {
        const device = createMockDevice({
          physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera'],
          minZoom: 0.5,
          maxZoom: 10,
        });

        // Test at ultra-wide zoom
        let lenses = detectLenses(device, 'back', 0.5);
        expect(lenses.find(l => l.id === 'ultra-wide')?.isActive).toBe(true);
        expect(lenses.find(l => l.id === 'wide')?.isActive).toBe(false);

        // Test at wide zoom
        lenses = detectLenses(device, 'back', 1);
        expect(lenses.find(l => l.id === 'ultra-wide')?.isActive).toBe(false);
        expect(lenses.find(l => l.id === 'wide')?.isActive).toBe(true);
      });

      it('should use tolerance for zoom matching', () => {
        const device = createMockDevice({
          physicalDevices: ['wide-angle-camera'],
          maxZoom: 10,
        });

        // Zoom close to 1 should still mark wide as active
        const lenses = detectLenses(device, 'back', 1.05);
        expect(lenses.find(l => l.id === 'wide')?.isActive).toBe(true);
      });

      it('should mark closest lens as active when at custom zoom', () => {
        const device = createMockDevice({
          physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera'],
          minZoom: 0.5,
          maxZoom: 10,
        });

        // At 1.5x, closest to wide (1x) not telephoto (2x)
        const lenses = detectLenses(device, 'back', 1.5);

        // Should mark closest one (wide at 1x is closer to 1.5 than telephoto at 2x)
        const hasActive = lenses.some(l => l.isActive && l.id !== 'selfie');
        expect(hasActive).toBe(true);
      });

      it('should mark selfie as active for front camera', () => {
        const device = createMockDevice({
          position: 'front',
          physicalDevices: ['wide-angle-camera'],
        });

        const lenses = detectLenses(device, 'front', 1);

        expect(lenses.find(l => l.id === 'selfie')?.isActive).toBe(true);
        // Back camera lenses should not be marked active
        expect(lenses.find(l => l.id === 'wide')?.isActive).toBe(false);
      });
    });
  });

  describe('updateActiveLens', () => {
    it('should update active state based on zoom', () => {
      const lenses: LensInfo[] = [
        { id: 'selfie', label: 'S', zoom: 1, isActive: false },
        { id: 'ultra-wide', label: '.5', zoom: 0.5, isActive: true },
        { id: 'wide', label: '1', zoom: 1, isActive: false },
        { id: 'telephoto', label: '3', zoom: 3, isActive: false },
      ];

      const updated = updateActiveLens(lenses, 3);

      expect(updated.find(l => l.id === 'ultra-wide')?.isActive).toBe(false);
      expect(updated.find(l => l.id === 'telephoto')?.isActive).toBe(true);
    });

    it('should not mutate original array', () => {
      const lenses: LensInfo[] = [
        { id: 'wide', label: '1', zoom: 1, isActive: true },
      ];

      const updated = updateActiveLens(lenses, 2);

      expect(lenses[0].isActive).toBe(true);  // Original unchanged
      expect(updated[0].isActive).toBe(false);  // Updated copy
    });

    it('should mark multiple lenses if zoom matches exactly', () => {
      const lenses: LensInfo[] = [
        { id: 'selfie', label: 'S', zoom: 1, isActive: false },
        { id: 'wide', label: '1', zoom: 1, isActive: false },
      ];

      const updated = updateActiveLens(lenses, 1);

      // Both have zoom 1, so both should be active
      expect(updated.filter(l => l.isActive)).toHaveLength(2);
    });
  });

  describe('zoom label formatting', () => {
    it('should format ultra-wide zoom correctly', () => {
      const device = createMockDevice({
        physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera'],
        minZoom: 0.6,
        maxZoom: 10,
      });

      const lenses = detectLenses(device, 'back', 1);
      const ultraWide = lenses.find(l => l.id === 'ultra-wide');

      expect(ultraWide?.label).toBe('.6');
    });

    it('should format integer zooms without decimal', () => {
      const device = createMockDevice({
        physicalDevices: ['wide-angle-camera', 'telephoto-camera'],
        minZoom: 1,
        maxZoom: 10,
      });

      const lenses = detectLenses(device, 'back', 1);

      expect(lenses.find(l => l.id === 'wide')?.label).toBe('1');
      expect(lenses.find(l => l.id === 'telephoto-1')?.label).toBe('2');
    });
  });
});
