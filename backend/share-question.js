// One-tap shareable question pages.
//
//   /q/jamb/physics/1985/12   JAMB Physics 1985, question 12   (human-friendly, no IDs)
//   /q/<examDocId>/12         question 12 of any JAMB paper in the `exams` collection
//   /q/<questionDocId>        one doc from the `questions` collection
//
// Why this exists: Firestore rules make `questions` readable only when signed in, and
// the CBT lives behind a login, so a link posted to a WhatsApp channel could not open a
// question for a first-time visitor. These routes read with the Admin SDK on the server
// and return a small server-rendered page: it opens without signing in, carries Open
// Graph tags (so WhatsApp shows a preview card), lets the student tap an answer and see
// the explanation, then points them at the full app.
//
// Only JAMB papers and active `questions` docs are exposed — never university
// assessments or other exam types that live in the same `exams` collection.
//
// Usage metrics (views / answers / clicks / shares per `?src=` tag) are buffered in
// memory and flushed to Firestore `shareStats/{day}` every FLUSH_MS, because one
// Firestore document sustains only ~1 write/second and a viral post can exceed that.

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SLUG_RE = /^[a-z0-9-]{2,40}$/i;
const YEAR_RE = /^(19|20)\d{2}$/;
const SRC_RE = /^[a-z0-9_-]{1,24}$/;
const EVENT_TYPES = ['answer', 'click', 'share'];

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const FLUSH_MS = 30 * 1000;

const ENGLISH = ['English', 'English Language', 'Use of English'];
const MATHS = ['Mathematics', 'Maths', 'Math'];
const LITERATURE = ['Literature', 'Literature in English', 'Literature-in-English'];
const SUBJECT_ALIASES = {
  english: ENGLISH,
  'use-of-english': ENGLISH,
  mathematics: MATHS,
  maths: MATHS,
  math: MATHS,
  crs: ['CRS', 'C.R.S', 'Christian Religious Studies'],
  government: ['Government', 'Govt'],
  literature: LITERATURE,
  'literature-in-english': LITERATURE,
};

export function subjectCandidates(slug) {
  const s = String(slug || '').toLowerCase();
  if (SUBJECT_ALIASES[s]) return SUBJECT_ALIASES[s];
  return [s.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')];
}

const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]
));
const text = (v) => (v === undefined || v === null ? '' : String(v));

// Reuse the app's own renderer (tables, [u]underline[/u], escaping) so a question looks
// the same here as in the CBT. utils.js is a browser module, so load it defensively: if
// that ever stops working on the server, fall back to plain escaped text.
async function loadRenderer() {
  try {
    const m = await import('../utils.js');
    if (typeof m.renderRichContent === 'function') return m.renderRichContent;
  } catch (e) {
    console.warn('[share-question] utils.js renderer unavailable, using plain text:', e.message);
  }
  return (raw) => text(raw).split('\n').map(esc).join('<br>');
}

