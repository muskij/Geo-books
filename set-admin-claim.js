/**
 * Grant or revoke admin access via a Firebase custom claim.
 *
 * This is the canonical way to make someone an admin. Both server.js
 * (req.user.admin) and firestore.rules (request.auth.token.admin) read this
 * same claim off the user's ID token, so there is nothing left to
 * hand-sync between the API and the database rules.
 *
 * Usage:
 *   node scripts/set-admin-claim.js grant someone@example.com
 *   node scripts/set-admin-claim.js revoke someone@example.com
 *
 * Requires the same credentials server.js uses — set one of:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
 *
 * Note: the affected user must sign out/in (or call
 * getIdToken(true) to force a refresh) before the new claim takes effect
 * in their session — custom claims only apply to newly-issued ID tokens.
 */
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const [, , action, email] = process.argv;

if (!['grant', 'revoke'].includes(action) || !email) {
  console.error('Usage: node scripts/set-admin-claim.js <grant|revoke> <email>');
  process.exit(1);
}

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
} else {
  console.error('No Firebase credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON.');
  process.exit(1);
}

try {
  const user = await admin.auth().getUserByEmail(email);
  const existingClaims = user.customClaims || {};
  const newClaims = { ...existingClaims, admin: action === 'grant' };

  await admin.auth().setCustomUserClaims(user.uid, newClaims);

  console.log(`✅ ${action === 'grant' ? 'Granted' : 'Revoked'} admin claim for ${email} (uid: ${user.uid})`);
  console.log('   The user must sign out/in (or refresh their ID token) for this to take effect.');
  process.exit(0);
} catch (err) {
  console.error(`❌ Failed to ${action} admin claim for ${email}:`, err.message);
  process.exit(1);
}
