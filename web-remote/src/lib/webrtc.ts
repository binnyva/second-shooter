import { httpsCallable } from 'firebase/functions';
import type { Command, ConnectionState, Response } from '@shared/protocol';
import type { IceCandidate } from '@shared/signaling';
import {
  buildIceServers,
  ICE_CANDIDATE_POOL_SIZE,
  ICE_SERVERS_FETCH_TIMEOUT_MS,
  ICE_SERVERS_FUNCTION_NAME,
  parseIceServersResult,
  STUN_ICE_SERVERS,
} from '@shared/ice';
import { ensureSignedIn, functions } from './firebase';

/**
 * Fetches STUN + TURN servers for a new peer connection.
 *
 * TURN credentials are minted per request by the getIceServers Cloud Function.
 * If that call fails we pair over STUN only — the behaviour before TURN.
 */
async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    // The function rejects unauthenticated callers; signing in is idempotent
    // and normally already done before joining the session.
    await ensureSignedIn();

    const callable = httpsCallable(functions, ICE_SERVERS_FUNCTION_NAME, {
      timeout: ICE_SERVERS_FETCH_TIMEOUT_MS,
    });
    const { data } = await callable();
    const turnServers = parseIceServersResult(data);

    if (turnServers.length === 0) {
      console.warn('[web-remote] getIceServers returned no TURN servers, using STUN only');
      return STUN_ICE_SERVERS;
    }

    return buildIceServers(turnServers);
  } catch (error) {
    console.warn('[web-remote] Failed to fetch TURN credentials, using STUN only', error);
    return STUN_ICE_SERVERS;
  }
}

type RemoteStreamCallback = (stream: MediaStream) => void;
type ResponseCallback = (response: Response) => void;
type ConnectionStateCallback = (state: ConnectionState) => void;
type IceCandidateCallback = (candidate: IceCandidate) => void;
type DataChannelOpenCallback = () => void;

interface BrowserWebRTCClientOptions {
  onRemoteStream: RemoteStreamCallback;
  onResponse: ResponseCallback;
  onConnectionState: ConnectionStateCallback;
  onIceCandidate: IceCandidateCallback;
  onDataChannelOpen: DataChannelOpenCallback;
}

export class BrowserWebRTCClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private remoteStream: MediaStream | null = null;
  // ICE candidates that arrived before there was a remote description to
  // attach them to. See addIceCandidate for why this is the normal case.
  private pendingIceCandidates: IceCandidate[] = [];
  private readonly callbacks: BrowserWebRTCClientOptions;

  constructor(callbacks: BrowserWebRTCClientOptions) {
    this.callbacks = callbacks;
  }

  // Async because TURN credentials are minted on demand by a Cloud Function.
  async createConnection(): Promise<void> {
    this.close();

    this.peerConnection = new RTCPeerConnection({
      iceServers: await getIceServers(),
      iceCandidatePoolSize: ICE_CANDIDATE_POOL_SIZE,
    });

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      const candidate = event.candidate.candidate;
      if (this.shouldSkipCandidate(candidate)) {
        console.log('[web-remote] Skipping browser ICE candidate', candidate);
        return;
      }

      this.callbacks.onIceCandidate({
        candidate,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        sdpMid: event.candidate.sdpMid,
      });
    };

    this.peerConnection.onconnectionstatechange = () => {
      this.callbacks.onConnectionState(
        this.mapConnectionState(this.peerConnection?.connectionState)
      );
      console.log(
        '[web-remote] connectionState',
        this.peerConnection?.connectionState
      );
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log(
        '[web-remote] iceConnectionState',
        this.peerConnection?.iceConnectionState
      );
    };

    this.peerConnection.onicecandidateerror = (event) => {
      console.warn('[web-remote] onicecandidateerror', event);
    };

    this.peerConnection.ontrack = (event) => {
      console.log('[web-remote] ontrack', {
        kind: event.track.kind,
        readyState: event.track.readyState,
        streams: event.streams.length,
      });
      if (event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
      }

      if (this.remoteStream) {
        this.callbacks.onRemoteStream(this.remoteStream);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    this.callbacks.onConnectionState('connecting');
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(description)
    );

    await this.flushPendingIceCandidates();
  }

  // Candidates routinely arrive before we can use them. The camera finishes
  // gathering while the QR code is still on screen, so when the remote joins,
  // Firestore replays the whole offerCandidates collection in one batch — and
  // that listener races the separate session-doc listener carrying the offer.
  // Queue anything that arrives early and flush once the remote description
  // is in place.
  async addIceCandidate(candidate: IceCandidate): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }

    await this.applyIceCandidate(candidate);
  }

  private async applyIceCandidate(candidate: IceCandidate): Promise<void> {
    await this.peerConnection!.addIceCandidate(
      new RTCIceCandidate({
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
      })
    );
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.peerConnection?.remoteDescription) {
      return;
    }
    if (this.pendingIceCandidates.length === 0) {
      return;
    }

    const queued = this.pendingIceCandidates;
    this.pendingIceCandidates = [];

    for (const candidate of queued) {
      try {
        await this.applyIceCandidate(candidate);
      } catch (error) {
        // One bad candidate shouldn't stop the rest; ICE only needs one to work.
        console.warn('Failed to apply buffered ICE candidate:', error);
      }
    }
  }

  sendCommand(command: Command): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return;
    }

    this.dataChannel.send(JSON.stringify(command));
  }

  close(): void {
    this.pendingIceCandidates = [];

    if (this.dataChannel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onmessage = null;
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.ontrack = null;
      this.peerConnection.ondatachannel = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => track.stop());
      this.remoteStream = null;
    }

    this.callbacks.onConnectionState('disconnected');
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;

    channel.onopen = () => {
      console.log('[web-remote] data channel open');
      this.callbacks.onDataChannelOpen();
    };

    channel.onclose = () => {
      console.log('[web-remote] data channel close');
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as Response;
        if (message && typeof message === 'object' && 'type' in message) {
          this.callbacks.onResponse(message);
        }
      } catch (error) {
        console.error('Failed to parse data channel message', error);
      }
    };

    channel.onerror = (error) => {
      console.error('[web-remote] data channel error', error);
    };
  }

  private shouldSkipCandidate(candidate: string): boolean {
    // Browsers often emit mDNS host candidates (*.local) for privacy.
    // react-native-webrtc peers frequently fail to resolve those, so drop only
    // the mDNS variants and keep normal host/srflx/relay candidates.
    return candidate.includes('.local');
  }

  private mapConnectionState(state?: RTCPeerConnectionState): ConnectionState {
    switch (state) {
      case 'connected':
        return 'connected';
      case 'connecting':
        return 'connecting';
      case 'failed':
      case 'closed':
        return 'failed';
      default:
        return 'disconnected';
    }
  }
}
