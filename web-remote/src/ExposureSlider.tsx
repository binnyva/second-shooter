import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ExposureInfo } from '@shared/protocol';

/** The slider hides itself this long after the last touch. */
const HIDE_AFTER_MS = 3000;
const TRACK_HEIGHT = 200;
const THUMB_SIZE = 36;

/** 0 → "0", 0.6667 → "+0.7", -1 → "-1", as the app's formatEv. */
export const formatEv = (ev: number) => {
  if (Math.abs(ev) < 0.05) {
    return '0';
  }
  return (ev > 0 ? '+' : '-') + Math.abs(ev).toFixed(1).replace(/\.0$/, '');
};

const snap = (ev: number, info: ExposureInfo) =>
  Math.min(info.max, Math.max(info.min, Math.round(ev / info.step) * info.step));

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <path
        fill="currentColor"
        d="M12 9c1.65 0 3 1.35 3 3s-1.35 3-3 3-3-1.35-3-3 1.35-3 3-3m0-2c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"
      />
    </svg>
  );
}

interface ExposureSliderProps {
  info: ExposureInfo;
  /** Bumped by each tap on the viewfinder: shows the slider, or hides it if shown. */
  toggleCount: number;
  onChange: (ev: number) => void;
  onEnd: () => void;
}

/**
 * The app's exposure slider: hidden until the viewfinder is tapped, a sun for
 * a thumb, drag up to brighten, tap the value for 0. Hides after a few
 * seconds without a touch.
 */
export function ExposureSlider({ info, toggleCount, onChange, onEnd }: ExposureSliderProps) {
  const [visible, setVisible] = useState(false);
  const [lastTouch, setLastTouch] = useState(0);
  const [dragEv, setDragEv] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startEv: number } | null>(null);
  // Only taps after mounting count (it remounts on reconnecting).
  const seenToggles = useRef(toggleCount);

  useEffect(() => {
    if (toggleCount !== seenToggles.current) {
      seenToggles.current = toggleCount;
      setVisible((shown) => !shown);
      setLastTouch((n) => n + 1);
    }
  }, [toggleCount]);

  useEffect(() => {
    if (!visible || dragEv !== null) {
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [visible, lastTouch, dragEv]);

  if (!visible || info.max <= info.min || info.step <= 0) {
    return null;
  }

  const shown = dragEv ?? info.ev;
  const travel = TRACK_HEIGHT - THUMB_SIZE;
  const fraction = (info.max - Math.min(info.max, Math.max(info.min, shown))) / (info.max - info.min);
  const zeroTop = THUMB_SIZE / 2 + (info.max / (info.max - info.min)) * travel;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    try {
      // Keeps the drag going when the finger slides off the track.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser doesn't know (a synthetic one) can't be captured.
    }
    drag.current = { startY: event.clientY, startEv: info.ev };
    setDragEv(info.ev);
    setLastTouch((n) => n + 1);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) {
      return;
    }
    const raw = start.startEv - ((event.clientY - start.startY) / travel) * (info.max - info.min);
    const next = Math.min(info.max, Math.max(info.min, raw));
    if (snap(next, info) !== snap(dragEv ?? start.startEv, info)) {
      onChange(snap(next, info));
    }
    setDragEv(next);
  };

  const onPointerUp = () => {
    if (!drag.current) {
      return;
    }
    drag.current = null;
    setDragEv(null);
    setLastTouch((n) => n + 1);
    onEnd();
  };

  const reset = () => {
    setLastTouch((n) => n + 1);
    onChange(0);
    onEnd();
  };

  return (
    <div className="exposure-slider" onClick={(event) => event.stopPropagation()}>
      <div
        className="exposure-track"
        style={{ height: TRACK_HEIGHT }}
        role="slider"
        aria-label="Exposure"
        aria-valuemin={info.min}
        aria-valuemax={info.max}
        aria-valuenow={snap(shown, info)}
        aria-valuetext={formatEv(snap(shown, info))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="exposure-line" />
        <span className="exposure-zero" style={{ top: zeroTop }} />
        <span className="exposure-thumb" style={{ top: fraction * travel }}>
          <SunIcon />
        </span>
      </div>
      <button
        type="button"
        className="exposure-value"
        onClick={reset}
        aria-label="Reset exposure to 0"
      >
        {formatEv(snap(shown, info))}
      </button>
    </div>
  );
}
