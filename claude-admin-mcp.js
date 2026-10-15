// Claude <-> Geo-Books admin bridge (MCP over HTTP, JSON-RPC).
//
// OFF unless CLAUDE_MCP_SECRET is set (>= 32 chars). The secret is part of the URL path:
//   https://<your-app>/mcp/<CLAUDE_MCP_SECRET>
// Anyone with that URL can use these tools, so treat it like a password and rotate it
// (change the env var) if it ever leaks. Every call is written to `claudeAuditLog`.
//
// Deliberately NOT exposed: tokens, passwords, payment/escrow mutation, bans, deletes,
// subscription changes, raw Firestore access. Only the tools listed below exist.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const REPORT_STATUSES = ['pending', 'reviewing', 'resolved', 'dismissed'];
// Content collections Claude may create/edit. No users, admins, payments, promos or subscriptions.
const CONTENT = ['books', 'questions', 'scholarships', 'hostels', 'courseTopics', 'videoLessons'];
const MAX_BYTES = 20000;
const USER_FIELDS = ['displayName', 'email', 'university', 'role', 'level', 'xp', 'streak', 'subscription', 'createdAt'];

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function plain(v) {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = plain(obj[k]);
  return out;
}

export function mountClaudeAdminMcp({ app, db, FieldValue, r2 }) {
  const secret = process.env.CLAUDE_MCP_SECRET || '';
  if (secret.length < 32) {
    console.log('[claude-mcp] disabled (set CLAUDE_MCP_SECRET to 32+ chars to enable)');
    return;
  }
  if (!db) { console.log('[claude-mcp] disabled (Firebase Admin not configured)'); return; }

  const checkCol = (c) => { if (!CONTENT.includes(c)) throw new Error('collection not allowed'); };
  const checkData = (d) => {
    if (!d || typeof d !== 'object' || Array.isArray(d) || !Object.keys(d).length) throw new Error('data must be a non-empty object');
    if (JSON.stringify(d).length > MAX_BYTES) throw new Error('data too large');
    for (const k of Object.keys(d)) if (k.startsWith('__') || k.includes('.') || ['createdBy', 'createdAt', 'updatedBy', 'updatedAt'].includes(k)) throw new Error('field not allowed: ' + k);
  };
  const count = async (q) => (await q.count().get()).data().count;

  const tools = {
    admin_stats: {
      description: 'Read-only overview: total users, reports by status, marketplace items.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({
        users: await count(db.collection('users')),
        reports: Object.fromEntries(await Promise.all(REPORT_STATUSES.map(async (s) => [s, await count(db.collection('reports').where('status', '==', s))]))),
        marketItems: await count(db.collection('marketItems')),
      }),
    },
    list_reports: {
      description: 'Read-only: list user reports, newest first. Optional status filter.',
      inputSchema: { type: 'object', properties: { status: { type: 'string', enum: REPORT_STATUSES }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
      run: async ({ status, limit = 20 }) => {
        let q = db.collection('reports');
        if (status) q = q.where('status', '==', status);
        const snap = await q.limit(Math.min(limit, 50)).get();
        return snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
      },
    },
    find_user: {
      description: 'Read-only: look up one user by exact email or uid. Returns limited profile fields only.',
      inputSchema: { type: 'object', properties: { email: { type: 'string' }, uid: { type: 'string' } } },
      run: async ({ email, uid }) => {
        if (!email && !uid) throw new Error('give email or uid');
        let doc;
        if (uid) doc = await db.collection('users').doc(String(uid)).get();
        else {
          const s = await db.collection('users').where('email', '==', String(email).toLowerCase()).limit(1).get();
          doc = s.docs[0];
        }
        if (!doc || !doc.exists) return { found: false };
        return { found: true, uid: doc.id, ...pick(doc.data(), USER_FIELDS) };
      },
    },
    list_market_items: {
      description: 'Read-only: recent marketplace listings.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
      run: async ({ limit = 20 }) => (await db.collection('marketItems').limit(Math.min(limit, 50)).get()).docs.map((d) => ({ id: d.id, ...plain(d.data()) })),
    },
    content_list: {
      description: 'Read-only: list documents in a content collection. Collections: ' + CONTENT.join(', '),
      inputSchema: { type: 'object', required: ['collection'], properties: { collection: { type: 'string', enum: CONTENT }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
      run: async ({ collection, limit = 20 }) => {
        checkCol(collection);
        return (await db.collection(collection).limit(Math.min(limit, 50)).get()).docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
      },
    },
    content_get: {
      description: 'Read-only: get one content document.',
      inputSchema: { type: 'object', required: ['collection', 'id'], properties: { collection: { type: 'string', enum: CONTENT }, id: { type: 'string' } } },
      run: async ({ collection, id }) => {
        checkCol(collection);
        const d = await db.collection(collection).doc(String(id)).get();
        return d.exists ? { id: d.id, ...plain(d.data()) } : { found: false };
      },
    },
    content_create: {
      description: 'WRITE (logged, undoable): create a new document in a content collection. Never overwrites an existing id.',
      inputSchema: { type: 'object', required: ['collection', 'data'], properties: { collection: { type: 'string', enum: CONTENT }, id: { type: 'string' }, data: { type: 'object' } } },
      write: true,
      run: async ({ collection, id, data }) => {
        checkCol(collection); checkData(data);
        const ref = id ? db.collection(collection).doc(String(id)) : db.collection(collection).doc();
        if ((await ref.get()).exists) throw new Error('id already exists; use content_update');
        await ref.set({ ...data, createdBy: 'claude-mcp', createdAt: FieldValue.serverTimestamp() });
        return { collection, id: ref.id, created: true };
      },
    },
    content_update: {
      description: 'WRITE (logged, undoable): merge fields into an existing content document. Cannot delete fields or documents.',
      inputSchema: { type: 'object', required: ['collection', 'id', 'data'], properties: { collection: { type: 'string', enum: CONTENT }, id: { type: 'string' }, data: { type: 'object' } } },
      write: true,
      run: async ({ collection, id, data }) => {
        checkCol(collection); checkData(data);
        const ref = db.collection(collection).doc(String(id));
        const before = await ref.get();
        if (!before.exists) throw new Error('document not found');
        const prev = {}; const was = before.data(); for (const k of Object.keys(data)) prev[k] = was[k] === undefined ? { __absent: true } : { v: was[k] };
        await ref.update({ ...data, updatedBy: 'claude-mcp', updatedAt: FieldValue.serverTimestamp() });
        return { collection, id, updated: Object.keys(data), _undo: { collection, id, prev } };
      },
    },
    revert_change: {
      description: 'WRITE (logged): undo a content_update or content_create using the auditId returned by that call.',
      inputSchema: { type: 'object', required: ['auditId'], properties: { auditId: { type: 'string' } } },
      write: true,
      run: async ({ auditId }) => {
        const a = await db.collection('claudeAuditLog').doc(String(auditId)).get();
        if (!a.exists) throw new Error('audit entry not found');
        const { tool, result } = a.data();
        if (tool === 'content_create') { await db.collection(result.collection).doc(result.id).delete(); return { reverted: 'created doc removed', id: result.id }; }
        if (tool === 'content_update' && result._undo) {
          const { collection, id, prev } = result._undo;
          const restore = {}; for (const [k, p] of Object.entries(prev)) restore[k] = p && p.__absent ? FieldValue.delete() : (p && 'v' in p ? p.v : p);
          await db.collection(collection).doc(id).update(restore);
          return { reverted: 'fields restored', id };
        }
        if (tool === 'import_past_papers' && Array.isArray(result.createdIds) && result.createdIds.length) {
          for (const eid of result.createdIds) { const d = await db.collection('exams').doc(eid).get(); if (d.exists && d.data().createdBy === 'claude-mcp') await d.ref.delete(); }
          return { reverted: 'imported exams removed', count: result.createdIds.length };
        }
        throw new Error('this entry cannot be reverted');
      },
    },

    r2_import_images: {
      description: 'WRITE (logged): copy image files that were staged in the deployed app\'s _bridge-import/<folder>/ directory into the R2 bucket under the same folder name. Never overwrites an existing object. Returns public URLs.',
      inputSchema: { type: 'object', required: ['folder'], properties: { folder: { type: 'string', description: 'lowercase letters, digits and dashes, e.g. chemistry-pastpaper' } } },
      write: true,
      run: async ({ folder }) => {
        if (!r2) throw new Error('R2 is not configured on this server');
        if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(String(folder))) throw new Error('bad folder name');
        const dir = path.join(r2.baseDir, '_bridge-import', folder);
        if (!fs.existsSync(dir)) throw new Error('nothing staged at _bridge-import/' + folder);
        const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
        const uploaded = []; const skipped = []; const rejected = [];
        for (const name of fs.readdirSync(dir)) {
          const ext = path.extname(name).toLowerCase();
          if (!/^[\w.-]+$/.test(name) || !TYPES[ext]) { rejected.push(name); continue; }
          const body = fs.readFileSync(path.join(dir, name));
          if (body.length > 5 * 1024 * 1024) { rejected.push(name + ' (too large)'); continue; }
          const Key = folder + '/' + name;
          let exists = false;
          try { await r2.client.send(new r2.HeadObjectCommand({ Bucket: r2.bucket, Key })); exists = true; } catch { /* not found */ }
          if (exists) { skipped.push(name); continue; }
          await r2.client.send(new r2.PutObjectCommand({ Bucket: r2.bucket, Key, Body: body, ContentType: TYPES[ext], CacheControl: 'public, max-age=31536000, immutable' }));
          uploaded.push(name);
        }
        return { folder, publicBase: (r2.publicUrl || '').replace(/\/$/, '') + '/' + folder + '/', uploaded: uploaded.length, skippedExisting: skipped, rejected, sample: uploaded.slice(0, 3) };
      },
    },
    import_past_papers: {
      description: 'WRITE (logged, undoable): create CBT exams (the Past Papers) from an <exam-paper> XML file staged at _bridge-import/<xmlFile>. Optional imagesManifest (CSV with columns file,year,question) staged beside it attaches diagram images stored in R2 under imagesFolder. dryRun defaults to true and writes nothing. Exams that already exist (same subject, year, type) are skipped.',
      inputSchema: { type: 'object', required: ['xmlFile'], properties: { xmlFile: { type: 'string' }, imagesManifest: { type: 'string' }, imagesFolder: { type: 'string' }, skipBroken: { type: 'boolean', description: 'import the good questions of a paper and drop the broken ones (reported in dropped). Default false: a paper with any broken question is skipped whole.' }, dryRun: { type: 'boolean' } } },
      write: true,
      run: async ({ xmlFile, imagesManifest, imagesFolder, skipBroken = false, dryRun = true }) => {
        const safe = (n) => { if (!/^[\w.-]+$/.test(String(n))) throw new Error('bad file name'); return path.join(r2base(), '_bridge-import', String(n)); };
        const r2base = () => { if (!r2) throw new Error('not configured'); return r2.baseDir; };
        const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
        const clean = (s) => dec(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        const tag = (blk, t) => { const mm = blk.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return mm ? clean(mm[1]) : ''; };
        const xml = fs.readFileSync(safe(xmlFile), 'utf8');
        const img = {};
        if (imagesManifest) {
          if (!imagesFolder || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(imagesFolder)) throw new Error('imagesFolder required with imagesManifest');
          const base = (r2.publicUrl || '').replace(/\/$/, '') + '/' + imagesFolder + '/';
          for (const line of fs.readFileSync(safe(imagesManifest), 'utf8').split(/\r?\n/).slice(1)) {
            const [file, , year, question] = line.split(',');
            if (file && year && question && /^[\w.-]+$/.test(file)) img[year + '|' + question] = base + file;
          }
        }
        const papers = [];
        for (const pm of xml.matchAll(/<exam-paper\b([^>]*)>([\s\S]*?)<\/exam-paper>/g)) {
          const attr = (n) => { const a = pm[1].match(new RegExp(n + '="([^"]*)"')); return a ? dec(a[1]).trim() : ''; };
          const subject = attr('subject'); const year = attr('year');
          const examType = (attr('type') || 'JAMB').toUpperCase() === 'JAMB' ? 'JAMB' : 'Other';
          const duration = parseInt(attr('duration')) || 40;
          const title = attr('title') || (subject + ' ' + year);
          const problems = []; const questions = [];
          [...pm[2].matchAll(/<question\b([^>]*)>([\s\S]*?)<\/question>/g)].forEach((qm, i) => {
            const n = i + 1;
            const ans = ((qm[1].match(/answer="([^"]*)"/) || [])[1] || '').toUpperCase();
            const a = ['A', 'B', 'C', 'D', 'E'].indexOf(ans);
            const all = ['a', 'b', 'c', 'd', 'e'].map((l) => tag(qm[2], 'choice-' + l));
            const opts = (all[4] || a === 4) ? all : all.slice(0, 4);
            const q = tag(qm[2], 'question-text');
            if (!q || a === -1 || opts.some((o) => !o) || /^\[(not extracted|RAW)/i.test(q)) { problems.push('Q' + n); return; }
            questions.push({ q, opts, a, exp: tag(qm[2], 'explanation'), image: tag(qm[2], 'image-url') || img[year + '|' + n] || null });
          });
          papers.push({ title, subject, year, examType, duration, questions, problems });
        }
        if (!papers.length) throw new Error('no <exam-paper> blocks found');
        const plan = []; const createdIds = [];
        for (const p of papers) {
          const dup = await db.collection('exams').where('jambSubject', '==', p.subject).where('jambYear', '==', p.year).where('examType', '==', p.examType).limit(1).get();
          const row = { title: p.title, questions: p.questions.length, withImages: p.questions.filter((q) => q.image).length, dropped: p.problems, duplicate: !dup.empty };
          if (!dryRun && !dup.empty) row.action = 'skipped (already exists)';
          else if (!dryRun && p.problems.length && !skipBroken) row.action = 'skipped (has broken questions; use skipBroken to drop them)';
          else if (!dryRun) {
            const ref = await db.collection('exams').add({ title: p.title, subject: p.subject, duration: p.duration, questions: p.questions, examType: p.examType, jambSubject: p.examType === 'JAMB' ? p.subject : null, jambYear: p.examType === 'JAMB' ? (p.year || null) : null, createdBy: 'claude-mcp', createdAt: FieldValue.serverTimestamp() });
            createdIds.push(ref.id); row.action = 'created';
          }
          plan.push(row);
        }
        return { dryRun: !!dryRun, papers: plan.length, questions: plan.reduce((s, r) => s + r.questions, 0), images: plan.reduce((s, r) => s + r.withImages, 0), created: createdIds.length, createdIds, plan };
      },
    },
    set_report_status: {
      description: 'WRITE (logged): set a report status to pending, reviewing, resolved or dismissed. Does not delete anything.',
      inputSchema: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string' }, status: { type: 'string', enum: REPORT_STATUSES } } },
      write: true,
      run: async ({ id, status }) => {
        if (!REPORT_STATUSES.includes(status)) throw new Error('bad status');
        const ref = db.collection('reports').doc(String(id));
        if (!(await ref.get()).exists) throw new Error('report not found');
        await ref.update({ status, reviewedBy: 'claude-mcp', updatedAt: FieldValue.serverTimestamp() });
        return { id, status };
      },
    },
  };

  const hits = new Map(); // crude per-minute limiter
  const limited = () => {
    const k = Math.floor(Date.now() / 60000);
    const n = (hits.get(k) || 0) + 1; hits.clear(); hits.set(k, n);
    return n > 60;
  };

  const audit = async (entry) => { try { return (await db.collection('claudeAuditLog').add({ ...entry, at: FieldValue.serverTimestamp() })).id; } catch { return null; } };
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  app.post('/mcp/:key', async (req, res) => {
    if (!safeEqual(req.params.key, secret)) return res.status(404).end(); // look like any unknown path
    if (limited()) return res.status(429).json(err(null, -32000, 'rate limited'));
    const { id = null, method, params = {} } = req.body || {};
    try {
      if (method === 'initialize')
        return res.json(ok(id, { protocolVersion: params.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'geo-books-admin', version: '1.0.0' } }));
      if (method === 'notifications/initialized') return res.status(202).end();
      if (method === 'ping') return res.json(ok(id, {}));
      if (method === 'tools/list')
        return res.json(ok(id, { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) }));
      if (method === 'tools/call') {
        const t = tools[params.name];
        if (!t) return res.json(err(id, -32602, 'unknown tool'));
        const args = params.arguments || {};
        try {
          const out = await t.run(args);
          if (t.write) {
            const auditId = await audit({ tool: params.name, args, ok: true, result: { ...out } });
            if (out && out._undo) delete out._undo;
            if (out && typeof out === 'object') out.auditId = auditId;
          }
          return res.json(ok(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }));
        } catch (e) {
          if (t.write) await audit({ tool: params.name, args, ok: false, error: String(e.message) });
          return res.json(ok(id, { isError: true, content: [{ type: 'text', text: String(e.message) }] }));
        }
      }
      return res.json(err(id, -32601, 'method not found'));
    } catch (e) {
      console.error('[claude-mcp]', e.message);
      return res.json(err(id, -32603, 'internal error'));
    }
  });
  app.get('/mcp/:key', (req, res) => res.status(405).end());
  console.log('[claude-mcp] enabled at /mcp/<secret>');
}
