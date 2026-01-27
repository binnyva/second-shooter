import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
} from 'react-native-vision-camera';
import { RTCView } from 'react-native-webrtc';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { CameraControls } from '../src/components/CameraControls';
import { QRCodeDisplay } from '../src/components/QRCodeDisplay';
import { useCamera } from '../src/hooks/useCamera';
import { useSignaling } from '../src/hooks/useSignaling';
import { usePeerConnection } from '../src/hooks/usePeerConnection';
import { requestMediaLibraryPermission } from '../src/utils/permissions';
import { detectLenses } from '../src/utils/lensDetection';
import { mediaService } from '../src/services/MediaService';
import { webRTCService } from '../src/services/WebRTCService';
import { Command, CameraState, LensInfo } from '../src/types';

export default function CameraScreen() {
  const router = useRouter();

  // Permissions
  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } =
    useCameraPermission();
  const { hasPermission: hasMicPermission, requestPermission: requestMicPermission } =
    useMicrophonePermission();

  // Camera state - use cameraRef from the hook
  const {
    cameraRef,
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

  // Last photo and lenses state
  const [lastPhotoUri, setLastPhotoUri] = useState<string | undefined>();
  const [availableLenses, setAvailableLenses] = useState<LensInfo[]>([]);

  // Track if WebRTC is using the camera (to deactivate vision-camera)
  const [isStreamingToRemote, setIsStreamingToRemote] = useState(false);

  // Local WebRTC stream for preview (separate from hook to avoid circular dependency)
  const [webrtcLocalStream, setWebrtcLocalStream] = useState<any>(null);

  // Frozen frame for smooth transitions during photo capture
  const [frozenFrameUri, setFrozenFrameUri] = useState<string | null>(null);
  const previewRef = useRef<ViewShot>(null);


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

  // Reference to track if we need to reactivate streaming after photo
  const pendingPhotoResolve = React.useRef<(() => void) | null>(null);

  // Handle camera becoming active again after being reactivated for photo
  const handleCameraInitialized = useCallback(() => {
    if (pendingPhotoResolve.current) {
      pendingPhotoResolve.current();
      pendingPhotoResolve.current = null;
    }
  }, []);

  // Take photo with camera reactivation if needed
  // Check WebRTC service directly to see if it has the camera locked
  const takePhotoWithReactivation = useCallback(async () => {
    const hasActiveStream = webRTCService.getLocalStreamRef() !== null;

    // If no active WebRTC stream, just take photo directly
    if (!hasActiveStream) {
      return takePhoto();
    }

    // WebRTC has the camera locked via getUserMedia
    // Must pause WebRTC stream to release camera for vision-camera
    console.log('[CAMERA] Pausing WebRTC stream for photo capture');

    // Capture the current preview frame before pausing (for smooth transition)
    try {
      if (previewRef.current) {
        const uri = await captureRef(previewRef, {
          format: 'jpg',
          quality: 0.8,
        });
        setFrozenFrameUri(uri);
        console.log('[CAMERA] Captured freeze frame for transition');
      }
    } catch (captureError) {
      console.warn('[CAMERA] Could not capture freeze frame:', captureError);
    }

    // Create a promise that resolves when camera is ready
    const cameraReadyPromise = new Promise<void>((resolve) => {
      pendingPhotoResolve.current = resolve;
    });

    // Stop WebRTC video track to release camera hardware
    webRTCService.pauseLocalStream();

    // Wait for Android to fully release camera hardware
    await new Promise(resolve => setTimeout(resolve, 500));

    // Activate vision-camera
    setIsStreamingToRemote(false);

    // Wait for camera to initialize (with timeout)
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 2000));
    await Promise.race([cameraReadyPromise, timeoutPromise]);

    // Additional delay to ensure camera session is fully running
    await new Promise(resolve => setTimeout(resolve, 500));

    // Retry photo capture with exponential backoff
    const maxRetries = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await takePhoto();
        // Success - reactivate streaming
        setIsStreamingToRemote(true);
        await webRTCService.resumeLocalStream(cameraState.facing);
        setWebrtcLocalStream(webRTCService.getLocalStreamRef());
        console.log('[CAMERA] Photo captured, WebRTC stream resumed');
        // Clear frozen frame after a brief delay to ensure smooth transition
        setTimeout(() => setFrozenFrameUri(null), 200);
        return result;
      } catch (error) {
        lastError = error;
        console.log(`[CAMERA] Photo capture attempt ${attempt + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 300 * Math.pow(2, attempt)));
      }
    }

    // All retries failed - reactivate streaming and throw
    setIsStreamingToRemote(true);
    await webRTCService.resumeLocalStream(cameraState.facing);
    setWebrtcLocalStream(webRTCService.getLocalStreamRef());
    // Clear frozen frame
    setFrozenFrameUri(null);
    throw lastError;
  }, [takePhoto, cameraState.facing]);

  // Handle incoming commands from remote
  const handleCommand = useCallback(async (command: Command) => {
    console.log('[CAMERA] Received command:', command.type);

    switch (command.type) {
      case 'TAKE_PHOTO':
        try {
          await takePhotoWithReactivation();
          sendResponse({ type: 'PHOTO_TAKEN', success: true });
        } catch (error) {
          sendResponse({ type: 'PHOTO_TAKEN', success: false, error: String(error) });
        }
        break;

      case 'START_RECORDING':
        try {
          // Deactivate streaming to free camera for vision-camera recording
          // Note: Remote preview will stop during recording
          if (isStreamingToRemote) {
            console.log('Deactivating streaming for video recording');
            // Stop WebRTC video track to release camera hardware
            webRTCService.pauseLocalStream();
            await new Promise(resolve => setTimeout(resolve, 100));
            setIsStreamingToRemote(false);
            // Wait for camera to initialize
            await new Promise(resolve => setTimeout(resolve, 500));
          }
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
          // Reactivate streaming after recording stops
          if (isRemoteConnected) {
            console.log('Reactivating streaming after recording');
            setIsStreamingToRemote(true);
            // Resume WebRTC stream
            await webRTCService.resumeLocalStream(cameraState.facing);
            setWebrtcLocalStream(webRTCService.getLocalStreamRef());
          }
        } catch (error) {
          sendResponse({ type: 'RECORDING_STOPPED', success: false, error: String(error) });
          // Still try to reactivate streaming on error
          if (isRemoteConnected) {
            setIsStreamingToRemote(true);
            await webRTCService.resumeLocalStream(cameraState.facing);
            setWebrtcLocalStream(webRTCService.getLocalStreamRef());
          }
        }
        break;

      case 'SET_ZOOM':
        setZoom(command.level);
        sendStateUpdate(cameraState, availableLenses);
        break;

      case 'SET_FLASH':
        updateState({ flash: command.mode });
        sendStateUpdate(cameraState, availableLenses);
        break;

      case 'SWITCH_CAMERA':
        switchCamera();
        sendStateUpdate(cameraState, availableLenses);
        break;

      case 'GET_STATE':
        sendStateUpdate(cameraState, availableLenses);
        break;
    }
  }, [takePhotoWithReactivation, startRecording, stopRecording, setZoom, updateState, switchCamera, cameraState, availableLenses, isStreamingToRemote, isRemoteConnected]);

  // WebRTC connection
  const {
    connectionState,
    isDataChannelReady,
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
    onIceCandidate: async (candidate) => {
      // Send camera's ICE candidates to Firebase for the remote to receive
      console.log('Sending ICE candidate to signaling');
      await addSignalingIceCandidate(candidate);
    },
  });

  // Get camera devices - always get back camera for consistent lens detection
  const device = useCameraDevice(cameraState.facing);
  const backDevice = useCameraDevice('back');

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

  // Detect available lenses - always use backDevice for consistent lens list
  useEffect(() => {
    if (backDevice) {
      const lenses = detectLenses(backDevice, cameraState.facing, cameraState.zoom);
      setAvailableLenses(lenses);
    }
  }, [backDevice, cameraState.facing, cameraState.zoom]);

  // Load last photo on mount
  useEffect(() => {
    const loadLastPhoto = async () => {
      const photo = await mediaService.getLastPhoto();
      if (photo) {
        setLastPhotoUri(photo.uri);
      }
    };
    loadLastPhoto();
  }, []);

  // Handle QR code display and session creation
  const handleShowQR = async () => {
    try {
      // Deactivate vision-camera before WebRTC takes over
      setIsStreamingToRemote(true);

      // Small delay to ensure camera is released
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create signaling session
      const newSessionId = await createSession();
      console.log('Created session:', newSessionId);

      // Create WebRTC connection
      await createConnection();

      // Start local stream for WebRTC
      const stream = await startLocalStream();
      setWebrtcLocalStream(stream);

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

      setShowQR(true);
    } catch (error) {
      console.error('Error setting up remote connection:', error);
      Alert.alert('Error', 'Failed to create remote connection');
      setIsStreamingToRemote(false);
    }
  };

  const handleCloseQR = () => {
    setShowQR(false);
    cleanupSignaling();
    closeConnection();
    setIsStreamingToRemote(false);
    setWebrtcLocalStream(null);
  };

  // Update remote connection state
  useEffect(() => {
    if (connectionState === 'connected') {
      setIsRemoteConnected(true);
    } else if (connectionState === 'failed' || connectionState === 'disconnected') {
      setIsRemoteConnected(false);
    }
  }, [connectionState]);

  // Send state updates when camera state changes and data channel is ready
  useEffect(() => {
    if (isRemoteConnected && isDataChannelReady) {
      sendStateUpdate(cameraState, availableLenses);
    }
  }, [cameraState, availableLenses, isRemoteConnected, isDataChannelReady, sendStateUpdate]);

  // Navigate to remote screen
  const handleGoToRemote = () => {
    router.push('/remote');
  };

  // Handle opening gallery
  const handleOpenGallery = async () => {
    await mediaService.openGallery();
  };

  // Handle settings press (placeholder for now)
  const handleSettingsPress = () => {
    Alert.alert('Settings', 'Settings coming soon!');
  };

  // Handle lens selection
  const handleLensSelect = (zoom: number) => {
    setZoom(zoom);
  };

  // Wrap takePhoto to update lastPhotoUri after capturing
  const handleTakePhoto = async () => {
    try {
      await takePhoto();
      // Refresh last photo after a brief delay to allow save to complete
      setTimeout(async () => {
        const photo = await mediaService.getLastPhoto();
        if (photo) {
          setLastPhotoUri(photo.uri);
        }
      }, 500);
    } catch (error) {
      console.error('Error taking photo:', error);
    }
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
      {/* Camera preview - show RTCView when streaming, vision-camera otherwise */}
      <ViewShot ref={previewRef} style={StyleSheet.absoluteFill}>
        {isStreamingToRemote && webrtcLocalStream ? (
          <RTCView
            streamURL={webrtcLocalStream.toURL()}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            mirror={cameraState.facing === 'front'}
          />
        ) : (
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={!isStreamingToRemote}
            photo={true}
            video={true}
            audio={true}
            zoom={cameraState.zoom}
            enableZoomGesture={true}
            onInitialized={handleCameraInitialized}
          />
        )}
      </ViewShot>

      {/* Frozen frame overlay during photo capture transition */}
      {frozenFrameUri && (
        <Image
          source={{ uri: frozenFrameUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}

      {/* Camera controls */}
      <CameraControls
        cameraState={cameraState}
        onTakePhoto={handleTakePhoto}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        onToggleFlash={toggleFlash}
        onSwitchCamera={switchCamera}
        onZoomChange={setZoom}
        onCaptureModeChange={setCaptureMode}
        lastPhotoUri={lastPhotoUri}
        onOpenGallery={handleOpenGallery}
        onSettingsPress={handleSettingsPress}
        onQRPress={handleShowQR}
        onModeToggle={handleGoToRemote}
        onLensSelect={handleLensSelect}
        availableLenses={availableLenses}
        currentMode="camera"
      />

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
  connectionIndicator: {
    position: 'absolute',
    top: 60,
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
