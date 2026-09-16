import { toText, readJson, writeJson, hasAiAccess, hasAnyPaidPlan } from "./utils.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-functions.js";

const AI_SETTINGS_STORAGE_KEY = 'geo-books_ai_config';

// --- AI Access Gate -------------------------------------------------------
// IMPORTANT: this is a client-side "fail fast" check only. It stops a
// non-premium user from ever making the network round trip and gives them
// an instant upgrade prompt instead of a delayed error — but anyone can open
// devtools and call the Cloud Function directly, bypassing this file
// entirely. The real security boundary MUST also exist server-side, inside
// each Cloud Function (generateQuiz, aiChatCompletion) via
// context.auth.uid -> Firestore users/{uid} lookup. That source isn't part
// of this repo upload, so add the equivalent check there too — see the
// comment above assertAiAccess() for a drop-in snippet.
//
// app.js sets this whenever it loads or updates the signed-in user's
// Firestore doc (call setAiUserContext(userData) right after
// app.state.userData is assigned).
let _aiUserContext = null;
export function setAiUserContext(userData) {
  _aiUserContext = userData || null;
}

export class AiAccessError extends Error {
  constructor(message = 'This is a premium AI feature. Upgrade your plan to unlock it.') {
    super(message);
    this.name = 'AiAccessError';
    this.code = 'ai/premium-required';
  }
}

// Mirror this check inside your Cloud Functions, e.g.:
//   const snap = await db.collection('users').doc(context.auth.uid).get();
//   const u = snap.data() || {};
//   const level = String(u.subscriptionLevel || '').toUpperCase();
//   const tier = String(u.subscription?.tier || '').toUpperCase();
//   if (level !== 'ELITE_100K' && tier !== 'PREMIUM' && tier !== 'ELITE') {
//     throw new functions.https.HttpsError('permission-denied', 'Premium required');
//   }
function assertAiAccess(checkFn = hasAiAccess) {
  if (!checkFn(_aiUserContext)) throw new AiAccessError();
}

function isLikelyApiKey(value) {
  const v = toText(value).trim();
  if (!v) return false;
  if (v.startsWith('AIza')) return true;
  return v.length >= 30 && /^[A-Za-z0-9._-]+$/.test(v);
}

export function getAiSettings() {
  const saved = readJson(AI_SETTINGS_STORAGE_KEY, {});
  const apiKey = toText(saved.apiKey || '').trim() || null;
  const endpoint = toText(saved.endpoint || '').trim() || 'https://generativelanguage.googleapis.com';
  const model = toText(saved.model || '').trim() || 'gemini-2.5-flash';
  const timeoutMs = Number(saved.timeoutMs);
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(120000, Math.max(1000, Math.floor(timeoutMs))) : 20000;

  return { apiKey, endpoint, model, timeoutMs: safeTimeoutMs };
}

export async function generateQuizFromNeuralCore(payload) { 
  assertAiAccess(hasAnyPaidPlan); // CBT/exam generation - any paid plan, not just Premium+Elite
  const functions = getFunctions(); 
  const callAiCore = httpsCallable(functions, 'generateQuiz'); 
  
  // The API Key is securely stored on the server via Google Secret Manager 
  const result = await callAiCore({ 
    text: payload.text, 
    strict: payload.strict,
    count: payload.count,
    style: payload.style,
    intensity: payload.intensity
  }); 
  return result.data; 
} 

export async function aiChatCompletion({ messages, model, temperature, maxTokens, accessCheck } = {}) {
  // Gating here (rather than in every individual aiXyz() helper below) works
  // because aiHumanizeText, aiSupportReply, aiTutorReply,
  // aiGenerateDailyPathTasks, aiExplainFlashcard, aiGenerateFlashcards,
  // aiGenerateCbtExam(FromSource), and aiParsePastedQuestions all funnel
  // through this one function — there is no other path to the AI backend.
  // NOTE: aiSupportReply (in-app help chat) is included in this gate too.
  // If you'd rather keep basic support free for everyone, move
  // assertAiAccess() calls down into the individual functions instead of
  // gating here, and skip it in aiSupportReply specifically.
  //
  // accessCheck lets a caller substitute a broader/narrower gate than the
  // default Premium+Elite one — e.g. CBT exam generation passes
  // hasAnyPaidPlan so every paid tier gets through, while humanizer/
  // support/tutor keep using the default hasAiAccess (Premium+Elite only).
  assertAiAccess(accessCheck);
  // Now routing through secure Cloud Function to protect API keys
  const functions = getFunctions();
  const callAiChat = httpsCallable(functions, 'aiChatCompletion');
  
  try {
    const result = await callAiChat({
      messages: Array.isArray(messages) ? messages : [],
      model: model,
      temperature: temperature,
      maxTokens: maxTokens
    });
    return result.data;
  } catch (error) {
    console.error("AI Chat Error:", error);
    throw error;
  }
}

// Keeping local helpers but redirecting core AI logic to backend
export async function aiGenerateQuestionsFromPdf(pdfData, { count = 20, intensity = 'standard' } = {}) {
  const text = await extractTextFromPdf(pdfData);
  if (!text || text.length < 100) throw new Error('PDF_CONTENT_TOO_SHORT');

  const safeCount = Math.max(5, Math.min(50, Math.floor(Number(count) || 20)));
  
  // Use the new secure core
  try {
    return await generateQuizFromNeuralCore({
      text: text.slice(0, 50000), // Safety limit for prompt size
      count: safeCount,
      intensity: intensity,
      strict: true
    });
  } catch (e) {
    console.warn("Secure AI failed, falling back to local heuristic generation", e);
    return generateQuestionsFromText(text, { count: safeCount });
  }
}

export function setAiSettings(partial) {
  const current = getAiSettings();
  const next = {
    ...current,
    ...(partial && typeof partial === 'object' ? partial : {})
  };
  const normalized = {
    apiKey: toText(next.apiKey || '').trim() || null,
    endpoint: toText(next.endpoint || '').trim() || current.endpoint,
    model: toText(next.model || '').trim() || current.model,
    timeoutMs: Number.isFinite(Number(next.timeoutMs)) ? Number(next.timeoutMs) : current.timeoutMs
  };
  writeJson(AI_SETTINGS_STORAGE_KEY, normalized);
  return getAiSettings();
}

