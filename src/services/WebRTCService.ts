import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
  mediaDevices,
  MediaStreamTrack,
} from 'react-native-webrtc';
import { RTC_CONFIG, DATA_CHANNEL_CONFIG, COMMAND_CHANNEL_NAME } from '../config/webrtc';
import { Command, Response, IceCandidate, ConnectionState } from '../types';

type CommandCallback = (command: Command) => void;
type ResponseCallback = (response: Response) => void;
type StreamCallback = (stream: MediaStream) => void;
type StateCallback = (state: ConnectionState) => void;
type IceCandidateEmitCallback = (candidate: IceCandidate) => void;
type DataChannelOpenCallback = () => void;

// Type definitions for react-native-webrtc events
interface RTCPeerConnectionIceEvent {
  candidate: RTCIceCandidate | null;
}

interface RTCTrackEvent {
  streams: MediaStream[];
  track: MediaStreamTrack;
}

interface RTCDataChannelEvent {
  channel: any;
}

class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: any = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  // Lock to prevent concurrent stream switching operations
  private isSwitchingStream: boolean = false;
  private pendingSwitch: { facingMode: 'front' | 'back'; zoom: number } | null = null;

  private onCommandCallback: CommandCallback | null = null;
  private onResponseCallback: ResponseCallback | null = null;
  private onRemoteStreamCallback: StreamCallback | null = null;
  private onConnectionStateCallback: StateCallback | null = null;
  private onIceCandidateCallback: IceCandidateEmitCallback | null = null;
  private onDataChannelOpenCallback: DataChannelOpenCallback | null = null;

  // Create peer connection
  createPeerConnection(): RTCPeerConnection {
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    this.peerConnection = new RTCPeerConnection(RTC_CONFIG as any);

    // Handle ICE candidates
    (this.peerConnection as any).onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && this.onIceCandidateCallback) {
        this.onIceCandidateCallback({
          candidate: event.candidate.candidate as string,
          sdpMLineIndex: event.candidate.sdpMLineIndex as number,
          sdpMid: event.candidate.sdpMid as string,
        });
      }
    };

    // Handle connection state changes
    (this.peerConnection as any).onconnectionstatechange = () => {
      if (this.onConnectionStateCallback && this.peerConnection) {
        const state = this.mapConnectionState(
          (this.peerConnection as any).connectionState
        );
        this.onConnectionStateCallback(state);
      }
    };

    // Handle ICE connection state changes
    (this.peerConnection as any).oniceconnectionstatechange = () => {
      console.log(
        'ICE connection state:',
        this.peerConnection?.iceConnectionState
      );
    };

    // Handle incoming tracks (remote stream)
    (this.peerConnection as any).ontrack = (event: RTCTrackEvent) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        if (this.onRemoteStreamCallback) {
          this.onRemoteStreamCallback(event.streams[0]);
        }
      }
    };

    // Handle incoming data channel
    (this.peerConnection as any).ondatachannel = (event: RTCDataChannelEvent) => {
      this.setupDataChannel(event.channel);
    };

    return this.peerConnection;
  }

  // Map WebRTC connection state to our state
  private mapConnectionState(state: string): ConnectionState {
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

  // Create data channel (called by the initiator/camera device)
  createDataChannel(): any {
    if (!this.peerConnection) {
      console.error('Peer connection not initialized');
      return null;
    }

    const channel = this.peerConnection.createDataChannel(
      COMMAND_CHANNEL_NAME,
      DATA_CHANNEL_CONFIG as any
    );

    this.setupDataChannel(channel);
    return channel;
  }

  // Set up data channel event handlers
  private setupDataChannel(channel: any): void {
    this.dataChannel = channel;

    channel.onopen = () => {
      console.log('Data channel opened');
      if (this.onDataChannelOpenCallback) {
        this.onDataChannelOpenCallback();
      }
    };

    channel.onclose = () => {
      console.log('Data channel closed');
    };

    channel.onmessage = (event: { data: string }) => {
      try {
        const message = JSON.parse(event.data);

        // Check if it's a command or response
        if (this.isCommand(message) && this.onCommandCallback) {
          this.onCommandCallback(message);
        } else if (this.isResponse(message) && this.onResponseCallback) {
          this.onResponseCallback(message);
        }
      } catch (error) {
        console.error('Error parsing data channel message:', error);
      }
    };

    channel.onerror = (error: any) => {
      console.error('Data channel error:', error);
    };
  }

  // Type guards for messages
  private isCommand(message: unknown): message is Command {
    if (!message || typeof message !== 'object') return false;
    const m = message as { type?: string };
    return [
      'TAKE_PHOTO',
      'START_RECORDING',
      'STOP_RECORDING',
      'SET_ZOOM',
      'SET_FLASH',
      'SWITCH_CAMERA',
      'GET_STATE',
    ].includes(m.type || '');
  }

  private isResponse(message: unknown): message is Response {
    if (!message || typeof message !== 'object') return false;
    const m = message as { type?: string };
    return [
      'PHOTO_TAKEN',
      'RECORDING_STARTED',
      'RECORDING_STOPPED',
      'STATE_UPDATE',
      'ERROR',
    ].includes(m.type || '');
  }

  // Create and return SDP offer
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    } as any);

    await this.peerConnection.setLocalDescription(offer as any);
    return offer as RTCSessionDescriptionInit;
  }

  // Create and return SDP answer
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer as any);
    return answer as RTCSessionDescriptionInit;
  }

  // Set remote description
  async setRemoteDescription(
    description: RTCSessionDescriptionInit
  ): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    // Check signaling state - only set remote description if we're in the right state
    const signalingState = (this.peerConnection as any).signalingState;
    if (description.type === 'answer' && signalingState !== 'have-local-offer') {
      console.log(`Ignoring answer - signaling state is '${signalingState}', expected 'have-local-offer'`);
      return;
    }
    if (description.type === 'offer' && signalingState !== 'stable') {
      console.log(`Ignoring offer - signaling state is '${signalingState}', expected 'stable'`);
      return;
    }

    const rtcDescription = new RTCSessionDescription({
      type: description.type as any,
      sdp: description.sdp || '',
    });
    await this.peerConnection.setRemoteDescription(rtcDescription as any);
  }

  // Add ICE candidate
  async addIceCandidate(candidate: IceCandidate): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const rtcCandidate = new RTCIceCandidate({
      candidate: candidate.candidate,
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid,
    });

    await this.peerConnection.addIceCandidate(rtcCandidate as any);
  }

  // Get local media stream for camera
  // zoom parameter helps select the appropriate physical lens (0.5 = ultra-wide, 1 = wide, 2+ = telephoto)
  async getLocalStream(facingMode: 'front' | 'back' = 'back', zoom: number = 1): Promise<MediaStream> {
    const sourceInfos = await mediaDevices.enumerateDevices() as any[];

    // Find all video devices matching the facing mode
    const targetFacing = facingMode === 'front' ? 'front' : 'environment';
    const matchingDevices = sourceInfos.filter(
      (info: any) => info.kind === 'videoinput' && info.facing === targetFacing
    );

    let videoSourceId: string | undefined;

    if (facingMode === 'back' && matchingDevices.length > 1) {
      // Multiple back cameras - try to select based on zoom level
      const sortedDevices = [...matchingDevices].sort((a: any, b: any) =>
        (a.label || '').localeCompare(b.label || '')
      );

      // Try to identify lenses by label patterns
      const ultraWide = sortedDevices.find((d: any) =>
        /ultra|wide.*angle|0\.5|0\.6/i.test(d.label || '')
      );
      const telephoto = sortedDevices.find((d: any) =>
        /tele|zoom|2x|3x|5x/i.test(d.label || '')
      );
      const wide = sortedDevices.find((d: any) =>
        !ultraWide?.deviceId?.includes(d.deviceId) &&
        !telephoto?.deviceId?.includes(d.deviceId)
      ) || sortedDevices[0];

      // Select device based on zoom level
      if (zoom < 0.8 && ultraWide) {
        videoSourceId = ultraWide.deviceId;
      } else if (zoom >= 1.8 && telephoto) {
        videoSourceId = telephoto.deviceId;
      } else if (wide) {
        videoSourceId = wide.deviceId;
      }

      // Fallback: if label-based detection fails, use index-based selection
      if (!videoSourceId && sortedDevices.length >= 2) {
        if (zoom < 0.8 && sortedDevices.length >= 2) {
          videoSourceId = sortedDevices[1]?.deviceId;
        } else if (zoom >= 1.8 && sortedDevices.length >= 3) {
          videoSourceId = sortedDevices[2]?.deviceId;
        } else {
          videoSourceId = sortedDevices[0]?.deviceId;
        }
      }
    }

    // Default fallback - use first matching device
    if (!videoSourceId && matchingDevices.length > 0) {
      videoSourceId = matchingDevices[0].deviceId;
    }

    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
        facingMode: facingMode === 'front' ? 'user' : 'environment',
        ...(videoSourceId ? { deviceId: videoSourceId } : {}),
      },
    });

    this.localStream = stream as MediaStream;
    return this.localStream;
  }

  // Add local stream to peer connection
  addLocalStream(stream: MediaStream): void {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    stream.getTracks().forEach((track) => {
      this.peerConnection!.addTrack(track, stream);
    });
  }

  // Send command via data channel
  sendCommand(command: Command): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.error('Data channel not ready');
      return;
    }

    this.dataChannel.send(JSON.stringify(command));
  }

  // Send response via data channel
  sendResponse(response: Response): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.error('Data channel not ready');
      return;
    }

    this.dataChannel.send(JSON.stringify(response));
  }

  // Set callback for incoming commands
  onCommand(callback: CommandCallback): void {
    this.onCommandCallback = callback;
  }

  // Set callback for incoming responses
  onResponse(callback: ResponseCallback): void {
    this.onResponseCallback = callback;
  }

  // Set callback for remote stream
  onRemoteStream(callback: StreamCallback): void {
    this.onRemoteStreamCallback = callback;
  }

  // Set callback for connection state changes
  onConnectionState(callback: StateCallback): void {
    this.onConnectionStateCallback = callback;
  }

  // Set callback for ICE candidates
  onIceCandidate(callback: IceCandidateEmitCallback): void {
    this.onIceCandidateCallback = callback;
  }

  // Set callback for data channel open
  onDataChannelOpen(callback: DataChannelOpenCallback): void {
    this.onDataChannelOpenCallback = callback;
  }

  // Get remote stream
  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  // Get local stream
  getLocalStreamRef(): MediaStream | null {
    return this.localStream;
  }

  // Pause local stream (stops video track to release camera hardware)
  pauseLocalStream(): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => track.stop());
    }
  }

  // Resume local stream (gets new stream and replaces tracks)
  // zoom parameter helps select the appropriate physical lens
  async resumeLocalStream(facingMode: 'front' | 'back' = 'back', zoom: number = 1): Promise<void> {
    if (!this.peerConnection) {
      console.error('Peer connection not initialized for stream resume');
      return;
    }

    try {
      // Get a new stream with the appropriate lens
      const newStream = await this.getLocalStream(facingMode, zoom);

      // Replace the tracks in the peer connection
      const senders = this.peerConnection.getSenders();
      const videoTrack = newStream.getVideoTracks()[0];
      const audioTrack = newStream.getAudioTracks()[0];

      for (const sender of senders) {
        if (sender.track?.kind === 'video' && videoTrack) {
          await sender.replaceTrack(videoTrack);
        } else if (sender.track?.kind === 'audio' && audioTrack) {
          await sender.replaceTrack(audioTrack);
        }
      }
    } catch (error) {
      console.error('Error resuming local stream:', error);
    }
  }

  // Switch to a different lens by replacing the video track
  async switchLens(facingMode: 'front' | 'back', zoom: number): Promise<void> {
    // If already switching, queue this request (only keep the latest)
    if (this.isSwitchingStream) {
      this.pendingSwitch = { facingMode, zoom };
      return;
    }

    if (!this.peerConnection || !this.localStream) {
      console.error('Peer connection or stream not initialized for lens switch');
      return;
    }

    this.isSwitchingStream = true;

    try {
      // Stop ALL tracks in the current stream to fully release the camera
      this.localStream.getTracks().forEach((track) => {
        track.stop();
      });

      // Small delay to ensure camera is fully released on Android
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get new stream with the desired lens
      const newStream = await this.getLocalStream(facingMode, zoom);

      // Replace both video and audio tracks in the peer connection
      const senders = this.peerConnection.getSenders();
      const newVideoTrack = newStream.getVideoTracks()[0];
      const newAudioTrack = newStream.getAudioTracks()[0];

      for (const sender of senders) {
        if (sender.track?.kind === 'video' && newVideoTrack) {
          await sender.replaceTrack(newVideoTrack);
        } else if (sender.track?.kind === 'audio' && newAudioTrack) {
          await sender.replaceTrack(newAudioTrack);
        }
      }
    } catch (error) {
      console.error('Error switching lens:', error);
    } finally {
      this.isSwitchingStream = false;

      // Process any pending switch request
      if (this.pendingSwitch) {
        const pending = this.pendingSwitch;
        this.pendingSwitch = null;
        setTimeout(() => {
          this.switchLens(pending.facingMode, pending.zoom);
        }, 50);
      }
    }
  }

  // Check if data channel is ready
  isDataChannelReady(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  // Close connection and cleanup
  close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.onCommandCallback = null;
    this.onResponseCallback = null;
    this.onRemoteStreamCallback = null;
    this.onConnectionStateCallback = null;
    this.onIceCandidateCallback = null;
    this.onDataChannelOpenCallback = null;

    // Reset switching state
    this.isSwitchingStream = false;
    this.pendingSwitch = null;
  }
}

// Export singleton instance
export const webRTCService = new WebRTCService();
export default webRTCService;
