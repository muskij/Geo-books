import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountShareQuestion, subjectCandidates, cleanSrc, pathFromLinkId } from './share-question.js';

// --- minimal Firestore fake: collection().where().limit().get(), doc().get()/set() ---
function makeDb(data) {
  const stats = [];
  const col = (name) => {
    const rows = data[name] || {};
    const build = (filters) => ({
      where: (field, op, value) => build([...filters, { field, op, value }]),
      limit: () => build(filters),
      orderBy: () => build(filters),
      get: async () => ({
        docs: Object.entries(rows)
          .filter(([, d]) => filters.every(({ field, op, value }) => (op === '==' ? d[field] === value : value.includes(d[field]))))
          .map(([id, d]) => ({ id, data: () => d })),
      }),
    });
    return {
      ...build([]),
      doc: (id) => ({
        get: async () => ({ exists: id in rows, data: () => rows[id] }),
        set: async (payload, opts) => {
          stats.push({ name, id, payload, opts });
          // mirror increments into readable rows so the admin endpoint can be tested
          const row = (data[name] = data[name] || {});
          const cur = (row[id] = row[id] || {});
          const merge = (dst, src) => { for (const [k, v] of Object.entries(src)) {
            if (v && typeof v === 'object' && 'inc' in v) dst[k] = (dst[k] || 0) + v.inc;
            else if (v && typeof v === 'object' && !(v instanceof Date)) { dst[k] = dst[k] || {}; merge(dst[k], v); }
            else dst[k] = v; } };
          merge(cur, payload);
        },
      }),
    };
  };
  return { collection: col, stats };
}
const FieldValue = { increment: (n) => ({ inc: n }) };

const physics = {
  examType: 'JAMB', jambSubject: 'Physics', jambYear: '1985',
  questions: [
    { q: 'A body of mass $2$ kg <script>alert(1)</script>', opts: ['1', '2', '3', '4', '5'], a: 2, exp: 'F = ma', image: 'http://insecure.example/x.png' },
    { q: 'No answer key here', opts: ['a', 'b'], exp: '' },
    { q: 'Read the passage and answer', opts: ['x', 'y'], a: 0, groups: ['g1'], image: 'https://cdn.example/diagram.png' },
  ],
  groups: [{ id: 'g1', kind: 'passage', title: 'Passage A', text: 'Once upon a time' }],
};
const english = {
  examType: 'JAMB', jambSubject: 'Use of English', jambYear: 2001,
  questions: [{ q: 'Pick the word', opts: ['a', 'b', 'c', 'd'], a: 1 }],
};
const assessment = { examType: 'UNIVERSITY', subject: 'PHY101', questions: [{ q: 'Secret?', opts: ['a', 'b'], a: 0 }] };

async function start() {
  const db = makeDb({
    exams: { PHYSICSDOC1: physics, ENGLISHDOC1: english, ASSESSDOC1: assessment },
    questions: {
      QACTIVE001: { examType: 'JAMB', subject: 'Biology', year: 1999, questionText: 'Q?', options: { A: '1', B: '2', C: '3', D: '4' }, correct: 'B', explanation: 'because', isActive: true },
      QHIDDEN001: { examType: 'JAMB', subject: 'Biology', questionText: 'Q?', options: { A: '1', B: '2', C: '3', D: '4' }, correct: 'B', isActive: false },
    },
  });
  const app = express();
  app.use(express.json());
  const rateLimit = () => (req, res, next) => next();
  const requireAuth = (req, res, next) => {
    const t = req.headers.authorization;
    if (!t) return res.status(401).json({ error: 'no token' });
    req.user = { uid: t.replace('Bearer ', '') };
    next();
  };
  const isAdminUser = async (u) => u.uid === 'admin';
  const { flush } = await mountShareQuestion({ app, db, FieldValue, rateLimit, requireAuth, isAdminUser });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, flush, close: () => server.close() };
}

test('helpers', () => {
  assert.deepEqual(subjectCandidates('physics'), ['Physics']);
  assert.deepEqual(subjectCandidates('computer-studies'), ['Computer Studies']);
  assert.ok(subjectCandidates('english').includes('Use of English'));
  assert.equal(cleanSrc('TikTok'), 'tiktok');
  assert.equal(cleanSrc('bad src!'), 'direct');
  assert.equal(cleanSrc(undefined), 'direct');
});