export function aiIsConfigured() {
  const s = getAiSettings();
  return !!(s.apiKey && s.endpoint);
}

function normalizeEndpoint(endpoint) {
  const ep = toText(endpoint).trim();
  if (!ep) return '';
  if (ep.includes('/chat/completions')) return ep;
  if (ep.endsWith('/')) return ep + 'chat/completions';
  if (ep.endsWith('/v1')) return ep + '/chat/completions';
  return ep;
}

function isGeminiEndpoint(endpoint) {
  const ep = toText(endpoint).toLowerCase();
  return ep.includes('generativelanguage.googleapis.com');
}

function normalizeGeminiModelId(model) {
  const raw = toText(model).trim();
  if (!raw) return '';
  return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
}

function normalizeGeminiBase(endpoint) {
  const ep = toText(endpoint).trim().replace(/\/+$/, '');
  if (!ep) return '';
  if (ep.includes('/v1beta')) return ep;
  return ep + '/v1beta';
}

async function listGeminiModels() {
  const s = getAiSettings();
  const base = normalizeGeminiBase(s.endpoint);
  const url = `${base}/models?key=${encodeURIComponent(s.apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), s.timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const msg = toText(json?.error?.message || json?.message || text || res.statusText).trim() || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    const models = Array.isArray(json?.models) ? json.models : [];
    return models;
  } finally {
    clearTimeout(timer);
  }
}

function pickGeminiModel(models, preferred) {
  const want = normalizeGeminiModelId(preferred);
  const list = Array.isArray(models) ? models : [];
  const supported = list.filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'));

  const byId = new Map();
  for (const m of supported) {
    const id = normalizeGeminiModelId(m?.name);
    if (!id) continue;
    byId.set(id, m);
  }

  if (want && byId.has(want)) return want;

  const fallbacks = [
    'gemini-2.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-1.5-pro-latest',
    'gemini-1.5-pro',
    'gemini-1.0-pro'
  ];

  for (const id of fallbacks) {
    if (byId.has(id)) return id;
  }

  const first = supported[0]?.name;
  return normalizeGeminiModelId(first);
}

function buildGeminiPayload(messages, temperature) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const systemParts = safeMessages
    .filter(m => m && typeof m === 'object' && m.role === 'system')
    .map(m => toText(m.content).trim())
    .filter(Boolean);
  const systemText = systemParts.join('\n\n');

  const contents = safeMessages
    .filter(m => m && typeof m === 'object' && m.role !== 'system')
    .map(m => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      return { role, parts: [{ text: toText(m.content) }] };
    });

  const payload = {
    contents,
    generationConfig: {
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7
    }
  };

  if (systemText) payload.system_instruction = { parts: [{ text: systemText }] };
  return payload;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

let pdfjsPromise = null;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('https://cdn.jsdelivr.net/npm/@bundled-es-modules/pdfjs-dist@3.6.172-alpha.1/build/pdf.min.js');
  }
  const mod = await pdfjsPromise;
  const pdfjs = mod?.default || mod;
  try {
    if (pdfjs?.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/@bundled-es-modules/pdfjs-dist@3.6.172-alpha.1/build/pdf.worker.min.js';
    }
  } catch {}
  return pdfjs;
}

let mammothPromise = null;
async function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = import('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/+esm');
  }
  const mod = await mammothPromise;
  return mod?.default || mod;
}

function splitIntoSentences(text) {
  const raw = toText(text).replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  return raw
    .split(/[.!?]\s+/g)
    .map(s => s.trim())
    .filter(s => s.length >= 40 && s.length <= 220);
}

function pickKeywordToken(sentence) {
  const stop = new Set([
    'the','and','that','with','from','this','they','them','then','when','where','which','what','your','you',
    'are','was','were','been','being','have','has','had','will','shall','may','might','can','could','would','should',
    'into','onto','over','under','between','within','without','about','above','below','after','before','because',
    'also','than','there','their','these','those','some','such','most','more','many','each','other','only','very'
  ]);
  const tokens = toText(sentence)
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/\s+/g)
    .map(t => t.trim())
    .filter(Boolean);
  const candidates = tokens
    .filter(t => t.length >= 5)
    .filter(t => !stop.has(t.toLowerCase()))
    .filter(t => /[a-zA-Z]/.test(t));
  if (!candidates.length) return '';
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

function buildDistractors(globalTokens, correct, count = 3) {
  const c = toText(correct).trim();
  const pool = Array.isArray(globalTokens) ? globalTokens : [];
  const out = [];
  const used = new Set([c.toLowerCase()]);
  for (let i = 0; i < pool.length && out.length < count; i++) {
    const t = toText(pool[i]).trim();
    const key = t.toLowerCase();
    if (!t || used.has(key)) continue;
    if (Math.abs(t.length - c.length) > 10) continue;
    used.add(key);
    out.push(t);
  }
  while (out.length < count) out.push(`Option ${String.fromCharCode(65 + out.length + 1)}`);
  return out;
}

function shuffle(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function inferSubjectFromText(text) {
  const t = toText(text).toLowerCase();
  const score = (pairs) => pairs.reduce((sum, p) => sum + (t.includes(p) ? 1 : 0), 0);
  const scores = [
    { subject: 'Mathematics', s: score(['equation', 'algebra', 'calculus', 'integral', 'derivative', 'simultaneous', 'quadratic', 'logarithm', 'trigonometry']) },
    { subject: 'Physics', s: score(['velocity', 'acceleration', 'force', 'newton', 'momentum', 'energy', 'power', 'electric', 'current', 'voltage', 'resistance']) },
    { subject: 'Chemistry', s: score(['atom', 'mole', 'acid', 'base', 'salt', 'alkane', 'alkene', 'oxidation', 'reduction', 'periodic', 'compound']) },
    { subject: 'Biology', s: score(['cell', 'photosynthesis', 'mitosis', 'meiosis', 'enzyme', 'genetics', 'organism', 'respiration', 'ecosystem']) },
    { subject: 'English', s: score(['synonym', 'antonym', 'grammar', 'tenses', 'concord', 'comprehension', 'punctuation', 'clause']) }
  ];
  scores.sort((a, b) => b.s - a.s);
  return scores[0]?.s ? scores[0].subject : 'General';
}

function countWords(value) {
  return toText(value).trim().split(/\s+/g).filter(Boolean).length;
}

function extractDefinitionsFromSentences(sentences) {
  const list = Array.isArray(sentences) ? sentences : [];
  const out = [];
  const seen = new Set();
  const patterns = [
    ' is ',
    ' are ',
    ' means ',
    ' refers to ',
    ' can be defined as '
  ];
  for (const s of list) {
    const raw = toText(s).trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const hit = patterns.find(p => lower.includes(p));
    if (!hit) continue;
    const parts = raw.split(new RegExp(hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    if (parts.length < 2) continue;
    const term = toText(parts[0]).trim().replace(/[:\-–—]$/, '').trim();
    const def = toText(parts.slice(1).join(hit)).trim();
    if (!term || !def) continue;
    if (term.length > 60 || def.length < 25 || def.length > 200) continue;
    if (countWords(term) > 6) continue;
    if (/^\d+$/.test(term)) continue;
    const key = `${term.toLowerCase()}|${def.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ term, def, source: raw });
  }
  return out;
}

