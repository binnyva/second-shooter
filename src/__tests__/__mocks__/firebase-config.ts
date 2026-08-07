// Mock for ../config/firebase
export const db = {};
export const auth = {};
export const functions = {};
export const ensureSignedIn = jest.fn().mockResolvedValue(undefined);
export const SESSIONS_COLLECTION = 'sessions';
export const OFFER_CANDIDATES_SUBCOLLECTION = 'offerCandidates';
export const ANSWER_CANDIDATES_SUBCOLLECTION = 'answerCandidates';
