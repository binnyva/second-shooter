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
    console.log('[CAMERA] Vision camera initialized (onInitialized callback fired)');
    console.log(`[CAMERA] Current state: isWebRTCUsingCamera=${isWebRTCUsingCamera}, currentStreamMode=${currentStreamMode}`);
    setIsCameraInitialized(true);
  }, [isWebRTCUsingCamera, currentStreamMode]);

  // Handle incoming commands from remote
  const handleCommand = useCallback(async (command: Command) => {
    console.log('[CAMERA] Received command:', command.type);

    switch (command.type) {
      case 'TAKE_PHOTO':
        try {
          // If WebRTC is using the camera, we need to temporarily release it
          // so vision-camera can take the photo
          const wasUsingWebRTC = streamModeRef.current === 'webrtc';
          if (wasUsingWebRTC) {
            console.log('[CAMERA] TAKE_PHOTO: Pausing WebRTC stream to release camera...');
            pauseLocalStream();
            setIsWebRTCUsingCamera(false);
            // Wait for camera hardware to be released and vision-camera to initialize
            // This needs sufficient time for: React re-render + camera hardware release + vision-camera init
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          await takePhoto();

          // Resume WebRTC stream if it was active
          if (wasUsingWebRTC) {
            console.log('[CAMERA] TAKE_PHOTO: Resuming WebRTC stream...');
            setIsWebRTCUsingCamera(true);
            await new Promise(resolve => setTimeout(resolve, 200));
            await resumeLocalStream(facingRef.current);
          }

          sendResponse({ type: 'PHOTO_TAKEN', success: true });
        } catch (error) {
          // Try to resume WebRTC even if photo failed
          if (streamModeRef.current === 'webrtc') {
            console.log('[CAMERA] TAKE_PHOTO: Error occurred, resuming WebRTC stream...');
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

  // Debug: Log camera isActive state changes
  const cameraIsActive = isFocused && !cameraState.isRecording && !isWebRTCUsingCamera;
  useEffect(() => {
    console.log(`[CAMERA] Vision camera isActive changed: ${cameraIsActive}`);
    console.log(`[CAMERA]   - isFocused=${isFocused}, isRecording=${cameraState.isRecording}, isWebRTCUsingCamera=${isWebRTCUsingCamera}`);
  }, [cameraIsActive, isFocused, cameraState.isRecording, isWebRTCUsingCamera]);

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
    console.log('[CAMERA] handleShowQR: Starting connection setup...');
    setIsQRLoading(true);
    try {
      // Mark as streaming (but vision-camera stays active for local preview with zoom)
      setIsStreamingToRemote(true);

      // Create signaling session
      const newSessionId = await createSession();
      console.log('[CAMERA] handleShowQR: Created session:', newSessionId);

      // Create WebRTC connection
      console.log('[CAMERA] handleShowQR: Creating WebRTC connection...');
      await createConnection();
      console.log('[CAMERA] handleShowQR: WebRTC connection created');

      // Determine initial stream mode based on current camera state
      const initialStreamMode = determineStreamMode(cameraState.facing, cameraState.zoom);
      console.log(`[CAMERA] handleShowQR: Initial stream mode will be: ${initialStreamMode}`);

      // IMPORTANT: Add video track BEFORE creating offer so it's included in SDP negotiation
      // This avoids the need for renegotiation when switching to WebRTC mode later
      if (initialStreamMode === 'webrtc') {
        console.log('[CAMERA] handleShowQR: Starting in WebRTC mode, deactivating vision-camera first...');
        setIsWebRTCUsingCamera(true);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log('[CAMERA] handleShowQR: Adding video track to connection...');
      await startLocalStream();
      setCurrentStreamMode(initialStreamMode);

      // If starting in frame-based mode, pause the WebRTC stream immediately
      // (the track is in the SDP but we won't send video frames)
      if (initialStreamMode === 'frame-based') {
        console.log('[CAMERA] handleShowQR: Starting in frame-based mode, pausing WebRTC stream...');
        pauseLocalStream();
      }

      // Create and send offer (now includes video track)
      console.log('[CAMERA] handleShowQR: Creating offer...');
      const offer = await createOffer();
      console.log('[CAMERA] handleShowQR: Offer created, sending to signaling...');
      await sendOffer({ type: 'offer', sdp: offer.sdp! });

      // Listen for ICE candidates from remote
      listenForIceCandidate(async (candidate) => {
        console.log('[CAMERA] Received ICE candidate from remote');
        await addPeerIceCandidate(candidate);
      });

      // Listen for answer from remote
      onAnswer(async (answer) => {
        console.log('[CAMERA] Received answer from remote, setting remote description...');
        await setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        console.log('[CAMERA] Remote description set. Connection should be established.');
        setIsRemoteConnected(true);
        setShowQR(false);
      });

      setShowQR(true);
      setIsQRLoading(false);
      console.log('[CAMERA] handleShowQR: Setup complete, showing QR code');
    } catch (error) {
      console.error('[CAMERA] handleShowQR ERROR:', error);
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
    console.log(`[CAMERA] Connection state changed: ${connectionState}`);
    if (connectionState === 'connected') {
      console.log(`[CAMERA] Remote connected! Setting isRemoteConnected=true`);
      setIsRemoteConnected(true);
    } else if (connectionState === 'failed' || connectionState === 'disconnected') {
      console.log(`[CAMERA] Remote disconnected. Resetting states...`);
      setIsRemoteConnected(false);
      // Reset WebRTC camera usage when connection drops
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
    console.log(`[CAMERA] ========== STREAM MODE SWITCH START ==========`);
    console.log(`[CAMERA] Current mode: ${streamModeRef.current}, Target mode: ${newMode}`);
    console.log(`[CAMERA] Current state: isWebRTCUsingCamera=${isWebRTCUsingCamera}, isCameraInitialized=${isCameraInitialized}`);
    console.log(`[CAMERA] Camera facing: ${cameraState.facing}`);

    if (newMode === 'webrtc') {
      // First, mark that WebRTC will use the camera (this deactivates vision-camera)
      console.log(`[CAMERA] Step 1: Setting isWebRTCUsingCamera=true (deactivating vision-camera)`);
      setIsWebRTCUsingCamera(true);
      // Wait for vision-camera to release the camera hardware
      console.log(`[CAMERA] Step 2: Waiting 200ms for vision-camera to release...`);
      await new Promise(resolve => setTimeout(resolve, 200));
      // Resume WebRTC stream (track already exists, just replace with new stream)
      console.log(`[CAMERA] Step 3: Resuming WebRTC local stream...`);
      try {
        await resumeLocalStream(cameraState.facing);
        console.log(`[CAMERA] Step 3: WebRTC local stream resumed successfully`);
      } catch (error) {
        console.error(`[CAMERA] Step 3 FAILED: WebRTC resume error:`, error);
      }
    } else {
      // First, pause WebRTC stream to release the camera
      console.log(`[CAMERA] Step 1: Pausing WebRTC stream...`);
      pauseLocalStream();
      // Wait for WebRTC to release the camera hardware
      console.log(`[CAMERA] Step 2: Waiting 200ms for WebRTC to release camera...`);
      await new Promise(resolve => setTimeout(resolve, 200));
      // Reset camera initialized state so frame capture waits for vision-camera to restart
      console.log(`[CAMERA] Step 3: Setting isCameraInitialized=false`);
      setIsCameraInitialized(false);
      // Force camera remount to ensure onInitialized fires
      console.log(`[CAMERA] Step 4: Incrementing cameraKey to force remount`);
      setCameraKey(prev => prev + 1);
      // Mark that WebRTC is no longer using the camera (this reactivates vision-camera)
      console.log(`[CAMERA] Step 5: Setting isWebRTCUsingCamera=false (reactivating vision-camera)`);
      setIsWebRTCUsingCamera(false);
    }
    console.log(`[CAMERA] Step Final: Setting currentStreamMode=${newMode}`);
    setCurrentStreamMode(newMode);
    sendStateUpdate(cameraState, availableLenses, false, false, newMode);
    console.log(`[CAMERA] ========== STREAM MODE SWITCH END ==========`);
  }, [resumeLocalStream, pauseLocalStream, sendStateUpdate, cameraState, availableLenses, isWebRTCUsingCamera, isCameraInitialized]);

  // Debounced stream mode detection based on camera facing and zoom
  useEffect(() => {
    if (!isRemoteConnected || !isDataChannelReady) {
      console.log(`[CAMERA] Stream mode check skipped: isRemoteConnected=${isRemoteConnected}, isDataChannelReady=${isDataChannelReady}`);
      return;
    }

    const targetMode = determineStreamMode(cameraState.facing, cameraState.zoom);
    console.log(`[CAMERA] Stream mode check: facing=${cameraState.facing}, zoom=${cameraState.zoom.toFixed(2)}, targetMode=${targetMode}, currentMode=${streamModeRef.current}`);

    // Only switch if mode actually changed
    if (targetMode === streamModeRef.current) {
      return;
    }

    console.log(`[CAMERA] Stream mode change needed: ${streamModeRef.current} -> ${targetMode}, starting 300ms debounce...`);

    // Debounce to avoid rapid switching during pinch-to-zoom
    const debounceTimer = setTimeout(() => {
      // Re-check after debounce in case values changed
      const currentTargetMode = determineStreamMode(cameraState.facing, cameraState.zoom);
      console.log(`[CAMERA] Debounce complete: currentTargetMode=${currentTargetMode}, streamModeRef=${streamModeRef.current}`);
      if (currentTargetMode !== streamModeRef.current) {
        console.log(`[CAMERA] Triggering stream mode switch...`);
        handleStreamModeSwitch(currentTargetMode);
      } else {
        console.log(`[CAMERA] Mode already matches, skipping switch`);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [cameraState.facing, cameraState.zoom, isRemoteConnected, isDataChannelReady, handleStreamModeSwitch]);

  // Log data channel ready state changes
  useEffect(() => {
    console.log(`[CAMERA] isDataChannelReady changed: ${isDataChannelReady}`);
  }, [isDataChannelReady]);

  // Send state updates when camera state changes and data channel is ready
  useEffect(() => {
    if (isRemoteConnected && isDataChannelReady) {
      console.log(`[CAMERA] Sending state update: zoom=${cameraState.zoom.toFixed(2)}, facing=${cameraState.facing}, streamMode=${currentStreamMode}`);
      sendStateUpdate(cameraState, availableLenses, false, false, currentStreamMode);
    }
  }, [cameraState, availableLenses, isRemoteConnected, isDataChannelReady, sendStateUpdate, currentStreamMode]);

  // Reset camera initialized state when camera key changes (remount)
  useEffect(() => {
    console.log(`[CAMERA] cameraKey changed to ${cameraKey}, resetting isCameraInitialized to false`);
    setIsCameraInitialized(false);
  }, [cameraKey]);

  // Debug: Log isCameraInitialized changes
  useEffect(() => {
    console.log(`[CAMERA] isCameraInitialized changed to: ${isCameraInitialized}`);
  }, [isCameraInitialized]);

  // Frame capture using vision-camera snapshot - sends frames to remote device
  // Only used when in frame-based mode (not WebRTC)
  const frameIdRef = useRef(0);
  useEffect(() => {
    console.log(`[CAMERA] Frame capture effect triggered: isRemoteConnected=${isRemoteConnected}, isDataChannelReady=${isDataChannelReady}, currentStreamMode=${currentStreamMode}, isCameraInitialized=${isCameraInitialized}, isRecording=${cameraState.isRecording}`);

    if (!isRemoteConnected || !isDataChannelReady) {
      console.log('[CAMERA] Frame capture: Not connected, skipping');
      return;
    }

    // Skip frame capture when using WebRTC native stream
    if (currentStreamMode === 'webrtc') {
      console.log('[CAMERA] Frame capture: Using WebRTC stream, skipping frame capture');
      return;
    }

    // Wait for camera to be initialized
    if (!isCameraInitialized) {
      console.log('[CAMERA] Frame capture: Waiting for camera to initialize');
      return;
    }

    // Don't capture frames during recording (to avoid performance issues)
    if (cameraState.isRecording) {
      console.log('[CAMERA] Frame capture: Recording in progress, skipping');
      return;
    }

    console.log('[CAMERA] Frame capture: Starting snapshot frame capture for remote preview (frame-based mode)');

    // Capture and send frames at ~8 FPS (need time for file I/O)
    let framesSent = 0;
    let frameErrors = 0;
    let isCapturing = false; // Prevent overlapping captures
    let startupComplete = false;

    // Delay actual capture start by 500ms to let camera fully stabilize
    const captureStartTimer = setTimeout(() => {
      console.log('[CAMERA] Frame capture: Camera stabilized, beginning frame capture');
      startupComplete = true;
    }, 500);

    // Log frame stats every 3 seconds
    const statsInterval = setInterval(() => {
      if (startupComplete) {
        console.log(`[CAMERA] Frame capture stats: sent=${framesSent}, errors=${frameErrors}, isCapturing=${isCapturing}`);
      }
    }, 3000);

    const captureInterval = setInterval(async () => {
      // Wait for startup delay
      if (!startupComplete) {
        console.log('[CAMERA] Frame capture: waiting for startup delay...');
        return;
      }

      // Skip if previous capture is still in progress
      if (isCapturing) {
        console.log('[CAMERA] Frame capture: previous capture still in progress, skipping');
        return;
      }

      isCapturing = true;
      const attemptNum = framesSent + frameErrors + 1;
      console.log(`[CAMERA] Capture attempt ${attemptNum}: calling takeSnapshot...`);
      try {
        const snapshotPath = await takeSnapshot();
        console.log(`[CAMERA] Capture attempt ${attemptNum}: snapshotPath=${snapshotPath ? 'got path' : 'NULL/undefined'}`);

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
            frameErrors++;
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
        } else {
          frameErrors++;
        }
      } catch (error) {
        frameErrors++;
        console.log(`[CAMERA] Frame capture error:`, error);
      } finally {
        isCapturing = false;
      }
    }, 125); // ~8 FPS

    return () => {
      console.log(`[CAMERA] *** Frame capture CLEANUP triggered! *** Total sent=${framesSent}, errors=${frameErrors}`);
      console.log(`[CAMERA] Cleanup reason - check which dependency changed:`);
      console.log(`[CAMERA]   isRemoteConnected=${isRemoteConnected}, isDataChannelReady=${isDataChannelReady}`);
      console.log(`[CAMERA]   isCameraInitialized=${isCameraInitialized}, isRecording=${cameraState.isRecording}`);
      console.log(`[CAMERA]   currentStreamMode=${currentStreamMode}`);
      clearTimeout(captureStartTimer);
      clearInterval(captureInterval);
      clearInterval(statsInterval);
    };
  }, [isRemoteConnected, isDataChannelReady, isCameraInitialized, cameraState.isRecording, takeSnapshot, currentStreamMode]);

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