function buildUniqueOptions(options, correctValue) {
  const out = [];
  const used = new Set();
  for (const o of options) {
    const v = toText(o).trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (used.has(k)) continue;
    used.add(k);
    out.push(v);
    if (out.length === 4) break;
  }
  while (out.length < 4) out.push(`Option ${String.fromCharCode(65 + out.length)}`);
  const correct = Math.max(0, out.findIndex(x => toText(x).trim().toLowerCase() === toText(correctValue).trim().toLowerCase()));
  return { opts: out.slice(0, 4), correct: correct >= 0 ? correct : 0 };
}

function generateDefinitionQuestions(defs, { count = 20 } = {}) {
  const safeCount = Math.max(5, Math.min(50, Math.floor(Number(count) || 20)));
  const list = Array.isArray(defs) ? defs : [];
  const poolDefs = shuffle(list).slice(0, 120);
  const questions = [];
  const usedQ = new Set();

  for (let i = 0; i < poolDefs.length && questions.length < safeCount; i++) {
    const d = poolDefs[i];
    const flip = i % 2 === 0;
    if (flip) {
      const qText = `What is ${d.term}?`;
      const key = qText.toLowerCase();
      if (usedQ.has(key)) continue;
      usedQ.add(key);
      const distractors = shuffle(poolDefs.filter(x => x !== d)).slice(0, 3).map(x => x.def);
      const built = buildUniqueOptions([d.def, ...distractors], d.def);
      questions.push({ q: qText, opts: built.opts, correct: built.correct, exp: d.source });
    } else {
      const stem = d.def.replace(/\s+/g, ' ').trim();
      const qText = `Which term matches this definition?\n${stem}`;
      const key = qText.toLowerCase();
      if (usedQ.has(key)) continue;
      usedQ.add(key);
      const distractors = shuffle(poolDefs.filter(x => x !== d)).slice(0, 3).map(x => x.term);
      const built = buildUniqueOptions([d.term, ...distractors], d.term);
      questions.push({ q: qText, opts: built.opts, correct: built.correct, exp: d.source });
    }
  }

  return questions.slice(0, safeCount);
}

