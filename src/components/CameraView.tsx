import React, { useRef, useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  PhotoFile,
  VideoFile,
  ReadonlyFrameProcessor,
} from 'react-native-vision-camera';
import { CameraControls } from './CameraControls';
import { cameraService } from '../services/CameraService';
import { mediaService } from '../services/MediaService';
import { CameraState, FlashMode, CaptureMode } from '../types';

interface CameraViewProps {
  onPhotoTaken?: (photo: PhotoFile) => void;
  onVideoRecorded?: (video: VideoFile) => void;
  onStateChange?: (state: CameraState) => void;
  externalState?: CameraState;
  controlsDisabled?: boolean;
  showControls?: boolean;
  frameProcessor?: ReadonlyFrameProcessor;
}

export function CameraView({
  onPhotoTaken,
  onVideoRecorded,
  onStateChange,
  externalState,
  controlsDisabled = false,
  showControls = true,
  frameProcessor,
}: CameraViewProps) {
  const cameraRef = useRef<Camera>(null);
  const { hasPermission: hasCameraPermission } = useCameraPermission();
  const { hasPermission: hasMicPermission } = useMicrophonePermission();

  const [cameraState, setCameraState] = useState<CameraState>(
    externalState || cameraService.getState()
  );

  // Request a multi-camera device that includes all physical lenses
  // This enables optical zoom switching between ultra-wide, wide, and telephoto
  const device = useCameraDevice(cameraState.facing, {
    physicalDevices: [
      'ultra-wide-angle-camera',
      'wide-angle-camera',
      'telephoto-camera',
    ],
  });

  // Sync with external state if provided
  useEffect(() => {
    if (externalState) {
      setCameraState(externalState);
    }
  }, [externalState]);

  // Set camera ref in service
  useEffect(() => {
    if (cameraRef.current) {
      cameraService.setCameraRef(cameraRef.current);
    }
  }, []);

  // Notify parent of state changes
  const updateState = useCallback(
    (updates: Partial<CameraState>) => {
      const newState = { ...cameraState, ...updates };
      setCameraState(newState);
      onStateChange?.(newState);
    },
    [cameraState, onStateChange]
  );

  const handleTakePhoto = useCallback(async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePhoto({
        flash: cameraState.flash === 'auto' ? 'on' : cameraState.flash,
        enableShutterSound: false,
      });

      // Save to gallery
      await mediaService.savePhotoToGallery(photo);

      onPhotoTaken?.(photo);
    } catch (error) {
      console.error('Error taking photo:', error);
    }
  }, [cameraState.flash, onPhotoTaken]);

  const handleStartRecording = useCallback(async () => {
    if (!cameraRef.current || cameraState.isRecording) return;

    updateState({ isRecording: true });

    cameraRef.current.startRecording({
      flash: cameraState.flash === 'auto' ? 'on' : cameraState.flash,
      onRecordingFinished: async (video) => {
        updateState({ isRecording: false });

        // Save to gallery
        await mediaService.saveVideoToGallery(video);

        onVideoRecorded?.(video);
      },
      onRecordingError: (error) => {
        updateState({ isRecording: false });
        console.error('Recording error:', error);
      },
    });
  }, [cameraState.flash, cameraState.isRecording, onVideoRecorded, updateState]);

  const handleStopRecording = useCallback(async () => {
    if (!cameraRef.current || !cameraState.isRecording) return;

    await cameraRef.current.stopRecording();
  }, [cameraState.isRecording]);

  const handleToggleFlash = useCallback(() => {
    const modes: FlashMode[] = ['off', 'on', 'auto'];
    const currentIndex = modes.indexOf(cameraState.flash);
    const nextIndex = (currentIndex + 1) % modes.length;
    updateState({ flash: modes[nextIndex] });
  }, [cameraState.flash, updateState]);

  const handleSwitchCamera = useCallback(() => {
    updateState({
      facing: cameraState.facing === 'back' ? 'front' : 'back',
    });
  }, [cameraState.facing, updateState]);

  const handleZoomChange = useCallback(
    (zoom: number) => {
      updateState({ zoom: Math.max(0.5, Math.min(10, zoom)) });
    },
    [updateState]
  );

  const handleCaptureModeChange = useCallback(
    (mode: CaptureMode) => {
      updateState({ captureMode: mode });
    },
    [updateState]
  );

  if (!hasCameraPermission || !hasMicPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          Camera and microphone permissions are required
        </Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.loadingText}>Loading camera...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        video={true}
        audio={true}
        zoom={cameraState.zoom}
        enableZoomGesture={true}
        frameProcessor={frameProcessor}
      />

      {showControls && (
        <CameraControls
          cameraState={cameraState}
          onTakePhoto={handleTakePhoto}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onToggleFlash={handleToggleFlash}
          onSwitchCamera={handleSwitchCamera}
          onZoomChange={handleZoomChange}
          onCaptureModeChange={handleCaptureModeChange}
          disabled={controlsDisabled}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 20,
  },
  permissionText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
  },
});

export default CameraView;
