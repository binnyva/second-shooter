# Second Shooter Web Remote

Standalone browser remote for QR fallback sessions.

## Environment

The web remote reads the same Firebase variables already used by the Expo app:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

Optional TURN variables:

- `EXPO_PUBLIC_TURN_URL`
- `EXPO_PUBLIC_TURN_USERNAME`
- `EXPO_PUBLIC_TURN_CREDENTIAL`

## Commands

```bash
npm install
npm run dev
```

## Universal Link Files

`public/.well-known/assetlinks.json` and `public/.well-known/apple-app-site-association`
are checked in as templates. Replace the placeholder certificate fingerprint and Apple team
ID before deploying to `https://remote.secondshooter.app`.
