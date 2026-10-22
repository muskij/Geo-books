// Run with: node --test backend/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSvg, normalizeQuestion, shuffleOptions, isDiagramSubject,
  diagramTargetFor, generateSubjectQuestions
} from './ai-questions.js';

const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" width="400"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#1f2937"/></marker></defs><polygon points="50,200 300,200 50,60" fill="none" stroke="#1f2937" stroke-width="2"/><line x1="10" y1="10" x2="90" y2="10" stroke="#1f2937" marker-end="url(#arrow)"/><text x="160" y="220" font-size="14">8 cm &amp; 6 cm &deg;</text></svg>';

test('sanitizeSvg keeps a valid diagram and normalises the root', () => {
  const out = sanitizeSvg(GOOD);
  assert.ok(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(out.includes('<rect width="100%" height="100%" fill="#ffffff"/>'));
  assert.ok(!/width="400"/.test(out.split('>')[0]), 'root width removed');
  assert.ok(out.includes('<polygon') && out.includes('marker-end="url(#arrow)"'));
  assert.ok(out.includes('8 cm &amp; 6 cm °'), out);
});

test('typical model output with <title>/<desc> and a tspan still works; their text is dropped', () => {
  const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><title>Right triangle</title><desc>ignore me</desc><text x="10" y="20">Side <tspan font-weight="bold">8 cm</tspan></text></svg>');
  assert.ok(out, 'accepted');
  assert.ok(!out.includes('Right triangle') && !out.includes('ignore me'), out);
  assert.ok(out.includes('8 cm'));
});

test('sanitizeSvg rejects every attack we can think of', () => {
  const attacks = {
    script: '<svg><script>alert(1)</script></svg>',
    quoteBreakout: `<svg><line x1='1' stroke='red" onload="alert(1)' x2="2"/></svg>`,
    foreignObject: '<svg><foreignObject><div>hi</div></foreignObject></svg>',
    style: '<svg><style>*{fill:red}</style></svg>',
    image: '<svg><image href="https://evil.example/x.png"/></svg>',
    use: '<svg><use href="#a"/></svg>',
    anchor: '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    nested: '<svg><svg><line x1="0" y1="0" x2="1" y2="1"/></svg></svg>',
    comment: '<svg><!-- hi --><line x1="0" y1="0" x2="1" y2="1"/></svg>',
    cdata: '<svg><text><![CDATA[x]]></text></svg>',
    jsUrl: '<svg><line stroke="javascript:alert(1)" x1="0" y1="0" x2="1" y2="1"/></svg>',
    externalUrl: '<svg><line stroke="url(https://evil.example/a.svg#x)" x1="0" y1="0" x2="1" y2="1"/></svg>',
    dataUri: '<svg><line stroke="data:image/svg+xml;base64,AAA" x1="0" y1="0" x2="1" y2="1"/></svg>',
    unclosed: '<svg><g><line x1="0" y1="0" x2="1" y2="1"/></svg>',
    mismatched: '<svg><g></text></g></svg>',
    unquoted: '<svg><line x1=0 y1="0" x2="1" y2="1"/></svg>',
    afterRoot: '<svg><line x1="0" y1="0" x2="1" y2="1"/></svg>trailing junk',
    notSvg: '<div><svg></svg></div>',
    emptyRoot: '<svg/>',
    animate: '<svg><line x1="0" y1="0" x2="1" y2="1"><animate attributeName="x1" to="5"/></line></svg>'
  };
  for (const [name, svg] of Object.entries(attacks)) {
    assert.equal(sanitizeSvg(svg), null, `should reject: ${name}`);
  }
});

test('event-handler attributes are stripped from the output, not passed through', () => {
  for (const attr of ['onload="alert(1)"', 'onclick="alert(1)"', 'onerror="alert(1)"', "onmouseover='alert(1)'"]) {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" ${attr}><line x1="0" y1="0" x2="1" y2="1" ${attr}/></svg>`);
    assert.ok(out, 'still a usable diagram');
    assert.ok(!/\bon[a-z]+\s*=|alert/i.test(out), out);
  }
});

test('sanitizeSvg drops unknown attributes silently (style, event handlers)', () => {
  const out = sanitizeSvg('<svg><line x1="0" y1="0" x2="5" y2="5" style="fill:red" onclick="x()" stroke="#000"/></svg>');
  assert.ok(out && !/style=|onclick/.test(out) && out.includes('stroke="#000"'));
});

test('sanitizeSvg escapes text and strips unknown entities', () => {
  const out = sanitizeSvg('<svg><text x="1" y="1">a &lt;b&gt; &bogus; &#176; & c</text></svg>');
  assert.ok(out.includes('a &lt;b&gt;  ° &amp; c'), out);
});

test('sanitizeSvg enforces size limits', () => {
  assert.equal(sanitizeSvg('<svg>' + '<line x1="0" y1="0" x2="1" y2="1"/>'.repeat(300) + '</svg>'), null);
  assert.equal(sanitizeSvg('<svg><text>' + 'x'.repeat(20000) + '</text></svg>'), null);
});

const q = (over = {}) => ({ q: 'What is the SI unit of force?', opts: ['Newton', 'Joule', 'Watt', 'Pascal'], correct: 0, exp: 'F = ma.', topic: 'Mechanics', ...over });

test('normalizeQuestion accepts a valid question and rejects broken ones', () => {
  assert.ok(normalizeQuestion(q()));
  assert.equal(normalizeQuestion(q({ opts: ['a', 'b', 'c'] })), null);
  assert.equal(normalizeQuestion(q({ opts: ['same', 'Same', 'c', 'd'] })), null, 'duplicate options');
  assert.equal(normalizeQuestion(q({ correct: 4 })), null);
  assert.equal(normalizeQuestion(q({ correct: '1' })) && normalizeQuestion(q({ correct: 'x' })), null);
  assert.equal(normalizeQuestion(q({ q: 'short' })), null);
  assert.equal(normalizeQuestion(null), null);
});

test('questions that refer to a diagram must carry a valid one', () => {
  assert.equal(normalizeQuestion(q({ refs_diagram: true, diagram: null })), null);
  assert.equal(normalizeQuestion(q({ q: 'In the diagram above, what is the length of side x?', diagram: null })), null);
  assert.equal(normalizeQuestion(q({ refs_diagram: true, diagram: '<svg><script>x</script></svg>' })), null);
  const ok = normalizeQuestion(q({ q: 'In the diagram above, find the hypotenuse.', refs_diagram: true, diagram: GOOD }));
  assert.ok(ok && ok.diagram.startsWith('<svg'));
  // an unusable diagram on a question that does not need one is just dropped
  const plain = normalizeQuestion(q({ refs_diagram: false, diagram: '<svg><script/></svg>' }));
  assert.ok(plain && plain.diagram === null);
});

test('shuffleOptions remaps the correct index', () => {
  for (let s = 0; s < 50; s++) {
    let x = s + 1;
    const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    const r = shuffleOptions({ opts: ['A1', 'B2', 'C3', 'D4'], correct: 2 }, rand);
    assert.equal(r.opts[r.correct], 'C3');
    assert.deepEqual([...r.opts].sort(), ['A1', 'B2', 'C3', 'D4']);
  }
  const keep = shuffleOptions({ opts: ['x', 'y', 'Both A and B', 'z'], correct: 2 });
  assert.deepEqual(keep.opts, ['x', 'y', 'Both A and B', 'z']);
});

test('diagram subjects and quotas', () => {
  for (const s of ['Physics', 'Mathematics', 'Further Mathematics', 'Biology', 'Chemistry', 'Geography', 'Economics', 'Agricultural Science', 'Technical Drawing']) assert.ok(isDiagramSubject(s), s);
  for (const s of ['English', 'Literature', 'CRS', 'Government', 'Yoruba']) assert.ok(!isDiagramSubject(s), s);
  assert.equal(diagramTargetFor('English', 40), 0);
  assert.equal(diagramTargetFor('Physics', 5), 1);
  assert.equal(diagramTargetFor('Physics', 20), 5);
  assert.equal(diagramTargetFor('Physics', 40), 10);
});

// ---- orchestrator with a fake model ---------------------------------------
function fakeModel({ wrongVerify = new Set(), failVerify = false, diagramsEnabled = true } = {}) {
  let n = 0;
  const truth = new Map();
  const calls = { gen: 0, verify: 0, genMessages: [] };
  const callModel = async (messages) => {
    const sys = messages[0].content;
    if (sys.includes('senior Nigerian')) {
      calls.gen++;
      calls.genMessages.push(sys);
      const { count } = JSON.parse(messages[1].content);
      const want = Number((/Exactly (\d+) of the/.exec(sys) || [])[1] || 0);
      const questions = Array.from({ length: count }, (_, i) => {
        const id = ++n;
        const hasD = diagramsEnabled && i < want;
        const correct = id % 4;
        const opts = [`opt ${id} a`, `opt ${id} b`, `opt ${id} c`, `opt ${id} d`];
        truth.set(`Question number ${id} about topic?`, { correct, opts });
        return {
          q: hasD ? `In the diagram above, question number ${id} about topic?` : `Question number ${id} about topic?`,
          opts, correct, exp: 'because', topic: 't', refs_diagram: hasD, diagram: hasD ? GOOD : null
        };
      });
      return { questions };
    }
    calls.verify++;
    if (failVerify) throw new Error('verifier down');
    const { questions } = JSON.parse(messages[1].content);
    return {
      answers: questions.map((it) => {
        const key = it.question.replace('In the diagram above, question', 'Question');
        const t = [...truth.entries()].find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
        const idNum = Number(/number (\d+)/.exec(it.question)[1]);
        let choice = t ? it.options.findIndex((o) => o === t.opts[t.correct]) : null;
        if (wrongVerify.has(idNum)) choice = (choice + 1) % 4;
        return { id: it.id, choice };
      })
    };
  };
  return { callModel, calls };
}

test('generateSubjectQuestions: count, diagram quota, ai flag, answer keys intact', async () => {
  const { callModel } = fakeModel();
  const res = await generateSubjectQuestions({ subject: 'Physics', count: 20, callModel });
  assert.equal(res.questions.length, 20);
  assert.ok(res.diagramCount >= 5, `diagrams: ${res.diagramCount}`);
  assert.equal(res.verified, true);
  for (const x of res.questions) {
    assert.equal(x.ai, true);
    assert.equal(x.opts.length, 4);
    // option shuffle must keep the right answer text pointing at the key
    const id = /number (\d+)/.exec(x.q)[1];
    assert.equal(x.opts[x.correct], `opt ${id} ${'abcd'[Number(id) % 4]}`);
    if (x.diagram) assert.ok(x.diagram.startsWith('<svg'));
  }
  assert.equal(new Set(res.questions.map((x) => x.q)).size, 20, 'no duplicates');
});

test('verification drops questions whose key the checker disagrees with', async () => {
  const wrong = new Set(Array.from({ length: 10 }, (_, i) => i + 1));
  const { callModel } = fakeModel({ wrongVerify: wrong });
  const res = await generateSubjectQuestions({ subject: 'Chemistry', count: 12, callModel });
  for (const x of res.questions) assert.ok(!wrong.has(Number(/number (\d+)/.exec(x.q)[1])), x.q);
});

test('non-diagram subjects never ask for or receive diagrams', async () => {
  const { callModel, calls } = fakeModel({ diagramsEnabled: false });
  const res = await generateSubjectQuestions({ subject: 'English', count: 20, callModel });
  assert.equal(res.diagramTarget, 0);
  assert.equal(res.diagramCount, 0);
  assert.ok(calls.genMessages.every((s) => !s.includes('MUST include a diagram') && !s.includes('DIAGRAM RULES')));
});

test('if verification is unavailable, questions are returned but flagged unverified', async () => {
  const { callModel } = fakeModel({ failVerify: true });
  const res = await generateSubjectQuestions({ subject: 'Biology', count: 10, callModel });
  assert.equal(res.verified, false);
  assert.ok(res.questions.length >= 5);
});

test('fails loudly when the model yields nothing usable', async () => {
  await assert.rejects(generateSubjectQuestions({ subject: 'Physics', count: 10, callModel: async () => ({ questions: [{ q: 'bad' }] }) }), /AI_NO_QUESTIONS/);
  await assert.rejects(generateSubjectQuestions({ subject: '', count: 10, callModel: async () => ({}) }), /AI_BAD_INPUT/);
});
