import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Text,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraState, CaptureMode, LensInfo } from '../types';

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
  // New props for redesigned UI
  lastPhotoUri?: string;
  onOpenGallery?: () => void;
  onSettingsPress?: () => void;
  onQRPress?: () => void;
  onModeToggle?: () => void;
  onLensSelect?: (zoom: number) => void;
  availableLenses?: LensInfo[];
  currentMode?: 'camera' | 'remote';
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
  lastPhotoUri,
  onOpenGallery,
  onSettingsPress,
  onQRPress,
  onModeToggle,
  onLensSelect,
  availableLenses = [],
  currentMode = 'camera',
}: CameraControlsProps) {
  const insets = useSafeAreaInsets();
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

  const handleLensPress = (lens: LensInfo) => {
    if (disabled) return;

    // Handle selfie camera switch
    if (lens.id === 'selfie') {
      // Only switch if not already on front camera
      if (facing !== 'front') {
        onSwitchCamera();
      }
      return;
    }

    // Handle back camera lens selection
    // If on front camera, switch to back camera first
    if (facing === 'front') {
      onSwitchCamera();
    }

    // Set zoom level
    if (onLensSelect) {
      onLensSelect(lens.zoom);
    } else {
      onZoomChange(lens.zoom);
    }
  };

  return (
    <View style={styles.container}>
      {/* Bottom controls section */}
      <View style={[styles.bottomSection, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
        {/* Row 1: Photo/Video Toggle */}
        <View style={styles.modeToggleRow}>
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
        </View>

        {/* Row 2: Thumbnail | Shutter | Mode Toggle */}
        <View style={styles.mainControlsRow}>
          {/* Thumbnail / Gallery */}
          <TouchableOpacity
            style={styles.thumbnailButton}
            onPress={onOpenGallery}
            disabled={disabled || !onOpenGallery}
          >
            {lastPhotoUri ? (
              <Image source={{ uri: lastPhotoUri }} style={styles.thumbnailImage} />
            ) : (
              <View style={styles.thumbnailPlaceholder}>
                <Text style={styles.thumbnailPlaceholderText}>📷</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Shutter Button */}
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

          {/* Camera/Remote Mode Toggle */}
          <TouchableOpacity
            style={styles.modeToggleButton}
            onPress={onModeToggle}
            disabled={disabled || !onModeToggle}
          >
            <View style={styles.toggleSwitch}>
              <View
                style={[
                  styles.toggleIndicator,
                  currentMode === 'remote' && styles.toggleIndicatorRight,
                ]}
              />
              <Text
                style={[
                  styles.toggleText,
                  styles.toggleTextLeft,
                  currentMode === 'camera' && styles.toggleTextActive,
                ]}
              >
                📷
              </Text>
              <Text
                style={[
                  styles.toggleText,
                  styles.toggleTextRight,
                  currentMode === 'remote' && styles.toggleTextActive,
                ]}
              >
                📱
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Row 3: Settings | Lens Selector | QR Button */}
        <View style={styles.bottomRow}>
          {/* Settings Button */}
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={onSettingsPress}
            disabled={disabled || !onSettingsPress}
          >
            <Text style={styles.settingsButtonText}>⚙️</Text>
          </TouchableOpacity>

          {/* Lens Selector */}
          <View style={styles.lensSelector}>
            {availableLenses.length > 0 ? (
              availableLenses.map((lens) => (
                <TouchableOpacity
                  key={lens.id}
                  style={[
                    styles.lensButton,
                    lens.isActive && styles.lensButtonActive,
                  ]}
                  onPress={() => handleLensPress(lens)}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      styles.lensButtonText,
                      lens.isActive && styles.lensButtonTextActive,
                    ]}
                  >
                    {lens.label}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              // Fallback: show current zoom
              <View style={styles.zoomDisplay}>
                <Text style={styles.zoomDisplayText}>{zoom.toFixed(1)}x</Text>
              </View>
            )}
          </View>

          {/* QR Code Button */}
          <TouchableOpacity
            style={styles.qrButton}
            onPress={onQRPress}
            disabled={disabled || !onQRPress}
          >
            <Text style={styles.qrButtonText}>
              {currentMode === 'camera' ? '⊞' : '📷'}
            </Text>
          </TouchableOpacity>
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
    justifyContent: 'flex-end',
  },
  bottomSection: {
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingTop: 20,
    // paddingBottom is set dynamically based on safe area insets
  },
  // Row 1: Photo/Video Toggle
  modeToggleRow: {
    alignItems: 'center',
    marginBottom: 20,
  },
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    padding: 4,
  },
  modeButton: {
    paddingHorizontal: 24,
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
  // Row 2: Main Controls
  mainControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  // Thumbnail
  thumbnailButton: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailPlaceholderText: {
    fontSize: 20,
    opacity: 0.5,
  },
  // Shutter Button
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
  // Mode Toggle (Camera/Remote)
  modeToggleButton: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleSwitch: {
    width: 56,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    position: 'relative',
  },
  toggleIndicator: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fff',
    left: 2,
  },
  toggleIndicatorRight: {
    left: 28,
  },
  toggleText: {
    fontSize: 14,
    zIndex: 1,
  },
  toggleTextLeft: {
    marginLeft: 4,
  },
  toggleTextRight: {
    marginRight: 4,
  },
  toggleTextActive: {
    opacity: 0.3,
  },
  // Row 3: Bottom Row
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Settings Button
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsButtonText: {
    fontSize: 20,
  },
  // Lens Selector
  lensSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    padding: 4,
  },
  lensButton: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    marginHorizontal: 2,
  },
  lensButtonActive: {
    backgroundColor: 'rgba(255, 204, 0, 0.9)',
  },
  lensButtonText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  lensButtonTextActive: {
    color: '#000',
  },
  zoomDisplay: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  zoomDisplayText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  // QR Button
  qrButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrButtonText: {
    fontSize: 20,
  },
});

export default CameraControls;
