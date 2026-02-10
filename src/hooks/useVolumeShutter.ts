import { useEffect, useRef } from 'react';
import { VolumeManager } from 'react-native-volume-manager';
import { useSettings } from './useSettings';

interface UseVolumeShutterOptions {
  onShutterPress: () => void;
  enabled: boolean;
}

export function useVolumeShutter({ onShutterPress, enabled }: UseVolumeShutterOptions) {
  const { settings } = useSettings();
  const onShutterPressRef = useRef(onShutterPress);
  const lastPressRef = useRef(0);

  // Keep callback ref up to date to avoid stale closures
  useEffect(() => {
    onShutterPressRef.current = onShutterPress;
  }, [onShutterPress]);

  useEffect(() => {
    if (!enabled || !settings.volumeShutter) return;

    // Suppress system volume UI while active
    VolumeManager.showNativeVolumeUI({ enabled: false });

    const listener = VolumeManager.addVolumeListener((result) => {
      const now = Date.now();
      if (now - lastPressRef.current < 500) return; // debounce
      lastPressRef.current = now;
      onShutterPressRef.current();
    });

    return () => {
      listener.remove();
      VolumeManager.showNativeVolumeUI({ enabled: true });
    };
  }, [enabled, settings.volumeShutter]);
}
