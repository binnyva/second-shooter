import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
  DocumentReference,
  CollectionReference,
} from 'firebase/firestore';
import {
  db,
  SESSIONS_COLLECTION,
  OFFER_CANDIDATES_SUBCOLLECTION,
  ANSWER_CANDIDATES_SUBCOLLECTION,
} from '../config/firebase';
import { generateSessionId } from '../utils/sessionId';
import { SignalingOffer, SignalingAnswer, IceCandidate } from '../types';

type IceCandidateCallback = (candidate: IceCandidate) => void;
type OfferCallback = (offer: SignalingOffer) => void;
type AnswerCallback = (answer: SignalingAnswer) => void;

class SignalingService {
  private sessionId: string | null = null;
  private unsubscribers: Unsubscribe[] = [];

  // Create a new signaling session
  async createSession(): Promise<string> {
    const sessionId = generateSessionId();
    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);

    await setDoc(sessionRef, {
      createdAt: serverTimestamp(),
      status: 'waiting',
    });

    this.sessionId = sessionId;
    return sessionId;
  }

  // Join an existing session
  async joinSession(sessionId: string): Promise<boolean> {
    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
    const sessionDoc = await getDoc(sessionRef);

    if (!sessionDoc.exists()) {
      return false;
    }

    this.sessionId = sessionId;
    return true;
  }

  // Send WebRTC offer
  async sendOffer(sessionId: string, offer: SignalingOffer): Promise<void> {
    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
    await setDoc(
      sessionRef,
      {
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
        status: 'offer_sent',
      },
      { merge: true }
    );
  }

  // Send WebRTC answer
  async sendAnswer(sessionId: string, answer: SignalingAnswer): Promise<void> {
    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
    await setDoc(
      sessionRef,
      {
        answer: {
          type: answer.type,
          sdp: answer.sdp,
        },
        status: 'connected',
      },
      { merge: true }
    );
  }

  // Listen for offer
  onOffer(sessionId: string, callback: OfferCallback): Unsubscribe {
    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);

    const unsubscribe = onSnapshot(sessionRef, (snapshot) => {
      const data = snapshot.data();
      if (data?.offer) {
        callback({
          type: data.offer.type,
          sdp: data.offer.sdp,
        });
      }
    });

    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  // Listen for answer
  onAnswer(sessionId: string, callback: AnswerCallback): Unsubscribe {
    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);

    const unsubscribe = onSnapshot(sessionRef, (snapshot) => {
      const data = snapshot.data();
      if (data?.answer) {
        callback({
          type: data.answer.type,
          sdp: data.answer.sdp,
        });
      }
    });

    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  // Add ICE candidate
  async addIceCandidate(
    sessionId: string,
    candidate: IceCandidate,
    role: 'offer' | 'answer'
  ): Promise<void> {
    const subcollection =
      role === 'offer'
        ? OFFER_CANDIDATES_SUBCOLLECTION
        : ANSWER_CANDIDATES_SUBCOLLECTION;

    const candidatesRef = collection(
      db,
      SESSIONS_COLLECTION,
      sessionId,
      subcollection
    );

    await addDoc(candidatesRef, {
      candidate: candidate.candidate,
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid,
    });
  }

  // Listen for ICE candidates
  onIceCandidate(
    sessionId: string,
    role: 'offer' | 'answer',
    callback: IceCandidateCallback
  ): Unsubscribe {
    const subcollection =
      role === 'offer'
        ? OFFER_CANDIDATES_SUBCOLLECTION
        : ANSWER_CANDIDATES_SUBCOLLECTION;

    const candidatesRef = collection(
      db,
      SESSIONS_COLLECTION,
      sessionId,
      subcollection
    );

    const unsubscribe = onSnapshot(candidatesRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          callback({
            candidate: data.candidate,
            sdpMLineIndex: data.sdpMLineIndex,
            sdpMid: data.sdpMid,
          });
        }
      });
    });

    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  // Delete session and cleanup
  async deleteSession(sessionId: string): Promise<void> {
    try {
      // Delete ICE candidates subcollections would require a cloud function
      // For now, just delete the main session document
      // The old sessions will be cleaned up by Firestore TTL rules or manual cleanup
      const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
      await deleteDoc(sessionRef);
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  }

  // Cleanup all listeners
  cleanup(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];

    if (this.sessionId) {
      this.deleteSession(this.sessionId);
      this.sessionId = null;
    }
  }

  // Get current session ID
  getSessionId(): string | null {
    return this.sessionId;
  }
}

// Export singleton instance
export const signalingService = new SignalingService();
export default signalingService;
