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
import { determineStreamMode } from '../src/utils/streamMode';
import { mediaService } from '../src/services/MediaService';
import { webRTCService } from '../src/services/WebRTCService';
import { Command, CameraState, LensInfo, StreamMode } from '../src/types';

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

  // Stream mode tracking (WebRTC for 1x/front, frame-based for other zoom levels)
  const [currentStreamMode, setCurrentStreamMode] = useState<StreamMode>('frame-based');

  // Track if WebRTC is actively using the camera (to deactivate vision-camera during WebRTC streaming)
  const [isWebRTCUsingCamera, setIsWebRTCUsingCamera] = useState(false);

  // Track if remote connection is active (used for showing connection indicator)
  const [isStreamingToRemote, setIsStreamingToRemote] = useState(false);
  // Key to force Camera remount when screen regains focus (fixes vision-camera not restarting)
  const [cameraKey, setCameraKey] = useState(0);
  // Zoom override - used to mount camera at 1x then update to target zoom after init
  // This works around vision-camera not applying zoom prop at mount time
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  // Ref to track streaming state for use in callbacks (avoids stale closure issues)
  const isStreamingRef = useRef(false);

  // Ref to track current facing for use in callbacks (avoids stale closure issues)
  const facingRef = useRef<'front' | 'back'>('back');

  // Ref to track current stream mode for use in callbacks (avoids stale closure issues)
  const streamModeRef = useRef<StreamMode>('frame-based');

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
    setIsCameraInitialized(true);

    // Clear zoom override after a brief delay to apply the actual target zoom
    // This works around vision-camera not respecting zoom prop at mount time
    if (zoomOverride !== null) {
      setTimeout(() => {
        setZoomOverride(null);
      }, 100);
    }
  }, [zoomOverride]);

  // Handle incoming commands from remote
  const handleCommand = useCallback(async (command: Command) => {
    switch (command.type) {
      case 'TAKE_PHOTO':
        try {
          // If WebRTC is using the camera, temporarily release it for vision-camera
          const wasUsingWebRTC = streamModeRef.current === 'webrtc';
          if (wasUsingWebRTC) {
            pauseLocalStream();
            setIsWebRTCUsingCamera(false);
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // Take a snapshot FIRST for preview (captures what's about to be photographed)
          // This is small enough to send over the data channel
          let previewBase64: string | null = null;
          try {
            const snapshotPath = await takeSnapshot();
            if (snapshotPath) {
              const fileUri = snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`;
              previewBase64 = await FileSystem.readAsStringAsync(fileUri, {
                encoding: FileSystem.EncodingType.Base64,
              });
              await FileSystem.deleteAsync(fileUri, { idempotent: true });
            }
          } catch (snapshotError) {
            console.error('Error taking preview snapshot:', snapshotError);
          }

          // Now take the actual full-resolution photo
          await takePhoto();

          // Resume WebRTC stream if it was active
          if (wasUsingWebRTC) {
            setIsWebRTCUsingCamera(true);
            await new Promise(resolve => setTimeout(resolve, 200));
            await resumeLocalStream(facingRef.current);
          }

          sendResponse({ type: 'PHOTO_TAKEN', success: true });

          // Send the preview to remote and update local thumbnail
          setTimeout(async () => {
            try {
              // Update last photo URI for local display
              const photo = await mediaService.getLastPhoto();
              if (photo) {
                setLastPhotoUri(photo.uri);
              }

              // Send the preview snapshot to remote
              if (previewBase64) {
                console.log(`[CAMERA] Sending photo preview to remote: ${previewBase64.length} bytes`);
                sendResponse({ type: 'PHOTO_DATA', data: previewBase64, timestamp: Date.now() });
              }
            } catch (photoError) {
              console.error('Error sending photo to remote:', photoError);
            }
          }, 500);
        } catch (error) {
          // Try to resume WebRTC even if photo failed
          if (streamModeRef.current === 'webrtc') {
            setIsWebRTCUsingCamera(true);
            await new Promise(resolve => setTimeout(resolve, 200));
            await resumeLocalStream(facingRef.current);
          }
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
        // Send state with current stream mode (uses ref to avoid stale closure)
        sendStateUpdate(cameraState, availableLenses, false, false, streamModeRef.current);
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
    pauseLocalStream,
    resumeLocalStream,
    close: closeConnection,
  } = usePeerConnection({
    role: 'camera',
    onCommand: handleCommand,
    onIceCandidate: async (candidate) => {
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

  const cameraIsActive = isFocused && !cameraState.isRecording && !isWebRTCUsingCamera;

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
    setIsQRLoading(true);
    try {
      setIsStreamingToRemote(true);

      // Create signaling session and WebRTC connection
      await createSession();
      await createConnection();

      // Determine initial stream mode based on current camera state
      const initialStreamMode = determineStreamMode(cameraState.facing, cameraState.zoom);

      // Add video track BEFORE creating offer so it's included in SDP negotiation
      if (initialStreamMode === 'webrtc') {
        setIsWebRTCUsingCamera(true);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      await startLocalStream();
      setCurrentStreamMode(initialStreamMode);

      // If starting in frame-based mode, pause the WebRTC stream immediately
      if (initialStreamMode === 'frame-based') {
        pauseLocalStream();
      }

      // Create and send offer
      const offer = await createOffer();
      await sendOffer({ type: 'offer', sdp: offer.sdp! });

      // Listen for ICE candidates from remote
      listenForIceCandidate(async (candidate) => {
        await addPeerIceCandidate(candidate);
      });

      // Listen for answer from remote
      onAnswer(async (answer) => {
        await setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        setIsRemoteConnected(true);
        setShowQR(false);
      });

      setShowQR(true);
      setIsQRLoading(false);
    } catch (error) {
      console.error('[CAMERA] Connection setup error:', error);
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
    setIsWebRTCUsingCamera(false);
    setCurrentStreamMode('frame-based');
  };

  // Update remote connection state
  useEffect(() => {
    if (connectionState === 'connected') {
      setIsRemoteConnected(true);
    } else if (connectionState === 'failed' || connectionState === 'disconnected') {
      setIsRemoteConnected(false);
      setIsWebRTCUsingCamera(false);
      setCurrentStreamMode('frame-based');
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

  // Keep stream mode ref in sync with state (for use in callbacks)
  useEffect(() => {
    streamModeRef.current = currentStreamMode;
  }, [currentStreamMode]);

  // Handle stream mode switching between WebRTC and frame-based
  const handleStreamModeSwitch = useCallback(async (newMode: StreamMode) => {
    if (newMode === 'webrtc') {
      // Clear any pending zoom override
      if (zoomOverride !== null) {
        setZoomOverride(null);
      }
      // Deactivate vision-camera, then start WebRTC stream
      setIsWebRTCUsingCamera(true);
      await new Promise(resolve => setTimeout(resolve, 200));
      try {
        await resumeLocalStream(cameraState.facing);
      } catch (error) {
        console.error('[CAMERA] WebRTC resume error:', error);
      }
    } else {
      // Pause WebRTC stream to release the camera
      pauseLocalStream();
      await new Promise(resolve => setTimeout(resolve, 200));
      // Set zoom override to mount camera at 1x - actual zoom applied after init
      // (works around vision-camera not respecting zoom prop at mount time)
      setZoomOverride(1);
      setIsCameraInitialized(false);
      setCameraKey(prev => prev + 1);
      setIsWebRTCUsingCamera(false);
    }
    setCurrentStreamMode(newMode);
    sendStateUpdate(cameraState, availableLenses, false, false, newMode);
  }, [resumeLocalStream, pauseLocalStream, sendStateUpdate, cameraState, availableLenses, zoomOverride]);

  // Debounced stream mode detection based on camera facing and zoom
  useEffect(() => {
    if (!isDataChannelReady) return;

    const targetMode = determineStreamMode(cameraState.facing, cameraState.zoom);
    if (targetMode === streamModeRef.current) return;

    // Debounce to avoid rapid switching during pinch-to-zoom
    const debounceTimer = setTimeout(() => {
      const currentTargetMode = determineStreamMode(cameraState.facing, cameraState.zoom);
      if (currentTargetMode !== streamModeRef.current) {
        handleStreamModeSwitch(currentTargetMode);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [cameraState.facing, cameraState.zoom, isDataChannelReady, handleStreamModeSwitch]);

  // Send state updates when camera state changes and data channel is ready
  useEffect(() => {
    if (isDataChannelReady) {
      sendStateUpdate(cameraState, availableLenses, false, false, currentStreamMode);
    }
  }, [cameraState, availableLenses, isDataChannelReady, sendStateUpdate, currentStreamMode]);

  // Reset camera initialized state when camera key changes (remount)
  useEffect(() => {
    setIsCameraInitialized(false);
  }, [cameraKey]);

  // Frame capture using vision-camera snapshot - sends frames to remote device
  // Only used when in frame-based mode (not WebRTC)
  const frameIdRef = useRef(0);
  useEffect(() => {
    if (!isDataChannelReady) return;
    if (currentStreamMode === 'webrtc') return;
    if (!isCameraInitialized) return;
    if (zoomOverride !== null) return;
    if (cameraState.isRecording) return;

    // Capture and send frames at ~8 FPS (need time for file I/O)
    let isCapturing = false; // Prevent overlapping captures
    let startupComplete = false;

    // Delay actual capture start to let camera fully stabilize and switch lenses
    // 1000ms gives time for telephoto lens selection when zoom > 1
    const captureStartTimer = setTimeout(() => {
      startupComplete = true;
    }, 1000);

    const captureInterval = setInterval(async () => {
      if (!startupComplete) return;
      if (isCapturing) return;

      isCapturing = true;
      try {
        const snapshotPath = await takeSnapshot();

        if (snapshotPath) {
          // Ensure path has file:// prefix for expo-file-system
          const fileUri = snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`;

          // Read the file and convert to base64
          try {
            const base64 = await FileSystem.readAsStringAsync(fileUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const frameId = frameIdRef.current++;
            webRTCService.sendFrameData(frameId, base64, Date.now());
          } catch {
            // Ignore read errors
          }

          // Clean up the temporary snapshot file
          try {
            await FileSystem.deleteAsync(fileUri, { idempotent: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      } catch (error) {
        console.error('[CAMERA] Frame capture error:', error);
      } finally {
        isCapturing = false;
      }
    }, 125); // ~8 FPS

    return () => {
      clearTimeout(captureStartTimer);
      clearInterval(captureInterval);
    };
  }, [isDataChannelReady, isCameraInitialized, cameraState.isRecording, takeSnapshot, currentStreamMode, zoomOverride, cameraState.zoom]);

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
          isActive={cameraIsActive}
          photo={true}
          video={true}
          audio={true}
          zoom={zoomOverride ?? cameraState.zoom}
          enableZoomGesture={true}
          onInitialized={handleCameraInitialized}
        />

        {/* Grid overlay */}
        <GridOverlay type={settings.gridOverlay} />

        {/* Frozen preview notice when WebRTC is using the camera */}
        {isWebRTCUsingCamera && (
          <View style={styles.frozenOverlay}>
            <Text style={styles.frozenText}>Preview paused</Text>
            <Text style={styles.frozenSubtext}>Use remote device to see live preview</Text>
          </View>
        )}
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
  frozenOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  frozenText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  frozenSubtext: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
});
