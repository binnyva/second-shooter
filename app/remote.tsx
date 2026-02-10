import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MediaStream } from 'react-native-webrtc';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { QRCodeScanner } from '../src/components/QRCodeScanner';
import { HybridPreview } from '../src/components/HybridPreview';
import { CameraControls } from '../src/components/CameraControls';
import { PhotoViewer } from '../src/components/PhotoViewer';
import { useSignaling } from '../src/hooks/useSignaling';
import { usePeerConnection } from '../src/hooks/usePeerConnection';
import { useSettings } from '../src/hooks/useSettings';
import { useVolumeShutter } from '../src/hooks/useVolumeShutter';
import { webRTCService } from '../src/services/WebRTCService';
import { CameraState, Response, FlashMode, CaptureMode, LensInfo, StreamMode, FrameDataMessage, PhotoDataMessage } from '../src/types';

const DEFAULT_STATE: CameraState = {
  zoom: 1,
  flash: 'off',
  facing: 'back',
  captureMode: 'photo',
  isRecording: false,
};

export default function RemoteScreen() {
  const router = useRouter();

  // Settings
  const { settings } = useSettings();

  // Keep screen awake based on setting
  useEffect(() => {
    if (settings.keepScreenAwake) {
      activateKeepAwakeAsync('remote-screen');
    } else {
      deactivateKeepAwake('remote-screen');
    }
    return () => {
      deactivateKeepAwake('remote-screen');
    };
  }, [settings.keepScreenAwake]);

  // UI state
  const [showScanner, setShowScanner] = useState(true);
  const [remoteState, setRemoteState] = useState<CameraState>(DEFAULT_STATE);
  const [remoteLenses, setRemoteLenses] = useState<LensInfo[]>([]);
  const [videoNeedsRotation, setVideoNeedsRotation] = useState(false);
  const [previewZoomLimited, setPreviewZoomLimited] = useState(false);
  const [streamMode, setStreamMode] = useState<StreamMode>('webrtc');
  const [latestFrame, setLatestFrame] = useState<FrameDataMessage | null>(null);

  // Last photo received from camera device
  const [lastRemotePhotoUri, setLastRemotePhotoUri] = useState<string | null>(null);
  const [showPhotoViewer, setShowPhotoViewer] = useState(false);

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

  // Handle frame data from camera device (for frame-based streaming)
  const framesReceivedRef = useRef(0);
  const handleFrameData = useCallback((frameData: FrameDataMessage) => {
    framesReceivedRef.current++;
    // Log every 30 frames (~3 seconds)
    if (framesReceivedRef.current % 30 === 0) {
      console.log(`[REMOTE] Received ${framesReceivedRef.current} frames, latest id: ${frameData.frameId}, size: ${frameData.data?.length || 0} bytes`);
    }
    setLatestFrame(frameData);
  }, []);

  // Handle responses from camera device
  const handleResponse = useCallback((response: Response) => {
    // Handle frame data separately (high frequency)
    if (response.type === 'FRAME_DATA') {
      handleFrameData(response);
      return;
    }

    // Handle photo data (don't log base64 content)
    if (response.type === 'PHOTO_DATA') {
      console.log(`[REMOTE] Received photo data: ${response.data?.length || 0} bytes`);
      const photoUri = `data:image/jpeg;base64,${response.data}`;
      setLastRemotePhotoUri(photoUri);
      return;
    }

    console.log('Received response:', response.type);

    switch (response.type) {
      case 'STATE_UPDATE':
        console.log(`[REMOTE] STATE_UPDATE: zoom=${response.state.zoom}, facing=${response.state.facing}, streamMode=${response.streamMode}`);
        setRemoteState(response.state);
        if (response.lenses) {
          setRemoteLenses(response.lenses);
        }
        if (response.videoNeedsRotation !== undefined) {
          setVideoNeedsRotation(response.videoNeedsRotation);
        }
        if (response.previewZoomLimited !== undefined) {
          setPreviewZoomLimited(response.previewZoomLimited);
        }
        if (response.streamMode !== undefined) {
          if (response.streamMode !== streamMode) {
            console.log(`[REMOTE] Stream mode changing: ${streamMode} -> ${response.streamMode}`);
          }
          setStreamMode(response.streamMode);
        }
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
    const tracks = stream.getTracks();
    const videoTracks = stream.getVideoTracks();
    console.log(`[REMOTE] Received remote stream: ${tracks.length} tracks total, ${videoTracks.length} video tracks`);
    videoTracks.forEach((track, i) => {
      console.log(`[REMOTE] Video track ${i}: id=${track.id}, readyState=${track.readyState}, enabled=${track.enabled}`);
    });
  }, []);

  // Track data channel ready state
  const [isDataChannelReady, setIsDataChannelReady] = useState(false);

  // Handle data channel open
  const handleDataChannelOpen = useCallback(() => {
    console.log('Data channel is now ready');
    setIsDataChannelReady(true);
    // Set up frame data callback
    webRTCService.onFrameData(handleFrameData);
  }, [handleFrameData]);

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
    onIceCandidate: async (candidate) => {
      // Send remote's ICE candidates to Firebase for the camera to receive
      console.log('Sending ICE candidate to signaling');
      await addSignalingIceCandidate(candidate);
    },
    onDataChannelOpen: handleDataChannelOpen,
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
    setIsDataChannelReady(false);
    router.back();
  };

  // Handle QR scanner button - show scanner to connect to a new camera
  const handleQRPress = () => {
    // Cleanup existing connection and show scanner
    cleanupSignaling();
    closeConnection();
    setIsDataChannelReady(false);
    setShowScanner(true);
  };

  // Handle mode toggle - navigate back to camera mode
  const handleModeToggle = () => {
    cleanupSignaling();
    closeConnection();
    setIsDataChannelReady(false);
    router.replace('/');
  };

  // Handle settings press
  const handleSettingsPress = () => {
    router.push('/settings');
  };

  // Handle lens selection - send command to camera
  const handleLensSelect = useCallback((zoom: number) => {
    sendCommand({ type: 'SET_ZOOM', level: zoom });
  }, [sendCommand]);

  // Handle opening photo viewer
  const handleOpenPhotoViewer = useCallback(() => {
    if (lastRemotePhotoUri) {
      setShowPhotoViewer(true);
    }
  }, [lastRemotePhotoUri]);

  // Volume button shutter
  const handleVolumeShutter = useCallback(() => {
    if (connectionState !== 'connected') return;
    if (remoteState.captureMode === 'photo') {
      handleTakePhoto();
    } else {
      if (remoteState.isRecording) {
        handleStopRecording();
      } else {
        handleStartRecording();
      }
    }
  }, [connectionState, remoteState.captureMode, remoteState.isRecording, handleTakePhoto, handleStartRecording, handleStopRecording]);

  useVolumeShutter({ onShutterPress: handleVolumeShutter, enabled: !showScanner });

  // Request initial state when data channel becomes ready
  useEffect(() => {
    if (isDataChannelReady && !showScanner) {
      console.log('Data channel ready, requesting initial state');
      sendCommand({ type: 'GET_STATE' });
    }
  }, [isDataChannelReady, showScanner, sendCommand]);

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
          {/* Hybrid preview - supports both WebRTC and frame-based streaming */}
          <HybridPreview
            stream={remoteStream}
            connectionState={connectionState}
            streamMode={streamMode}
            latestFrame={latestFrame}
            facing={remoteState.facing}
            videoNeedsRotation={videoNeedsRotation}
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
            lastPhotoUri={lastRemotePhotoUri ?? undefined}
            onOpenGallery={handleOpenPhotoViewer}
            onSettingsPress={handleSettingsPress}
            onQRPress={handleQRPress}
            onModeToggle={handleModeToggle}
            onLensSelect={handleLensSelect}
            availableLenses={remoteLenses}
            currentMode="remote"
            previewZoomLimited={previewZoomLimited}
          />

          {/* Photo viewer modal */}
          <PhotoViewer
            visible={showPhotoViewer}
            photoUri={lastRemotePhotoUri}
            onClose={() => setShowPhotoViewer(false)}
          />

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
  sessionInfo: {
    position: 'absolute',
    top: 60,
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
