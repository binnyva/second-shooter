// Mock for expo-crypto backed by Node's crypto module
import { randomBytes } from 'crypto';

export function getRandomBytes(byteCount: number): Uint8Array {
  return new Uint8Array(randomBytes(byteCount));
}
