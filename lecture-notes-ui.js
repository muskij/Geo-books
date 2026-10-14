// Lecture -> Notes (browser side). Records the lecture in short segments, sends each to the
// server for transcription, then asks the server to write notes + practice questions.
// Server half: lecture-notes.js. Notes are stored server-side (owner-only).
import { getApps } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import { launchCbtSession } from './ai-vault-shared.js';

const SECTION_ID = 'lectureNotes';
const SEGMENT_MS = 240000; // 4 minutes per upload
const DRAFT_KEY = 'gbLectureDraft_v1';
const API_BASE = window.GEO_BOOKS_API_URL || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3007' : '');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const mins = (sec) => Math.max(1, Math.round(sec / 60)) + ' min';
const toast = (msg, type) => { try { if (typeof window.toast === 'function') return window.toast(msg, type); } catch (e) { /* ignore */ } const t = document.createElement('div'); t.textContent = msg; t.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:12px 18px;border-radius:14px;font-weight:700;font-size:14px;z-index:9999;max-width:90vw'; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };

async function api(path, opts = {}) {
  const app = getApps()[0];
  const user = app ? getAuth(app).currentUser : null;
  if (!user) throw Object.assign(new Error('Please sign in first.'), { code: 'auth' });
  const token = await user.getIdToken();
  const res = await fetch(API_BASE + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) throw Object.assign(new Error((body && body.error) || 'Request failed (' + res.status + ').'), { status: res.status, body });
  return body;
}

const CSS = `
.ln{max-width:720px;margin:0 auto;padding:16px 16px 130px}
.ln h2{font-size:26px;font-weight:900;letter-spacing:-.02em}
.ln-lead{font-size:14px;font-weight:600;color:#64748b;margin:4px 0 16px}
.ln-card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;padding:16px;margin-bottom:12px}
.ln-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:14px;border:1.5px solid #e2e8f0;background:#fff;color:#334155;font-weight:800;font-size:15px;cursor:pointer}
.ln-btn:active{transform:scale(.97)}.ln-btn svg{width:18px;height:18px}
.ln-main{background:#5b4cf0;border-color:#5b4cf0;color:#fff}.ln-red{background:#e11d48;border-color:#e11d48;color:#fff}
.ln-wide{width:100%}.ln-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ln-quota{height:8px;border-radius:99px;background:#e2e8f0;overflow:hidden;margin:8px 0 4px}.ln-quota i{display:block;height:100%;background:#5b4cf0;border-radius:99px}
.ln-small{font-size:12.5px;font-weight:600;color:#94a3b8}
.ln input{width:100%;box-sizing:border-box;min-height:46px;border-radius:12px;border:1px solid #e2e8f0;background:#f8fafc;padding:0 12px;font-size:16px;font-weight:600;outline:none;margin-bottom:8px}
.ln input:focus{border-color:#5b4cf0;background:#fff}
.ln-rec{text-align:center;padding:28px 16px}
.ln-dot{width:14px;height:14px;border-radius:50%;background:#e11d48;display:inline-block;margin-right:8px;animation:lnPulse 1.2s infinite}
.ln-paused .ln-dot{animation:none;background:#94a3b8}
@keyframes lnPulse{50%{opacity:.25}}
.ln-time{font-size:54px;font-weight:900;letter-spacing:-.03em;font-variant-numeric:tabular-nums;margin:8px 0}
.ln-meter{height:10px;border-radius:99px;background:#e2e8f0;overflow:hidden;max-width:320px;margin:10px auto 6px}.ln-meter i{display:block;height:100%;width:0;background:#059669;transition:width .1s}
.ln-status{font-size:13px;font-weight:700;color:#64748b;min-height:20px}
.ln-warn{background:#fffbeb;color:#92400e;border-radius:14px;padding:10px 12px;font-size:13px;font-weight:700;margin:10px 0}
.ln-err{background:#fff1f2;color:#9f1239}
.ln-item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:14px;margin-bottom:8px;cursor:pointer}
.ln-item b{display:block;font-size:15px;font-weight:800;overflow-wrap:anywhere}.ln-item span{font-size:12.5px;font-weight:600;color:#94a3b8}
.ln-item>div{min-width:0;flex:1}
.ln-n h3{font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#5b4cf0;margin:20px 0 8px}
.ln-n p,.ln-n li{font-size:15px;line-height:1.55;font-weight:500}.ln-n ul{padding-left:20px;margin:0}.ln-n li{margin:5px 0}
.ln-n h4{font-size:16px;font-weight:800;margin:14px 0 4px}
.ln-def{padding:10px 12px;border-radius:14px;background:#f1f0ff;margin-bottom:6px;font-size:14.5px}.ln-def b{color:#4a3bd9}
.ln-tip{padding:10px 12px;border-radius:14px;background:#fffbeb;margin-bottom:6px;font-size:14.5px;font-weight:600}
.ln-empty{text-align:center;padding:30px 18px;border:1.5px dashed #cbd5e1;border-radius:22px;background:#fff}
.ln-empty h3{font-size:17px;font-weight:900}.ln-empty p{font-size:13px;font-weight:600;color:#94a3b8;margin:6px 0 0}
html.dark .ln-card,html.dark .ln-btn,html.dark .ln-item,html.dark .ln-empty{background:#0f172a;border-color:#1e293b;color:#e2e8f0}
html.dark .ln input{background:#0b1220;border-color:#1e293b;color:#e2e8f0}
html.dark .ln-def{background:#1b1a45}html.dark .ln-tip{background:#2a2110;color:#fde68a}
html.dark .ln-main,html.dark .ln-red{color:#fff}
@media (prefers-reduced-motion:reduce){.ln-dot{animation:none}}`;

const S = { view: 'home', title: '', course: '', quota: null, notes: null, list: null, busy: false, rec: null, msg: '' };

function loadDraft() { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && Array.isArray(d.parts) && d.parts.length ? d : null; } catch (e) { return null; } }
function saveDraft(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) { /* storage blocked */ } }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }

