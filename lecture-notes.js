// Lecture -> Notes (server side). Mounted from server.js via mountLectureNotes().
//
// Flow: the phone records the lecture in ~4 minute segments; each segment is sent to
// /api/lecture-notes/transcribe (OpenAI speech-to-text); when recording stops the joined
// transcript is sent to /api/lecture-notes/generate, which writes structured notes + practice
// questions and saves them to Firestore (`lectureNotes`, written only through this server).
//
// Cost control: a per-user DAILY budget of audio seconds AND bytes, enforced here (not in the
// browser). Defaults are env-configurable. Admins are exempt.
import multer from 'multer';

const FREE_SECONDS = Number(process.env.LECTURE_NOTES_FREE_SECONDS) || 10 * 60;
const PASS_SECONDS = Number(process.env.LECTURE_NOTES_PASS_SECONDS) || 240 * 60;
const MAX_SEGMENT_BYTES = 24 * 1024 * 1024; // a live 4-minute segment is ~1 MB; an uploaded file may be up to Whisper's 25 MB limit
const MAX_SEGMENT_SECONDS = 3 * 3600;
const BYTES_PER_SECOND_BUDGET = 36000; // ~288 kbps allowance: fits 16 kHz mono WAV (32 KB/s) made in the browser; live audio is ~3 KB/s
const MAX_TRANSCRIPT_CHARS = 200000; // ~3 hours of speech
const TRANSCRIBE_MODEL = process.env.LECTURE_TRANSCRIBE_MODEL || 'whisper-1';
const NOTES_MODEL = process.env.LECTURE_NOTES_MODEL || 'gpt-4o-mini';

export const PASS_TIERS = ['UNIVERSITY_PASS_30', 'UNIVERSITY_PASS_70', 'STANDARD', 'STANDARD_ANNUAL', 'PREMIUM', 'PREMIUM_ANNUAL'];

const clean = (v, max = 400) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);

const NOTES_PROMPT = `You turn a raw lecture transcript into study notes for a Nigerian university student.
Rules:
- Use ONLY what the transcript says. Never add facts, formulas, names or numbers that were not said. If something is unclear or garbled, leave it out or mark it "(unclear in recording)".
- The transcript may contain speech-recognition mistakes; correct obvious ones only when the meaning is certain.
- If the transcript is too short or has no real teaching content, set "lowConfidence": true and keep every other field short or empty.
- Write simple, exam-friendly English.
Return ONLY valid JSON with exactly this shape:
{
 "title": string,
 "summary": string (3-5 sentences),
 "keyPoints": string[] (5-10 items),
 "sections": [{"heading": string, "bullets": string[]}],
 "definitions": [{"term": string, "meaning": string}],
 "examTips": string[] (things the lecturer stressed, repeated, or said would be examined; empty if none),
 "questions": [{"q": string, "opts": [string,string,string,string], "correct": 0-3, "exp": string}] (6-10 multiple choice questions answerable from the transcript),
 "lowConfidence": boolean
}`;


// Whisper decides the format from the file name, so the name must match the real type.
const AUDIO_EXT = { mp3: 'mp3', mpeg: 'mp3', mpga: 'mp3', m4a: 'm4a', mp4: 'mp4', wav: 'wav', ogg: 'ogg', oga: 'ogg', opus: 'ogg', webm: 'webm', flac: 'flac' };
const MIME_EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'video/mp4': 'mp4', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav', 'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/flac': 'flac', 'audio/x-flac': 'flac' };
function audioExt(mimetype, originalname) {
  const m = String(mimetype || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXT[m]) return MIME_EXT[m];
  const e = String(originalname || '').split('.').pop().toLowerCase();
  return Object.prototype.hasOwnProperty.call(AUDIO_EXT, e) ? AUDIO_EXT[e] : null;
}

function normaliseNotes(raw, fallbackTitle) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const questions = arr(o.questions, 12)
    .filter((q) => q && typeof q.q === 'string' && Array.isArray(q.opts) && q.opts.length === 4)
    .map((q) => ({
      q: clean(q.q, 500),
      opts: q.opts.map((x) => clean(x, 300)),
      correct: Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3 ? q.correct : 0,
      exp: clean(q.exp, 500),
    }));
  return {
    title: clean(o.title, 120) || clean(fallbackTitle, 120) || 'Lecture notes',
    summary: clean(o.summary, 1500),
    keyPoints: arr(o.keyPoints, 12).map((x) => clean(x, 400)).filter(Boolean),
    sections: arr(o.sections, 12)
      .map((s) => ({ heading: clean(s?.heading, 160), bullets: arr(s?.bullets, 15).map((b) => clean(b, 500)).filter(Boolean) }))
      .filter((s) => s.heading || s.bullets.length),
    definitions: arr(o.definitions, 20)
      .map((d) => ({ term: clean(d?.term, 120), meaning: clean(d?.meaning, 500) }))
      .filter((d) => d.term && d.meaning),
    examTips: arr(o.examTips, 10).map((x) => clean(x, 400)).filter(Boolean),
    questions,
    lowConfidence: o.lowConfidence === true,
  };
}