function generateBlankQuestions(sentences, tokenPool, { count = 20 } = {}) {
  const safeCount = Math.max(5, Math.min(50, Math.floor(Number(count) || 20)));
  const picks = shuffle(sentences).slice(0, Math.max(10, safeCount * 3));
  const questions = [];
  const used = new Set();
  for (const s of picks) {
    if (questions.length >= safeCount) break;
    const keyToken = pickKeywordToken(s);
    if (!keyToken) continue;
    const blanked = s.replace(new RegExp(`\\b${keyToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), '____');
    if (!blanked.includes('____')) continue;
    const qKey = blanked.toLowerCase();
    if (used.has(qKey)) continue;
    used.add(qKey);
    const distractors = buildDistractors(tokenPool, keyToken, 3);
    const built = buildUniqueOptions(shuffle([keyToken, ...distractors]), keyToken);
    questions.push({ q: `Fill in the blank:\n${blanked}`, opts: built.opts, correct: built.correct, exp: toText(s).trim() });
  }
  return questions.slice(0, safeCount);
}

export function generateQuestionsFromText(text, { count = 20, style = 'balanced' } = {}) {
  const safeCount = Math.max(5, Math.min(50, Math.floor(Number(count) || 20)));
  const subject = inferSubjectFromText(text);
  const sentences = splitIntoSentences(text);
  const tokens = toText(text)
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/\s+/g)
    .map(t => t.trim())
    .filter(t => t.length >= 4 && /[a-zA-Z]/.test(t));

  const tokenPool = shuffle(tokens).slice(0, 500);
  const defs = extractDefinitionsFromSentences(sentences);
  const styleRaw = toText(style).trim().toLowerCase();
  const chosenStyle = styleRaw === 'definitions' || styleRaw === 'blanks' || styleRaw === 'balanced' ? styleRaw : 'balanced';

  let questions = [];
  if (chosenStyle === 'definitions') {
    questions = generateDefinitionQuestions(defs, { count: safeCount });
  } else if (chosenStyle === 'blanks') {
    questions = generateBlankQuestions(sentences, tokenPool, { count: safeCount });
  } else {
    const defCount = Math.min(safeCount, Math.max(5, Math.floor(safeCount * 0.6)));
    const blankCount = Math.max(5, safeCount - defCount);
    const a = generateDefinitionQuestions(defs, { count: defCount });
    const b = generateBlankQuestions(sentences, tokenPool, { count: blankCount });
    questions = shuffle([...a, ...b]).slice(0, safeCount);
  }

  return { subject, questions: questions.slice(0, safeCount) };
}

export async function extractTextFromPdf(pdfData) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: pdfData });
  const pdf = await loadingTask.promise;
  let fullText = '';
  
  const pages = pdf.numPages;
  const pagesLines = [];
  
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = Array.isArray(textContent?.items) ? textContent.items : [];
    const lines = bucketPdfItemsToLines(items);
    pagesLines.push(lines);
  }
  
  const stripped = stripRecurringHeadersFooters(pagesLines);
  const mergedLines = collapseDuplicateLines(stripped.flat().filter(l => !isProbablyHeaderFooter(l)));
  return normalizeTextBlocks(mergedLines.join('\n'));
}

const scanCache = new Map();

function emitScanProgress(detail) {
  try {
    const d = detail && typeof detail === 'object' ? detail : {};
    if (typeof globalThis?.dispatchEvent !== 'function') return;
    globalThis.dispatchEvent(new CustomEvent('cbt:scanProgress', { detail: d }));
  } catch {}
}

function isProbablyHeaderFooter(line) {
  const t = toText(line).trim();
  if (!t) return true;
  if (/^page\s*\d+(\s*of\s*\d+)?$/i.test(t)) return true;
  if (/^\d+\s*\/\s*\d+$/i.test(t)) return true;
  if (/^\d+$/i.test(t)) return true;
  if (/^copyright\s+/i.test(t)) return true;
  return false;
}

function normalizeTextBlocks(text) {
  let t = toText(text);
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}

function collapseDuplicateLines(lines) {
  const out = [];
  let prev = '';
  for (const l of lines) {
    const s = toText(l).replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (key === prev) continue;
    prev = key;
    out.push(s);
  }
  return out;
}

function bucketPdfItemsToLines(items) {
  const rows = new Map();
  for (const it of items) {
    const str = toText(it?.str).replace(/\s+/g, ' ').trim();
    if (!str) continue;
    const tr = Array.isArray(it?.transform) ? it.transform : null;
    const x = Number(tr?.[4]) || 0;
    const y = Number(tr?.[5]) || 0;
    const key = Math.round(y / 2) * 2;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ str, x, y });
  }
  const keys = Array.from(rows.keys()).sort((a, b) => b - a);
  const lines = [];
  for (const k of keys) {
    const parts = rows.get(k).sort((a, b) => a.x - b.x);
    let line = '';
    for (const p of parts) {
      if (!line) {
        line = p.str;
        continue;
      }
      const prev = line[line.length - 1] || '';
      const next = p.str[0] || '';
      if (prev === '-' && /[a-z]/.test(next)) {
        line = line.slice(0, -1) + p.str;
      } else if (/[\w)]/.test(prev) && /[\w(]/.test(next)) {
        line += ' ' + p.str;
      } else {
        line += p.str;
      }
    }
    line = line.replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines;
}

function stripRecurringHeadersFooters(pagesLines) {
  const pages = Array.isArray(pagesLines) ? pagesLines : [];
  const headerCounts = new Map();
  const footerCounts = new Map();
  const get = (m, k) => m.get(k) || 0;
  const set = (m, k, v) => m.set(k, v);

  for (const lines of pages) {
    const clean = Array.isArray(lines) ? lines.filter(l => !isProbablyHeaderFooter(l)) : [];
    const header = clean.slice(0, 2);
    const footer = clean.slice(-2);
    for (const h of header) {
      const k = toText(h).toLowerCase();
      if (!k) continue;
      set(headerCounts, k, get(headerCounts, k) + 1);
    }
    for (const f of footer) {
      const k = toText(f).toLowerCase();
      if (!k) continue;
      set(footerCounts, k, get(footerCounts, k) + 1);
    }
  }

  const minHits = Math.max(2, Math.floor(pages.length * 0.6));
  const bad = new Set();
  for (const [k, v] of headerCounts.entries()) if (v >= minHits) bad.add(k);
  for (const [k, v] of footerCounts.entries()) if (v >= minHits) bad.add(k);

  return pages.map(lines => (Array.isArray(lines) ? lines.filter(l => !bad.has(toText(l).toLowerCase())) : []));
}

async function extractTextFromPdfArrayBuffer(buf, { maxPages = 12, maxChars = 180000 } = {}) {
  const pdfjs = await loadPdfJs();
  if (!pdfjs?.getDocument) throw new Error('PDFJS_LOAD_FAILED');

  emitScanProgress({ stage: 'pdf_open', pct: 5, status: 'Opening PDF…' });
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = Math.min(Math.max(1, Math.floor(Number(maxPages) || 12)), doc.numPages || 1);
  emitScanProgress({ stage: 'pdf_open', pct: 8, status: `Preparing ${pages} page(s)…`, pages });

  const pagesLines = [];
  let collected = 0;
  for (let p = 1; p <= pages; p++) {
    const pct = Math.min(70, 10 + Math.round((p / Math.max(1, pages)) * 55));
    emitScanProgress({ stage: 'pdf_extract', pct, status: `Scanning page ${p}/${pages}…`, page: p, pages });

    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = Array.isArray(content?.items) ? content.items : [];
    const lines = bucketPdfItemsToLines(items);
    pagesLines.push(lines);

    collected += lines.join('\n').length;
    if (collected >= maxChars) break;
  }

  const stripped = stripRecurringHeadersFooters(pagesLines);
  const mergedLines = collapseDuplicateLines(stripped.flat().filter(l => !isProbablyHeaderFooter(l)));
  const text = normalizeTextBlocks(mergedLines.join('\n'));

  emitScanProgress({ stage: 'pdf_done', pct: 70, status: 'Text extracted' });
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

async function extractTextFromDocxArrayBuffer(buf, { maxChars = 180000 } = {}) {
  const mammoth = await loadMammoth();
  if (!mammoth?.extractRawText) throw new Error('MAMMOTH_LOAD_FAILED');
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  const text = toText(res?.value || '').trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

async function scanSourceToText(source, { maxChars = 180000 } = {}) {
  const src = source && typeof source === 'object' ? source : {};
  const directText = toText(src.textContent || '').trim();
  if (directText) return { text: directText.length > maxChars ? directText.slice(0, maxChars) : directText, scanned: true, reason: '' };
  const hasFile = !!src.file && typeof src.file.arrayBuffer === 'function';
  const fileUrl = toText(src.fileUrl).trim();
  const fileName = hasFile ? toText(src.file?.name).toLowerCase() : toText(fileUrl).toLowerCase();
  const isPdf = fileName.endsWith('.pdf') || toText(src.file?.type).includes('pdf');
  const isDocx = fileName.endsWith('.docx') || toText(src.file?.type).includes('officedocument.wordprocessingml.document');
  const pagesRaw = toText(src.scanPages || '').trim().toLowerCase();
  const hintCount = Math.max(0, Math.min(50, Math.floor(Number(src.countHint) || 0)));
  const autoPages = hintCount ? Math.max(5, Math.min(30, Math.ceil(hintCount / 3) * 2)) : 12;
  const maxPages = pagesRaw === 'auto' || !pagesRaw ? autoPages : Math.max(1, Math.min(30, Math.floor(Number(pagesRaw) || 12)));
  try {
    let buf = null;
    const cacheKey = hasFile
      ? `file:${toText(src.file?.name)}:${Number(src.file?.size) || 0}:${Number(src.file?.lastModified) || 0}:p${maxPages}`
      : (fileUrl ? `url:${fileUrl}:p${maxPages}` : '');
    if (cacheKey && scanCache.has(cacheKey)) {
      const cached = scanCache.get(cacheKey);
      return { text: cached, scanned: !!cached, reason: cached ? '' : 'empty' };
    }
    if (hasFile) buf = await src.file.arrayBuffer();
    else if (fileUrl) {
      const res = await fetch(fileUrl);
      if (!res.ok) return { text: '', scanned: false, reason: 'fetch_failed' };
      buf = await res.arrayBuffer();
    }
    if (!buf) return { text: '', scanned: false, reason: 'no_file' };
    if (isPdf) {
      const text = await extractTextFromPdfArrayBuffer(buf, { maxChars, maxPages });
      if (cacheKey) scanCache.set(cacheKey, text);
      return { text, scanned: !!text, reason: text ? '' : 'empty' };
    }
    if (isDocx) {
      emitScanProgress({ stage: 'docx_extract', pct: 25, status: 'Reading DOCX…' });
      const text = await extractTextFromDocxArrayBuffer(buf, { maxChars });
      if (cacheKey) scanCache.set(cacheKey, text);
      return { text, scanned: !!text, reason: text ? '' : 'empty' };
    }
    const text = new TextDecoder().decode(buf);
    const sliced = text.length > maxChars ? text.slice(0, maxChars) : text;
    if (cacheKey) scanCache.set(cacheKey, sliced.trim());
    return { text: sliced.trim(), scanned: !!sliced.trim(), reason: sliced.trim() ? '' : 'empty' };
  } catch (e) {
    const msg = toText(e?.message).toLowerCase();
    if (msg.includes('pdfjs')) return { text: '', scanned: false, reason: 'pdf_parse_failed' };
    if (msg.includes('mammoth')) return { text: '', scanned: false, reason: 'docx_parse_failed' };
    return { text: '', scanned: false, reason: 'scan_failed' };
  }
}

async function fileToInlineData(file, maxBytes = 8 * 1024 * 1024) {
  if (!file) return null;
  const name = toText(file.name).toLowerCase();
  if (name.endsWith('.docx')) return null;
  const buf = await file.arrayBuffer();
  const sliced = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  const mime = toText(file.type).trim() || 'application/pdf';
  return { mime_type: mime, data: arrayBufferToBase64(sliced) };
}

async function urlToInlineData(url, maxBytes = 8 * 1024 * 1024) {
  const href = toText(url).trim();
  if (!href) return null;
  if (href.toLowerCase().includes('.docx')) return null;
  const res = await fetch(href);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = toText(res.headers.get('content-type')).trim() || 'application/pdf';
  if (mime.toLowerCase().includes('officedocument.wordprocessingml.document')) return null;
  const buf = await res.arrayBuffer();
  const sliced = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  return { mime_type: mime, data: arrayBufferToBase64(sliced) };
}

async function aiGeminiGenerateContentWithParts({ systemText, parts, model, temperature, maxTokens }) {
  const s = getAiSettings();
  if (!s.apiKey) throw new Error('AI_NOT_CONFIGURED');

  const base = normalizeGeminiBase(s.endpoint);
  if (!base) throw new Error('AI_NOT_CONFIGURED');

  const primaryModel = normalizeGeminiModelId(toText(model || '').trim() || s.model);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), s.timeoutMs);
  try {
    const payloadBase = {
      contents: [{ role: 'user', parts: Array.isArray(parts) ? parts : [{ text: toText(parts) }] }],
      generationConfig: {
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7
      }
    };
    if (toText(systemText).trim()) payloadBase.system_instruction = { parts: [{ text: toText(systemText) }] };
    if (Number.isFinite(Number(maxTokens))) payloadBase.generationConfig.maxOutputTokens = Math.floor(Number(maxTokens));

    const tryOnce = async (modelId) => {
      const url = `${base}/models/${encodeURIComponent(normalizeGeminiModelId(modelId))}:generateContent?key=${encodeURIComponent(s.apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadBase),
        signal: controller.signal
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}

      if (!res.ok) {
        const msg = toText(json?.error?.message || json?.message || text || res.statusText).trim() || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.payload = json;
        throw err;
      }

      const outParts = json?.candidates?.[0]?.content?.parts;
      const content = Array.isArray(outParts) ? outParts.map(p => toText(p?.text)).join('') : '';
      return { content: toText(content), raw: json };
    };

    try {
      return await tryOnce(primaryModel);
    } catch (e) {
      const msg = toText(e?.message).toLowerCase();
      const shouldRetry = msg.includes('listmodels') || msg.includes('is not found') || msg.includes('not supported for generatecontent') || e?.status === 404;
      if (!shouldRetry) throw e;

      const models = await listGeminiModels();
      const picked = pickGeminiModel(models, primaryModel);
      if (!picked || picked === primaryModel) throw e;
      return await tryOnce(picked);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function aiGeminiGenerateContent({ messages, model, temperature, maxTokens }) {
  const s = getAiSettings();
  if (!s.apiKey) throw new Error('AI_NOT_CONFIGURED');

  const base = normalizeGeminiBase(s.endpoint);
  if (!base) throw new Error('AI_NOT_CONFIGURED');

  const primaryModel = normalizeGeminiModelId(toText(model || '').trim() || s.model);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), s.timeoutMs);
  try {
    const payload = buildGeminiPayload(messages, temperature);
    if (Number.isFinite(Number(maxTokens))) {
      payload.generationConfig.maxOutputTokens = Math.floor(Number(maxTokens));
    }

    const tryOnce = async (modelId) => {
      const url = `${base}/models/${encodeURIComponent(normalizeGeminiModelId(modelId))}:generateContent?key=${encodeURIComponent(s.apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}

      if (!res.ok) {
        const msg = toText(json?.error?.message || json?.message || text || res.statusText).trim() || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.payload = json;
        throw err;
      }

      const parts = json?.candidates?.[0]?.content?.parts;
      const content = Array.isArray(parts) ? parts.map(p => toText(p?.text)).join('') : '';
      return { content: toText(content), raw: json };
    };

    try {
      return await tryOnce(primaryModel);
    } catch (e) {
      const msg = toText(e?.message).toLowerCase();
      const shouldRetry = msg.includes('listmodels') || msg.includes('is not found') || msg.includes('not supported for generatecontent') || e?.status === 404;
      if (!shouldRetry) throw e;

      const models = await listGeminiModels();
      const picked = pickGeminiModel(models, primaryModel);
      if (!picked || picked === primaryModel) throw e;
      return await tryOnce(picked);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function aiParsePastedQuestions(rawText) {
  const input = toText(rawText).trim();
  if (!input) return { questions: [] };

  const system = [
    'You are a professional exam parser.',
    'Extract objective (multiple-choice) questions from the provided text.',
    'The text may contain question numbers, options (A, B, C, D), and correct answers.',
    'Return ONLY valid JSON with this exact structure:',
    '{ "questions": [ { "q": string, "opts": [string,string,string,string], "a": 0|1|2|3, "exp": string } ] }',
    'Rules:',
    '1. "q" is the question text.',
    '2. "opts" is an array of exactly 4 options.',
    '3. "a" is the 0-indexed index of the correct option (0=A, 1=B, 2=C, 3=D).',
    '4. "exp" is a brief explanation (optional, leave empty if not found).',
    '5. If the correct answer is not explicitly mentioned, try to infer it or default to 0.',
    '6. Return as many valid questions as you can find.'
  ].join('\n');

  const { content } = await aiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: input }
    ],
    temperature: 0.2,
    maxTokens: 2500
  });

  const raw = toText(content).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      parsed = JSON.parse(raw.slice(start, end + 1));
    }
  }

  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error('Could not parse questions. Please check the format.');
  }

  return parsed;
}

export async function aiHumanizeText(rawText, nuance = 'nigerian') {
  const input = toText(rawText).trim();
  if (!input) return '';

  const system = [
    'You are an AI humanizer for Nigerian student writing.',
    'Rewrite the user text to sound natural, human, and less AI-generated.',
    'Keep the meaning the same.',
    'Avoid sounding overly formal or overly slangy.',
    'Do not add headings or bullet points unless the input already has them.',
    'Return only the rewritten text.'
  ].join('\n');

  const user = `Nuance: ${toText(nuance).trim() || 'nigerian'}\n\nText:\n${input}`;

  const { content } = await aiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.6
  });

  return toText(content).trim();
}

export async function aiSupportReply(message, context = {}) {
  const userMsg = toText(message).trim();
  if (!userMsg) return '';

  const system = [
    'You are the Geo-Books in-app assistant.',
    'Help users navigate features and troubleshoot issues in a Nigerian student hub web app.',
    'Ask at most one clarifying question if needed.',
    'Keep responses short and actionable.'
  ].join('\n');

  const ctx = {
    section: toText(context.section || '').trim(),
    user: context.user && typeof context.user === 'object' ? {
      university: toText(context.user.university || '').trim(),
      subscriptionLevel: toText(context.user.subscriptionLevel || '').trim()
    } : {}
  };

  const { content } = await aiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Context: ${JSON.stringify(ctx)}\n\nUser: ${userMsg}` }
    ],
    temperature: 0.5
  });

  return toText(content).trim();
}

