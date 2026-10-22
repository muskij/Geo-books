// ai-questions.js — AI-generated CBT questions for subjects that have no past
// questions imported yet, including diagram questions.
//
// Pure logic only (no network, no Firestore): the model call is injected as
// `callModel(messages, { temperature, maxTokens }) -> parsed JSON object`, so
// every rule below is unit-tested offline (ai-questions.test.js).
//
// Pipeline (generateSubjectQuestions):
//   1. Over-generate ~30% more questions than asked, in parallel chunks, with a
//      share of them required to carry an SVG diagram.
//   2. Validate each question + sanitize each SVG (strict allowlist). A question
//      that refers to a diagram we could not keep is dropped, never shown.
//   3. Verification pass: a second model call solves every question WITHOUT the
//      answer key; only questions where it independently agrees are kept. This
//      is what stops wrong answer keys (the main risk of AI-written exams).
//   4. Pick `count` questions, guaranteeing the diagram quota first.

const MAX_SVG_CHARS = 8000;
const MAX_SVG_TAGS = 250;

const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'marker', 'line', 'polyline', 'polygon', 'rect',
  'circle', 'ellipse', 'path', 'text', 'tspan',
  // Models often add these as accessibility metadata; they render nothing and
  // their text content is dropped (only TEXT_TAGS keep text).
  'title', 'desc'
]);
const TEXT_TAGS = new Set(['text', 'tspan']);

// Canonical (case-sensitive) SVG attribute names we allow.
const SVG_ATTRS = [
  'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity', 'fill-rule',
  'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
  'dx', 'dy', 'id', 'marker-end', 'marker-start', 'markerWidth', 'markerHeight', 'refX', 'refY',
  'orient', 'markerUnits', 'preserveAspectRatio'
];
const ATTR_BY_LOWER = new Map(SVG_ATTRS.map((a) => [a.toLowerCase(), a]));
const URL_ATTRS = new Set(['marker-end', 'marker-start', 'fill', 'stroke']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", deg: '°', nbsp: ' ', times: '×', divide: '÷', plusmn: '±', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', mu: 'μ', omega: 'ω', Omega: 'Ω', micro: 'µ' };

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 32 && code < 0x2fff ? String.fromCodePoint(code) : '';
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : '';
  });
}

