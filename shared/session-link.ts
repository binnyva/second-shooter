const DEFAULT_REMOTE_WEB_ORIGIN = 'https://remote.secondshooter.app';
const SESSION_PATH_PREFIX = '/s/';
const SESSION_ID_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

function normalizeOrigin(origin: string): string {
  return origin.endsWith('/') ? origin.slice(0, -1) : origin;
}

export function buildRemoteSessionUrl(
  sessionId: string,
  origin: string = DEFAULT_REMOTE_WEB_ORIGIN
): string {
  return `${normalizeOrigin(origin)}${SESSION_PATH_PREFIX}${encodeURIComponent(sessionId)}`;
}

function extractSessionIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const querySessionId = url.searchParams.get('sessionId');
    if (querySessionId && isValidSessionId(querySessionId)) {
      return querySessionId;
    }

    if (url.pathname.startsWith(SESSION_PATH_PREFIX)) {
      const sessionId = decodeURIComponent(
        url.pathname.slice(SESSION_PATH_PREFIX.length).split('/')[0] || ''
      ).toUpperCase();
      return isValidSessionId(sessionId) ? sessionId : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId.trim().toUpperCase());
}

export function parseSessionIdFromInput(input: string): string | null {
  const value = input.trim();
  if (!value) {
    return null;
  }

  const directSessionId = value.toUpperCase();
  if (isValidSessionId(directSessionId)) {
    return directSessionId;
  }

  const parsedUrlSessionId = extractSessionIdFromUrl(value);
  if (parsedUrlSessionId) {
    return parsedUrlSessionId;
  }

  try {
    const payload = JSON.parse(value) as { sessionId?: string };
    if (payload.sessionId && isValidSessionId(payload.sessionId)) {
      return payload.sessionId.toUpperCase();
    }
  } catch {
    return null;
  }

  return null;
}

export const REMOTE_WEB_ORIGIN = DEFAULT_REMOTE_WEB_ORIGIN;
