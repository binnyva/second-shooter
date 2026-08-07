import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { ICE_SERVERS_FUNCTION_REGION } from '@shared/ice';

const firebaseConfig = {
  apiKey: import.meta.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const missingFirebaseKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingFirebaseKeys.length > 0) {
  throw new Error(
    `Missing Firebase env vars for web-remote: ${missingFirebaseKeys.join(', ')}`
  );
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
export const auth = getAuth(app);

// Callable functions (getIceServers). Region must match the function's.
export const functions = getFunctions(app, ICE_SERVERS_FUNCTION_REGION);

// Firestore rules require request.auth != null, so the remote signs in
// anonymously before joining a session.
let signInPromise: Promise<void> | null = null;

export function ensureSignedIn(): Promise<void> {
  if (auth.currentUser) {
    return Promise.resolve();
  }
  if (!signInPromise) {
    signInPromise = new Promise<void>((resolve, reject) => {
      // Wait for persistence to restore before deciding to sign in,
      // so page reloads reuse the same anonymous user.
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsubscribe();
          resolve();
        } else {
          signInAnonymously(auth).catch((error) => {
            unsubscribe();
            signInPromise = null;
            reject(error);
          });
        }
      });
    });
  }
  return signInPromise;
}