test('JAMB route renders a safe, shareable question page', async () => {
  const s = await start();
  try {
    const res = await fetch(`${s.base}/q/jamb/physics/1985/1?src=whatsapp`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /JAMB Physics 1985 · Question 1/);
    assert.match(html, /property="og:title"/);
    assert.match(html, /data-correct="2"/);
    assert.match(html, /data-src="whatsapp"/);
    assert.equal((html.match(/class="opt"/g) || []).length, 5);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'question text must be escaped');
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.ok(!html.includes('insecure.example'), 'non-https images are dropped');
    assert.match(html, /katex/); // math present -> KaTeX loaded
    assert.match(html, /F = ma/);
  } finally { s.close(); }
});

test('aliases and string/number years resolve; groups and https image included', async () => {
  const s = await start();
  try {
    const eng = await fetch(`${s.base}/q/jamb/english/2001/1`);
    assert.equal(eng.status, 200);
    assert.match(await eng.text(), /JAMB Use of English 2001 · Question 1/);

    const withGroup = await (await fetch(`${s.base}/q/jamb/physics/1985/3`)).text();
    assert.match(withGroup, /Passage A/);
    assert.match(withGroup, /Once upon a time/);
    assert.match(withGroup, /og:image" content="https:\/\/cdn\.example\/diagram\.png"/);
    assert.ok(!withGroup.includes('katex'), 'no math -> KaTeX not loaded');
  } finally { s.close(); }
});

test('question without an answer key is not interactive', async () => {
  const s = await start();
  try {
    const html = await (await fetch(`${s.base}/q/jamb/physics/1985/2`)).text();
    assert.match(html, /data-correct="-1"/);
    assert.match(html, /class="opt" data-i="0" disabled/);
    assert.match(html, /answer key for this question/);
  } finally { s.close(); }
});

test('by exam id works for JAMB only; assessments are never exposed', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/q/PHYSICSDOC1/1`)).status, 200);
    assert.equal((await fetch(`${s.base}/q/ASSESSDOC1/1`)).status, 404);
  } finally { s.close(); }
});

test('questions collection: active ok, inactive hidden', async () => {
  const s = await start();
  try {
    const ok = await fetch(`${s.base}/q/QACTIVE001`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /data-correct="1"/);
    assert.equal((await fetch(`${s.base}/q/QHIDDEN001`)).status, 404);
  } finally { s.close(); }
});

test('bad input returns 404, never throws', async () => {
  const s = await start();
  try {
    for (const p of ['/q/jamb/physics/1985/99', '/q/jamb/physics/1985/0', '/q/jamb/physics/abcd/1', '/q/jamb/phys!cs/1985/1', '/q/short', '/q/NOPE00000/1', '/q/jamb/biology/1985/1']) {
      assert.equal((await fetch(`${s.base}${p}`)).status, 404, p);
    }
  } finally { s.close(); }
});

const post = (base, body) => fetch(`${base}/api/share/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('rendering a page does NOT count a view (preview crawlers must not inflate it)', async () => {
  const s = await start();
  try {
    await fetch(`${s.base}/q/jamb/physics/1985/1?src=channel`, { headers: { 'User-Agent': 'WhatsApp/2.23' } });
    await s.flush();
    assert.equal(s.db.stats.length, 0);
  } finally { s.close(); }
});

test('page carries its link id and beacons a view', async () => {
  const s = await start();
  try {
    const html = await (await fetch(`${s.base}/q/jamb/physics/1985/12?src=channel`)).text().catch(() => '');
    // question 12 doesn't exist in the fixture -> use question 1 for the markup check
    const ok = await (await fetch(`${s.base}/q/jamb/physics/1985/1?src=channel`)).text();
    assert.match(ok, /data-link="jamb_physics_1985_1"/);
    assert.match(ok, /ping\('view'\)/);
    assert.match(ok, /gb_seen_/);
    assert.equal(html.includes('data-link'), false);
  } finally { s.close(); }
});

test('metrics are buffered, sanitised, and flushed per day and per link', async () => {
  const s = await start();
  try {
    const link = 'jamb_physics_1985_1';
    assert.equal((await post(s.base, { type: 'view', src: 'tiktok', link })).status, 204);
    assert.equal((await post(s.base, { type: 'view', src: 'tiktok', link })).status, 204);
    assert.equal((await post(s.base, { type: 'view', src: '<b>x</b>', link })).status, 204);
    assert.equal((await post(s.base, { type: 'unique', src: 'tiktok', link })).status, 204);
    assert.equal((await post(s.base, { type: 'answer', src: 'tiktok', link })).status, 204);
    assert.equal((await post(s.base, { type: 'click', src: 'tiktok', link })).status, 204);
    assert.equal((await post(s.base, { type: 'hack', src: 'tiktok', link })).status, 400);
    assert.equal(s.db.stats.length, 0, 'nothing written until flush');
    await s.flush();
    const day = s.db.stats.find((x) => x.name === 'shareStats');
    assert.deepEqual(day.opts, { merge: true });
    assert.deepEqual(day.payload.views, { tiktok: { inc: 2 }, direct: { inc: 1 } });
    assert.deepEqual(day.payload.uniques, { tiktok: { inc: 1 } });
    assert.deepEqual(day.payload.answers, { tiktok: { inc: 1 } });
    assert.deepEqual(day.payload.clicks, { tiktok: { inc: 1 } });
    const l = s.db.stats.find((x) => x.name === 'shareLinks');
    assert.equal(l.id, link);
    assert.equal(l.payload.path, '/q/jamb/physics/1985/1');
    assert.deepEqual(l.payload.views, { inc: 3 });
    assert.deepEqual(l.payload.uniques, { inc: 1 });
    assert.deepEqual(l.payload.bySrc, { tiktok: { inc: 2 }, direct: { inc: 1 } });
  } finally { s.close(); }
});

test('bad or hostile link ids never create per-link docs', async () => {
  const s = await start();
  try {
    for (const link of ['../x', 'jamb_x', '<script>', 'a'.repeat(300), '', undefined]) {
      assert.equal((await post(s.base, { type: 'view', src: 'x', link })).status, 204);
    }
    await s.flush();
    assert.equal(s.db.stats.filter((x) => x.name === 'shareLinks').length, 0);
  } finally { s.close(); }
});

test('link id <-> path round trip', () => {
  assert.equal(pathFromLinkId('jamb_physics_1985_12'), '/q/jamb/physics/1985/12');
  assert.equal(pathFromLinkId('exam_PHYS_DOC-1_x_7'.replace('PHYS_DOC-1_x', 'PHYSICSDOC_1')), '/q/PHYSICSDOC_1/7');
  assert.equal(pathFromLinkId('question_QACTIVE001'), '/q/QACTIVE001');
  assert.equal(pathFromLinkId('nonsense'), '');
});

test('admin endpoint: requires auth + admin, returns per-link stats', async () => {
  const s = await start();
  try {
    await fetch(`${s.base}/q/jamb/physics/1985/1?src=channel`); // registers the title
    await post(s.base, { type: 'view', src: 'channel', link: 'jamb_physics_1985_1' });
    await post(s.base, { type: 'view', src: 'channel', link: 'jamb_physics_1985_1' });
    await post(s.base, { type: 'unique', src: 'channel', link: 'jamb_physics_1985_1' });

    assert.equal((await fetch(`${s.base}/api/share/links`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/share/links`, { headers: { Authorization: 'Bearer student' } })).status, 403);

    const res = await fetch(`${s.base}/api/share/links`, { headers: { Authorization: 'Bearer admin' } });
    assert.equal(res.status, 200);
    const { links } = await res.json();
    assert.equal(links.length, 1);
    assert.equal(links[0].path, '/q/jamb/physics/1985/1');
    assert.equal(links[0].views, 2);
    assert.equal(links[0].uniques, 1);
    assert.deepEqual(links[0].bySrc, { channel: 2 });
    assert.match(links[0].title, /JAMB Physics 1985/);
  } finally { s.close(); }
});
