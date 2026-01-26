import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { CameraControls } from '../src/components/CameraControls';
import { CameraState, LensInfo } from '../src/types';

// Mock data for UI testing
const MOCK_LENSES: LensInfo[] = [
  { id: 'ultra-wide', label: '.6', zoom: 0.6, isActive: false },
  { id: 'wide', label: '1', zoom: 1, isActive: true },
  { id: 'telephoto-2x', label: '2', zoom: 2, isActive: false },
  { id: 'telephoto-3x', label: '3', zoom: 3, isActive: false },
];

export default function UITestScreen() {
  const [cameraState, setCameraState] = useState<CameraState>({
    zoom: 1,
    flash: 'off',
    facing: 'back',
    captureMode: 'photo',
    isRecording: false,
  });

  const [lenses, setLenses] = useState<LensInfo[]>(MOCK_LENSES);

  const handleLensSelect = (zoom: number) => {
    setCameraState(prev => ({ ...prev, zoom }));
    setLenses(prev => prev.map(l => ({ ...l, isActive: l.zoom === zoom })));
  };

  return (
    <View style={styles.container}>
      {/* Gray background to simulate camera preview */}
      <View style={styles.cameraPreview} />

      <CameraControls
        cameraState={cameraState}
        onTakePhoto={() => console.log('Take photo')}
        onStartRecording={() => setCameraState(prev => ({ ...prev, isRecording: true }))}
        onStopRecording={() => setCameraState(prev => ({ ...prev, isRecording: false }))}
        onToggleFlash={() => console.log('Toggle flash')}
        onSwitchCamera={() => console.log('Switch camera')}
        onZoomChange={(zoom) => setCameraState(prev => ({ ...prev, zoom }))}
        onCaptureModeChange={(mode) => setCameraState(prev => ({ ...prev, captureMode: mode }))}
        lastPhotoUri={undefined}
        onOpenGallery={() => console.log('Open gallery')}
        onSettingsPress={() => console.log('Settings')}
        onQRPress={() => console.log('QR pressed')}
        onModeToggle={() => console.log('Mode toggle')}
        onLensSelect={handleLensSelect}
        availableLenses={lenses}
        currentMode="camera"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraPreview: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#333',
  },
});
