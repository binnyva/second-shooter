import type { Command, ConnectionState, Response } from '@shared/protocol';
import type { IceCandidate } from '@shared/signaling';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

if (import.meta.env.EXPO_PUBLIC_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.EXPO_PUBLIC_TURN_URL,
    username: import.meta.env.EXPO_PUBLIC_TURN_USERNAME,
    credential: import.meta.env.EXPO_PUBLIC_TURN_CREDENTIAL,
  });
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
  private readonly callbacks: BrowserWebRTCClientOptions;

  constructor(callbacks: BrowserWebRTCClientOptions) {
    this.callbacks = callbacks;
  }

  createConnection(): void {
    this.close();

    this.peerConnection = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
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
  }

  async addIceCandidate(candidate: IceCandidate): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.addIceCandidate(
      new RTCIceCandidate({
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
      })
    );
  }

  sendCommand(command: Command): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return;
    }

    this.dataChannel.send(JSON.stringify(command));
  }

  close(): void {
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
