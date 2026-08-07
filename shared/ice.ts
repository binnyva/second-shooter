/**
 * ICE configuration shared by the mobile app and the web remote.
 *
 * STUN alone fails for a minority of pairings (symmetric NAT, most carrier
 * CGNAT), so both clients ask the `getIceServers` Cloud Function for
 * short-lived Cloudflare TURN credentials and relay through it when a direct
 * path can't be found. Cloudflare only issues credentials through its API —
 * there is no static username/password to embed in a client.
 */

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Public STUN servers. Used on their own as the fallback whenever the TURN
// credential fetch fails, which keeps a function outage at "pairing works as
// well as it did before TURN" rather than "pairing is broken".
export const STUN_ICE_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

export const ICE_CANDIDATE_POOL_SIZE = 10;

// Must match the export name and region in functions/src/index.ts.
export const ICE_SERVERS_FUNCTION_NAME = 'getIceServers';
export const ICE_SERVERS_FUNCTION_REGION = 'us-central1';

// Give up on the credential fetch quickly and pair over STUN instead. A cold
// function instance is still well under this; the callable default (70s) would
// stall pairing long enough to look broken.
export const ICE_SERVERS_FETCH_TIMEOUT_MS = 8000;

/**
 * Narrows the callable's response to usable ICE servers.
 *
 * Returns an empty array for anything malformed so the caller can fall back to
 * STUN instead of handing junk to RTCPeerConnection.
 */
export function parseIceServersResult(result: unknown): IceServerConfig[] {
  if (!result || typeof result !== 'object') {
    return [];
  }

  const { iceServers } = result as { iceServers?: unknown };
  if (!Array.isArray(iceServers)) {
    return [];
  }

  return iceServers.filter((server): server is IceServerConfig => {
    if (!server || typeof server !== 'object') {
      return false;
    }
    const { urls } = server as { urls?: unknown };
    return (
      typeof urls === 'string' ||
      (Array.isArray(urls) && urls.every((url) => typeof url === 'string'))
    );
  });
}

/**
 * STUN first, then the relay servers — the ordering doesn't change which
 * candidate pair wins (ICE prefers host/srflx over relay by priority), it just
 * keeps the list readable in logs.
 */
export function buildIceServers(turnServers: IceServerConfig[]): IceServerConfig[] {
  return [...STUN_ICE_SERVERS, ...turnServers];
}
