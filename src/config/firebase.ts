import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getFunctions, Functions } from 'firebase/functions';
import {
  initializeAuth,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  Auth,
} from 'firebase/auth';
// The firebase package's types always point at the browser build, which omits
// this react-native-only export; Metro resolves the RN bundle at runtime,
// where it exists (firebase-js-sdk types limitation).
// @ts-expect-error
import { getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ICE_SERVERS_FUNCTION_REGION } from '../../shared/ice';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase (avoid duplicate initialization)
let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize Firestore
export const db: Firestore = getFirestore(app);

// Callable functions (getIceServers). Region must match the function's.
export const functions: Functions = getFunctions(app, ICE_SERVERS_FUNCTION_REGION);

// Initialize Auth with AsyncStorage persistence so the same anonymous user
// is reused across app launches. initializeAuth throws if called twice
// (e.g. during fast refresh), so fall back to the existing instance.
let authInstance: Auth;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  authInstance = getAuth(app);
}
export const auth: Auth = authInstance;

// Firestore rules require request.auth != null, so every client signs in
// anonymously before touching the sessions collection.
let signInPromise: Promise<void> | null = null;

export function ensureSignedIn(): Promise<void> {
  if (auth.currentUser) {
    return Promise.resolve();
  }
  if (!signInPromise) {
    signInPromise = new Promise<void>((resolve, reject) => {
      // Wait for persistence to restore before deciding to sign in,
      // otherwise every launch would mint a new anonymous user.
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

// Collection names
export const SESSIONS_COLLECTION = 'sessions';
export const OFFER_CANDIDATES_SUBCOLLECTION = 'offerCandidates';
export const ANSWER_CANDIDATES_SUBCOLLECTION = 'answerCandidates';

export default app;