const root = () => document.getElementById(SECTION_ID);
function paint(html) {
  const el = root(); if (!el) return;
  el.innerHTML = '<style>' + CSS + '</style><div class="ln">' + html + '</div>';
  if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

// ---------- HOME ----------
async function showHome() {
  S.view = 'home';
  renderHome();
  try { S.quota = await api('/api/lecture-notes/quota'); } catch (e) { S.quota = null; }
  try { S.list = (await api('/api/lecture-notes')).items; } catch (e) { S.list = e.code === 'auth' ? 'auth' : null; }
  if (S.view === 'home') renderHome();
}

function renderHome() {
  const q = S.quota;
  const quotaHtml = q && !q.unlimited
    ? '<div class="ln-quota"><i style="width:' + Math.min(100, Math.round((q.usedSeconds / q.capSeconds) * 100)) + '%"></i></div><p class="ln-small">Today: ' + mins(q.usedSeconds).replace('1 min', q.usedSeconds ? '1 min' : '0 min') + ' of ' + mins(q.capSeconds) + ' recording time used. Resets every day.</p>'
    : (q && q.unlimited ? '<p class="ln-small">Unlimited recording time (admin).</p>' : '');
  const draft = loadDraft();
  let html = '<h2>Lecture to Notes</h2><p class="ln-lead">Record your lecture. Get clean notes, key points and practice questions.</p>';
  html += '<div class="ln-card"><input id="lnTitle" maxlength="100" placeholder="Lecture title (optional), e.g. Newton’s laws" value="' + esc(S.title) + '"><input id="lnCourse" maxlength="40" placeholder="Course code (optional), e.g. PHY 101" value="' + esc(S.course) + '">' +
    '<button type="button" class="ln-btn ln-main ln-wide" data-ln="start"><i data-lucide="mic"></i>Start recording</button>' +
    '<button type="button" class="ln-btn ln-wide" data-ln="pick" style="margin-top:8px"><i data-lucide="upload"></i>Upload a recording</button><input type="file" id="lnFile" hidden accept="audio/*,.mp3,.m4a,.wav,.ogg,.oga,.opus,.webm,.flac,.mp4">' +
    '<p class="ln-small" style="margin-top:8px">Already recorded it? Upload an mp3, m4a, wav or ogg file (up to 3 hours). Big files are prepared on your phone first, which can take a few minutes.</p>' + quotaHtml +
    '<p class="ln-small" style="margin-top:8px">Only record where your lecturer allows it. Keep the screen on and this page open while recording. Put the phone near the lecturer.</p></div>';
  if (draft) html += '<div class="ln-card"><b>Unfinished lecture found</b><p class="ln-small" style="margin:4px 0 10px">' + draft.parts.length + ' part(s) were transcribed on this phone but no notes were made yet.</p><div class="ln-row"><button type="button" class="ln-btn ln-main" data-ln="resume">Make notes</button><button type="button" class="ln-btn" data-ln="discard">Discard</button></div></div>';
  html += '<h3 style="font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:20px 0 8px">Your notes</h3>';
  if (S.list === 'auth') html += '<div class="ln-empty"><h3>Sign in to use this</h3><p>Your notes are saved to your account.</p></div>';
  else if (S.list === null) html += '<p class="ln-small">Loading…</p>';
  else if (!S.list.length) html += '<div class="ln-empty"><h3>No notes yet</h3><p>Your first recording will show up here.</p></div>';
  else html += S.list.map((n) => '<button type="button" class="ln-item" data-ln="open" data-id="' + esc(n.id) + '"><div><b>' + esc(n.title) + '</b><span>' + (n.course ? esc(n.course) + ' · ' : '') + (n.createdAtMs ? new Date(n.createdAtMs).toLocaleDateString() + ' · ' : '') + mins(n.durationSeconds || 60) + '</span></div><i data-lucide="chevron-right"></i></button>').join('');
  paint(html);
}

// ---------- RECORDING ----------
function pickMime() {
  const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (!window.MediaRecorder) return null;
  for (const m of c) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ } }
  return '';
}

