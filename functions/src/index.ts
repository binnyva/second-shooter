import { HttpsError, onCall } from 'firebase-functions/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';

// Cloudflare Realtime TURN. The token ID identifies the key and is useless on
// its own; the API token can mint credentials, so it lives in Secret Manager.
const TURN_TOKEN_ID = defineString('CLOUDFLARE_TURN_TOKEN_ID');
const TURN_API_TOKEN = defineSecret('CLOUDFLARE_TURN_API_TOKEN');

// How long minted credentials stay valid. Should comfortably exceed a single
// shooting session, since credentials are fetched once per connection.
const CREDENTIAL_TTL_SECONDS = 2 * 60 * 60;

// Re-mint this long before expiry so a cached credential handed to a client is
// never close to expiring mid-session.
const CACHE_SAFETY_MARGIN_SECONDS = 20 * 60;

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

interface CachedCredentials {
  iceServers: IceServer[];
  usableUntilMs: number;
}

// Cloud Functions instances are reused between invocations, so a warm instance
// can serve many pairings from one Cloudflare API call.
let cache: CachedCredentials | null = null;

async function mintIceServers(): Promise<IceServer[]> {
  const url =
    `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_TOKEN_ID.value()}` +
    '/credentials/generate-ice-servers';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TURN_API_TOKEN.value()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
  });

  if (!response.ok) {
    // Never log the body — it contains credentials on success and can echo the
    // request on failure.
    logger.error('Cloudflare TURN credential request failed', {
      status: response.status,
    });
    throw new HttpsError('unavailable', 'Could not obtain TURN credentials');
  }

  const body = (await response.json()) as { iceServers?: IceServer | IceServer[] };

  if (!body.iceServers) {
    logger.error('Cloudflare TURN response missing iceServers');
    throw new HttpsError('unavailable', 'Could not obtain TURN credentials');
  }

  // The API has returned both a bare object and an array across versions.
  return Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
}

/**
 * Returns short-lived Cloudflare TURN credentials to a signed-in client.
 *
 * Callers must be authenticated (the app and web remote both sign in
 * anonymously before pairing), which keeps the relay quota tied to real app
 * users rather than anyone who finds the endpoint.
 */
export const getIceServers = onCall(
  {
    region: 'us-central1',
    secrets: [TURN_API_TOKEN],
    // Cloud Run IAM can't validate Firebase ID tokens, so leaving the service
    // IAM-private rejects every client before this code runs. The auth check
    // below is the real gate — this only opens the network layer.
    invoker: 'public',
    // Auth is the real gate; the web remote is served from a different origin
    // than the function, and the mobile app sends no Origin at all.
    cors: true,
    memory: '256MiB',
    timeoutSeconds: 20,
    maxInstances: 10,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'Sign in before requesting TURN credentials'
      );
    }

    const now = Date.now();
    if (cache && cache.usableUntilMs > now) {
      return { iceServers: cache.iceServers, cached: true };
    }

    const iceServers = await mintIceServers();

    cache = {
      iceServers,
      usableUntilMs:
        now + (CREDENTIAL_TTL_SECONDS - CACHE_SAFETY_MARGIN_SECONDS) * 1000,
    };

    logger.info('Minted Cloudflare TURN credentials', {
      serverCount: iceServers.length,
      urlCount: iceServers.reduce((sum, server) => sum + server.urls.length, 0),
    });

    return { iceServers, cached: false };
  }
);