export function mountLectureNotes({ app, db, FieldValue, requireAuth, isAdminUser }) {
  const audio = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SEGMENT_BYTES, files: 1 },
    fileFilter: (req, file, cb) => (/^audio\/|^application\/ogg|^video\/(webm|mp4)/.test(file.mimetype) && audioExt(file.mimetype, file.originalname) ? cb(null, true) : cb(new Error('UNSUPPORTED_AUDIO'))),
  });

  const today = () => new Date().toISOString().slice(0, 10);

  async function budgetFor(user) {
    if (await isAdminUser(user)) return { seconds: Infinity, admin: true };
    const snap = await db.collection('users').doc(user.uid).get();
    const sub = snap.exists ? snap.data()?.subscription : null;
    const tier = sub && sub.verified && sub.status === 'active' ? String(sub.tier || '').toUpperCase() : 'FREE';
    return { seconds: PASS_TIERS.includes(tier) ? PASS_SECONDS : FREE_SECONDS, tier };
  }

  // Reserve budget BEFORE calling the paid API; refund if the call fails.
  async function reserve(user, seconds, bytes) {
    const uid = user.uid;
    const b = await budgetFor(user);
    if (b.admin) return { ok: true, admin: true };
    const ref = db.collection('lectureNotesUsage').doc(`${uid}_${today()}`);
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const used = s.exists ? Number(s.data().seconds) || 0 : 0;
      const usedBytes = s.exists ? Number(s.data().bytes) || 0 : 0;
      if (used + seconds > b.seconds || usedBytes + bytes > b.seconds * BYTES_PER_SECOND_BUDGET) {
        return { ok: false, cap: b.seconds, used };
      }
      tx.set(ref, { uid, day: today(), seconds: used + seconds, bytes: usedBytes + bytes, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true, cap: b.seconds, used: used + seconds };
    });
  }
  async function refund(uid, seconds, bytes) {
    try {
      const ref = db.collection('lectureNotesUsage').doc(`${uid}_${today()}`);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) return;
        tx.update(ref, { seconds: Math.max((Number(s.data().seconds) || 0) - seconds, 0), bytes: Math.max((Number(s.data().bytes) || 0) - bytes, 0) });
      });
    } catch (e) { /* best effort */ }
  }

  app.get('/api/lecture-notes/quota', requireAuth, async (req, res) => {
    try {
      const b = await budgetFor(req.user);
      const s = await db.collection('lectureNotesUsage').doc(`${req.user.uid}_${today()}`).get();
      const used = s.exists ? Number(s.data().seconds) || 0 : 0;
      res.json({ capSeconds: b.admin ? null : b.seconds, usedSeconds: used, unlimited: !!b.admin });
    } catch (e) {
      res.status(500).json({ error: 'Could not read your allowance.' });
    }
  });

  app.post('/api/lecture-notes/transcribe', requireAuth, (req, res, next) => {
    audio.single('audio')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That audio file is too large (the limit is 24 MB per upload).' : err.message === 'UNSUPPORTED_AUDIO' ? 'Unsupported audio type. Use mp3, m4a, wav, ogg, webm or flac.' : 'Upload failed.';
        return res.status(400).json({ error: msg });
      }
      next();
    });
  }, async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'AI service not configured on server' });
    if (!req.file || !req.file.size) return res.status(400).json({ error: 'No audio received.' });

    const seconds = Math.min(Math.max(Math.round(Number(req.body?.seconds) || 0), 1), MAX_SEGMENT_SECONDS);
    const bytes = req.file.size;
    let r;
    try { r = await reserve(req.user, seconds, bytes); } catch (e) { return res.status(500).json({ error: 'Could not check your allowance.' }); }
    if (!r.ok) return res.status(429).json({ error: 'You have used today’s lecture-recording time.', capSeconds: r.cap, usedSeconds: r.used, quota: true });

    try {
      const form = new FormData();
      form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), 'segment.' + audioExt(req.file.mimetype, req.file.originalname));
      form.append('model', TRANSCRIBE_MODEL);
      form.append('response_format', 'json');
      form.append('prompt', 'A university lecture in Nigeria, spoken in English. It may include technical terms, course codes and names.');
      const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      if (!resp.ok) {
        console.error('lecture-notes transcribe error:', resp.status, (await resp.text()).slice(0, 300));
        await refund(req.user.uid, seconds, bytes);
        return res.status(502).json({ error: 'Transcription failed for this segment.' });
      }
      const out = await resp.json();
      res.json({ text: clean(out.text, 30000) });
    } catch (e) {
      console.error('lecture-notes transcribe exception:', e.message);
      await refund(req.user.uid, seconds, bytes);
      res.status(500).json({ error: 'Transcription failed for this segment.' });
    }
  });

  app.post('/api/lecture-notes/generate', requireAuth, async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'AI service not configured on server' });
    const transcript = clean(req.body?.transcript, MAX_TRANSCRIPT_CHARS);
    const title = clean(req.body?.title, 120);
    const course = clean(req.body?.course, 60);
    const seconds = Math.min(Math.max(Math.round(Number(req.body?.seconds) || 0), 0), 6 * 3600);
    if (transcript.length < 200) return res.status(400).json({ error: 'The recording was too short to make notes from. Record at least a minute or two of the lecture.' });

    // Light per-user rate limit so notes can't be regenerated in a loop.
    const hitKey = `${req.user.uid}_${Math.floor(Date.now() / 600000)}`;
    generateHits.set(hitKey, (generateHits.get(hitKey) || 0) + 1);
    if (generateHits.get(hitKey) > 12) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    if (generateHits.size > 5000) generateHits.clear();

    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: NOTES_MODEL,
          temperature: 0.2,
          max_tokens: 3500,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: NOTES_PROMPT },
            { role: 'user', content: `${course ? `Course: ${course}\n` : ''}${title ? `Title given by student: ${title}\n` : ''}\nTRANSCRIPT:\n${transcript}` },
          ],
        }),
      });
      if (!resp.ok) {
        console.error('lecture-notes generate error:', resp.status, (await resp.text()).slice(0, 300));
        return res.status(502).json({ error: 'The AI could not write your notes. Your transcript is saved on your phone; try again.' });
      }
      const data = await resp.json();
      let parsed;
      try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch (e) { parsed = null; }
      if (!parsed) return res.status(502).json({ error: 'The AI returned an unreadable answer. Please try again.' });
      const notes = normaliseNotes(parsed, title);
      const doc = await db.collection('lectureNotes').add({
        uid: req.user.uid,
        title: notes.title,
        course,
        durationSeconds: seconds,
        notes,
        transcript,
        createdAt: FieldValue.serverTimestamp(),
      });
      res.json({ id: doc.id, notes, course, durationSeconds: seconds });
    } catch (e) {
      console.error('lecture-notes generate exception:', e.message);
      res.status(500).json({ error: 'Could not write your notes. Please try again.' });
    }
  });
  const generateHits = new Map();

  const ownedDoc = async (req, res) => {
    const snap = await db.collection('lectureNotes').doc(String(req.params.id)).get();
    if (!snap.exists || snap.data().uid !== req.user.uid) { res.status(404).json({ error: 'Notes not found.' }); return null; }
    return snap;
  };

  app.get('/api/lecture-notes', requireAuth, async (req, res) => {
    try {
      const snap = await db.collection('lectureNotes').where('uid', '==', req.user.uid).limit(100).get();
      const items = snap.docs.map((d) => {
        const x = d.data();
        const t = x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : 0;
        return { id: d.id, title: x.title, course: x.course || '', durationSeconds: x.durationSeconds || 0, summary: clean(x.notes?.summary, 160), createdAtMs: t };
      }).sort((a, b) => b.createdAtMs - a.createdAtMs);
      res.json({ items });
    } catch (e) {
      console.error('lecture-notes list error:', e.message);
      res.status(500).json({ error: 'Could not load your notes.' });
    }
  });

  app.get('/api/lecture-notes/:id', requireAuth, async (req, res) => {
    try {
      const snap = await ownedDoc(req, res); if (!snap) return;
      const x = snap.data();
      res.json({ id: snap.id, notes: x.notes, course: x.course || '', durationSeconds: x.durationSeconds || 0 });
    } catch (e) { res.status(500).json({ error: 'Could not load these notes.' }); }
  });

  app.delete('/api/lecture-notes/:id', requireAuth, async (req, res) => {
    try {
      const snap = await ownedDoc(req, res); if (!snap) return;
      await snap.ref.delete();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Could not delete these notes.' }); }
  });

  console.log('[lecture-notes] enabled');
}

export const __test = { normaliseNotes, audioExt };
