import { useState, useCallback, useEffect, useRef } from 'react';
import { MediaStream } from 'react-native-webrtc';
import { webRTCService } from '../services/WebRTCService';
import { ConnectionState, Command, Response, IceCandidate, CameraState } from '../types';

type Role = 'camera' | 'remote';

interface UsePeerConnectionOptions {
  role: Role;
  onCommand?: (command: Command) => void;
  onResponse?: (response: Response) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onIceCandidate?: (candidate: IceCandidate) => void;
}

interface UsePeerConnectionReturn {
  connectionState: ConnectionState;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  createConnection: () => Promise<void>;
  createOffer: () => Promise<RTCSessionDescriptionInit>;
  createAnswer: () => Promise<RTCSessionDescriptionInit>;
  setRemoteDescription: (description: RTCSessionDescriptionInit) => Promise<void>;
  addIceCandidate: (candidate: IceCandidate) => Promise<void>;
  sendCommand: (command: Command) => void;
  sendResponse: (response: Response) => void;
  sendStateUpdate: (state: CameraState) => void;
  startLocalStream: () => Promise<MediaStream>;
  close: () => void;
}

export function usePeerConnection({
  role,
  onCommand,
  onResponse,
  onRemoteStream,
  onIceCandidate,
}: UsePeerConnectionOptions): UsePeerConnectionReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const isInitializedRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      webRTCService.close();
    };
  }, []);

  // Create peer connection
  const createConnection = useCallback(async (): Promise<void> => {
    if (isInitializedRef.current) {
      return;
    }

    webRTCService.createPeerConnection();
    isInitializedRef.current = true;

    // Set up callbacks
    webRTCService.onConnectionState((state) => {
      setConnectionState(state);
    });

    webRTCService.onRemoteStream((stream) => {
      setRemoteStream(stream);
      onRemoteStream?.(stream);
    });

    webRTCService.onIceCandidate((candidate) => {
      onIceCandidate?.(candidate);
    });

    if (onCommand) {
      webRTCService.onCommand(onCommand);
    }

    if (onResponse) {
      webRTCService.onResponse(onResponse);
    }

    // Camera device creates the data channel
    if (role === 'camera') {
      webRTCService.createDataChannel();
    }

    setConnectionState('connecting');
  }, [role, onCommand, onResponse, onRemoteStream, onIceCandidate]);

  // Create SDP offer (camera device)
  const createOffer = useCallback(async (): Promise<RTCSessionDescriptionInit> => {
    return webRTCService.createOffer();
  }, []);

  // Create SDP answer (remote device)
  const createAnswer = useCallback(async (): Promise<RTCSessionDescriptionInit> => {
    return webRTCService.createAnswer();
  }, []);

  // Set remote description
  const setRemoteDescription = useCallback(async (
    description: RTCSessionDescriptionInit
  ): Promise<void> => {
    await webRTCService.setRemoteDescription(description);
  }, []);

  // Add ICE candidate
  const addIceCandidate = useCallback(async (candidate: IceCandidate): Promise<void> => {
    try {
      await webRTCService.addIceCandidate(candidate);
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
      // Don't throw - ICE failures are often recoverable
    }
  }, []);

  // Send command (remote device)
  const sendCommand = useCallback((command: Command): void => {
    webRTCService.sendCommand(command);
  }, []);

  // Send response (camera device)
  const sendResponse = useCallback((response: Response): void => {
    webRTCService.sendResponse(response);
  }, []);

  // Send state update (camera device)
  const sendStateUpdate = useCallback((state: CameraState): void => {
    webRTCService.sendResponse({
      type: 'STATE_UPDATE',
      state,
    });
  }, []);

  // Start local stream and add to connection (camera device)
  const startLocalStream = useCallback(async (): Promise<MediaStream> => {
    const stream = await webRTCService.getLocalStream('back');
    setLocalStream(stream);
    webRTCService.addLocalStream(stream);
    return stream;
  }, []);

  // Close connection
  const close = useCallback((): void => {
    webRTCService.close();
    isInitializedRef.current = false;
    setConnectionState('disconnected');
    setRemoteStream(null);
    setLocalStream(null);
  }, []);

  return {
    connectionState,
    remoteStream,
    localStream,
    createConnection,
    createOffer,
    createAnswer,
    setRemoteDescription,
    addIceCandidate,
    sendCommand,
    sendResponse,
    sendStateUpdate,
    startLocalStream,
    close,
  };
}

export default usePeerConnection;
