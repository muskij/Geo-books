/**
 * Geo-Books AI Vault Shared Helpers
 * Used by ExamVault.htm and AIScanVault.htm.
 *
 * Why this exists: both pages previously called Gemini directly from the
 * browser (ExamVault.htm had a client-side API key in a `fetch()` call).
 * This routes exam generation through the same Cloud-Function-proxied
 * `aiChatCompletion` that ai.js's aiHumanizeText/aiSupportReply/aiTutorReply
 * already use, so no API key ever reaches the browser. It also centralizes
 * the Elite-tier check so both pages gate access the same way.
 *
 * IMPORTANT: the check in `requireEliteAccess()` below is a UX gate only —
 * it stops honest users from seeing a feature they haven't paid for, but a
 * motivated user can bypass client-side JS entirely and call the
 * `aiChatCompletion` Cloud Function directly. Real enforcement MUST also
 * live server-side, inside the Cloud Function itself. See the
 * `functions-premium-gate-EXAMPLE.js` file for the exact snippet to add
 * there — this file can't add it for you because that project's source
 * wasn't part of what was uploaded here.
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { aiChatCompletion, extractTextFromPdf } from "./ai.js";
import { hasAiAccess, hasAnyPaidPlan } from "./utils.js";

// Same project as app.js / index.htm / main_admin.htm.
const firebaseConfig = {
  apiKey: "AIzaSyADGe2kvf7Gpt4YpyFyxd9Zj-iari4wSgI",
  authDomain: "scholarly-21cac.firebaseapp.com",
  projectId: "scholarly-21cac",
  storageBucket: "scholarly-21cac.firebasestorage.app",
  messagingSenderId: "765010207748",
  appId: "1:765010207748:web:7250933407d8bfccaf8151",
  measurementId: "G-JSPDC8D1CN"
};

function getFirebaseApp() {
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

/** Resolves with the current Firebase user (or null) once auth state settles. */
export function waitForAuthUser() {
  const auth = getAuth(getFirebaseApp());
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user || null);
    });
  });
}

/**
 * Client-side UX gate. Returns { allowed, user, subscriptionLevel }.
 * NOT a security boundary on its own — see file header.
 */
export async function requireEliteAccess() {
  const user = await waitForAuthUser();
  if (!user) return { allowed: false, user: null, subscriptionLevel: null };

  const db = getFirestore(getFirebaseApp());
  let userData = {};
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    userData = snap.exists() ? snap.data() : {};
  } catch (e) {
    console.warn('requireEliteAccess: failed to read user doc:', e);
  }

  // hasAnyPaidPlan (not hasAiAccess) — AI Scan Vault / Exam Vault's exam
  // generation is available on ANY paid plan, unlike the humanizer/
  // support/tutor features elsewhere which stay Premium+Elite only.
  return {
    allowed: hasAnyPaidPlan(userData),
    user,
    subscriptionLevel: userData.subscription?.tier || userData.subscriptionLevel || 'FREE'
  };
}

const EXAM_SYSTEM_PROMPT = [
  'You generate CBT multiple-choice exam questions for Nigerian students.',
  'Return ONLY valid JSON, with no markdown code fences and no commentary, in exactly this shape:',
  '{"subject": string, "questions": [{"q": string, "opts": [string,string,string,string], "correct": 0|1|2|3, "exp": string}]}',
  'Every question must have exactly 4 options. "correct" is the 0-indexed position of the right option.',
  'Keep explanations ("exp") short, one sentence.'
].join('\n');

function stripCodeFences(raw) {
  return String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
}

/**
 * Generates exam questions from either a topic/prompt or extracted source
 * text, via the Cloud-Function-proxied chat completion (no exposed key,
 * no image/vision support — see README note in ExamVault.htm for the
 * camera-scan limitation this implies).
 *
 * Returns { subject, questions: [{ q, opts, correct, exp }] } — this exact
 * shape is what cbt.js expects, so it can be handed to launchCbtSession()
 * unmodified.
 */
export async function generateExamFromText({ sourceText, topic, subject, count = 10, intensity = 'standard' } = {}) {
  const safeCount = Math.max(3, Math.min(50, Math.floor(Number(count) || 10)));
  const safeIntensity = ['easy', 'standard', 'hard'].includes(String(intensity).toLowerCase())
    ? String(intensity).toLowerCase()
    : 'standard';

  const userPrompt = [
    `Subject/topic: ${subject || topic || 'General'}`,
    `Question count: ${safeCount}`,
    `Intensity: ${safeIntensity}`,
    sourceText
      ? `Source material to base questions on:\n${String(sourceText).slice(0, 60000)}`
      : `No source document provided — generate from general knowledge on: ${topic || subject || 'General'}`
  ].join('\n\n');

  const { content } = await aiChatCompletion({
    messages: [
      { role: 'system', content: EXAM_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.4,
    maxTokens: Math.min(4000, 120 * safeCount + 300),
    accessCheck: hasAnyPaidPlan // AI Scan Vault / Exam Vault - any paid plan, not just Premium+Elite
  });

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(content));
  } catch (e) {
    throw new Error('The AI returned an unexpected format. Please try again.');
  }

  const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const questions = rawQuestions
    .filter((q) => q && typeof q.q === 'string' && Array.isArray(q.opts) && q.opts.length >= 2)
    .map((q) => ({
      q: String(q.q),
      opts: q.opts.map(String),
      correct: Number.isInteger(q.correct) ? q.correct : 0,
      exp: typeof q.exp === 'string' ? q.exp : ''
    }));

  if (!questions.length) throw new Error('No valid questions were generated. Please try again with more source text.');

  return { subject: (parsed && parsed.subject) || subject || topic || 'General', questions };
}

/** Extracts text from an uploaded PDF File object using the same local
 * (no-network) pdf.js extraction ai.js already ships with. */
export async function extractTextFromPdfFile(file) {
  const buf = await file.arrayBuffer();
  return extractTextFromPdf(new Uint8Array(buf));
}

/**
 * Hands a generated question set off to cbt.htm, matching the exact
 * sessionStorage contract app.js's launchCbtExamPage() uses (see cbt.js's
 * header comment / SESSION_KEY = 'geoBooksCbtSession').
 */
export function launchCbtSession({ subject, questions, durationSec = 1800, examType = 'GENERAL' } = {}) {
  try {
    sessionStorage.setItem('geoBooksCbtSession', JSON.stringify({
      subject: subject || 'General',
      questions: questions || [],
      durationSec: Number(durationSec) || 1800,
      examType: examType || 'GENERAL',
      startedAtMs: Date.now()
    }));
  } catch (e) {
    console.error('Failed to hand off CBT session to cbt.htm:', e);
    throw new Error('Could not start the exam page. Please try again.');
  }
  window.location.href = 'cbt.htm';
}
