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

TURN needs no env vars: credentials are minted per connection by the `getIceServers`
Cloud Function (see `functions/`), and pairing falls back to STUN if that call fails.

## Commands

```bash
npm install
npm run dev
```

## Universal Link Files

`public/.well-known/assetlinks.json` and `public/.well-known/apple-app-site-association`
are checked in as templates. Replace the placeholder certificate fingerprint and Apple team
ID before deploying to `https://apps.binnyva.com/second-shooter/`.

Note: iOS and Android fetch these files from the **domain root**
(`https://apps.binnyva.com/.well-known/...`), not from the `/second-shooter/`
subdirectory. Since the site is deployed under a subdirectory, copy the two files to
`/.well-known/` at the root of `apps.binnyva.com` on the server.
