import { IceCandidate } from '../../types';

// WebRTCService pulls ICE servers from a Cloud Function; keep tests offline.
jest.mock('../../config/webrtc', () => ({
  getRtcConfig: jest.fn().mockResolvedValue({ iceServers: [] }),
  DATA_CHANNEL_CONFIG: { ordered: true },
  COMMAND_CHANNEL_NAME: 'camera-commands',
}));

import { webRTCService } from '../../services/WebRTCService';

const candidate = (id: string): IceCandidate => ({
  candidate: `candidate:${id} 1 udp 2122260223 192.168.1.5 54321 typ host`,
  sdpMLineIndex: 0,
  sdpMid: '0',
});

const OFFER = { type: 'offer' as const, sdp: 'mock-offer-sdp' };

describe('WebRTCService', () => {
  afterEach(() => {
    webRTCService.close();
  });

  describe('addIceCandidate', () => {
    it('buffers candidates that arrive before the remote description', async () => {
      const pc: any = await webRTCService.createPeerConnection();

      await webRTCService.addIceCandidate(candidate('a'));
      await webRTCService.addIceCandidate(candidate('b'));

      expect(pc.addIceCandidate).not.toHaveBeenCalled();
    });

    it('applies buffered candidates once the remote description is set', async () => {
      const pc: any = await webRTCService.createPeerConnection();

      await webRTCService.addIceCandidate(candidate('a'));
      await webRTCService.addIceCandidate(candidate('b'));
      await webRTCService.setRemoteDescription(OFFER);

      expect(pc.addIceCandidate).toHaveBeenCalledTimes(2);
      const applied = pc.addIceCandidate.mock.calls.map((c: any[]) => c[0].candidate);
      expect(applied).toEqual([candidate('a').candidate, candidate('b').candidate]);
    });

    it('applies candidates immediately once the remote description exists', async () => {
      const pc: any = await webRTCService.createPeerConnection();
      await webRTCService.setRemoteDescription(OFFER);

      await webRTCService.addIceCandidate(candidate('a'));

      expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
    });

    it('buffers instead of throwing when no peer connection exists yet', async () => {
      await expect(webRTCService.addIceCandidate(candidate('a'))).resolves.toBeUndefined();
    });

    it('keeps applying candidates after one of them fails', async () => {
      const pc: any = await webRTCService.createPeerConnection();
      pc.addIceCandidate
        .mockRejectedValueOnce(new Error('bad candidate'))
        .mockResolvedValue(undefined);

      await webRTCService.addIceCandidate(candidate('a'));
      await webRTCService.addIceCandidate(candidate('b'));
      await webRTCService.setRemoteDescription(OFFER);

      expect(pc.addIceCandidate).toHaveBeenCalledTimes(2);
    });

    it('does not replay buffered candidates onto a new peer connection', async () => {
      await webRTCService.createPeerConnection();
      await webRTCService.addIceCandidate(candidate('a'));

      const pc: any = await webRTCService.createPeerConnection();
      await webRTCService.setRemoteDescription(OFFER);

      expect(pc.addIceCandidate).not.toHaveBeenCalled();
    });
  });

  describe('generation', () => {
    it('changes on create so a stale owner can detect it lost the connection', async () => {
      await webRTCService.createPeerConnection();
      const first = webRTCService.getGeneration();

      await webRTCService.createPeerConnection();

      expect(webRTCService.getGeneration()).not.toBe(first);
    });

    it('changes on close', async () => {
      await webRTCService.createPeerConnection();
      const generation = webRTCService.getGeneration();

      webRTCService.close();

      expect(webRTCService.getGeneration()).not.toBe(generation);
    });
  });
});

describe('concurrent connection setup', () => {
  it('has a peer connection ready for every caller that awaited creation', async () => {
    // Reproduces the original failure: while createPeerConnection awaits TURN
    // credentials, peerConnection is null. A second caller that skipped the
    // wait would wire up listeners and immediately hit a null connection.
    const inFlight = webRTCService.createPeerConnection();

    // A candidate arriving mid-fetch must not throw.
    await expect(webRTCService.addIceCandidate(candidate('a'))).resolves.toBeUndefined();

    await inFlight;

    await expect(webRTCService.setRemoteDescription(OFFER)).resolves.toBeUndefined();
  });
});