function httpsUrl(raw) {
  try {
    const u = new URL(text(raw).trim());
    return u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

export function cleanSrc(raw) {
  const s = text(raw).trim().toLowerCase();
  return SRC_RE.test(s) ? s : 'direct';
}

// --- loading ----------------------------------------------------------------

function viewFromExam(exam, n) {
  const list = Array.isArray(exam.questions) ? exam.questions : [];
  const q = list[n - 1];
  if (!q) return null;
  const opts = (Array.isArray(q.opts) ? q.opts : []).map(text).slice(0, 6);
  if (!text(q.q).trim() || opts.length < 2 || opts.some((o) => !o.trim())) return null;
  const byId = new Map();
  (Array.isArray(exam.groups) ? exam.groups : []).forEach((g) => {
    if (g && g.id !== undefined && text(g.text).trim()) byId.set(String(g.id), g);
  });
  const groups = (Array.isArray(q.groups) ? q.groups : [])
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((g) => ({ kind: text(g.kind), title: text(g.title).trim(), text: text(g.text) }));
  const subject = text(exam.jambSubject || exam.subject).trim();
  const year = text(exam.jambYear).trim();
  return {
    title: `JAMB ${subject}${year ? ` ${year}` : ''} · Question ${n}`,
    subject,
    text: text(q.q),
    opts,
    correct: Number.isInteger(q.a) && q.a >= 0 && q.a < opts.length ? q.a : -1,
    exp: text(q.exp).trim(),
    image: httpsUrl(q.image),
    groups,
  };
}

function viewFromQuestionDoc(d) {
  if (d.isActive === false) return null;
  const opts = ['A', 'B', 'C', 'D'].map((k) => text(d.options?.[k]));
  if (!text(d.questionText).trim() || opts.some((o) => !o.trim())) return null;
  const subject = text(d.subject).trim();
  const label = [text(d.examType).trim(), subject, d.year ? text(d.year) : ''].filter(Boolean).join(' ');
  return {
    title: label || 'Practice question',
    subject,
    text: text(d.questionText),
    opts,
    correct: ['A', 'B', 'C', 'D'].indexOf(text(d.correct).trim().toUpperCase()),
    exp: text(d.explanation).trim(),
    image: httpsUrl(d.questionImage),
    groups: [],
  };
}

async function loadByJamb(db, slug, year, n) {
  const snap = await db.collection('exams')
    .where('examType', '==', 'JAMB')
    .where('jambSubject', 'in', subjectCandidates(slug))
    .where('jambYear', 'in', [Number(year), String(year)])
    .limit(5)
    .get();
  for (const doc of snap.docs) {
    const view = viewFromExam(doc.data(), n);
    if (view) return view;
  }
  return null;
}

async function loadByExamId(db, id, n) {
  const doc = await db.collection('exams').doc(id).get();
  if (!doc.exists) return null;
  const exam = doc.data();
  if (text(exam.examType).toUpperCase() !== 'JAMB') return null; // never expose assessments
  return viewFromExam(exam, n);
}

async function loadByQuestionId(db, id) {
  const doc = await db.collection('questions').doc(id).get();
  return doc.exists ? viewFromQuestionDoc(doc.data()) : null;
}

// --- page -------------------------------------------------------------------

function snippet(raw, max = 150) {
  const s = text(raw).replace(/\$\$?/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function renderPage(view, { render, base, path, src }) {
  const hasMath = /\$/.test([view.text, view.exp, ...view.opts, ...view.groups.map((g) => g.text)].join(' '));
  const canonical = base ? `${base}${path}` : path;
  const interactive = view.correct >= 0;
  const letters = 'ABCDEF';

  const groups = view.groups.map((g) => `
      <details class="grp" open>
        <summary>${esc(g.title || (g.kind === 'directions' ? 'Directions' : 'Read this first'))}</summary>
        <div class="grp-body">${render(g.text)}</div>
      </details>`).join('');

  const options = view.opts.map((o, i) => `
      <button type="button" class="opt" data-i="${i}"${interactive ? '' : ' disabled'}>
        <span class="ltr">${letters[i]}</span><span class="otxt">${render(o)}</span>
      </button>`).join('');

  const desc = `${snippet(view.text)} Tap to answer — free on Geo-Books.`;
  const image = view.image ? `<img class="qimg" src="${esc(view.image)}" alt="Question diagram" loading="lazy">` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(view.title)} | Geo-Books</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Geo-Books">
<meta property="og:title" content="${esc(view.title)} — can you solve it?">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
${view.image ? `<meta property="og:image" content="${esc(view.image)}">` : ''}
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${esc(canonical)}">
${hasMath ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">' : ''}
<style>
:root{--bg:#f6f7fb;--card:#fff;--ink:#0f172a;--mute:#64748b;--line:#e2e8f0;--brand:#4f46e5;--ok:#059669;--okbg:#ecfdf5;--bad:#e11d48;--badbg:#fff1f2}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#131a2e;--ink:#e8ecf8;--mute:#93a0c0;--line:#243052;--brand:#818cf8;--okbg:#06281f;--badbg:#33121c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px 16px 40px}
.tag{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);margin:8px 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px}
.q{font-size:18px;font-weight:600;margin:0 0 14px;overflow-wrap:anywhere}
.qimg{max-width:100%;border-radius:12px;margin:0 0 14px;background:#fff}
.grp{border:1px solid var(--line);border-radius:14px;margin:0 0 14px;background:var(--bg)}
.grp summary{cursor:pointer;padding:10px 14px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.grp-body{padding:0 14px 12px;max-height:45vh;overflow:auto;overflow-wrap:anywhere}
.opt{display:flex;gap:12px;align-items:center;width:100%;text-align:left;margin:0 0 10px;padding:12px 14px;border:2px solid var(--line);border-radius:14px;background:var(--card);color:var(--ink);font:inherit;cursor:pointer}
.opt:disabled{cursor:default}.opt:not(:disabled):active{transform:scale(.99)}
.ltr{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;background:var(--bg);color:var(--mute)}
.otxt{overflow-wrap:anywhere;min-width:0}
.opt.ok{border-color:var(--ok);background:var(--okbg)}.opt.ok .ltr{background:var(--ok);color:#fff}
.opt.bad{border-color:var(--bad);background:var(--badbg)}.opt.bad .ltr{background:var(--bad);color:#fff}
.res{display:none;margin:6px 0 0;font-weight:800}.res.ok{color:var(--ok)}.res.bad{color:var(--bad)}
.exp{display:none;margin:12px 0 0;padding:12px 14px;border-radius:14px;background:var(--bg);border:1px solid var(--line);overflow-wrap:anywhere}
.exp b{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin-bottom:4px}
.note{margin:6px 0 0;color:var(--mute);font-size:14px}
.cta{display:none;margin-top:18px}.cta.show{display:block}
.btn{display:block;text-align:center;text-decoration:none;font-weight:800;border-radius:14px;padding:14px 16px;margin:0 0 10px;border:2px solid var(--brand);font:inherit;font-weight:800;width:100%;cursor:pointer}
.btn.p{background:var(--brand);color:#fff}.btn.s{background:transparent;color:var(--brand)}
footer{margin-top:22px;text-align:center;color:var(--mute);font-size:13px}
table{border-collapse:collapse;max-width:100%}th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left}
</style>
</head>
<body>
<main id="q" data-correct="${view.correct}" data-src="${esc(src)}" data-title="${esc(view.title)}" data-subject="${esc(view.subject)}">
  <div class="tag">${esc(view.title)}</div>
  <div class="card">
    ${groups}
    <p class="q">${render(view.text)}</p>
    ${image}
    <div id="opts">${options}</div>
    <div id="res" class="res" role="status"></div>
    ${interactive ? '' : '<p class="note">The answer key for this question isn’t loaded yet — practise the full paper in Geo-Books.</p>'}
    ${view.exp ? `<div id="exp" class="exp"><b>Explanation</b>${render(view.exp)}</div>` : ''}
  </div>
  <div id="cta" class="cta${interactive ? '' : ' show'}">
    <a id="go" class="btn p" href="/geo-books.htm">Practise more ${esc(view.subject || 'JAMB')} on Geo-Books</a>
    <button id="share" type="button" class="btn s">Challenge a friend on WhatsApp</button>
  </div>
  <footer>Powered by Geo-Books | Peak Flow Digitals</footer>
</main>
${hasMath ? `<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>` : ''}
<script>
(function(){
  var root=document.getElementById('q'),correct=parseInt(root.dataset.correct,10),src=root.dataset.src;
  function ping(type){try{var b=new Blob([JSON.stringify({type:type,src:src})],{type:'application/json'});if(!(navigator.sendBeacon&&navigator.sendBeacon('/api/share/event',b))){fetch('/api/share/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,src:src}),keepalive:true})}}catch(e){}}
  var go=document.getElementById('go');
  var phone=window.matchMedia&&window.matchMedia('(max-width:900px)').matches;
  go.href=(phone?'/geo-books-phone.htm':'/geo-books.htm')+'?src='+encodeURIComponent(src);
  go.addEventListener('click',function(){ping('click')});
  document.getElementById('share').addEventListener('click',function(){
    ping('share');
    var url=location.origin+location.pathname+'?src=friend';
    var msg='Can you solve this? '+root.dataset.title+'\\n'+url;
    window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank','noopener');
  });
  var done=false,opts=document.querySelectorAll('.opt');
  opts.forEach(function(btn){btn.addEventListener('click',function(){
    if(done||correct<0)return;done=true;
    var pick=parseInt(btn.dataset.i,10);
    opts.forEach(function(o){o.disabled=true});
    opts[correct].classList.add('ok');
    var res=document.getElementById('res');
    if(pick===correct){res.textContent='Correct! Well done.';res.className='res ok'}
    else{btn.classList.add('bad');res.textContent='Not quite — the answer is '+String.fromCharCode(65+correct)+'.';res.className='res bad'}
    res.style.display='block';
    var exp=document.getElementById('exp');if(exp)exp.style.display='block';
    document.getElementById('cta').classList.add('show');
    ping('answer');
  })});
  document.addEventListener('DOMContentLoaded',function(){
    if(window.renderMathInElement)try{window.renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false})}catch(e){}
  });
})();
</script>
</body>
</html>`;
}

function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Question not found | Geo-Books</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center;background:#f6f7fb;color:#0f172a}a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:#4f46e5;color:#fff;font-weight:700;text-decoration:none}</style></head>
<body><div><h1>We couldn’t find that question</h1><p>The link may be wrong or the question was removed.</p><a href="/">Open Geo-Books</a></div></body></html>`;
}

// --- mount ------------------------------------------------------------------

export async function mountShareQuestion({ app, db, FieldValue, rateLimit }) {
  const render = await loadRenderer();

  const pageLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: 'Too many requests. Please try again in a minute.' });
  const eventLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'Too many requests.' });

  // Small TTL cache: a post forwarded across WhatsApp can send hundreds of opens for
  // the same question in minutes; none of them should each cost a Firestore read.
  const cache = new Map();
  const cacheGet = (k) => {
    const hit = cache.get(k);
    if (!hit) return undefined;
    if (Date.now() - hit.t > CACHE_TTL_MS) { cache.delete(k); return undefined; }
    return hit.v;
  };
  const cacheSet = (k, v) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(k, { t: Date.now(), v });
  };

  // Buffered counters -> one Firestore write per flush.
  let pending = {};
  const bump = (kind, src) => {
    pending[kind] = pending[kind] || {};
    pending[kind][src] = (pending[kind][src] || 0) + 1;
  };
  async function flush() {
    if (!db || !FieldValue || !Object.keys(pending).length) return;
    const batch = pending;
    pending = {};
    const data = {};
    for (const [kind, bySrc] of Object.entries(batch)) {
      data[kind] = {};
      for (const [src, n] of Object.entries(bySrc)) data[kind][src] = FieldValue.increment(n);
    }
    // Days roll over at midnight Lagos time (UTC+1, no DST) to match the audience.
    const day = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);
    try {
      await db.collection('shareStats').doc(day).set(data, { merge: true });
    } catch (e) {
      console.error('[share-question] stats flush failed:', e.message);
    }
  }
  setInterval(flush, FLUSH_MS).unref();

  const baseFor = (req) => {
    const configured = text(process.env.PUBLIC_BASE_URL).trim().replace(/\/+$/, '');
    if (configured) return configured;
    const host = text(req.get('host'));
    return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${req.protocol}://${host}` : '';
  };

  async function respond(req, res, key, loader) {
    if (!db) return res.status(503).type('html').send(notFoundPage());
    try {
      let view = cacheGet(key);
      if (view === undefined) {
        view = await loader();
        cacheSet(key, view || null);
      }
      if (!view) return res.status(404).type('html').send(notFoundPage());
      const src = cleanSrc(req.query.src);
      bump('views', src);
      res.set('Cache-Control', 'public, max-age=300');
      res.type('html').send(renderPage(view, { render, base: baseFor(req), path: req.path, src }));
    } catch (e) {
      console.error('[share-question] failed:', e);
      res.status(500).type('html').send(notFoundPage());
    }
  }

  const num = (v) => (/^\d{1,4}$/.test(String(v)) ? parseInt(v, 10) : 0);

  // Order matters only by segment count, so these cannot shadow each other.
  app.get('/q/jamb/:subject/:year/:n', pageLimiter, (req, res) => {
    const { subject, year } = req.params;
    const n = num(req.params.n);
    if (!SLUG_RE.test(subject) || !YEAR_RE.test(year) || n < 1) return res.status(404).type('html').send(notFoundPage());
    return respond(req, res, `jamb:${subject.toLowerCase()}:${year}:${n}`, () => loadByJamb(db, subject, year, n));
  });

  app.get('/q/:id/:n', pageLimiter, (req, res) => {
    const { id } = req.params;
    const n = num(req.params.n);
    if (!ID_RE.test(id) || n < 1) return res.status(404).type('html').send(notFoundPage());
    return respond(req, res, `exam:${id}:${n}`, () => loadByExamId(db, id, n));
  });

  app.get('/q/:id', pageLimiter, (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return res.status(404).type('html').send(notFoundPage());
    return respond(req, res, `question:${id}`, () => loadByQuestionId(db, id));
  });

  app.post('/api/share/event', eventLimiter, (req, res) => {
    const type = text(req.body?.type);
    if (!EVENT_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown event type' });
    bump(`${type}s`, cleanSrc(req.body?.src));
    res.status(204).end();
  });

  return { flush }; // exposed for tests and graceful shutdown
}
