import { determineStreamMode } from '../../utils/streamMode';
import { DEFAULT_SETTINGS } from '../../types';

describe('determineStreamMode', () => {
  describe("previewMode 'auto'", () => {
    it('streams the front camera over webrtc', () => {
      expect(determineStreamMode('front', 1, 'auto')).toBe('webrtc');
    });

    it('streams the front camera over webrtc whatever the zoom reads', () => {
      // The front camera has no zoom, but nothing stops a stale value arriving.
      expect(determineStreamMode('front', 3, 'auto')).toBe('webrtc');
    });

    it('streams the back camera over webrtc at 1x', () => {
      expect(determineStreamMode('back', 1, 'auto')).toBe('webrtc');
    });

    it('falls back to frames for a zoomed back camera', () => {
      // getUserMedia can't capture vision-camera's zoomed preview.
      expect(determineStreamMode('back', 2, 'auto')).toBe('frame-based');
    });

    it('falls back to frames for an ultra-wide back camera', () => {
      expect(determineStreamMode('back', 0.5, 'auto')).toBe('frame-based');
    });

    it('treats zoom within tolerance of 1x as webrtc', () => {
      expect(determineStreamMode('back', 1.02, 'auto')).toBe('webrtc');
      expect(determineStreamMode('back', 0.98, 'auto')).toBe('webrtc');
    });

    it('treats zoom outside tolerance of 1x as frames', () => {
      expect(determineStreamMode('back', 1.1, 'auto')).toBe('frame-based');
      expect(determineStreamMode('back', 0.9, 'auto')).toBe('frame-based');
    });
  });

  describe("previewMode 'frames'", () => {
    // The point of the setting is that the lens is never handed to WebRTC, so
    // no camera state may talk it into a handoff.
    it.each([
      ['front', 1],
      ['front', 3],
      ['back', 1],
      ['back', 0.5],
      ['back', 2],
    ] as const)('stays frame-based for the %s camera at %sx', (facing, zoom) => {
      expect(determineStreamMode(facing, zoom, 'frames')).toBe('frame-based');
    });
  });

  it('defaults to the mode that never hands over the lens', () => {
    // Guards the deliberate default in DEFAULT_SETTINGS: shipping 'auto' would
    // put the camera clicking and the handoff contention errors back.
    expect(DEFAULT_SETTINGS.previewMode).toBe('frames');
    expect(determineStreamMode('back', 1, DEFAULT_SETTINGS.previewMode)).toBe('frame-based');
  });
});