async function startRecording() {
  S.title = (document.getElementById('lnTitle') || {}).value || '';
  S.course = (document.getElementById('lnCourse') || {}).value || '';
  const mime = pickMime();
  if (mime === null || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot record audio. Try Chrome or Safari.', 'error'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { toast('Microphone permission is needed to record. Allow it in your browser settings and try again.', 'error'); return; }

  const r = { stream, mime, parts: [], pending: 0, queue: Promise.resolve(), active: true, paused: false, segStart: 0, elapsedBefore: 0, timer: null, segTimer: null, recorder: null, quotaHit: false, failed: 0, ctx: null, raf: 0, wake: null, bg: false };
  S.rec = r; S.view = 'recording'; S.msg = '';
  try { if (navigator.wakeLock) r.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not available */ }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; r.ctx = new AC();
    const an = r.ctx.createAnalyser(); an.fftSize = 512; r.ctx.createMediaStreamSource(stream).connect(an); r.an = an;
  } catch (e) { /* meter is optional */ }
  startSegment(r);
  r.timer = setInterval(tick, 500);
  const vis = () => { if (document.hidden && S.rec && S.rec.active && !S.rec.paused) S.rec.bg = true; if (!document.hidden && S.rec && S.rec.bg) { S.msg = 'The app was in the background, so part of the recording may be missing. Keep the screen on while recording.'; } };
  r.vis = vis; document.addEventListener('visibilitychange', vis);
  renderRecording();
  meter();
}

function startSegment(r) {
  const rec = new MediaRecorder(r.stream, r.mime ? { mimeType: r.mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
  const chunks = []; r.recorder = rec; r.segStart = Date.now();
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onerror = () => { S.msg = 'The recorder had a problem. Your earlier parts are safe.'; };
  rec.onstop = () => {
    const seconds = Math.round((Date.now() - r.segStart) / 1000);
    r.elapsedBefore += seconds;
    const blob = new Blob(chunks, { type: rec.mimeType || r.mime || 'audio/webm' });
    if (blob.size > 1500 && seconds >= 2) enqueue(r, blob, seconds);
    if (r.active && !r.paused && !r.quotaHit) startSegment(r);
  };
  rec.start();
  clearTimeout(r.segTimer); r.segTimer = setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch (e) { /* ignore */ } }, SEGMENT_MS);
}

