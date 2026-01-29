import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
} from 'react-native-vision-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { CameraControls } from '../src/components/CameraControls';
import { QRCodeDisplay } from '../src/components/QRCodeDisplay';
import { GridOverlay } from '../src/components/GridOverlay';
import { TimerCountdown } from '../src/components/TimerCountdown';
import { AspectRatioContainer } from '../src/components/AspectRatioContainer';
import { useCamera } from '../src/hooks/useCamera';
import { useSignaling } from '../src/hooks/useSignaling';
import { usePeerConnection } from '../src/hooks/usePeerConnection';
import { useSettings } from '../src/hooks/useSettings';
import { requestMediaLibraryPermission } from '../src/utils/permissions';
import { detectLenses } from '../src/utils/lensDetection';
import { mediaService } from '../src/services/MediaService';
import { webRTCService } from '../src/services/WebRTCService';
import { Command, CameraState, LensInfo } from '../src/types';

export default function CameraScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();

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
    takeSnapshot,
    startRecording,
    stopRecording,
    updateState,
  } = useCamera();

  // Settings
  const { settings } = useSettings();

  // Keep screen awake based on setting
  useEffect(() => {
    if (settings.keepScreenAwake) {
      activateKeepAwakeAsync('camera-screen');
    } else {
      deactivateKeepAwake('camera-screen');
    }
    return () => {
      deactivateKeepAwake('camera-screen');
    };
  }, [settings.keepScreenAwake]);

  // Timer countdown state
  const [showTimerCountdown, setShowTimerCountdown] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const pendingTimerPhoto = useRef<(() => void) | null>(null);

  // QR code state
  const [showQR, setShowQR] = useState(false);
  const [isRemoteConnected, setIsRemoteConnected] = useState(false);
  const [isQRLoading, setIsQRLoading] = useState(false);

  // Last photo and lenses state
  const [lastPhotoUri, setLastPhotoUri] = useState<string | undefined>();
  const [availableLenses, setAvailableLenses] = useState<LensInfo[]>([]);

  // Track if WebRTC is using the camera (to deactivate vision-camera)
  const [isStreamingToRemote, setIsStreamingToRemote] = useState(false);
  // Key to force Camera remount when screen regains focus (fixes vision-camera not restarting)
  const [cameraKey, setCameraKey] = useState(0);
  // Ref to track streaming state for use in callbacks (avoids stale closure issues)
  const isStreamingRef = useRef(false);

  // Ref to track current facing for use in callbacks (avoids stale closure issues)
  const facingRef = useRef<'front' | 'back'>('back');

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


  // Track camera initialization state
  const [isCameraInitialized, setIsCameraInitialized] = useState(false);

  // Handle camera becoming active again
  const handleCameraInitialized = useCallback(() => {
    console.log('[CAMERA] Camera initialized');
    setIsCameraInitialized(true);
  }, []);

  // Handle incoming commands from remote
  const handleCommand = useCallback(async (command: Command) => {
    console.log('[CAMERA] Received command:', command.type);

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
          // Frame capture is automatically paused during recording
          // (useEffect depends on cameraState.isRecording)
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
          // Frame capture is automatically resumed after recording
          // (useEffect depends on cameraState.isRecording)
        } catch (error) {
          sendResponse({ type: 'RECORDING_STOPPED', success: false, error: String(error) });
        }
        break;

      case 'SET_ZOOM':
        setZoom(command.level);
        // Vision-camera handles zoom directly via its zoom prop
        // Snapshot captures the zoomed preview and sends it to remote
        break;

      case 'SET_FLASH':
        updateState({ flash: command.mode });
        // Note: STATE_UPDATE is sent automatically via useEffect when cameraState changes
        break;

      case 'SWITCH_CAMERA':
        switchCamera();
        // Vision-camera handles the camera switch directly
        // Snapshot captures the new camera's preview and sends it to remote
        break;

      case 'GET_STATE':
        // Send state with frame-based mode since we always use snapshot capture
        sendStateUpdate(cameraState, availableLenses, false, false, 'frame-based');
        break;
    }
  }, [takePhoto, startRecording, stopRecording, setZoom, updateState, switchCamera, cameraState, availableLenses]);

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

  // Get camera devices with multi-camera support for optical zoom
  // Request all physical devices to enable lens switching
  const device = useCameraDevice(cameraState.facing, {
    physicalDevices: [
      'ultra-wide-angle-camera',
      'wide-angle-camera',
      'telephoto-camera',
    ],
  });
  // Always get back camera with all lenses for consistent lens detection
  const backDevice = useCameraDevice('back', {
    physicalDevices: [
      'ultra-wide-angle-camera',
      'wide-angle-camera',
      'telephoto-camera',
    ],
  });

  // Force camera remount when screen regains focus (fixes vision-camera not restarting)
  const wasFocusedRef = useRef(isFocused);
  useEffect(() => {
    if (isFocused && !wasFocusedRef.current) {
      setCameraKey(prev => prev + 1);
    }
    wasFocusedRef.current = isFocused;
  }, [isFocused]);

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

  // Log all available camera devices for debugging
  useEffect(() => {
    const allDevices = Camera.getAvailableCameraDevices();
    console.log('[CameraDebug] Total devices found:', allDevices.length);
    allDevices.forEach((d, idx) => {
      console.log(`[CameraDebug] Device ${idx}: id=${d.id} position=${d.position} name=${d.name}`);
      console.log(`[CameraDebug]   physicalDevices:`, d.physicalDevices);
      console.log(`[CameraDebug]   minZoom=${d.minZoom} maxZoom=${d.maxZoom} neutralZoom=${d.neutralZoom}`);
    });
  }, []);

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
    setIsQRLoading(true);
    try {
      // Mark as streaming (but vision-camera stays active for local preview with zoom)
      setIsStreamingToRemote(true);

      // Create signaling session
      const newSessionId = await createSession();
      console.log('Created session:', newSessionId);

      // Create WebRTC connection (data channel only, no video stream)
      // This allows vision-camera to keep the camera hardware for zoom support
      await createConnection();

      // Don't call startLocalStream() - we'll use snapshot-based frame capture instead
      // This keeps vision-camera in control of the camera hardware, enabling zoom

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
      setIsQRLoading(false);
    } catch (error) {
      console.error('Error setting up remote connection:', error);
      Alert.alert('Error', 'Failed to create remote connection');
      setIsStreamingToRemote(false);
      setIsQRLoading(false);
    }
  };

  const handleCloseQR = () => {
    setShowQR(false);
    cleanupSignaling();
    closeConnection();
    setIsStreamingToRemote(false);
  };

  // Update remote connection state
  useEffect(() => {
    if (connectionState === 'connected') {
      setIsRemoteConnected(true);
    } else if (connectionState === 'failed' || connectionState === 'disconnected') {
      setIsRemoteConnected(false);
    }
  }, [connectionState]);

  // Keep streaming ref in sync with state (for use in callbacks)
  useEffect(() => {
    isStreamingRef.current = isStreamingToRemote;
  }, [isStreamingToRemote]);

  // Keep facing ref in sync with state (for use in callbacks)
  useEffect(() => {
    facingRef.current = cameraState.facing;
  }, [cameraState.facing]);

  // Send state updates when camera state changes and data channel is ready
  useEffect(() => {
    if (isRemoteConnected && isDataChannelReady) {
      // Send state with frame-based mode since we always use snapshot capture
      sendStateUpdate(cameraState, availableLenses, false, false, 'frame-based');
    }
  }, [cameraState, availableLenses, isRemoteConnected, isDataChannelReady, sendStateUpdate]);

  // Reset camera initialized state when camera key changes (remount)
  useEffect(() => {
    setIsCameraInitialized(false);
  }, [cameraKey]);

  // Frame capture using vision-camera snapshot - sends frames to remote device
  const frameIdRef = useRef(0);
  useEffect(() => {
    if (!isRemoteConnected || !isDataChannelReady) {
      return;
    }

    // Wait for camera to be initialized
    if (!isCameraInitialized) {
      console.log('[CAMERA] Waiting for camera to initialize before frame capture');
      return;
    }

    // Don't capture frames during recording (to avoid performance issues)
    if (cameraState.isRecording) {
      return;
    }

    console.log('[CAMERA] Starting snapshot frame capture for remote preview');

    // Capture and send frames at ~8 FPS (need time for file I/O)
    let framesSent = 0;
    let isCapturing = false; // Prevent overlapping captures
    let startupComplete = false;

    // Delay actual capture start by 500ms to let camera fully stabilize
    const captureStartTimer = setTimeout(() => {
      console.log('[CAMERA] Camera stabilized, beginning frame capture');
      startupComplete = true;
    }, 500);

    const captureInterval = setInterval(async () => {
      // Wait for startup delay
      if (!startupComplete) return;

      // Skip if previous capture is still in progress
      if (isCapturing) return;

      isCapturing = true;
      try {
        const snapshotPath = await takeSnapshot();

        if (snapshotPath) {
          // Ensure path has file:// prefix for expo-file-system
          const fileUri = snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`;

          // Read the file and convert to base64
          let base64: string | null = null;
          try {
            base64 = await FileSystem.readAsStringAsync(fileUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          } catch {
            // Ignore read errors
          }

          if (base64) {
            const frameId = frameIdRef.current++;
            webRTCService.sendFrameData(frameId, base64, Date.now());
            framesSent++;
          }

          // Clean up the temporary snapshot file
          try {
            await FileSystem.deleteAsync(fileUri, { idempotent: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      } catch {
        // Ignore capture errors during transitions
      } finally {
        isCapturing = false;
      }
    }, 125); // ~8 FPS

    return () => {
      console.log('[CAMERA] Stopping snapshot frame capture');
      clearTimeout(captureStartTimer);
      clearInterval(captureInterval);
    };
  }, [isRemoteConnected, isDataChannelReady, isCameraInitialized, cameraState.isRecording, takeSnapshot]);

  // Navigate to remote screen
  const handleGoToRemote = () => {
    router.push('/remote');
  };

  // Handle opening gallery
  const handleOpenGallery = async () => {
    await mediaService.openGallery();
  };

  // Handle settings press
  const handleSettingsPress = () => {
    router.push('/settings');
  };

  // Handle lens selection
  const handleLensSelect = (zoom: number) => {
    setZoom(zoom);
  };

  // Actually take the photo (called directly or after timer)
  const actuallyTakePhoto = useCallback(async () => {
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
  }, [takePhoto]);

  // Handle timer countdown completion
  const handleTimerComplete = useCallback(() => {
    setShowTimerCountdown(false);
    actuallyTakePhoto();
  }, [actuallyTakePhoto]);

  // Wrap takePhoto to support timer
  const handleTakePhoto = async () => {
    if (settings.timer > 0) {
      setTimerSeconds(settings.timer);
      setShowTimerCountdown(true);
    } else {
      await actuallyTakePhoto();
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
      {/* Camera preview with aspect ratio container */}
      <AspectRatioContainer ratio={settings.aspectRatio}>
        {/* Vision camera preview - always used for local preview (supports zoom) */}
        {/* takeSnapshot captures frames to send to remote device */}
        <Camera
          key={`camera-${cameraKey}`}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isFocused && !cameraState.isRecording}
          photo={true}
          video={true}
          audio={true}
          zoom={cameraState.zoom}
          enableZoomGesture={true}
          onInitialized={handleCameraInitialized}
        />

        {/* Grid overlay */}
        <GridOverlay type={settings.gridOverlay} />
      </AspectRatioContainer>

      {/* Timer countdown overlay */}
      {showTimerCountdown && (
        <TimerCountdown
          seconds={timerSeconds}
          onComplete={handleTimerComplete}
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
        isQRLoading={isQRLoading}
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
