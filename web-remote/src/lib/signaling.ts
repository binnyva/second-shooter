import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  IceCandidate,
  SignalingAnswer,
  SignalingOffer,
} from '@shared/signaling';

const SESSIONS_COLLECTION = 'sessions';
const OFFER_CANDIDATES_SUBCOLLECTION = 'offerCandidates';
const ANSWER_CANDIDATES_SUBCOLLECTION = 'answerCandidates';

type IceCandidateCallback = (candidate: IceCandidate) => void;
type OfferCallback = (offer: SignalingOffer) => void;
type SessionMissingCallback = () => void;

export class BrowserSignalingClient {
  private readonly db: Firestore;
  private sessionId: string | null = null;
  private unsubscribers: Unsubscribe[] = [];
  private processedOfferSdp: string | null = null;

  constructor(db: Firestore) {
    this.db = db;
  }

  async joinSession(sessionId: string): Promise<boolean> {
    this.processedOfferSdp = null;
    const sessionRef = doc(this.db, SESSIONS_COLLECTION, sessionId);
    const sessionDoc = await getDoc(sessionRef);

    if (!sessionDoc.exists()) {
      return false;
    }

    this.sessionId = sessionId;
    return true;
  }

  async sendAnswer(answer: SignalingAnswer): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const sessionRef = doc(this.db, SESSIONS_COLLECTION, this.sessionId);
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

  async addIceCandidate(candidate: IceCandidate): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const candidatesRef = collection(
      this.db,
      SESSIONS_COLLECTION,
      this.sessionId,
      ANSWER_CANDIDATES_SUBCOLLECTION
    );

    await addDoc(candidatesRef, {
      candidate: candidate.candidate,
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid,
    });
  }

  onOffer(callback: OfferCallback): void {
    if (!this.sessionId) {
      return;
    }

    const sessionRef = doc(this.db, SESSIONS_COLLECTION, this.sessionId);
    const unsubscribe = onSnapshot(sessionRef, (snapshot) => {
      const data = snapshot.data();
      if (data?.offer && data.offer.sdp !== this.processedOfferSdp) {
        this.processedOfferSdp = data.offer.sdp;
        callback({
          type: data.offer.type,
          sdp: data.offer.sdp,
        });
      }
    });

    this.unsubscribers.push(unsubscribe);
  }

  onOfferIceCandidate(callback: IceCandidateCallback): void {
    if (!this.sessionId) {
      return;
    }

    const candidatesRef = collection(
      this.db,
      SESSIONS_COLLECTION,
      this.sessionId,
      OFFER_CANDIDATES_SUBCOLLECTION
    );

    const unsubscribe = onSnapshot(candidatesRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') {
          return;
        }

        const data = change.doc.data();
        callback({
          candidate: data.candidate,
          sdpMLineIndex: data.sdpMLineIndex,
          sdpMid: data.sdpMid,
        });
      });
    });

    this.unsubscribers.push(unsubscribe);
  }

  onSessionMissing(callback: SessionMissingCallback): void {
    if (!this.sessionId) {
      return;
    }

    const sessionRef = doc(this.db, SESSIONS_COLLECTION, this.sessionId);
    const unsubscribe = onSnapshot(sessionRef, (snapshot) => {
      if (!snapshot.exists()) {
        callback();
      }
    });

    this.unsubscribers.push(unsubscribe);
  }

  cleanup(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.sessionId = null;
    this.processedOfferSdp = null;
  }
}
