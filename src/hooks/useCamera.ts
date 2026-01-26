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

  // Set zoom level (1-10)
  const setZoom = useCallback((zoom: number) => {
    const clampedZoom = Math.max(1, Math.min(10, zoom));
    updateState({ zoom: clampedZoom });
  }, [updateState]);

  // Set flash mode
  const setFlash = useCallback((flash: FlashMode) => {
    updateState({ flash });
  }, [updateState]);

  // Toggle flash through modes
  const toggleFlash = useCallback(() => {
    const modes: FlashMode[] = ['off', 'on', 'auto'];
    const currentIndex = modes.indexOf(state.flash);
    const nextIndex = (currentIndex + 1) % modes.length;
    updateState({ flash: modes[nextIndex] });
  }, [state.flash, updateState]);

  // Set camera facing
  const setFacing = useCallback((facing: CameraFacing) => {
    updateState({ facing });
  }, [updateState]);

  // Switch camera between front and back
  const switchCamera = useCallback(() => {
    updateState({
      facing: state.facing === 'back' ? 'front' : 'back',
    });
  }, [state.facing, updateState]);

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
        enableShutterSound: true,
      });

      // Save to gallery
      await mediaService.savePhotoToGallery(photo);

      return photo;
    } catch (error) {
      console.error('Error taking photo:', error);
      throw error;
    }
  }, [state.flash]);

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
    startRecording,
    stopRecording,
    reset,
    setFullState,
    updateState,
  };
}

export default useCamera;
