/**
 * PASTE-IN EXAMPLE — not a standalone file to deploy.
 *
 * This project's Firebase Functions source wasn't part of what was uploaded
 * for review, so this can't be wired in directly. It shows exactly what to
 * add to the existing `aiChatCompletion` (and `generateQuiz`) callable
 * functions so the Elite-tier check in ai-vault-shared.js's
 * requireEliteAccess() is actually enforced, not just a UI suggestion.
 *
 * Why this matters: a client-side check (hiding a button, reading
 * subscriptionLevel in the browser) only stops honest users. Any callable
 * Cloud Function is a public HTTPS endpoint — a user (or anyone who
 * inspects your bundle) can call `aiChatCompletion` directly with the
 * Firebase client SDK and their own auth token, skipping every page's UI
 * entirely. The check has to happen inside the function, using Admin SDK
 * data the caller cannot forge.
 */

const admin = require('firebase-admin'); // already a dependency per package.json
const functions = require('firebase-functions');

/**
 * Throws if the calling user isn't Elite. Uses `context.auth.uid` (verified
 * server-side by Firebase, unlike anything the client sends in the request
 * body) to look up the user's real subscriptionLevel via Admin SDK, which
 * bypasses firestore.rules — this read is trusted precisely because it's
 * NOT going through client-facing rules.
 */
async function requireElite(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }
  const snap = await admin.firestore().collection('users').doc(context.auth.uid).get();
  const subscriptionLevel = snap.exists ? snap.data().subscriptionLevel : 'STANDARD';
  if (subscriptionLevel !== 'ELITE_100K') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'This AI feature requires an Elite subscription.'
    );
  }
}

/**
 * Example: gating the existing aiChatCompletion callable. Find the real
 * `exports.aiChatCompletion = functions.https.onCall(...)` in your
 * functions project and add the requireElite() call as the first line
 * inside the handler — everything else about the function stays the same.
 */
exports.aiChatCompletion = functions.https.onCall(async (data, context) => {
  await requireElite(context); // <-- the actual enforcement point

  // ...existing aiChatCompletion body (call Gemini, return { content }) ...
});

/**
 * Same pattern for generateQuiz (called by generateQuizFromNeuralCore in
 * ai.js) — add the same requireElite(context) line at the top of its
 * handler too, since it's a separate callable with its own entry point.
 */
exports.generateQuiz = functions.https.onCall(async (data, context) => {
  await requireElite(context); // <-- add this line

  // ...existing generateQuiz body...
});

/**
 * OPTIONAL — a lighter-touch alternative to a hard paywall: give STANDARD
 * users a small daily quota instead of blocking them outright (see chat
 * discussion re: freemium vs hard wall). Swap requireElite() for this in
 * whichever functions you want to stay partially free.
 */
async function checkAndConsumeQuota(context, { freeLimit = 3 } = {}) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }
  const uid = context.auth.uid;

  const userSnap = await admin.firestore().collection('users').doc(uid).get();
  const subscriptionLevel = userSnap.exists ? userSnap.data().subscriptionLevel : 'STANDARD';
  if (subscriptionLevel === 'ELITE_100K') return; // unlimited for Elite

  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const usageRef = admin.firestore().collection('aiUsage').doc(`${uid}_${today}`);

  await admin.firestore().runTransaction(async (tx) => {
    const usageSnap = await tx.get(usageRef);
    const used = usageSnap.exists ? (usageSnap.data().count || 0) : 0;
    if (used >= freeLimit) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Daily free AI limit reached (${freeLimit}/day). Upgrade to Elite for unlimited access.`
      );
    }
    tx.set(usageRef, { count: used + 1, uid, date: today }, { merge: true });
  });
}
