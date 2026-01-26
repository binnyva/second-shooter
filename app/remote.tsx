import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MediaStream } from 'react-native-webrtc';
import { QRCodeScanner } from '../src/components/QRCodeScanner';
import { RemotePreview } from '../src/components/RemotePreview';
import { CameraControls } from '../src/components/CameraControls';
import { useSignaling } from '../src/hooks/useSignaling';
import { usePeerConnection } from '../src/hooks/usePeerConnection';
import { CameraState, Response, FlashMode, CaptureMode } from '../src/types';

const DEFAULT_STATE: CameraState = {
  zoom: 1,
  flash: 'off',
  facing: 'back',
  captureMode: 'photo',
  isRecording: false,
};

export default function RemoteScreen() {
  const router = useRouter();

  // UI state
  const [showScanner, setShowScanner] = useState(true);
  const [remoteState, setRemoteState] = useState<CameraState>(DEFAULT_STATE);

  // Signaling
  const {
    sessionId,
    joinSession,
    sendAnswer,
    onOffer,
    addIceCandidate: addSignalingIceCandidate,
    onIceCandidate: listenForIceCandidate,
    cleanup: cleanupSignaling,
  } = useSignaling('remote');

  // Handle responses from camera device
  const handleResponse = useCallback((response: Response) => {
    console.log('Received response:', response.type);

    switch (response.type) {
      case 'STATE_UPDATE':
        setRemoteState(response.state);
        break;

      case 'PHOTO_TAKEN':
        if (response.success) {
          // Could show a brief flash or indicator
          console.log('Photo taken successfully');
        } else {
          Alert.alert('Error', response.error || 'Failed to take photo');
        }
        break;

      case 'RECORDING_STARTED':
        setRemoteState((prev) => ({ ...prev, isRecording: true }));
        break;

      case 'RECORDING_STOPPED':
        setRemoteState((prev) => ({ ...prev, isRecording: false }));
        if (!response.success) {
          Alert.alert('Error', response.error || 'Failed to stop recording');
        }
        break;

      case 'ERROR':
        Alert.alert('Error', response.message);
        break;
    }
  }, []);

  // Handle remote stream from camera
  const handleRemoteStream = useCallback((stream: MediaStream) => {
    console.log('Received remote stream');
  }, []);

  // WebRTC connection
  const {
    connectionState,
    remoteStream,
    createConnection,
    createAnswer,
    setRemoteDescription,
    addIceCandidate: addPeerIceCandidate,
    sendCommand,
    close: closeConnection,
  } = usePeerConnection({
    role: 'remote',
    onResponse: handleResponse,
    onRemoteStream: handleRemoteStream,
  });

  // Handle QR code scan
  const handleScan = async (scannedSessionId: string) => {
    console.log('Scanned session ID:', scannedSessionId);

    try {
      // Join the signaling session
      const joined = await joinSession(scannedSessionId);
      if (!joined) {
        Alert.alert('Error', 'Session not found. Please scan the QR code again.');
        return;
      }

      // Create WebRTC connection
      await createConnection();

      // Listen for ICE candidates from camera
      listenForIceCandidate(async (candidate) => {
        console.log('Received ICE candidate from camera');
        await addPeerIceCandidate(candidate);
      });

      // Listen for offer from camera
      onOffer(async (offer) => {
        console.log('Received offer from camera');

        // Set remote description (the offer)
        await setRemoteDescription({ type: 'offer', sdp: offer.sdp });

        // Create and send answer
        const answer = await createAnswer();
        await sendAnswer({ type: 'answer', sdp: answer.sdp! });
      });

      // Hide scanner
      setShowScanner(false);

      // Request initial state
      setTimeout(() => {
        sendCommand({ type: 'GET_STATE' });
      }, 1000);

    } catch (error) {
      console.error('Error connecting to camera:', error);
      Alert.alert('Error', 'Failed to connect to camera. Please try again.');
    }
  };

  // Control handlers
  const handleTakePhoto = useCallback(() => {
    sendCommand({ type: 'TAKE_PHOTO' });
  }, [sendCommand]);

  const handleStartRecording = useCallback(() => {
    sendCommand({ type: 'START_RECORDING' });
  }, [sendCommand]);

  const handleStopRecording = useCallback(() => {
    sendCommand({ type: 'STOP_RECORDING' });
  }, [sendCommand]);

  const handleToggleFlash = useCallback(() => {
    const modes: FlashMode[] = ['off', 'on', 'auto'];
    const currentIndex = modes.indexOf(remoteState.flash);
    const nextIndex = (currentIndex + 1) % modes.length;
    sendCommand({ type: 'SET_FLASH', mode: modes[nextIndex] });
  }, [sendCommand, remoteState.flash]);

  const handleSwitchCamera = useCallback(() => {
    sendCommand({ type: 'SWITCH_CAMERA' });
  }, [sendCommand]);

  const handleZoomChange = useCallback((zoom: number) => {
    sendCommand({ type: 'SET_ZOOM', level: zoom });
  }, [sendCommand]);

  const handleCaptureModeChange = useCallback((mode: CaptureMode) => {
    setRemoteState((prev) => ({ ...prev, captureMode: mode }));
  }, []);

  // Handle back navigation
  const handleBack = () => {
    cleanupSignaling();
    closeConnection();
    router.back();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSignaling();
      closeConnection();
    };
  }, [cleanupSignaling, closeConnection]);

  return (
    <View style={styles.container}>
      {showScanner ? (
        // QR Scanner view
        <QRCodeScanner
          onScan={handleScan}
          onClose={handleBack}
        />
      ) : (
        // Remote control view
        <>
          {/* Remote preview */}
          <RemotePreview
            stream={remoteStream}
            connectionState={connectionState}
          />

          {/* Camera controls */}
          <CameraControls
            cameraState={remoteState}
            onTakePhoto={handleTakePhoto}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onToggleFlash={handleToggleFlash}
            onSwitchCamera={handleSwitchCamera}
            onZoomChange={handleZoomChange}
            onCaptureModeChange={handleCaptureModeChange}
            disabled={connectionState !== 'connected'}
          />

          {/* Back button */}
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>

          {/* Session info */}
          {sessionId && (
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionText}>
                Session: {sessionId}
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  sessionInfo: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  sessionText: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'monospace',
  },
});
