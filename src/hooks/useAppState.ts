import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Tracks whether the app is in the foreground, and fires a callback on every
 * background -> foreground transition.
 *
 * Turning the screen off backgrounds the app, and that is not a state either
 * device recovers from on its own: Android takes the camera away (every
 * getUserMedia track ends and vision-camera's session is torn down), and once
 * ICE consent checks stop being answered both peer connections drop. Screens
 * that hold a pairing hang their recovery off this hook.
 */
export function useAppState(onForeground?: () => void): boolean {
  const [isForeground, setIsForeground] = useState(
    AppState.currentState === 'active'
  );

  // Kept in a ref so a caller passing an inline callback doesn't re-subscribe
  // on every render.
  const onForegroundRef = useRef(onForeground);
  useEffect(() => {
    onForegroundRef.current = onForeground;
  }, [onForeground]);

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;

    const subscription = AppState.addEventListener('change', (next) => {
      const wasBackgrounded = previous !== 'active';
      previous = next;
      setIsForeground(next === 'active');

      if (next === 'active' && wasBackgrounded) {
        onForegroundRef.current?.();
      }
    });

    return () => subscription.remove();
  }, []);

  return isForeground;
}

export default useAppState;
