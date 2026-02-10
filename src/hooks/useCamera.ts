import { useState, useCallback, useRef, useEffect } from 'react';
import { Camera, PhotoFile, VideoFile } from 'react-native-vision-camera';
import { CameraState, FlashMode, CaptureMode, CameraFacing } from '../types';
import { mediaService } from '../services/MediaService';

const DEFAULT_STATE: CameraState = {
  zoom: 1,
  flash: 'off',
  facing: 'back',
  captureMode: 'photo',
  isRecording: false,
};

export function useCamera(initialState?: Partial<CameraState>) {
  const cameraRef = useRef<Camera>(null);
  const [state, setState] = useState<CameraState>({
    ...DEFAULT_STATE,
    ...initialState,
  });

  // Update individual state properties
  const updateState = useCallback((updates: Partial<CameraState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Set zoom level (0.5-10, supports ultra-wide)
  const setZoom = useCallback((zoom: number) => {
    const clampedZoom = Math.max(0.5, Math.min(10, zoom));
    updateState({ zoom: clampedZoom });
  }, [updateState]);

  // Set flash mode
  const setFlash = useCallback((flash: FlashMode) => {
    updateState({ flash });
  }, [updateState]);

  // Toggle flash through modes
  // Use functional update to avoid stale closure issues
  const toggleFlash = useCallback(() => {
    const modes: FlashMode[] = ['off', 'on', 'auto'];
    setState((prev) => {
      const currentIndex = modes.indexOf(prev.flash);
      const nextIndex = (currentIndex + 1) % modes.length;
      return { ...prev, flash: modes[nextIndex] };
    });
  }, []);

  // Set camera facing
  const setFacing = useCallback((facing: CameraFacing) => {
    updateState({ facing });
  }, [updateState]);

  // Switch camera between front and back
  // Use functional update to avoid stale closure issues
  const switchCamera = useCallback(() => {
    setState((prev) => ({
      ...prev,
      facing: prev.facing === 'back' ? 'front' : 'back',
    }));
  }, []);

  // Set capture mode
  const setCaptureMode = useCallback((captureMode: CaptureMode) => {
    updateState({ captureMode });
  }, [updateState]);

  // Take photo
  const takePhoto = useCallback(async (): Promise<PhotoFile | null> => {
    if (!cameraRef.current) {
      console.error('Camera ref not set');
      return null;
    }

    try {
      const photo = await cameraRef.current.takePhoto({
        flash: state.flash === 'auto' ? 'on' : state.flash,
        enableShutterSound: false,
      });

      // Save to gallery
      await mediaService.savePhotoToGallery(photo);

      return photo;
    } catch (error) {
      throw error;
    }
  }, [state.flash]);

  // Take a quick snapshot for preview streaming (doesn't save to gallery)
  const takeSnapshot = useCallback(async (): Promise<string | null> => {
    if (!cameraRef.current) {
      return null;
    }

    try {
      const snapshot = await cameraRef.current.takeSnapshot({
        quality: 50, // Lower quality for faster streaming
      });
      return snapshot.path;
    } catch {
      return null;
    }
  }, []);

  // Start video recording
  const startRecording = useCallback(async (
    onFinished?: (video: VideoFile) => void,
    onError?: (error: unknown) => void
  ): Promise<void> => {
    if (!cameraRef.current) {
      console.error('Camera ref not set');
      return;
    }

    if (state.isRecording) {
      console.warn('Already recording');
      return;
    }

    updateState({ isRecording: true });

    cameraRef.current.startRecording({
      flash: state.flash === 'auto' ? 'on' : state.flash,
      onRecordingFinished: async (video) => {
        updateState({ isRecording: false });

        // Save to gallery
        await mediaService.saveVideoToGallery(video);

        onFinished?.(video);
      },
      onRecordingError: (error) => {
        updateState({ isRecording: false });
        console.error('Recording error:', error);
        onError?.(error);
      },
    });
  }, [state.flash, state.isRecording, updateState]);

  // Stop video recording
  const stopRecording = useCallback(async (): Promise<void> => {
    if (!cameraRef.current) {
      console.error('Camera ref not set');
      return;
    }

    if (!state.isRecording) {
      console.warn('Not recording');
      return;
    }

    try {
      await cameraRef.current.stopRecording();
    } catch (error) {
      console.error('Error stopping recording:', error);
      throw error;
    }
  }, [state.isRecording]);

  // Reset state to defaults
  const reset = useCallback(() => {
    setState({ ...DEFAULT_STATE, ...initialState });
  }, [initialState]);

  // Set full state (for external control)
  const setFullState = useCallback((newState: CameraState) => {
    setState(newState);
  }, []);

  return {
    cameraRef,
    state,
    setZoom,
    setFlash,
    toggleFlash,
    setFacing,
    switchCamera,
    setCaptureMode,
    takePhoto,
    takeSnapshot,
    startRecording,
    stopRecording,
    reset,
    setFullState,
    updateState,
  };
}

export default useCamera;
