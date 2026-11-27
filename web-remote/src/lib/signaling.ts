import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  Timestamp,
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

// Matches the mobile app's SESSION_TTL_MS: expireAt drives the Firestore TTL
// policies that garbage-collect stale docs (rules cap it at 2 hours out).
const SESSION_TTL_MS = 60 * 60 * 1000;

function sessionExpireAt(): Timestamp {
  return Timestamp.fromMillis(Date.now() + SESSION_TTL_MS);
}

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

  /**
   * Takes over a session another remote has already answered.
   *
   * The camera makes one offer per connection, so an offer in a session that
   * is `connected`, or that any remote has answered before, belongs to an
   * existing connection: someone else's, this page's before a reload, or an
   * ICE restart (status `offer_sent`) for a remote that dropped. Answering
   * it with a new peer connection gets ICE and DTLS up but no data channel,
   * since SCTP belongs to the old peer. Instead, mark it as seen and set the
   * status back to `waiting`: the camera answers that with a fresh offer for
   * a new connection, which onOffer then picks up.
   *
   * It's a transaction so the offer marked as seen is the one in the doc
   * when `waiting` lands; the camera's ICE-restart writes check the status
   * in a transaction too, so none can follow the claim.
   *
   * Cameras that predate this (the React Native app) ignore the request, and
   * the remote waits as it did before.
   */
  async claimSession(): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const sessionRef = doc(this.db, SESSIONS_COLLECTION, this.sessionId);
    const claimed = await runTransaction(this.db, async (tx) => {
      const data = (await tx.get(sessionRef)).data();
      if (!data?.offer?.sdp || (data.status !== 'connected' && !data.answer)) {
        return null;
      }
      tx.set(sessionRef, { status: 'waiting' }, { merge: true });
      return data.offer.sdp as string;
    });
    if (claimed) {
      this.processedOfferSdp = claimed;
    }
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
      expireAt: sessionExpireAt(),
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
