import { useState, useCallback, useEffect, useRef } from 'react';
import { signalingService } from '../services/SignalingService';
import { SignalingOffer, SignalingAnswer, IceCandidate } from '../types';
import { Unsubscribe } from 'firebase/firestore';

type Role = 'camera' | 'remote';

interface UseSignalingReturn {
  sessionId: string | null;
  isConnected: boolean;
  error: string | null;
  createSession: () => Promise<string>;
  joinSession: (sessionId: string) => Promise<boolean>;
  sendOffer: (offer: SignalingOffer) => Promise<void>;
  sendAnswer: (answer: SignalingAnswer) => Promise<void>;
  addIceCandidate: (candidate: IceCandidate) => Promise<void>;
  onOffer: (callback: (offer: SignalingOffer) => void) => void;
  onAnswer: (callback: (answer: SignalingAnswer) => void) => void;
  onIceCandidate: (callback: (candidate: IceCandidate) => void) => void;
  cleanup: () => void;
}

export function useSignaling(role: Role): UseSignalingReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unsubscribersRef = useRef<Unsubscribe[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    // Unsubscribe from all listeners
    unsubscribersRef.current.forEach((unsub) => unsub());
    unsubscribersRef.current = [];

    // Cleanup signaling service
    signalingService.cleanup();

    setSessionId(null);
    setIsConnected(false);
    setError(null);
  }, []);

  // Create a new session (camera device)
  const createSession = useCallback(async (): Promise<string> => {
    try {
      setError(null);
      const id = await signalingService.createSession();
      setSessionId(id);
      return id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      setError(message);
      throw err;
    }
  }, []);

  // Join an existing session (remote device)
  const joinSession = useCallback(async (id: string): Promise<boolean> => {
    try {
      setError(null);
      const success = await signalingService.joinSession(id);

      if (success) {
        setSessionId(id);
        return true;
      } else {
        setError('Session not found');
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join session';
      setError(message);
      throw err;
    }
  }, []);

  // Send WebRTC offer
  const sendOffer = useCallback(async (offer: SignalingOffer): Promise<void> => {
    if (!sessionId) {
      throw new Error('No active session');
    }

    try {
      await signalingService.sendOffer(sessionId, offer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send offer';
      setError(message);
      throw err;
    }
  }, [sessionId]);

  // Send WebRTC answer
  const sendAnswer = useCallback(async (answer: SignalingAnswer): Promise<void> => {
    if (!sessionId) {
      throw new Error('No active session');
    }

    try {
      await signalingService.sendAnswer(sessionId, answer);
      setIsConnected(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send answer';
      setError(message);
      throw err;
    }
  }, [sessionId]);

  // Add ICE candidate
  const addIceCandidate = useCallback(async (candidate: IceCandidate): Promise<void> => {
    if (!sessionId) {
      throw new Error('No active session');
    }

    try {
      // Role determines which subcollection to use
      const candidateRole = role === 'camera' ? 'offer' : 'answer';
      await signalingService.addIceCandidate(sessionId, candidate, candidateRole);
    } catch (err) {
      console.error('Failed to add ICE candidate:', err);
      // Don't throw - ICE candidate failures are often recoverable
    }
  }, [sessionId, role]);

  // Listen for offer (remote device listens)
  const onOffer = useCallback((callback: (offer: SignalingOffer) => void): void => {
    if (!sessionId) {
      console.error('No active session');
      return;
    }

    const unsubscribe = signalingService.onOffer(sessionId, callback);
    unsubscribersRef.current.push(unsubscribe);
  }, [sessionId]);

  // Listen for answer (camera device listens)
  const onAnswer = useCallback((callback: (answer: SignalingAnswer) => void): void => {
    if (!sessionId) {
      console.error('No active session');
      return;
    }

    const unsubscribe = signalingService.onAnswer(sessionId, (answer) => {
      setIsConnected(true);
      callback(answer);
    });
    unsubscribersRef.current.push(unsubscribe);
  }, [sessionId]);

  // Listen for ICE candidates
  const onIceCandidate = useCallback((callback: (candidate: IceCandidate) => void): void => {
    if (!sessionId) {
      console.error('No active session');
      return;
    }

    // Camera listens for answer candidates, remote listens for offer candidates
    const candidateRole = role === 'camera' ? 'answer' : 'offer';
    const unsubscribe = signalingService.onIceCandidate(sessionId, candidateRole, callback);
    unsubscribersRef.current.push(unsubscribe);
  }, [sessionId, role]);

  return {
    sessionId,
    isConnected,
    error,
    createSession,
    joinSession,
    sendOffer,
    sendAnswer,
    addIceCandidate,
    onOffer,
    onAnswer,
    onIceCandidate,
    cleanup,
  };
}

export default useSignaling;
