import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  Unsubscribe,
  DocumentReference,
  CollectionReference,
} from 'firebase/firestore';
import {
  db,
  ensureSignedIn,
  SESSIONS_COLLECTION,
  OFFER_CANDIDATES_SUBCOLLECTION,
  ANSWER_CANDIDATES_SUBCOLLECTION,
} from '../config/firebase';
import { generateSessionId } from '../utils/sessionId';
import { SignalingOffer, SignalingAnswer, IceCandidate } from '../types';

// Sessions are short-lived pairing artifacts. expireAt drives the Firestore
// TTL policies that garbage-collect abandoned session and candidate docs;
// the security rules cap it at 2 hours out.
const SESSION_TTL_MS = 60 * 60 * 1000;

function sessionExpireAt(): Timestamp {
  return Timestamp.fromMillis(Date.now() + SESSION_TTL_MS);
}

type IceCandidateCallback = (candidate: IceCandidate) => void;
type OfferCallback = (offer: SignalingOffer) => void;
type AnswerCallback = (answer: SignalingAnswer) => void;

class SignalingService {
  private sessionId: string | null = null;
  private ownsSession = false;
  private unsubscribers: Unsubscribe[] = [];
  private processedOfferSdp: string | null = null;
  private processedAnswerSdp: string | null = null;

  // Create a new signaling session
  async createSession(): Promise<string> {
    await ensureSignedIn();

    // Reset processed flags for new session
    this.processedOfferSdp = null;
    this.processedAnswerSdp = null;

    const sessionId = generateSessionId();
    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);

    await setDoc(sessionRef, {
      createdAt: serverTimestamp(),
      expireAt: sessionExpireAt(),
      status: 'waiting',
    });

    this.sessionId = sessionId;
    this.ownsSession = true;
    return sessionId;
  }

  // Join an existing session
  async joinSession(sessionId: string): Promise<boolean> {
    await ensureSignedIn();

    // Reset processed flags for new session
    this.processedOfferSdp = null;
    this.processedAnswerSdp = null;

    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
    const sessionDoc = await getDoc(sessionRef);

    if (!sessionDoc.exists()) {
      return false;
    }

    this.sessionId = sessionId;
    this.ownsSession = false;
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
      if (data?.offer && data.offer.sdp !== this.processedOfferSdp) {
        // Mark this offer as processed to avoid duplicate handling
        this.processedOfferSdp = data.offer.sdp;
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
      if (data?.answer && data.answer.sdp !== this.processedAnswerSdp) {
        // Mark this answer as processed to avoid duplicate handling
        this.processedAnswerSdp = data.answer.sdp;
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
      expireAt: sessionExpireAt(),
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
      // Only the main session document is deleted here; candidate subcollection
      // docs (and abandoned sessions) are garbage-collected by the Firestore
      // TTL policies on their expireAt fields.
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

    if (this.sessionId && this.ownsSession) {
      this.deleteSession(this.sessionId);
    }
    this.sessionId = null;
    this.ownsSession = false;

    // Reset processed flags for next session
    this.processedOfferSdp = null;
    this.processedAnswerSdp = null;
  }

  // Get current session ID
  getSessionId(): string | null {
    return this.sessionId;
  }
}

// Export singleton instance
export const signalingService = new SignalingService();
export default signalingService;
