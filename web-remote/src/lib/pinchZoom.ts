import { useEffect, useRef, useState, type RefObject } from 'react';

/** A pinch's zoom: `current` scaled by the fingers' spread, kept to the range. */
export const pinchedZoom = (current: number, scale: number, min: number, max: number) =>
  Math.min(max, Math.max(min, current * scale));

/** 0.5 → "0.5", 1 → "1", 2.34 → "2.3", as the app's Lenses.formatZoom. */
export const formatZoom = (zoom: number) => zoom.toFixed(1).replace(/\.0$/, '');

interface PinchZoomOptions {
  enabled: boolean;
  zoom: number;
  min: number;
  max: number;
  onZoom: (zoom: number) => void;
  onEnd: () => void;
}

/**
 * Two-finger pinch on `target`, from `zoom` at the start of the gesture.
 * One finger is left alone, so taps on the controls work as before. The
 * element needs `touch-action: none`, or the browser takes the pinch.
 *
 * Returns the zoom being asked for while pinching, else null.
 */
export function usePinchZoom(target: RefObject<HTMLElement | null>, options: PinchZoomOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [pinchZoom, setPinchZoom] = useState<number | null>(null);

  useEffect(() => {
    const element = target.current;
    if (!element) {
      return;
    }
    const pointers = new Map<number, { x: number; y: number }>();
    let lastSpread: number | null = null;
    let zoom: number | null = null;

    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const end = () => {
      lastSpread = null;
      if (zoom !== null) {
        zoom = null;
        setPinchZoom(null);
        latest.current.onEnd();
      }
    };

    const onDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2 && latest.current.enabled) {
        lastSpread = spread();
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) {
        return;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size !== 2 || lastSpread === null || !latest.current.enabled) {
        return;
      }
      const now = spread();
      if (lastSpread <= 0 || now <= 0) {
        return;
      }
      const { min, max } = latest.current;
      const from = zoom ?? latest.current.zoom;
      const to = pinchedZoom(from, now / lastSpread, min, max);
      lastSpread = now;
      if (to !== from || zoom === null) {
        zoom = to;
        setPinchZoom(to);
        latest.current.onZoom(to);
      }
      event.preventDefault();
    };

    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) {
        end();
      }
    };

    // iOS Safari zooms the page on its own gesture events, whatever touch-action says.
    const blockGesture = (event: Event) => event.preventDefault();

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('gesturestart', blockGesture);
    element.addEventListener('gesturechange', blockGesture);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('gesturestart', blockGesture);
      element.removeEventListener('gesturechange', blockGesture);
    };
  }, [target]);

  return pinchZoom;
}