function safeAttrValue(name, value) {
  if (value.length > 1500) return false;
  // Quotes are rejected too: a single-quoted source value containing " would
  // otherwise break out of the double-quoted attribute we re-emit.
  if (/[<>&\\"'`]/.test(value) || /javascript:|data:|expression|@import/i.test(value)) return false;
  if (/url\s*\(/i.test(value)) {
    // Only an in-document reference like url(#arrow) (for marker-end etc.).
    return URL_ATTRS.has(name) && /^url\(#[A-Za-z][\w-]*\)$/.test(value.trim());
  }
  return true;
}

/**
 * Rebuilds an SVG string from an allowlist of elements/attributes. Anything
 * outside the allowlist (script, style, image, foreignObject, use, a, animate,
 * event handlers, external URLs…) makes the whole diagram invalid (null).
 * The client also renders it through <img src="data:image/svg+xml…">, which
 * can never run script — this is a second, independent layer.
 */
export function sanitizeSvg(input) {
  if (typeof input !== 'string') return null;
  const src = input.trim();
  if (!src || src.length > MAX_SVG_CHARS * 2) return null;
  if (!/^<svg[\s>]/i.test(src)) return null;

  const out = [];
  const stack = [];
  let tags = 0;
  let rootSeen = false;
  let rootClosed = false;

  const re = /<([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[2] !== undefined) {
      // text node
      const top = stack[stack.length - 1];
      if (top && TEXT_TAGS.has(top)) {
        const t = escXml(decodeEntities(m[2].replace(/\s+/g, ' ')));
        if (t.trim()) out.push(t);
      } else if (m[2].trim() && rootClosed) {
        return null; // junk after </svg>
      }
      continue;
    }

    let body = m[1].trim();
    if (!body || body[0] === '!' || body[0] === '?') return null; // comments, CDATA, PI, doctype

    if (body[0] === '/') {
      const name = body.slice(1).trim().toLowerCase();
      if (!SVG_TAGS.has(name) || stack.pop() !== name) return null;
      out.push(`</${name}>`);
      if (!stack.length) rootClosed = true;
      continue;
    }

    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1).trim();
    const nm = /^([a-zA-Z][\w:-]*)/.exec(body);
    if (!nm) return null;
    const name = nm[1].toLowerCase();
    if (!SVG_TAGS.has(name)) return null;
    if (rootClosed) return null;
    if (++tags > MAX_SVG_TAGS) return null;
    if (name === 'svg') {
      if (rootSeen) return null; // nested <svg>
      rootSeen = true;
    } else if (!rootSeen) {
      return null;
    }

    let rest = body.slice(nm[1].length);
    const attrs = [];
    const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = attrRe.exec(rest))) {
      const canon = ATTR_BY_LOWER.get(am[1].toLowerCase());
      const value = am[2] !== undefined ? am[2] : am[3];
      rest = rest.replace(am[0], ' ');
      attrRe.lastIndex = 0;
      if (!canon) continue; // unknown / event-handler attributes are dropped
      if (name === 'svg' && (canon === 'width' || canon === 'height')) continue;
      if (!safeAttrValue(canon, value)) return null;
      attrs.push(`${canon}="${value.trim()}"`);
    }
    if (rest.trim()) return null; // malformed / unquoted attributes

    if (name === 'svg') {
      const hasVb = attrs.some((a) => a.startsWith('viewBox='));
      const head = [
        'xmlns="http://www.w3.org/2000/svg"',
        ...(hasVb ? [] : ['viewBox="0 0 400 260"']),
        'preserveAspectRatio="xMidYMid meet"',
        'font-family="sans-serif"',
        ...attrs.filter((a) => !a.startsWith('preserveAspectRatio='))
      ];
      out.push(`<svg ${head.join(' ')}>`, '<rect width="100%" height="100%" fill="#ffffff"/>');
    } else {
      out.push(`<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}${selfClosing ? '/' : ''}>`);
    }
    if (!selfClosing) stack.push(name);
    else if (name === 'svg') return null; // <svg/> is empty
  }

  if (!rootSeen || stack.length) return null;
  const result = out.join('');
  return result.length <= MAX_SVG_CHARS ? result : null;
}

// ---------------------------------------------------------------------------
// Question validation
// ---------------------------------------------------------------------------
const cleanText = (v, max) => String(v ?? '').replace(/[ \t\r\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const DIAGRAM_WORDS = /\b(diagram|figure|graph shown|shown (above|below)|circuit (shown|above|below)|in the (graph|chart|figure|picture)|the (graph|chart|table|figure) (above|below))\b/i;

export function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const q = cleanText(raw.q ?? raw.question, 700);
  const opts = Array.isArray(raw.opts) ? raw.opts.map((o) => cleanText(o, 220)) : [];
  if (q.length < 8 || opts.length !== 4 || opts.some((o) => !o)) return null;
  if (new Set(opts.map((o) => o.toLowerCase())).size !== 4) return null;
  const correct = Number(raw.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;

  let diagram = null;
  if (typeof raw.diagram === 'string' && raw.diagram.trim()) diagram = sanitizeSvg(raw.diagram);
  const needsDiagram = raw.refs_diagram === true || DIAGRAM_WORDS.test(q);
  if (needsDiagram && !diagram) return null; // refers to a figure we cannot show

  return {
    q,
    opts,
    correct,
    exp: cleanText(raw.exp ?? raw.explanation, 500),
    topic: cleanText(raw.topic, 80),
    diagram
  };
}

const stemKey = (q) => q.q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);

const POSITIONAL_OPTION = /\b(above|both|all of|none of|neither|a and b|b and c|a and c|a, b)\b/i;

// The model tends to bias the correct answer's position. Shuffle options and
// remap `correct`, except where options refer to each other ("both A and B").
export function shuffleOptions(q, rand = Math.random) {
  if (q.opts.some((o) => POSITIONAL_OPTION.test(o))) return q;
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, opts: order.map((i) => q.opts[i]), correct: order.indexOf(q.correct) };
}

// ---------------------------------------------------------------------------
// Which subjects get diagrams
// ---------------------------------------------------------------------------
// Diagram questions only make sense where a picture carries information.
// English, Literature, CRS/IRS, Government, etc. are excluded on purpose: a
// forced diagram there would be decoration, not a question.
const DIAGRAM_SUBJECTS = /(math|physic|chem|bio|geograph|econom|agric|further|technical|drawing|computer|ict|commerce|account|statistic|science|health|home)/i;

export const isDiagramSubject = (subject) => DIAGRAM_SUBJECTS.test(String(subject || ''));

export function diagramTargetFor(subject, count) {
  if (!isDiagramSubject(subject)) return 0;
  return Math.min(count, Math.max(count >= 10 ? 2 : 1, Math.round(count * 0.25)));
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
function difficultyLine(d) {
  return d === 'easy' ? 'Level: easy, recall and direct application.'
    : d === 'hard' ? 'Level: hard, multi-step and tricky distractors.'
    : 'Level: standard, matching a real examination.';
}

const SVG_RULES = [
  'DIAGRAM RULES (when a question has a diagram):',
  '- "diagram" is ONE complete SVG string: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"> ... </svg>',
  '- Allowed elements only: svg, g, defs, marker, line, polyline, polygon, rect, circle, ellipse, path, text, tspan.',
  '- No style, script, image, use, foreignObject, animation, or external references.',
  '- Draw with stroke="#1f2937" stroke-width="2"; use fill="none" unless a shape must be filled. Labels are <text font-size="14" fill="#1f2937">.',
  '- Keep it simple and uncluttered (under about 1800 characters). Leave margins; nothing may overlap or run outside the viewBox.',
  '- Every value, label, unit and point name needed to answer must be written inside the SVG as <text>, and must agree with the options.',
  '- Examples of good diagrams: triangles/circles/angles with labelled lengths, a labelled velocity-time or distance-time graph, a simple circuit with labelled resistors and a battery, a ray diagram, a labelled bar chart or demand/supply curves, a cell or organ outline with lettered parts, a number line, a food chain.',
  '- The question text must point to the figure ("In the diagram above…") and must be unanswerable without it.'
].join('\n');

export function buildGenerationMessages({ examType, subject, topic, count, diagrams, difficulty, variation }) {
  const system = [
    `You are a senior Nigerian ${examType} examiner writing ORIGINAL multiple-choice questions for ${subject}${topic ? ` (topic: ${topic})` : ''}.`,
    'Follow the official Nigerian syllabus for this subject. Questions must be accurate, unambiguous, and exam-style.',
    difficultyLine(difficulty),
    'Each question has exactly 4 options and exactly ONE correct option. Distractors must be plausible. Never use "all of the above" or "none of the above".',
    'Compute every numerical answer carefully. If you are not sure a question is correct, write a different one.',
    'Write mathematics in LaTeX inside single dollar signs, with backslashes escaped for JSON (e.g. "$\\\\frac{1}{2}x^2$").',
    'Cover different parts of the syllabus; do not repeat a question or an idea.',
    diagrams > 0
      ? `Exactly ${diagrams} of the ${count} questions MUST include a diagram ("refs_diagram": true and "diagram": an SVG string). All other questions have "refs_diagram": false, "diagram": null and must not mention any diagram or figure.`
      : 'No question may include or mention a diagram: set "refs_diagram": false and "diagram": null on every question.',
    diagrams > 0 ? SVG_RULES : '',
    'Return ONLY JSON: {"questions":[{"q":string,"opts":[string,string,string,string],"correct":0|1|2|3,"exp":string,"topic":string,"refs_diagram":boolean,"diagram":string|null}]}',
    '"exp" is a short worked explanation (1-2 sentences).'
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ examType, subject, topic: topic || null, count, batch: variation + 1 }) }
  ];
}

