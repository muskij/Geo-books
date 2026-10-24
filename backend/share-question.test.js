import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountShareQuestion, subjectCandidates, cleanSrc } from './share-question.js';

// --- minimal Firestore fake: collection().where().limit().get(), doc().get()/set() ---
function makeDb(data) {
  const stats = [];
  const col = (name) => {
    const rows = data[name] || {};
    const build = (filters) => ({
      where: (field, op, value) => build([...filters, { field, op, value }]),
      limit: () => build(filters),
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
        set: async (payload, opts) => { stats.push({ name, id, payload, opts }); },
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
  const { flush } = await mountShareQuestion({ app, db, FieldValue, rateLimit });
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

test('metrics are buffered, sanitised, and flushed as one write', async () => {
  const s = await start();
  try {
    await fetch(`${s.base}/q/jamb/physics/1985/1?src=tiktok`);
    await fetch(`${s.base}/q/jamb/physics/1985/1?src=tiktok`);
    await fetch(`${s.base}/q/jamb/physics/1985/1?src=${encodeURIComponent('<b>x</b>')}`);
    const ev = (type, src) => fetch(`${s.base}/api/share/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, src }) });
    assert.equal((await ev('answer', 'tiktok')).status, 204);
    assert.equal((await ev('click', 'tiktok')).status, 204);
    assert.equal((await ev('hack', 'tiktok')).status, 400);
    assert.equal(s.db.stats.length, 0, 'nothing written until flush');
    await s.flush();
    assert.equal(s.db.stats.length, 1);
    const { name, payload, opts } = s.db.stats[0];
    assert.equal(name, 'shareStats');
    assert.deepEqual(opts, { merge: true });
    assert.deepEqual(payload.views, { tiktok: { inc: 2 }, direct: { inc: 1 } });
    assert.deepEqual(payload.answers, { tiktok: { inc: 1 } });
    assert.deepEqual(payload.clicks, { tiktok: { inc: 1 } });
  } finally { s.close(); }
});
