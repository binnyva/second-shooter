// Generate a unique session ID for pairing
// Uses a combination of timestamp and random characters

const CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded similar-looking chars: I, O, 0, 1

export function generateSessionId(length: number = 6): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * CHARACTERS.length);
    result += CHARACTERS[randomIndex];
  }
  return result;
}

// Validate session ID format
export function isValidSessionId(sessionId: string): boolean {
  if (!sessionId || sessionId.length !== 6) {
    return false;
  }
  // Check if all characters are valid
  for (const char of sessionId) {
    if (!CHARACTERS.includes(char)) {
      return false;
    }
  }
  return true;
}
