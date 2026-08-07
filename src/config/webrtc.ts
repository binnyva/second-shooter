import { httpsCallable } from 'firebase/functions';
import { ensureSignedIn, functions } from './firebase';
import {
  buildIceServers,
  ICE_CANDIDATE_POOL_SIZE,
  ICE_SERVERS_FETCH_TIMEOUT_MS,
  ICE_SERVERS_FUNCTION_NAME,
  parseIceServersResult,
  STUN_ICE_SERVERS,
} from '../../shared/ice';
import { IceServer } from '../types';

/**
 * Fetches STUN + TURN servers for a new peer connection.
 *
 * TURN credentials are minted per request by the getIceServers Cloud Function
 * (see functions/src/index.ts), so this is async and must be awaited before
 * constructing an RTCPeerConnection. If the call fails we pair over STUN only,
 * which is what the app did before TURN existed.
 */
export async function getIceServers(): Promise<IceServer[]> {
  try {
    // The function rejects unauthenticated callers; signing in is idempotent
    // and normally already done by the signaling service.
    await ensureSignedIn();

    const callable = httpsCallable(functions, ICE_SERVERS_FUNCTION_NAME, {
      timeout: ICE_SERVERS_FETCH_TIMEOUT_MS,
    });
    const { data } = await callable();
    const turnServers = parseIceServersResult(data);

    if (turnServers.length === 0) {
      console.warn('[WebRTC] getIceServers returned no TURN servers, using STUN only');
      return STUN_ICE_SERVERS;
    }

    return buildIceServers(turnServers);
  } catch (error) {
    console.warn('[WebRTC] Failed to fetch TURN credentials, using STUN only:', error);
    return STUN_ICE_SERVERS;
  }
}

// WebRTC configuration
export async function getRtcConfig(): Promise<RTCConfiguration> {
  return {
    iceServers: await getIceServers(),
    iceCandidatePoolSize: ICE_CANDIDATE_POOL_SIZE,
  };
}

// Data channel configuration
export const DATA_CHANNEL_CONFIG: RTCDataChannelInit = {
  ordered: true,
};

// Data channel name for camera commands
export const COMMAND_CHANNEL_NAME = 'camera-commands';