// Sends one piece of audio for transcription, retrying twice on network/server errors.
// Never retries a quota (429) or sign-in problem. Throws the last error.
async function transcribeBlob(blob, seconds, filename) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const f = new FormData(); f.append('seconds', String(seconds)); f.append('audio', blob, filename);
      return (await api('/api/lecture-notes/transcribe', { method: 'POST', body: f })).text || '';
    } catch (e) {
      lastErr = e;
      if (e.status === 429 || e.status === 401 || e.status === 400 || e.code === 'auth') break;
      await new Promise((ok) => setTimeout(ok, 1200 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function enqueue(r, blob, seconds) {
  const idx = r.parts.length; r.parts.push(null); r.pending++;
  r.queue = r.queue.then(async () => {
    let text = null, lastErr = null;
    try { text = await transcribeBlob(blob, seconds, blob.type.includes('mp4') ? 'seg.mp4' : 'seg.webm'); } catch (e) { lastErr = e; }
    if (text === null) {
      r.failed++;
      if (lastErr && lastErr.status === 429) { r.quotaHit = true; S.msg = 'You have used today’s recording time. Notes will be made from what was already captured.'; stopRecording(); }
      r.parts[idx] = '[Part ' + (idx + 1) + ' could not be transcribed]';
    } else r.parts[idx] = text;
    r.pending--;
    saveDraft({ title: S.title, course: S.course, parts: r.parts.filter((p) => p !== null), seconds: r.elapsedBefore });
  });
}

// ---------- UPLOADING A RECORDING ----------
const UP_MIME = { mp3: 'audio/mpeg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' };
const UP_DIRECT_MAX = 23 * 1024 * 1024; // the server accepts 24 MB per upload; bigger files are cut into pieces here
const UP_MAX_SECONDS = 3 * 3600;
const UP_DECODE_MAX_SECONDS = 90 * 60; // decoding keeps the whole recording in memory, so phones need a lower ceiling
const UP_CHUNK_SECONDS = 240;

function probeDuration(file) {
  return new Promise((ok) => {
    const a = document.createElement('audio'); a.preload = 'metadata'; const url = URL.createObjectURL(file);
    let t = null;
    const done = (d) => { clearTimeout(t); a.onloadedmetadata = a.ontimeupdate = a.onerror = null; try { a.removeAttribute('src'); a.load(); } catch (e) { /* ignore */ } URL.revokeObjectURL(url); ok(d); };
    t = setTimeout(() => done(NaN), 8000);
    a.onloadedmetadata = () => {
      if (isFinite(a.duration) && a.duration > 0) return done(a.duration);
      a.ontimeupdate = () => done(isFinite(a.duration) && a.duration > 0 ? a.duration : NaN); // some webm files only reveal their length after a seek
      try { a.currentTime = 1e101; } catch (e) { done(NaN); }
    };
    a.onerror = () => done(NaN);
    a.src = url;
  });
}

// 16 kHz mono 16-bit WAV of source frames [start, end). Averages source samples to avoid aliasing.
function encodeWav16k(chans, sr, start, end) {
  const step = sr / 16000; const outLen = Math.max(1, Math.floor((end - start) / step)); const n = chans.length;
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const a = start + Math.floor(i * step); const b = Math.min(end, Math.max(a + 1, start + Math.floor((i + 1) * step)));
    let sum = 0; for (let k = a; k < b; k++) for (let c = 0; c < n; c++) sum += chans[c][k];
    const v = Math.max(-1, Math.min(1, sum / ((b - a) * n)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const head = new ArrayBuffer(44); const dv = new DataView(head);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + pcm.byteLength, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, pcm.byteLength, true);
  return new Blob([head, pcm.buffer], { type: 'audio/wav' });
}

// Decodes the whole file, then yields it as 16 kHz mono WAV pieces of `seconds` each (one in memory at a time).
async function* wavPieces(file, seconds) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('This browser cannot prepare large audio files. Try a smaller file.');
  let audio = null;
  for (const rate of [16000, 22050, 44100]) { // lowest rate first: less memory; some browsers refuse very low rates
    try {
      const raw = await file.arrayBuffer(); const ctx = new Ctx(1, rate, rate);
      audio = await new Promise((ok, bad) => { const p = ctx.decodeAudioData(raw, ok, bad); if (p && p.then) p.then(ok, bad); });
      break;
    } catch (e) { audio = null; }
  }
  if (!audio) throw new Error('This file could not be read here. It may be too large for this phone, or in a format the browser cannot open. Try mp3, m4a or wav, or a shorter recording.');
  const sr = audio.sampleRate; const total = audio.length; const chans = [];
  for (let c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));
  const per = Math.round(seconds * sr);
  for (let start = 0; start < total; start += per) {
    const end = Math.min(total, start + per); if ((end - start) / sr < 1) continue;
    yield { blob: encodeWav16k(chans, sr, start, end), seconds: Math.max(1, Math.round((end - start) / sr)) };
  }
}

function paintUp(title, sub, pct) {
  paint('<div class="ln-card ln-rec"><div class="ln-time" style="font-size:22px">' + esc(title) + '</div><p class="ln-status">' + esc(sub || '') + '</p>' +
    '<div class="ln-meter"><i style="width:' + Math.max(3, Math.min(100, Math.round(pct || 0))) + '%"></i></div>' +
    '<p class="ln-small">Keep this page open.</p><button type="button" class="ln-btn" data-ln="upcancel" style="margin-top:12px">Cancel</button></div>');
}

async function uploadFile(file) {
  S.title = (document.getElementById('lnTitle') || {}).value || '';
  S.course = (document.getElementById('lnCourse') || {}).value || '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = Object.prototype.hasOwnProperty.call(UP_MIME, ext) ? UP_MIME[ext] : '';
  if (!mime) { toast('That file type is not supported. Use mp3, m4a, wav, ogg, webm or flac.', 'error'); return; }
  if (!S.title) S.title = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
  const up = S.up = { cancel: false };
  const back = (msg, type) => { S.up = null; if (msg) toast(msg, type || 'error'); return showHome(); };
  S.view = 'processing'; paintUp('Checking your recording…', file.name, 5);
  let parts = [], failed = 0, seconds = 0;
  try {
    let duration = await probeDuration(file);
    if (isFinite(duration) && duration > UP_MAX_SECONDS) return back('That recording is longer than 3 hours. Split it into shorter files.');
    const small = file.size <= UP_DIRECT_MAX && isFinite(duration);
    if (!small && isFinite(duration) && duration > UP_DECODE_MAX_SECONDS) return back('This file is large and ' + mins(duration) + ' long, which is too much to prepare on a phone. Use a smaller version (mp3 or m4a under 23 MB) or split it.');
    const q = await api('/api/lecture-notes/quota');
    const left = q.unlimited ? Infinity : Math.max(0, q.capSeconds - q.usedSeconds);
    if (isFinite(duration) && duration > left) return back('This recording is ' + mins(duration) + ' but you have ' + Math.floor(left / 60) + ' min of recording time left today. Free accounts get 10 minutes a day and the University Pass gives 4 hours. Try again tomorrow or use a shorter file.');
    const blobOf = () => new Blob([file], { type: mime });
    const ids = (p, n) => ('Transcribing part ' + p + ' of ' + n);

    if (small) {
      paintUp('Transcribing…', 'This can take a minute or two for a long recording.', 20);
      seconds = Math.max(1, Math.ceil(duration));
      try { parts.push(await transcribeBlob(blobOf(), seconds, 'upload.' + (UP_MIME[ext] === 'audio/mp4' ? 'm4a' : ext))); } catch (e) { if (up.cancel) return back(''); throw e; }
    } else {
      paintUp('Preparing the recording…', 'Large files are converted on your phone first. This can take a few minutes.', 8);
      let n = isFinite(duration) ? Math.ceil(duration / UP_CHUNK_SECONDS) : 0; let i = 0;
      for await (const piece of wavPieces(file, UP_CHUNK_SECONDS)) {
        if (up.cancel) return back('');
        if (!n) n = i + 1;
        i++; seconds += piece.seconds;
        if (!isFinite(duration) && seconds > UP_DECODE_MAX_SECONDS) return back('This recording is too long to prepare on a phone. Use a shorter file.');
        paintUp(ids(i, Math.max(n, i)), mins(seconds) + ' so far', 10 + 85 * (i / Math.max(n, i)));
        if (seconds > left) { failed++; parts.push('[Part ' + i + ' skipped: not enough recording time left today]'); break; }
        try { parts.push(await transcribeBlob(piece.blob, piece.seconds, 'part.wav')); }
        catch (e) { if (up.cancel) return back(''); failed++; parts.push('[Part ' + i + ' could not be transcribed]'); if (e.status === 429 || e.code === 'auth') break; }
        saveDraft({ title: S.title, course: S.course, parts: parts.slice(), seconds });
      }
    }
    if (up.cancel) return back('');
    saveDraft({ title: S.title, course: S.course, parts: parts.slice(), seconds });
    S.up = null;
    return await generate(parts, seconds, failed);
  } catch (e) {
    if (parts.length) saveDraft({ title: S.title, course: S.course, parts: parts.slice(), seconds });
    return back((e && e.message ? e.message : 'The upload failed.') + (parts.length ? ' What was already transcribed is saved on this phone.' : ''));
  }
}

function currentSeconds() {
  const r = S.rec; if (!r) return 0;
  return r.elapsedBefore + (r.active && !r.paused && r.segStart ? Math.round((Date.now() - r.segStart) / 1000) : 0);
}

function tick() { const t = document.getElementById('lnTime'); if (t) t.textContent = fmt(currentSeconds()); const s = document.getElementById('lnStatus'); const r = S.rec; if (s && r) s.textContent = r.paused ? 'Paused' : (r.pending ? 'Transcribing earlier parts… (' + r.pending + ')' : 'Recording…'); }

function meter() {
  const r = S.rec; if (!r || !r.an) return;
  const buf = new Uint8Array(r.an.fftSize);
  const loop = () => {
    if (!S.rec || S.rec !== r || !r.active) return;
    r.an.getByteTimeDomainData(buf);
    let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
    const bar = document.getElementById('lnMeter'); if (bar) bar.style.width = Math.min(100, Math.round((peak / 64) * 100)) + '%';
    r.raf = requestAnimationFrame(loop);
  };
  loop();
}

function renderRecording() {
  const r = S.rec; if (!r) return;
  paint('<div class="ln-card ln-rec' + (r.paused ? ' ln-paused' : '') + '"><div><span class="ln-dot"></span><b>' + (r.paused ? 'Paused' : 'Recording') + '</b></div><div class="ln-time" id="lnTime">' + fmt(currentSeconds()) + '</div>' +
    '<div class="ln-meter"><i id="lnMeter"></i></div><p class="ln-small">If the bar barely moves, move the phone closer to the lecturer.</p><p class="ln-status" id="lnStatus"></p>' +
    (S.msg ? '<div class="ln-warn">' + esc(S.msg) + '</div>' : '') +
    '<div class="ln-row" style="margin-top:14px"><button type="button" class="ln-btn" data-ln="pause"><i data-lucide="' + (r.paused ? 'play' : 'pause') + '"></i>' + (r.paused ? 'Resume' : 'Pause') + '</button><button type="button" class="ln-btn ln-red" data-ln="stop"><i data-lucide="square"></i>Finish</button></div></div>');
  tick();
}

function pauseToggle() {
  const r = S.rec; if (!r || !r.active) return;
  if (!r.paused) { r.paused = true; clearTimeout(r.segTimer); try { if (r.recorder.state === 'recording') r.recorder.stop(); } catch (e) { /* ignore */ } }
  else { r.paused = false; startSegment(r); }
  renderRecording();
}

function teardown(r) {
  r.active = false; clearInterval(r.timer); clearTimeout(r.segTimer); cancelAnimationFrame(r.raf);
  document.removeEventListener('visibilitychange', r.vis);
  try { r.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
  try { r.ctx && r.ctx.close(); } catch (e) { /* ignore */ }
  try { r.wake && r.wake.release(); } catch (e) { /* ignore */ }
}

async function stopRecording() {
  const r = S.rec; if (!r || !r.active || r.stopping) return;
  r.stopping = true;
  const wasPaused = r.paused; r.paused = true; clearTimeout(r.segTimer);
  const stopped = new Promise((ok) => { const rec = r.recorder; if (!rec || rec.state === 'inactive') return ok(); const prev = rec.onstop; rec.onstop = (e) => { prev && prev(e); ok(); }; try { rec.stop(); } catch (err) { ok(); } });
  await stopped; void wasPaused;
  S.view = 'processing';
  paint('<div class="ln-card ln-rec"><div class="ln-time" style="font-size:22px">Finishing the last part…</div><p class="ln-status" id="lnProc">Please keep this page open.</p></div>');
  await r.queue;
  const total = r.elapsedBefore;
  teardown(r);
  await generate(r.parts.filter((p) => p !== null), total, r.failed);
}

async function generate(parts, seconds, failed) {
  const transcript = parts.join('\n\n').trim();
  if (transcript.replace(/\[Part \d+ could not be transcribed\]/g, '').trim().length < 200) {
    S.view = 'home'; S.rec = null; clearDraft();
    toast('That was too short or too quiet to make notes from. Try again, closer to the lecturer.', 'error');
    return showHome();
  }
  S.view = 'processing';
  paint('<div class="ln-card ln-rec"><div class="ln-time" style="font-size:22px">Writing your notes…</div><p class="ln-status">This takes about 20–40 seconds.</p></div>');
  try {
    const out = await api('/api/lecture-notes/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, title: S.title, course: S.course, seconds }) });
    clearDraft(); S.rec = null;
    S.notes = out; S.view = 'notes';
    renderNotes(failed ? 'Some parts of the recording could not be transcribed, so those parts are missing from your notes.' : '');
  } catch (e) {
    S.view = 'home'; S.rec = null;
    saveDraft({ title: S.title, course: S.course, parts, seconds });
    toast(e.message + ' Your transcript is saved on this phone.', 'error');
    showHome();
  }
}

// ---------- NOTES ----------
function notesText(o) {
  const n = o.notes; const L = [n.title, o.course ? '(' + o.course + ')' : '', '', 'SUMMARY', n.summary, '', 'KEY POINTS'];
  n.keyPoints.forEach((k) => L.push('- ' + k));
  n.sections.forEach((s) => { L.push('', s.heading.toUpperCase()); s.bullets.forEach((b) => L.push('- ' + b)); });
  if (n.definitions.length) { L.push('', 'DEFINITIONS'); n.definitions.forEach((d) => L.push(d.term + ': ' + d.meaning)); }
  if (n.examTips.length) { L.push('', 'LIKELY EXAM POINTS'); n.examTips.forEach((t) => L.push('- ' + t)); }
  return L.join('\n');
}

function renderNotes(warn) {
  const o = S.notes; if (!o) return; const n = o.notes;
  let h = '<button type="button" class="ln-btn" data-ln="home" style="margin-bottom:12px"><i data-lucide="arrow-left"></i>All notes</button>';
  h += '<div class="ln-n"><h2>' + esc(n.title) + '</h2><p class="ln-small">' + (o.course ? esc(o.course) + ' · ' : '') + mins(o.durationSeconds || 60) + ' lecture</p>';
  if (warn) h += '<div class="ln-warn">' + esc(warn) + '</div>';
  if (n.lowConfidence) h += '<div class="ln-warn">The recording had little clear teaching content, so these notes may be thin. Check them against your own notes.</div>';
  h += '<p class="ln-small" style="margin-top:6px">AI-written from the recording. It can make mistakes, so check anything important against your handout or textbook.</p>';
  if (n.summary) h += '<h3>Summary</h3><p>' + esc(n.summary) + '</p>';
  if (n.keyPoints.length) h += '<h3>Key points</h3><ul>' + n.keyPoints.map((k) => '<li>' + esc(k) + '</li>').join('') + '</ul>';
  n.sections.forEach((s) => { h += '<h4>' + esc(s.heading) + '</h4><ul>' + s.bullets.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>'; });
  if (n.definitions.length) h += '<h3>Definitions</h3>' + n.definitions.map((d) => '<div class="ln-def"><b>' + esc(d.term) + '</b>: ' + esc(d.meaning) + '</div>').join('');
  if (n.examTips.length) h += '<h3>The lecturer stressed</h3>' + n.examTips.map((t) => '<div class="ln-tip">' + esc(t) + '</div>').join('');
  h += '</div><div class="ln-card" style="margin-top:18px">';
  if (n.questions.length >= 3) h += '<button type="button" class="ln-btn ln-main ln-wide" data-ln="quiz"><i data-lucide="play"></i>Practice ' + n.questions.length + ' questions from this lecture</button><div style="height:8px"></div>';
  h += '<div class="ln-row"><button type="button" class="ln-btn" data-ln="copy"><i data-lucide="copy"></i>Copy</button><button type="button" class="ln-btn" data-ln="share"><i data-lucide="share-2"></i>Share</button></div>' +
    '<button type="button" class="ln-btn ln-wide" data-ln="delete" style="margin-top:8px;color:#e11d48;border-color:#fecdd3"><i data-lucide="trash-2"></i>Delete these notes</button></div>';
  paint(h);
}

async function openNotes(id) {
  S.view = 'processing'; paint('<div class="ln-card ln-rec"><p class="ln-status">Opening…</p></div>');
  try { S.notes = await api('/api/lecture-notes/' + encodeURIComponent(id)); S.view = 'notes'; renderNotes(''); }
  catch (e) { toast(e.message, 'error'); showHome(); }
}

// ---------- EVENTS ----------
async function onClick(e) {
  const t = e.target.closest ? e.target.closest('[data-ln]') : null; if (!t) return;
  const act = t.getAttribute('data-ln');
  try {
    if (act === 'start') return await startRecording();
    if (act === 'pick') { const fi = document.getElementById('lnFile'); if (fi) fi.click(); return; }
    if (act === 'upcancel') { if (S.up) S.up.cancel = true; const b = t; b.disabled = true; b.textContent = 'Cancelling…'; return; }
    if (act === 'pause') return pauseToggle();
    if (act === 'stop') return await stopRecording();
    if (act === 'home') return await showHome();
    if (act === 'open') return await openNotes(t.getAttribute('data-id'));
    if (act === 'resume') { const d = loadDraft(); if (!d) return; S.title = d.title || ''; S.course = d.course || ''; return await generate(d.parts, d.seconds || 0, 0); }
    if (act === 'discard') { if (window.confirm('Discard the unfinished lecture? This cannot be undone.')) { clearDraft(); renderHome(); } return; }
    if (act === 'quiz') {
      const n = S.notes.notes;
      return launchCbtSession({ subject: n.title, questions: n.questions, durationSec: Math.max(300, n.questions.length * 60), examType: 'LECTURE_NOTES' });
    }
    if (act === 'copy') { await navigator.clipboard.writeText(notesText(S.notes)); return toast('Notes copied.', 'success'); }
    if (act === 'share') {
      const text = notesText(S.notes);
      if (navigator.share) { try { await navigator.share({ title: S.notes.notes.title, text }); } catch (err) { /* cancelled */ } return; }
      await navigator.clipboard.writeText(text); return toast('Sharing is not available here, so the notes were copied.', 'info');
    }
    if (act === 'delete') {
      if (!window.confirm('Delete these notes for good?')) return;
      await api('/api/lecture-notes/' + encodeURIComponent(S.notes.id), { method: 'DELETE' });
      toast('Deleted.', 'success'); return await showHome();
    }
  } catch (err) { toast(err.message || 'Something went wrong.', 'error'); }
}

function boot() {
  const el = root(); if (!el) return;
  el.addEventListener('click', onClick);
  el.addEventListener('change', (ev) => { const t = ev.target; if (t && t.id === 'lnFile' && t.files && t.files[0]) { const f = t.files[0]; t.value = ''; uploadFile(f); } });
  window.addEventListener('beforeunload', (ev) => { if ((S.rec && S.rec.active) || S.up) { ev.preventDefault(); ev.returnValue = ''; } });
  const open = () => { if (S.view === 'home') showHome(); };
  new MutationObserver(() => { if (!el.classList.contains('hidden') && !el.dataset.ready) { el.dataset.ready = '1'; open(); } else if (el.classList.contains('hidden')) { el.dataset.ready = ''; } })
    .observe(el, { attributes: true, attributeFilter: ['class'] });
  if (!el.classList.contains('hidden')) { el.dataset.ready = '1'; open(); }
}

window.__lectureNotesTest = { notesText, fmt, encodeWav16k };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
