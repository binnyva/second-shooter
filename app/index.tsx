import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
} from 'react-native-vision-camera';
import { CameraControls } from '../src/components/CameraControls';
import { QRCodeDisplay } from '../src/components/QRCodeDisplay';
import { useCamera } from '../src/hooks/useCamera';
import { useSignaling } from '../src/hooks/useSignaling';
import { usePeerConnection } from '../src/hooks/usePeerConnection';
import { requestMediaLibraryPermission } from '../src/utils/permissions';
import { Command, CameraState } from '../src/types';

export default function CameraScreen() {
  const router = useRouter();
  const cameraRef = useRef<Camera>(null);

  // Permissions
  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } =
    useCameraPermission();
  const { hasPermission: hasMicPermission, requestPermission: requestMicPermission } =
    useMicrophonePermission();

  // Camera state
  const {
    state: cameraState,
    setZoom,
    toggleFlash,
    switchCamera,
    setCaptureMode,
    takePhoto,
    startRecording,
    stopRecording,
    updateState,
  } = useCamera();

  // QR code state
  const [showQR, setShowQR] = useState(false);
  const [isRemoteConnected, setIsRemoteConnected] = useState(false);

  // Signaling
  const {
    sessionId,
    createSession,
    sendOffer,
    onAnswer,
    addIceCandidate: addSignalingIceCandidate,
    onIceCandidate: listenForIceCandidate,
    cleanup: cleanupSignaling,
  } = useSignaling('camera');

  // Handle incoming commands from remote
  const handleCommand = useCallback(async (command: Command) => {
    console.log('Received command:', command.type);

    switch (command.type) {
      case 'TAKE_PHOTO':
        try {
          await takePhoto();
          sendResponse({ type: 'PHOTO_TAKEN', success: true });
        } catch (error) {
          sendResponse({ type: 'PHOTO_TAKEN', success: false, error: String(error) });
        }
        break;

      case 'START_RECORDING':
        try {
          await startRecording();
          sendResponse({ type: 'RECORDING_STARTED' });
        } catch (error) {
          sendResponse({ type: 'ERROR', message: String(error) });
        }
        break;

      case 'STOP_RECORDING':
        try {
          await stopRecording();
          sendResponse({ type: 'RECORDING_STOPPED', success: true });
        } catch (error) {
          sendResponse({ type: 'RECORDING_STOPPED', success: false, error: String(error) });
        }
        break;

      case 'SET_ZOOM':
        setZoom(command.level);
        sendStateUpdate(cameraState);
        break;

      case 'SET_FLASH':
        updateState({ flash: command.mode });
        sendStateUpdate(cameraState);
        break;

      case 'SWITCH_CAMERA':
        switchCamera();
        sendStateUpdate(cameraState);
        break;

      case 'GET_STATE':
        sendStateUpdate(cameraState);
        break;
    }
  }, [takePhoto, startRecording, stopRecording, setZoom, updateState, switchCamera, cameraState]);

  // WebRTC connection
  const {
    connectionState,
    createConnection,
    createOffer,
    setRemoteDescription,
    addIceCandidate: addPeerIceCandidate,
    sendResponse,
    sendStateUpdate,
    startLocalStream,
    close: closeConnection,
  } = usePeerConnection({
    role: 'camera',
    onCommand: handleCommand,
  });

  // Get camera device
  const device = useCameraDevice(cameraState.facing);

  // Request permissions on mount
  useEffect(() => {
    const requestPermissions = async () => {
      if (!hasCameraPermission) {
        await requestCameraPermission();
      }
      if (!hasMicPermission) {
        await requestMicPermission();
      }
      await requestMediaLibraryPermission();
    };
    requestPermissions();
  }, [hasCameraPermission, hasMicPermission, requestCameraPermission, requestMicPermission]);

  // Handle QR code display and session creation
  const handleShowQR = async () => {
    try {
      // Create signaling session
      const newSessionId = await createSession();
      console.log('Created session:', newSessionId);

      // Create WebRTC connection
      await createConnection();

      // Start local stream for WebRTC
      await startLocalStream();

      // Create and send offer
      const offer = await createOffer();
      await sendOffer({ type: 'offer', sdp: offer.sdp! });

      // Listen for ICE candidates from remote
      listenForIceCandidate(async (candidate) => {
        console.log('Received ICE candidate from remote');
        await addPeerIceCandidate(candidate);
      });

      // Listen for answer from remote
      onAnswer(async (answer) => {
        console.log('Received answer from remote');
        await setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        setIsRemoteConnected(true);
        setShowQR(false);
      });

      // Send ICE candidates to signaling
      // Note: This is handled via onIceCandidate in usePeerConnection

      setShowQR(true);
    } catch (error) {
      console.error('Error setting up remote connection:', error);
      Alert.alert('Error', 'Failed to create remote connection');
    }
  };

  const handleCloseQR = () => {
    setShowQR(false);
    cleanupSignaling();
    closeConnection();
  };

  // Update remote connection state
  useEffect(() => {
    if (connectionState === 'connected') {
      setIsRemoteConnected(true);
      // Send initial state to remote
      sendStateUpdate(cameraState);
    } else if (connectionState === 'failed' || connectionState === 'disconnected') {
      setIsRemoteConnected(false);
    }
  }, [connectionState, cameraState, sendStateUpdate]);

  // Send state updates when camera state changes
  useEffect(() => {
    if (isRemoteConnected) {
      sendStateUpdate(cameraState);
    }
  }, [cameraState, isRemoteConnected, sendStateUpdate]);

  // Navigate to remote screen
  const handleGoToRemote = () => {
    router.push('/remote');
  };

  if (!hasCameraPermission || !hasMicPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          Camera and microphone permissions are required
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={async () => {
            await requestCameraPermission();
            await requestMicPermission();
          }}
        >
          <Text style={styles.permissionButtonText}>Grant Permissions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading camera...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera preview */}
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
      />

      {/* Camera controls */}
      <CameraControls
        cameraState={cameraState}
        onTakePhoto={takePhoto}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        onToggleFlash={toggleFlash}
        onSwitchCamera={switchCamera}
        onZoomChange={setZoom}
        onCaptureModeChange={setCaptureMode}
      />

      {/* Remote button */}
      <TouchableOpacity
        style={styles.remoteButton}
        onPress={handleShowQR}
      >
        <Text style={styles.remoteButtonText}>Remote</Text>
      </TouchableOpacity>

      {/* Be Remote button */}
      <TouchableOpacity
        style={styles.beRemoteButton}
        onPress={handleGoToRemote}
      >
        <Text style={styles.beRemoteButtonText}>Be Remote</Text>
      </TouchableOpacity>

      {/* Connection indicator */}
      {isRemoteConnected && (
        <View style={styles.connectionIndicator}>
          <View style={styles.connectionDot} />
          <Text style={styles.connectionText}>Remote Connected</Text>
        </View>
      )}

      {/* QR code overlay */}
      {showQR && sessionId && (
        <QRCodeDisplay sessionId={sessionId} onClose={handleCloseQR} />
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
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#007aff',
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  },
  remoteButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  remoteButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  beRemoteButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    backgroundColor: 'rgba(0, 122, 255, 0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  beRemoteButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  connectionIndicator: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4cd964',
    marginRight: 8,
  },
  connectionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
