const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

admin.initializeApp();

function toText(value) {
  return value === null || value === undefined ? '' : String(value);
}

const RANK_TIERS = [
  { rank: 1, title: 'Scholar', minXp: 0, reward: 'Starter Badge' },
  { rank: 2, title: 'Expert', minXp: 1000, reward: 'Custom Profile Colors' },
  { rank: 3, title: 'Pro', minXp: 3500, reward: 'Verified Checkmark' },
  { rank: 4, title: 'Master', minXp: 8500, reward: '10% Marketplace Discount' },
  { rank: 5, title: 'Elite', minXp: 18000, reward: 'Early Access to New Features' },
  { rank: 6, title: 'Legend', minXp: 40000, reward: 'Monthly Data Bundle / Leaderboard' }
];

function calculateRank(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  let current = RANK_TIERS[0];
  for (const tier of RANK_TIERS) {
    if (safeXp >= tier.minXp) current = tier;
  }
  const currentIndex = RANK_TIERS.findIndex((t) => t.rank === current.rank);
  const next = currentIndex >= 0 ? RANK_TIERS[currentIndex + 1] : null;

  const currentThreshold = current.minXp;
  const nextThreshold = next ? next.minXp : null;
  const progressPct =
    nextThreshold === null
      ? 100
      : Math.max(
          0,
          Math.min(100, ((safeXp - currentThreshold) / Math.max(1, nextThreshold - currentThreshold)) * 100)
        );
  const xpToNext = nextThreshold === null ? 0 : Math.max(0, nextThreshold - safeXp);

  return {
    xp: safeXp,
    rank: current.rank,
    title: current.title,
    reward: current.reward,
    nextRank: next ? next.rank : null,
    nextTitle: next ? next.title : null,
    nextThreshold,
    currentThreshold,
    xpToNext,
    progressPct
  };
}

exports.awardXp = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

  const uid = request.auth.uid;
  const amount = Math.floor(Number(request.data?.amount) || 0);
  const reason = toText(request.data?.reason).trim();

  if (!Number.isFinite(amount) || amount === 0) {
    throw new HttpsError('invalid-argument', 'Invalid XP amount');
  }
  if (amount < 0) throw new HttpsError('invalid-argument', 'Negative XP not allowed');
  if (amount > 500) throw new HttpsError('invalid-argument', 'XP amount too large');

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  const res = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() || {} : {};
    const oldXp = Number(data.xp) || 0;
    const oldRankTitle = toText(data.rank_title || '');
    const newXp = Math.max(0, oldXp + amount);
    const newRank = calculateRank(newXp);

    tx.set(
      userRef,
      {
        xp: newXp,
        level: newRank.rank,
        rank_title: newRank.title,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const eventRef = userRef.collection('xpEvents').doc();
    tx.set(eventRef, {
      delta: amount,
      reason: reason || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { oldXp, newXp, oldRankTitle, newRank };
  });

  const rankUp = !!res.oldRankTitle && res.newRank.title && res.oldRankTitle !== res.newRank.title;
  return { ...res, rankUp };
});

/**
 * Secure AI Layer - Routes requests to OpenAI (gpt-4o-mini)
 * API Key is bound via Secret Manager: firebase functions:secrets:set OPENAI_API_KEY
 */
exports.generateQuiz = onCall({ secrets: ["OPENAI_API_KEY"] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

  const { text, count, intensity, style } = request.data;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'AI Service not configured on server');
  }

  const safeCount = Math.max(5, Math.min(50, Math.floor(Number(count) || 20)));
  const safeIntensity = intensity === 'easy' || intensity === 'hard' ? intensity : 'standard';

  const systemPrompt = [
    'You are a world-class exam creator for Nigerian students.',
    `Target: ${safeIntensity} difficulty CBT questions.`,
    'Extract core academic concepts, definitions, and facts from the provided document text.',
    'Return ONLY valid JSON with this exact structure:',
    '{ "subject": string, "questions": [ { "q": string, "opts": [string,string,string,string], "correct": 0|1|2|3, "exp": string } ] }'
  ].join('\n');

  const userPrompt = `Document Text:\n${toText(text).slice(0, 50000)}\n\nGenerate ${safeCount} questions. Style: ${style || 'balanced'}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2500,
        response_format: { type: 'json_object' } // OpenAI's equivalent of Gemini's responseMimeType: "application/json"
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('generateQuiz OpenAI error:', response.status, errBody);
      throw new Error(`OpenAI error ${response.status}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) throw new Error('Empty response from AI');
    return JSON.parse(content);
  } catch (error) {
    console.error("AI Generation Error:", error);
    throw new HttpsError('internal', 'Failed to generate quiz content');
  }
});

exports.aiChatCompletion = onCall({ secrets: ["OPENAI_API_KEY"] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

  const { messages, temperature, maxTokens } = request.data;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'AI Service not configured on server');
  }
  if (!Array.isArray(messages) || !messages.length) {
    throw new HttpsError('invalid-argument', 'messages array is required');
  }

  try {
    // No role remapping needed here — the caller (ai.js / ai-vault-shared.js)
    // already sends 'system'/'user'/'assistant' roles, which is OpenAI's
    // native format. The old Gemini path had to remap 'assistant' -> 'model';
    // that step is simply gone now.
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: Number(temperature) || 0.7,
        max_tokens: Number(maxTokens) || 2000
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('aiChatCompletion OpenAI error:', response.status, errBody);
      throw new Error(`OpenAI error ${response.status}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';

    return { content };
  } catch (error) {
    console.error("AI Chat Error:", error);
    throw new HttpsError('internal', 'AI chat failed');
  }
});

exports.confirmEscrowPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

  const uid = request.auth.uid;
  const itemId = toText(request.data?.itemId).trim();
  const price = Math.floor(Number(request.data?.price) || 0);

  if (!itemId) throw new HttpsError('invalid-argument', 'Missing itemId');
  if (!Number.isFinite(price) || price <= 0) throw new HttpsError('invalid-argument', 'Invalid price');

  const db = admin.firestore();
  const itemRef = db.collection('marketItems').doc(itemId);
  const payRef = db.collection('escrowPayments').doc();

  const result = await db.runTransaction(async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists) throw new HttpsError('not-found', 'Item not found');
    const item = itemSnap.data() || {};
    const expectedPrice = Math.floor(Number(item.price) || 0);
    if (expectedPrice !== price) throw new HttpsError('failed-precondition', 'Price mismatch');

    tx.set(payRef, {
      buyerId: uid,
      itemId,
      price,
      sellerId: toText(item.sellerId || '').trim() || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'recorded'
    });

    return { ok: true, paymentId: payRef.id };
  });

  return result;
});