export async function aiTutorReply(message, context = {}) {
  const userMsg = toText(message).trim();
  if (!userMsg) return '';

  const system = [
    'You are a study tutor for Nigerian students.',
    'Explain concepts step-by-step with simple language and short examples.',
    'If the user asks for an answer, show the method and final answer if possible.',
    'If needed, ask one clarifying question.',
    'Keep it concise.'
  ].join('\n');

  const ctx = {
    subject: toText(context.subject || '').trim(),
    topic: toText(context.topic || '').trim(),
    exam: toText(context.exam || '').trim()
  };

  const { content } = await aiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Context: ${JSON.stringify(ctx)}\n\nQuestion: ${userMsg}` }
    ],
    temperature: 0.4
  });

  return toText(content).trim();
}

export async function aiGenerateDailyPathTasks(context = {}) {
  const system = [
    'You generate a short daily study plan for a student.',
    'Return ONLY valid JSON: an array of 3 to 6 tasks.',
    'Each task must be an object: { "id": string, "day": string, "task": string, "color": string, "icon": string }.',
    'Use Tailwind color classes for color like "bg-brand-500", "bg-rose-500", "bg-emerald-500", "bg-amber-500".',
    'Use lucide icon names like "book-open", "zap", "divide", "atom", "dna", "pen-tool".'
  ].join('\n');

  const safeContext = {
    university: toText(context.university || '').trim(),
    exams: Array.isArray(context.exams) ? context.exams.slice(0, 10).map(toText) : [],
    weakAreas: Array.isArray(context.weakAreas) ? context.weakAreas.slice(0, 10).map(toText) : []
  };

  const { content } = await aiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(safeContext) }
    ],
    temperature: 0.3,
    maxTokens: 350
  });

  const raw = toText(content).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
      parsed = JSON.parse(raw.slice(start, end + 1));
    }
  }

  if (!Array.isArray(parsed)) throw new Error('AI_BAD_JSON');

  const cleaned = parsed
    .filter(x => x && typeof x === 'object')
    .slice(0, 6)
    .map((t, idx) => ({
      id: toText(t.id || `t${idx + 1}`).trim() || `t${idx + 1}`,
      day: toText(t.day || '').trim() || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][idx] || 'Mon',
      task: toText(t.task || '').trim() || 'Study session',
      color: toText(t.color || '').trim() || 'bg-brand-500',
      icon: toText(t.icon || '').trim() || 'book-open'
    }));

  if (cleaned.length < 3) throw new Error('AI_TOO_FEW_TASKS');
  return cleaned;
}

export async function aiExplainFlashcard({ question, answer, category } = {}) {
  const q = toText(question).trim();
  const a = toText(answer).trim();
  const cat = toText(category).trim();
  if (!q && !a) return '';

  const system = [
    'You explain flashcards for Nigerian students.',
    'Explain the concept in simple terms with one short example if helpful.',
    'Give one memory tip.',
    'Keep it under 8 short lines.'
  ].join('\n');

  const user = `Category: ${cat || 'General'}\n\nQuestion: ${q}\n\nAnswer: ${a}`;

  const { content } = await aiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.4,
    maxTokens: 220
  });

  return toText(content).trim();
}

export async function aiGenerateFlashcards({ seed, source, count = 10 } = {}) {
  const safeCount = Math.max(1, Math.min(20, Math.floor(Number(count) || 10)));
  const hasSource = !!(source && (source.file || source.fileUrl || source.textContent));

  const system = [
    'You generate flashcards for Nigerian students.',
    'Return ONLY valid JSON with this shape:',
    '{ "category": string, "cards": [ { "q": string, "a": string } ] }',
    'Keep questions concise and answers informative but brief.',
    'Make sure the content is relevant to the Nigerian academic syllabus if applicable.'
  ].join('\n');

  let prompt = '';
  let parts = [];

  if (hasSource) {
    const scanned = await scanSourceToText(source);
    prompt = `Generate ${safeCount} flashcards from the following content:\n\n${scanned.text.slice(0, 50000)}`;
  } else {
    prompt = `Generate ${safeCount} flashcards about this topic: ${toText(seed).trim() || 'General Knowledge'}`;
  }

  const { content } = await aiChatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    maxTokens: 1500
  });

  const raw = toText(content).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) parsed = JSON.parse(raw.slice(start, end + 1));
  }

  const category = toText(parsed?.category).trim() || 'General';
  const cards = Array.isArray(parsed?.cards) ? parsed.cards.map(c => ({
    q: toText(c.q).trim(),
    a: toText(c.a).trim(),
    cat: category,
    srsLevel: 0,
    nextReview: Date.now()
  })) : [];

  return { category, cards };
}

export async function aiGenerateCbtExam({ seed, count = 20, intensity = 'standard' } = {}) {
  const safeSeed = toText(seed).trim();
  const safeCount = Math.max(5, Math.min(50, Math.floor(Number(count) || 20)));
  if (!safeSeed) throw new Error('AI_BAD_INPUT');
  const intensityRaw = toText(intensity).trim().toLowerCase();
  const safeIntensity = intensityRaw === 'easy' || intensityRaw === 'hard' || intensityRaw === 'standard' ? intensityRaw : 'standard';

  const system = [
    'You generate CBT multiple-choice questions for Nigerian students.',
    `Exam intensity: ${safeIntensity}.`,
    'Return ONLY valid JSON with this shape:',
    '{ "subject": string, "questions": [ { "q": string, "opts": [string,string,string,string], "correct": 0|1|2|3, "exp": string } ] }',
    'Make questions clear and exam-like.',
    'Keep explanations short.'
  ].join('\n');

  const runOnce = async ({ strict = false } = {}) => {
    const sys = strict
      ? [
          system,
          `You MUST return at least 5 questions and ideally exactly ${safeCount}.`,
          'Do not include markdown fences.',
          'Do not add extra keys.',
          'If you cannot comply, still return valid JSON with as many questions as possible.'
        ].join('\n')
      : system;

    const { content } = await aiChatCompletion({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: JSON.stringify({ seed: safeSeed, count: safeCount }) }
      ],
      temperature: strict ? 0.2 : 0.3,
      maxTokens: strict ? 1200 : 900,
      accessCheck: hasAnyPaidPlan // CBT generation - any paid plan
    });

    const raw = toText(content).trim();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) parsed = JSON.parse(raw.slice(start, end + 1));
    }

    const subject = toText(parsed?.subject).trim() || 'General';
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const cleaned = questions
      .filter(x => x && typeof x === 'object')
      .slice(0, safeCount)
      .map((q, idx) => {
        const opts = Array.isArray(q.opts) ? q.opts.map(toText).slice(0, 4) : [];
        const padded = opts.length === 4 ? opts : [...opts, 'Option A', 'Option B', 'Option C', 'Option D'].slice(0, 4);
        const correct = Math.max(0, Math.min(3, Math.floor(Number(q.correct))));
        return {
          q: toText(q.q).trim() || `Question ${idx + 1}`,
          opts: padded.map(x => toText(x).trim()),
          correct: Number.isFinite(correct) ? correct : 0,
          exp: toText(q.exp).trim() || ''
        };
      });

    return { subject, cleaned };
  };

  const first = await runOnce({ strict: false });
  if (first.cleaned.length >= 5) return { subject: first.subject, questions: first.cleaned };

  const second = await runOnce({ strict: true });
  if (second.cleaned.length >= 5) return { subject: second.subject, questions: second.cleaned };

  throw new Error('AI_TOO_FEW_QUESTIONS');
}

export async function aiGenerateCbtExamFromSource({ source, count = 20, intensity = 'standard' } = {}) {
  const safeCount = Math.max(5, Math.min(50, Math.floor(Number(count) || 20)));
  const src = source && typeof source === 'object' ? source : {};
  const title = toText(src.title).trim();
  const category = toText(src.category).trim();
  const fileUrl = toText(src.fileUrl).trim();
  const hasFile = !!src.file && typeof src.file.arrayBuffer === 'function';
  const fileName = hasFile ? toText(src.file?.name).toLowerCase() : '';
  const isDocx = fileName.endsWith('.docx') || toText(src.file?.type).includes('officedocument.wordprocessingml.document');
  const intensityRaw = toText(intensity).trim().toLowerCase();
  const safeIntensity = intensityRaw === 'easy' || intensityRaw === 'hard' || intensityRaw === 'standard' ? intensityRaw : 'standard';

  const system = [
    'You generate CBT multiple-choice questions for Nigerian students.',
    `Exam intensity: ${safeIntensity}.`,
    'If a document is provided, read it and extract concepts to create questions from it.',
    'Return ONLY valid JSON with this shape:',
    '{ "subject": string, "questions": [ { "q": string, "opts": [string,string,string,string], "correct": 0|1|2|3, "exp": string } ] }',
    'Make questions clear and exam-like.',
    'Keep explanations short.'
  ].join('\n');

  const prompt = JSON.stringify({
    title: title || null,
    category: category || null,
    count: safeCount
  });

  let inline = null;
  let inlineErr = '';
  try {
    if (hasFile) inline = await fileToInlineData(src.file);
    else if (fileUrl) inline = await urlToInlineData(fileUrl);
  } catch {
    inline = null;
    inlineErr = 'fetch_failed';
  }

  const scannedText = await scanSourceToText(src);
  if (scannedText.scanned && !aiIsConfigured()) {
    const style = toText(src.questionStyle || '').trim().toLowerCase() || 'balanced';
    const res = generateQuestionsFromText(scannedText.text, { count: safeCount, style });
    return { ...res, scanned: true, reason: '' };
  }

  if (!aiIsConfigured()) {
    const seed = `${title} ${category}`.trim();
    const res = generateQuestionsFromSeed(seed || 'General', safeCount);
    return { ...res, scanned: false, reason: scannedText.reason || 'ai_not_configured' };
  }

  if (scannedText.scanned && !isGeminiEndpoint(getAiSettings().endpoint)) {
    const style = toText(src.questionStyle || '').trim().toLowerCase() || 'balanced';
    const res = generateQuestionsFromText(scannedText.text, { count: safeCount, style });
    return { ...res, scanned: true, reason: '' };
  }

  if (!isGeminiEndpoint(getAiSettings().endpoint) || (!inline && !scannedText.scanned)) {
    const seed = `${title} ${category}`.trim();
    const res = await aiGenerateCbtExam({ seed: seed || 'General', count: safeCount, intensity: safeIntensity });
    return { ...res, scanned: false, reason: inlineErr || scannedText.reason || (isGeminiEndpoint(getAiSettings().endpoint) ? 'no_file' : 'non_gemini') };
  }

  const runOnce = async ({ strict = false } = {}) => {
    const sys = strict
      ? [
          system,
          `You MUST return at least 5 questions and ideally exactly ${safeCount}.`,
          'Return JSON only. No markdown.',
          'If the document is short, still create questions from any concepts found.'
        ].join('\n')
      : system;
    const prm = strict ? JSON.stringify({ title: title || null, category: category || null, count: safeCount, strict: true }) : prompt;

    const { content } = await aiGeminiGenerateContentWithParts({
      systemText: sys,
      parts: scannedText.scanned
        ? [{ text: prm }, { text: `DOCUMENT_TEXT:\n${scannedText.text.slice(0, 80000)}` }]
        : [{ text: prm }, { inline_data: inline }],
      temperature: strict ? 0.2 : 0.3,
      maxTokens: strict ? 1200 : 900
    });

    const raw = toText(content).trim();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) parsed = JSON.parse(raw.slice(start, end + 1));
    }

    const subject = toText(parsed?.subject).trim() || 'General';
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const cleaned = questions
      .filter(x => x && typeof x === 'object')
      .slice(0, safeCount)
      .map((q, idx) => {
        const opts = Array.isArray(q.opts) ? q.opts.map(toText).slice(0, 4) : [];
        const padded = opts.length === 4 ? opts : [...opts, 'Option A', 'Option B', 'Option C', 'Option D'].slice(0, 4);
        const correct = Math.max(0, Math.min(3, Math.floor(Number(q.correct))));
        return {
          q: toText(q.q).trim() || `Question ${idx + 1}`,
          opts: padded.map(x => toText(x).trim()),
          correct: Number.isFinite(correct) ? correct : 0,
          exp: toText(q.exp).trim() || ''
        };
      });

    return { subject, cleaned };
  };

  const first = await runOnce({ strict: false });
  if (first.cleaned.length >= 5) return { subject: first.subject, questions: first.cleaned, scanned: true, reason: '' };

  const second = await runOnce({ strict: true });
  if (second.cleaned.length >= 5) return { subject: second.subject, questions: second.cleaned, scanned: true, reason: '' };

  const seed = `${title} ${category}`.trim();
  const res = await aiGenerateCbtExam({ seed: seed || 'General', count: safeCount, intensity: safeIntensity });
  return { ...res, scanned: false, reason: 'too_few' };
}





