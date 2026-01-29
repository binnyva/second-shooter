import { useState, useEffect, useCallback } from 'react';
import { settingsService } from '../services/SettingsService';
import { AppSettings, DEFAULT_SETTINGS } from '../types';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const loadInitialSettings = async () => {
      const loadedSettings = await settingsService.loadSettings();
      setSettings(loadedSettings);
      setIsLoaded(true);
    };
    loadInitialSettings();
  }, []);

  // Subscribe to settings changes
  useEffect(() => {
    const unsubscribe = settingsService.subscribe((newSettings) => {
      setSettings(newSettings);
    });
    return unsubscribe;
  }, []);

  // Memoized update function
  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(
      key: K,
      value: AppSettings[K]
    ): Promise<void> => {
      await settingsService.updateSetting(key, value);
    },
    []
  );

  // Memoized batch update function
  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>): Promise<void> => {
      await settingsService.updateSettings(updates);
    },
    []
  );

  // Memoized reset function
  const resetSettings = useCallback(async (): Promise<void> => {
    await settingsService.resetSettings();
  }, []);

  return {
    settings,
    isLoaded,
    updateSetting,
    updateSettings,
    resetSettings,
  };
}

export default useSettings;
