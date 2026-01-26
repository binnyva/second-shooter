import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDB8ARUv9GUAueDF4EUfPmSIUg1c5j5Rxc",
  authDomain: "secondshooter-269c7.firebaseapp.com",
  projectId: "secondshooter-269c7",
  storageBucket: "secondshooter-269c7.firebasestorage.app",
  messagingSenderId: "827373055707",
  appId: "1:827373055707:web:9611bf537c1b3052a366fe"
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

// Collection names
export const SESSIONS_COLLECTION = 'sessions';
export const OFFER_CANDIDATES_SUBCOLLECTION = 'offerCandidates';
export const ANSWER_CANDIDATES_SUBCOLLECTION = 'answerCandidates';

export default app;