export function buildVerificationMessages(items) {
  const system = [
    'You are a strict examination moderator. For each question, solve it independently and pick the single best option.',
    'If the question is ambiguous, has no correct option, has more than one correct option, contains an error, or needs diagram information that its SVG does not provide, answer null.',
    'Do not assume any option is correct. Return ONLY JSON: {"answers":[{"id":number,"choice":0|1|2|3|null}]}'
  ].join('\n');
  const payload = items.map((it, id) => ({
    id,
    question: it.q,
    options: it.opts,
    ...(it.diagram ? { diagram_svg: it.diagram } : {})
  }));
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ questions: payload }) }
  ];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
const CHUNK = 12;
const VERIFY_CHUNK = 20;

const shuffled = (arr, rand = Math.random) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export async function generateSubjectQuestions({
  examType = 'GENERAL',
  subject,
  topic = '',
  count = 20,
  difficulty = 'standard',
  callModel,
  rand = Math.random,
  log = () => {}
} = {}) {
  if (typeof callModel !== 'function') throw new Error('callModel is required');
  const subj = cleanText(subject, 60);
  if (!subj) throw new Error('AI_BAD_INPUT');
  const want = Math.max(5, Math.min(60, Math.floor(Number(count) || 20)));
  const diagramTarget = diagramTargetFor(subj, want);

  // Over-generate to absorb verification / sanitizer drops.
  const total = Math.ceil(want * 1.3);
  const diagramAsk = diagramTarget ? Math.ceil(diagramTarget * 1.5) : 0;
  const nChunks = Math.ceil(total / CHUNK);
  const plan = Array.from({ length: nChunks }, (_, i) => ({
    count: Math.floor(total / nChunks) + (i < total % nChunks ? 1 : 0),
    diagrams: Math.floor(diagramAsk / nChunks) + (i < diagramAsk % nChunks ? 1 : 0)
  }));

  const settled = await Promise.allSettled(plan.map((p, i) => callModel(
    buildGenerationMessages({ examType, subject: subj, topic, count: p.count, diagrams: Math.min(p.diagrams, p.count), difficulty, variation: i }),
    { temperature: 0.7, maxTokens: 900 + p.count * 220 + p.diagrams * 900 }
  )));

  const seen = new Set();
  const candidates = [];
  let rejected = 0;
  settled.forEach((r) => {
    if (r.status !== 'fulfilled') { log('chunk failed', r.reason?.message); return; }
    const list = Array.isArray(r.value?.questions) ? r.value.questions : [];
    list.forEach((raw) => {
      const q = normalizeQuestion(raw);
      if (!q) { rejected++; return; }
      const key = stemKey(q);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(q);
    });
  });
  if (!candidates.length) throw new Error('AI_NO_QUESTIONS');

  // Verification: an independent solve; keep only agreements.
  let verifiedOk = true;
  const kept = [];
  const batches = [];
  for (let i = 0; i < candidates.length; i += VERIFY_CHUNK) batches.push(candidates.slice(i, i + VERIFY_CHUNK));
  const verdicts = await Promise.allSettled(batches.map(async (batch) => {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await callModel(buildVerificationMessages(batch), { temperature: 0, maxTokens: 200 + batch.length * 24 });
        const answers = Array.isArray(res?.answers) ? res.answers : null;
        if (!answers) throw new Error('bad verification shape');
        return answers;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }));
  verdicts.forEach((v, bi) => {
    const batch = batches[bi];
    if (v.status !== 'fulfilled') {
      // Verification unavailable: keep the batch but report it as unverified.
      verifiedOk = false;
      kept.push(...batch);
      return;
    }
    const byId = new Map(v.value.map((a) => [Number(a?.id), a?.choice]));
    batch.forEach((q, id) => { if (byId.get(id) === q.correct) kept.push(q); else rejected++; });
  });
  if (!kept.length) throw new Error('AI_NO_VERIFIED_QUESTIONS');

  // Selection: diagram quota first, then fill, then mix the order.
  const withD = shuffled(kept.filter((q) => q.diagram), rand);
  const without = shuffled(kept.filter((q) => !q.diagram), rand);
  const picked = withD.slice(0, diagramTarget);
  const filler = shuffled([...without, ...withD.slice(diagramTarget)], rand);
  while (picked.length < want && filler.length) picked.push(filler.shift());
  const final = shuffled(picked, rand).map((q) => ({ ...shuffleOptions(q, rand), ai: true }));

  const diagramCount = final.filter((q) => q.diagram).length;
  log('generated', { want, got: final.length, diagramTarget, diagramCount, rejected, verifiedOk });
  return { questions: final, requested: want, diagramTarget, diagramCount, verified: verifiedOk };
}

// ---------------------------------------------------------------------------
// Daily budget (questions per day) — enforced server-side in server.js
// ---------------------------------------------------------------------------
export const AI_QUESTION_DAILY_BUDGET = {
  FREE: 80,
  EXAM_PASS_SEASON: 150,
  EXAM_PASS_ANNUAL: 150,
  UNIVERSITY_PASS_30: 150,
  UNIVERSITY_PASS_70: 150,
  TUTOR_COURSE_PASS: 150,
  TUTOR_PASS: 150,
  STANDARD: 1000,
  STANDARD_ANNUAL: 1000,
  PREMIUM: 1000,
  PREMIUM_ANNUAL: 1000
};
export const DEFAULT_AI_QUESTION_BUDGET = 80;
