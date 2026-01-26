import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Text,
  Dimensions,
} from 'react-native';
import { CameraState, FlashMode, CaptureMode } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface CameraControlsProps {
  cameraState: CameraState;
  onTakePhoto: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onToggleFlash: () => void;
  onSwitchCamera: () => void;
  onZoomChange: (zoom: number) => void;
  onCaptureModeChange: (mode: CaptureMode) => void;
  disabled?: boolean;
}

export function CameraControls({
  cameraState,
  onTakePhoto,
  onStartRecording,
  onStopRecording,
  onToggleFlash,
  onSwitchCamera,
  onZoomChange,
  onCaptureModeChange,
  disabled = false,
}: CameraControlsProps) {
  const { flash, captureMode, isRecording, zoom, facing } = cameraState;

  const handleShutterPress = () => {
    if (disabled) return;

    if (captureMode === 'photo') {
      onTakePhoto();
    } else {
      if (isRecording) {
        onStopRecording();
      } else {
        onStartRecording();
      }
    }
  };

  const cycleFlash = () => {
    if (disabled) return;
    const modes: FlashMode[] = ['off', 'on', 'auto'];
    const currentIndex = modes.indexOf(flash);
    const nextIndex = (currentIndex + 1) % modes.length;
    onToggleFlash();
  };

  const getFlashIcon = (): string => {
    switch (flash) {
      case 'on':
        return '⚡';
      case 'auto':
        return '⚡A';
      default:
        return '⚡✗';
    }
  };

  const handleZoomIn = () => {
    if (disabled) return;
    onZoomChange(Math.min(zoom + 0.5, 10));
  };

  const handleZoomOut = () => {
    if (disabled) return;
    onZoomChange(Math.max(zoom - 0.5, 1));
  };

  return (
    <View style={styles.container}>
      {/* Top controls */}
      <View style={styles.topControls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={cycleFlash}
          disabled={disabled}
        >
          <Text style={styles.controlButtonText}>{getFlashIcon()}</Text>
        </TouchableOpacity>

        <View style={styles.zoomControls}>
          <TouchableOpacity
            style={styles.zoomButton}
            onPress={handleZoomOut}
            disabled={disabled}
          >
            <Text style={styles.zoomButtonText}>-</Text>
          </TouchableOpacity>
          <Text style={styles.zoomText}>{zoom.toFixed(1)}x</Text>
          <TouchableOpacity
            style={styles.zoomButton}
            onPress={handleZoomIn}
            disabled={disabled}
          >
            <Text style={styles.zoomButtonText}>+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={onSwitchCamera}
          disabled={disabled}
        >
          <Text style={styles.controlButtonText}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomControls}>
        {/* Mode selector */}
        <View style={styles.modeSelector}>
          <TouchableOpacity
            style={[
              styles.modeButton,
              captureMode === 'photo' && styles.modeButtonActive,
            ]}
            onPress={() => onCaptureModeChange('photo')}
            disabled={disabled || isRecording}
          >
            <Text
              style={[
                styles.modeButtonText,
                captureMode === 'photo' && styles.modeButtonTextActive,
              ]}
            >
              Photo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeButton,
              captureMode === 'video' && styles.modeButtonActive,
            ]}
            onPress={() => onCaptureModeChange('video')}
            disabled={disabled || isRecording}
          >
            <Text
              style={[
                styles.modeButtonText,
                captureMode === 'video' && styles.modeButtonTextActive,
              ]}
            >
              Video
            </Text>
          </TouchableOpacity>
        </View>

        {/* Shutter button */}
        <TouchableOpacity
          style={[
            styles.shutterButton,
            captureMode === 'video' && styles.shutterButtonVideo,
            isRecording && styles.shutterButtonRecording,
          ]}
          onPress={handleShutterPress}
          disabled={disabled}
        >
          <View
            style={[
              styles.shutterButtonInner,
              captureMode === 'video' && styles.shutterButtonInnerVideo,
              isRecording && styles.shutterButtonInnerRecording,
            ]}
          />
        </TouchableOpacity>

        {/* Camera facing indicator */}
        <View style={styles.facingIndicator}>
          <Text style={styles.facingText}>
            {facing === 'back' ? 'Rear' : 'Front'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonText: {
    fontSize: 20,
    color: '#fff',
  },
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingHorizontal: 10,
  },
  zoomButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomButtonText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
  },
  zoomText: {
    fontSize: 14,
    color: '#fff',
    marginHorizontal: 8,
    minWidth: 40,
    textAlign: 'center',
  },
  bottomControls: {
    alignItems: 'center',
    paddingBottom: 40,
    paddingTop: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  modeSelector: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    padding: 4,
  },
  modeButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 16,
  },
  modeButtonActive: {
    backgroundColor: '#fff',
  },
  modeButtonText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: '#000',
  },
  shutterButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  shutterButtonVideo: {
    borderColor: '#ff3b30',
  },
  shutterButtonRecording: {
    backgroundColor: 'rgba(255, 59, 48, 0.3)',
  },
  shutterButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },
  shutterButtonInnerVideo: {
    backgroundColor: '#ff3b30',
  },
  shutterButtonInnerRecording: {
    width: 30,
    height: 30,
    borderRadius: 6,
  },
  facingIndicator: {
    marginTop: 16,
  },
  facingText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
});

export default CameraControls;
