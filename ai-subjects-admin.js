/**
 * Geo-Books Admin — AI Subjects
 *
 * Loaded as its own <script type="module"> in main_admin.htm (same pattern as
 * university-admin.js). The "AI Subjects" sidebar section calls
 * window.initAiSubjectsAdmin() each time it is opened.
 *
 * Flow (mirrors MedPhysio's AI topic creator, scaled up to a whole subject):
 *   1. choose destination  → University course  |  Tutor course
 *   2. describe the subject → AI drafts an outline of topics
 *   3. edit outline         → AI writes every lesson (mini-text in MedPhysio's
 *                             component vocabulary, model structured answer,
 *                             quiz) and optionally searches YouTube
 *   4. review & publish     → topics are written to courseTopics / tutorTopics
 *                             (tutor: + tutorCourses when creating a course)
 *
 * Students then read the result in subject.htm / subject-lesson.htm.
 * Writes are gated by firestore.rules (isAdmin()) — this UI is a convenience.
 */
import {
  auth, db, apiPost, escapeHTML, sanitizeLessonHtml, stripTags, estimateReadMinutes,
  normalizeYouTube, normalizeDrive, safeHttpsUrl, KIND
} from './subject-shared.js';
import {
  collection, doc, getDocs, query, where, orderBy, limit, writeBatch, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'geoBooksAiSubjectDraft:v1';
const jsAttr = (v) => escapeHTML(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

const state = {
  kind: 'uni',
  outline: [],        // [{ title, description }]
  lessons: {},        // index -> lesson result (+ video choices)
  status: {},         // index -> 'pending' | 'working' | 'done' | 'error'
  errors: {},         // index -> message
  config: {},         // snapshot of step-1/2 inputs at outline time
  cancel: false,
  generating: false,
  tutors: [],
  tutorCourses: [],
  inited: false
};

const toast = (msg, type = 'success') => (window.toast ? window.toast(msg, type) : console.log(msg));
const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
const refreshIcons = () => { try { window.lucide?.createIcons(); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------------------
// Draft persistence — a 10-topic generation is minutes of work + API spend, so
// it survives a refresh. Cleared on publish / "Start Over".
// ---------------------------------------------------------------------------
function saveDraft() {
  try {
    if (!state.outline.length) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      kind: state.kind, outline: state.outline, lessons: state.lessons, config: state.config, savedAt: Date.now()
    }));
  } catch (e) { console.warn('Could not save AI subject draft:', e); }
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Step 1 — destination
// ---------------------------------------------------------------------------
function currentKind() {
  return document.querySelector('input[name="aiSubKind"]:checked')?.value === 'tutor' ? 'tutor' : 'uni';
}
function applyKindUi() {
  state.kind = currentKind();
  $('aiSubUniFields').classList.toggle('hidden', state.kind !== 'uni');
  $('aiSubTutorFields').classList.toggle('hidden', state.kind !== 'tutor');
  if (state.kind === 'tutor') loadTutorOptions();
  updatePublishLabel();
}

async function loadUniSuggestions() {
  try {
    const snap = await getDocs(query(collection(db, 'courseTopics'), orderBy('createdAt', 'desc'), limit(300)));
    const courses = new Map(); // courseId -> institutionId
    snap.docs.forEach((d) => {
      const x = d.data();
      if (x.courseId && !courses.has(x.courseId)) courses.set(x.courseId, x.institutionId || '');
    });
    state.courseInstitution = courses;
    $('aiSubCourseIdList').innerHTML = [...courses.keys()].map((c) => `<option value="${escapeHTML(c)}"></option>`).join('');
    $('aiSubInstitutionIdList').innerHTML = [...new Set(courses.values())].filter(Boolean).map((i) => `<option value="${escapeHTML(i)}"></option>`).join('');
  } catch (e) { console.warn('Could not load course suggestions:', e); }
}

async function loadTutorOptions() {
  try {
    const [tutorSnap, courseSnap] = await Promise.all([
      getDocs(collection(db, 'tutors')),
      getDocs(query(collection(db, 'tutorCourses'), orderBy('createdAt', 'desc'), limit(300)))
    ]);
    state.tutors = tutorSnap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((t) => t.accessGranted === true);
    state.tutorCourses = courseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const me = auth.currentUser;
    const sel = $('aiSubTutorOwner');
    const prev = sel.value;
    sel.innerHTML = `<option value="${escapeHTML(me?.uid || '')}">Geo-Books (platform course)</option>` +
      state.tutors.map((t) => `<option value="${escapeHTML(t.uid)}">${escapeHTML(t.name || t.email || t.uid)}</option>`).join('');
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    refreshTutorCourseOptions();
  } catch (e) {
    console.error('Could not load tutors:', e);
    $('aiSubTutorOwner').innerHTML = '<option value="">Could not load tutors</option>';
  }
}
function refreshTutorCourseOptions() {
  const owner = $('aiSubTutorOwner').value;
  const sel = $('aiSubTutorCourse');
  const prev = sel.value;
  sel.innerHTML = '<option value="__new__">＋ Create a new tutor course</option>' +
    state.tutorCourses.filter((c) => c.tutorId === owner)
      .map((c) => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.title || c.id)}</option>`).join('');
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  $('aiSubTutorNewFields').classList.toggle('hidden', sel.value !== '__new__');
  updatePublishLabel();
}

function readDestination() {
  const kind = currentKind();
  if (kind === 'uni') {
    const courseId = $('aiSubCourseId').value.trim();
    const institutionId = $('aiSubInstitutionId').value.trim();
    if (!courseId) throw new Error('Enter a Course ID / code for the university course.');
    if (!institutionId) throw new Error('Enter the Institution ID (students are matched to courses by it).');
    return { kind, courseId, institutionId };
  }
  const tutorId = $('aiSubTutorOwner').value;
  if (!tutorId) throw new Error('Choose who owns this tutor course.');
  const tutorCourseId = $('aiSubTutorCourse').value;
  if (tutorCourseId === '__new__') {
    return { kind, tutorId, tutorCourseId: null };
  }
  return { kind, tutorId, tutorCourseId };
}

// ---------------------------------------------------------------------------
// Step 2 — outline
// ---------------------------------------------------------------------------
window.aiSubjectsGenerateOutline = async () => {
  const btn = $('aiSubOutlineBtn');
  const status = $('aiSubOutlineStatus');
  status.textContent = '';
  let dest;
  try { dest = readDestination(); } catch (e) { status.textContent = e.message; return; }
  const title = $('aiSubTitle').value.trim();
  const brief = $('aiSubBrief').value.trim();
  if (!title) { status.textContent = 'Enter a subject title.'; return; }
  if (state.outline.length && !confirm('This replaces the current outline and any lessons already generated. Continue?')) return;

  btn.disabled = true;
  status.textContent = 'Designing the syllabus…';
  try {
    const data = await apiPost('/api/ai/subject-outline', {
      title, description: brief, level: $('aiSubLevel').value,
      audience: dest.kind === 'tutor' ? 'tutor' : 'university',
      topicCount: Number($('aiSubTopicCount').value) || 8
    });
    state.kind = dest.kind;
    state.outline = data.topics;
    state.lessons = {};
    state.status = {};
    state.errors = {};
    state.config = {
      dest, title, brief, level: $('aiSubLevel').value,
      quizCount: Math.max(0, Math.min(10, Number($('aiSubQuizCount').value) || 0)),
      youtube: $('aiSubYoutube').checked,
      autoAttach: $('aiSubAutoAttach').checked
    };
    saveDraft();
    status.textContent = '';
    renderOutline();
    renderReview();
    $('aiSubOutlineCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    status.textContent = e.message || 'Could not generate the outline.';
  } finally {
    btn.disabled = false;
  }
};

function syncOutlineFromDom() {
  document.querySelectorAll('#aiSubOutlineList [data-ol]').forEach((row) => {
    const i = Number(row.dataset.ol);
    if (!state.outline[i]) return;
    state.outline[i].title = row.querySelector('[data-f="title"]').value;
    state.outline[i].description = row.querySelector('[data-f="description"]').value;
  });
}

function renderOutline() {
  const card = $('aiSubOutlineCard');
  card.classList.toggle('hidden', !state.outline.length);
  if (!state.outline.length) return;
  const badge = { pending: ['bg-slate-100 text-slate-400', 'Not generated'], working: ['bg-amber-100 text-amber-700', 'Writing…'], done: ['bg-emerald-100 text-emerald-700', 'Ready'], error: ['bg-rose-100 text-rose-600', 'Failed'] };
  $('aiSubOutlineList').innerHTML = state.outline.map((t, i) => {
    const st = state.lessons[i] ? 'done' : (state.status[i] || 'pending');
    const [cls, label] = badge[st];
    return `<div data-ol="${i}" class="p-4 rounded-2xl border border-slate-100 bg-slate-50/60">
      <div class="flex items-center gap-3 mb-2">
        <span class="w-8 h-8 rounded-xl bg-white border border-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-black shrink-0">${String(i + 1).padStart(2, '0')}</span>
        <input data-f="title" ${state.generating ? 'disabled' : ''} value="${escapeHTML(t.title)}" placeholder="Topic title" class="flex-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-black outline-none focus:border-brand-500">
        <span class="px-3 py-1 rounded-full text-[9px] font-black uppercase ${cls}" ${st === 'error' ? `title="${escapeHTML(state.errors[i] || '')}"` : ''}>${label}</span>
        <button onclick="window.aiSubjectsMoveTopic(${i},-1)" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 text-xs font-black" title="Move up">↑</button>
        <button onclick="window.aiSubjectsMoveTopic(${i},1)" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 text-xs font-black" title="Move down">↓</button>
        <button onclick="window.aiSubjectsRemoveTopic(${i})" class="w-8 h-8 rounded-lg bg-white border border-rose-100 text-rose-400 text-xs font-black" title="Remove">✕</button>
      </div>
      <textarea data-f="description" ${state.generating ? 'disabled' : ''} rows="2" placeholder="What this lesson covers" class="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold outline-none focus:border-brand-500">${escapeHTML(t.description)}</textarea>
      ${st === 'error' ? `<p class="mt-2 text-[11px] font-bold text-rose-500">${escapeHTML(state.errors[i] || 'Failed')}</p>` : ''}
    </div>`;
  }).join('');
  const missing = state.outline.filter((_, i) => !state.lessons[i]).length;
  setText('aiSubGenAllLabel', missing === state.outline.length ? `Generate All ${missing} Lessons` : (missing ? `Generate Remaining ${missing} Lesson${missing === 1 ? '' : 's'}` : 'Regenerate All Lessons'));
}

function reindexLessons(mapFn) {
  const next = {};
  Object.keys(state.lessons).forEach((k) => { const nk = mapFn(Number(k)); if (nk !== null) next[nk] = state.lessons[k]; });
  state.lessons = next;
  state.status = {}; state.errors = {};
}
window.aiSubjectsMoveTopic = (i, dir) => {
  if (state.generating) return;
  syncOutlineFromDom();
  const j = i + dir;
  if (j < 0 || j >= state.outline.length) return;
  [state.outline[i], state.outline[j]] = [state.outline[j], state.outline[i]];
  reindexLessons((k) => (k === i ? j : k === j ? i : k));
  saveDraft(); renderOutline(); renderReview();
};
window.aiSubjectsRemoveTopic = (i) => {
  if (state.generating) return;
  syncOutlineFromDom();
  state.outline.splice(i, 1);
  reindexLessons((k) => (k === i ? null : k > i ? k - 1 : k));
  saveDraft(); renderOutline(); renderReview();
};
window.aiSubjectsAddTopic = () => {
  if (state.generating) return;
  if (!state.config?.title) { setText('aiSubOutlineStatus', 'Generate an outline first, then you can add topics to it.'); return; }
  syncOutlineFromDom();
  state.outline.push({ title: '', description: '' });
  saveDraft(); renderOutline();
};

// ---------------------------------------------------------------------------
// Step 3 — generate lessons (2 at a time, one retry each)
// ---------------------------------------------------------------------------
async function generateOne(i) {
  const t = state.outline[i];
  const cfg = state.config;
  state.status[i] = 'working'; delete state.errors[i];
  renderOutline();
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (state.cancel) { state.status[i] = 'pending'; return; }
    try {
      const lesson = await apiPost('/api/ai/subject-lesson', {
        subjectTitle: cfg.title, topicTitle: t.title, topicDescription: t.description,
        level: cfg.level, quizCount: cfg.quizCount, outlineTitles: state.outline.map((x) => x.title)
      });
      lesson.videos = [];
      lesson.fullLecture = null;      // { id,title,url,embedUrl }
      lesson.answerVideo = null;
      lesson.voiceNote = null;        // { url, embedUrl }
      lesson.youtubeSearchUrl = '';
      lesson.youtubeNote = '';
      if (cfg.youtube) {
        try {
          const yt = await apiPost('/api/ai/youtube-search', { query: lesson.youtubeQuery, max: 5 });
          lesson.youtubeSearchUrl = yt.searchUrl || '';
          if (!yt.configured) lesson.youtubeNote = 'YouTube search isn\'t set up on the server (add YOUTUBE_API_KEY). Use the search link and paste a URL instead.';
          else if (yt.error) lesson.youtubeNote = yt.error;
          lesson.videos = yt.videos || [];
          if (cfg.autoAttach && lesson.videos[0]) {
            const v = lesson.videos[0];
            lesson.fullLecture = { id: v.id, title: v.title, url: v.url, embedUrl: v.embedUrl };
          }
        } catch (e) { lesson.youtubeNote = `YouTube search failed: ${e.message}`; }
      }
      state.lessons[i] = lesson;
      state.status[i] = 'done';
      saveDraft();
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  state.status[i] = 'error';
  state.errors[i] = lastErr?.message || 'Generation failed';
}

window.aiSubjectsGenerateAll = async () => {
  if (state.generating) return;
  syncOutlineFromDom();
  if (state.outline.some((t) => !t.title.trim())) { toast('Every topic needs a title.', 'error'); return; }
  if (state.outline.some((t) => (t.description || '').trim().length < 10)) { toast('Every topic needs a short description (10+ characters) — the AI writes from it.', 'error'); return; }

  let todo = state.outline.map((_, i) => i).filter((i) => !state.lessons[i]);
  if (!todo.length) {
    if (!confirm('Regenerate ALL lessons? Any edits you made to existing lessons will be lost.')) return;
    state.lessons = {};
    todo = state.outline.map((_, i) => i);
  }
  state.generating = true; state.cancel = false;
  $('aiSubGenProgress').classList.remove('hidden');
  $('aiSubGenAllBtn').disabled = true;
  saveDraft();

  let finished = 0;
  const total = todo.length;
  const tick = () => {
    setText('aiSubGenLabel', `Writing lessons… ${finished}/${total}`);
    $('aiSubGenBar').style.width = `${(finished / total) * 100}%`;
  };
  tick();
  const queue = [...todo];
  const worker = async () => {
    while (queue.length && !state.cancel) {
      const i = queue.shift();
      await generateOne(i);
      finished++; tick(); renderOutline(); renderReview();
    }
  };
  await Promise.all([worker(), worker()]);

  state.generating = false;
  $('aiSubGenAllBtn').disabled = false;
  $('aiSubGenProgress').classList.add('hidden');
  renderOutline(); renderReview();
  const failed = Object.values(state.status).filter((s) => s === 'error').length;
  toast(state.cancel ? 'Generation cancelled.' : failed ? `Done — ${failed} lesson(s) failed. Run "Generate Remaining" to retry them.` : 'All lessons generated. Review them below.', failed ? 'error' : 'success');
  if (!state.cancel) $('aiSubReviewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.aiSubjectsCancelGen = () => { state.cancel = true; setText('aiSubGenLabel', 'Cancelling after the current lessons finish…'); };

// ---------------------------------------------------------------------------
// Step 4 — review
// ---------------------------------------------------------------------------
const PREVIEW_CSS_URL = () => new URL('medphysio.css', location.href).href;
function previewDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${PREVIEW_CSS_URL()}">
  <style>body{background:#f5faf8;padding:14px;margin:0}.mini-text-card{margin:0}</style></head>
  <body><article class="mini-text-card">${sanitizeLessonHtml(html)}</article></body></html>`;
}

function videoCardHtml(i, v) {
  const isLec = state.lessons[i].fullLecture?.id === v.id;
  const isAns = state.lessons[i].answerVideo?.id === v.id;
  return `<div class="flex gap-3 p-2 rounded-xl border ${isLec || isAns ? 'border-violet-300 bg-violet-50/50' : 'border-slate-100 bg-white'}">
    <img src="${escapeHTML(safeHttpsUrl(v.thumb))}" alt="" class="w-28 h-16 rounded-lg object-cover bg-slate-100 shrink-0">
    <div class="min-w-0 flex-1">
      <p class="text-[11px] font-black leading-tight line-clamp-2">${escapeHTML(v.title)}</p>
      <p class="text-[10px] font-bold text-slate-400 truncate">${escapeHTML(v.channel || '')}${v.duration ? ` · ${escapeHTML(v.duration)}` : ''}</p>
      <div class="flex gap-1.5 mt-1 flex-wrap">
        <button onclick="window.aiSubjectsPickVideo(${i},'${jsAttr(v.id)}','full')" class="px-2 py-1 rounded-md text-[9px] font-black uppercase ${isLec ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}">${isLec ? '✓ Full lecture' : 'Use as lecture'}</button>
        <button onclick="window.aiSubjectsPickVideo(${i},'${jsAttr(v.id)}','answer')" class="px-2 py-1 rounded-md text-[9px] font-black uppercase ${isAns ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}">${isAns ? '✓ Answer video' : 'Use as answer video'}</button>
        <a href="${escapeHTML(safeHttpsUrl(v.url))}" target="_blank" rel="noopener" class="px-2 py-1 rounded-md text-[9px] font-black uppercase bg-slate-100 text-slate-500">Watch ↗</a>
      </div>
    </div></div>`;
}

function renderReview() {
  const card = $('aiSubReviewCard');
  const done = Object.keys(state.lessons).map(Number).sort((a, b) => a - b).filter((i) => state.outline[i]);
  card.classList.toggle('hidden', !done.length);
  if (!done.length) return;
  setText('aiSubReviewCount', `${done.length} of ${state.outline.length} lessons ready`);
  updatePublishLabel();
  const openIdx = new Set([...document.querySelectorAll('#aiSubReviewList details[open]')].map((d) => d.dataset.rv));

  $('aiSubReviewList').innerHTML = done.map((i) => {
    const L = state.lessons[i];
    const attached = [L.fullLecture && 'lecture video', L.answerVideo && 'answer video', L.voiceNote && 'voice note'].filter(Boolean);
    return `<details data-rv="${i}" ${openIdx.has(String(i)) ? 'open' : ''} class="rounded-2xl border border-slate-100 bg-slate-50/40 overflow-hidden">
      <summary class="px-5 py-4 cursor-pointer flex items-center gap-3 select-none">
        <span class="w-8 h-8 rounded-xl bg-white border border-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-black shrink-0">${String(i + 1).padStart(2, '0')}</span>
        <span class="flex-1 min-w-0"><span class="block text-sm font-black truncate">${escapeHTML(state.outline[i].title)}</span>
          <span class="block text-[10px] font-bold text-slate-400">${L.miniTextReadMinutes} min read · ${L.questions?.length || 0} quiz question${(L.questions?.length || 0) === 1 ? '' : 's'}${attached.length ? ' · ' + attached.join(', ') : ''}</span></span>
        <span class="text-[10px] font-black uppercase text-violet-600">Review</span>
      </summary>
      <div class="p-5 pt-0 space-y-5">
        <div>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Mini-text preview <span class="normal-case font-bold">(as students see it)</span></p>
          <iframe data-preview="${i}" class="w-full rounded-2xl border border-slate-200 bg-white" style="height:420px" sandbox="" referrerpolicy="no-referrer"></iframe>
          <details class="mt-2"><summary class="text-[10px] font-black uppercase text-slate-400 cursor-pointer">Edit mini-text HTML</summary>
            <textarea data-edit="mini" data-i="${i}" rows="10" class="mt-2 w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-mono outline-none focus:border-brand-500">${escapeHTML(L.miniTextHtml)}</textarea>
            <button onclick="window.aiSubjectsApplyMiniEdit(${i})" class="mt-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase">Apply edit</button>
          </details>
        </div>

        <div>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Structured answer preview</p>
          <iframe data-preview-ans="${i}" class="w-full rounded-2xl border border-slate-200 bg-white" style="height:300px" sandbox="" referrerpolicy="no-referrer"></iframe>
        </div>

        <div>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Videos ${L.youtubeSearchUrl ? `<a href="${escapeHTML(safeHttpsUrl(L.youtubeSearchUrl))}" target="_blank" rel="noopener" class="normal-case text-violet-600 ml-2">Search YouTube ↗</a>` : ''}</p>
          ${L.youtubeNote ? `<p class="text-[11px] font-bold text-amber-600 mb-2">${escapeHTML(L.youtubeNote)}</p>` : ''}
          ${L.videos?.length ? `<div class="grid grid-cols-1 xl:grid-cols-2 gap-2 mb-3">${L.videos.map((v) => videoCardHtml(i, v)).join('')}</div>` : (state.config.youtube ? '<p class="text-[11px] font-bold text-slate-400 mb-2">No suggestions found.</p>' : '')}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input data-link="full" data-i="${i}" value="${escapeHTML(L.fullLecture?.url || '')}" placeholder="Full lecture — paste YouTube link" class="px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-bold outline-none focus:border-brand-500">
            <input data-link="answer" data-i="${i}" value="${escapeHTML(L.answerVideo?.url || '')}" placeholder="Answer video — paste YouTube link" class="px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-bold outline-none focus:border-brand-500">
            <input data-link="voice" data-i="${i}" value="${escapeHTML(L.voiceNote?.url || '')}" placeholder="Voice note — paste Google Drive link" class="px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-bold outline-none focus:border-brand-500">
          </div>
          <p data-link-msg="${i}" class="text-[11px] font-bold text-rose-500 mt-1"></p>
          <button onclick="window.aiSubjectsApplyLinks(${i})" class="mt-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase">Apply links</button>
        </div>

        <div class="flex gap-2 flex-wrap">
          <button onclick="window.aiSubjectsRegen(${i})" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase">↻ Regenerate this lesson</button>
          <button onclick="window.aiSubjectsDropLesson(${i})" class="px-4 py-2 rounded-xl bg-rose-50 text-rose-500 text-[10px] font-black uppercase">Remove from subject</button>
        </div>
      </div>
    </details>`;
  }).join('');

  // Fill iframes via srcdoc (sandboxed, no scripts) after insertion.
  done.forEach((i) => {
    const L = state.lessons[i];
    const a = document.querySelector(`iframe[data-preview="${i}"]`); if (a) a.srcdoc = previewDoc(L.miniTextHtml);
    const b = document.querySelector(`iframe[data-preview-ans="${i}"]`); if (b) b.srcdoc = previewDoc(L.structuredAnswerHtml || '<p>No structured answer was generated.</p>');
  });
}

window.aiSubjectsApplyMiniEdit = (i) => {
  const ta = document.querySelector(`textarea[data-edit="mini"][data-i="${i}"]`);
  if (!ta) return;
  const html = sanitizeLessonHtml(ta.value);
  if (stripTags(html).length < 40) { toast('That lesson text is too short.', 'error'); return; }
  state.lessons[i].miniTextHtml = html;
  state.lessons[i].miniTextReadMinutes = estimateReadMinutes(html);
  saveDraft(); renderReview(); toast('Mini-text updated.');
};

window.aiSubjectsPickVideo = (i, videoId, slot) => {
  const L = state.lessons[i];
  const v = L.videos.find((x) => x.id === videoId);
  if (!v) return;
  const key = slot === 'answer' ? 'answerVideo' : 'fullLecture';
  L[key] = (L[key]?.id === videoId) ? null : { id: v.id, title: v.title, url: v.url, embedUrl: v.embedUrl };
  saveDraft(); renderReview();
};

window.aiSubjectsApplyLinks = (i) => {
  const L = state.lessons[i];
  const read = (k) => document.querySelector(`input[data-link="${k}"][data-i="${i}"]`)?.value.trim() || '';
  const msg = document.querySelector(`[data-link-msg="${i}"]`);
  const problems = [];
  const toVideo = (raw, label) => {
    if (!raw) return null;
    const yt = normalizeYouTube(raw);
    if (!yt) { problems.push(`${label} must be a YouTube link.`); return undefined; }
    const known = L.videos.find((v) => v.id === yt.id);
    return { id: yt.id, title: known?.title || '', url: yt.url, embedUrl: yt.embedUrl };
  };
  const full = toVideo(read('full'), 'Full lecture');
  const ans = toVideo(read('answer'), 'Answer video');
  let voice = null;
  const voiceRaw = read('voice');
  if (voiceRaw) {
    const d = normalizeDrive(voiceRaw);
    if (!d) problems.push('Voice note must be a Google Drive file link (drive.google.com/file/d/…).'); else voice = d;
  }
  if (problems.length) { if (msg) msg.textContent = problems.join(' '); return; }
  if (full !== undefined) L.fullLecture = full;
  if (ans !== undefined) L.answerVideo = ans;
  L.voiceNote = voice;
  saveDraft(); renderReview(); toast('Links applied.');
};

window.aiSubjectsRegen = async (i) => {
  if (state.generating) return;
  if (!confirm('Regenerate this lesson? Your edits to it will be replaced.')) return;
  syncOutlineFromDom();
  state.generating = true;
  delete state.lessons[i];
  await generateOne(i);
  state.generating = false;
  saveDraft(); renderOutline(); renderReview();
  toast(state.lessons[i] ? 'Lesson regenerated.' : `Could not regenerate: ${state.errors[i] || 'error'}`, state.lessons[i] ? 'success' : 'error');
};

window.aiSubjectsDropLesson = (i) => {
  if (!confirm('Remove this topic from the subject?')) return;
  syncOutlineFromDom();
  window.aiSubjectsRemoveTopic(i);
};

function updatePublishLabel() {
  const n = Object.keys(state.lessons).filter((i) => state.outline[i]).length;
  const where = currentKind() === 'tutor' ? 'Tutor Course' : 'University Course';
  setText('aiSubPublishLabel', n ? `Publish ${n} Topic${n === 1 ? '' : 's'} to ${where}` : 'Publish Subject');
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------
function buildTopicDoc(i, topicNumber, dest, course, adminUid, aiSubjectId) {
  const L = state.lessons[i];
  const cfg = state.config;
  const base = {
    topicNumber,
    title: state.outline[i].title.trim(),
    description: state.outline[i].description.trim(),

    // marker the student pages use to route into the MedPhysio-style viewer
    contentFormat: 'medphysio',
    aiGenerated: true,
    aiSubjectId,
    subjectTitle: cfg.title,
    subjectDescription: cfg.brief || '',
    subjectLevel: cfg.level,

    miniText: stripTags(L.miniTextHtml),           // plain-text twin for older pages
    miniTextHtml: L.miniTextHtml,
    miniTextBlocks: [],
    miniTextKicker: 'Mini-text',
    miniTextReadMinutes: L.miniTextReadMinutes || estimateReadMinutes(L.miniTextHtml),

    voiceNote: L.voiceNote?.url || null,
    voiceNoteEmbed: L.voiceNote?.embedUrl || null,

    fullLecture: L.fullLecture?.url || null,
    fullLectureEmbed: L.fullLecture?.embedUrl || null,
    fullLectureTitle: L.videoTitle || L.fullLecture?.title || '',
    fullLectureDesc: L.videoDesc || '',

    structuredAnswer: stripTags(L.structuredAnswerHtml || '') || null,
    structuredAnswerHtml: L.structuredAnswerHtml || '',
    answerVideo: L.answerVideo?.url || null,
    answerVideoEmbed: L.answerVideo?.embedUrl || null,
    answerTitle: L.answerTitle || '',
    answerDesc: L.answerDesc || '',

    // other suggested videos (not attached) stay available as "Related videos"
    relatedVideos: (L.videos || []).slice(0, 5).map((v) => ({
      id: v.id, title: v.title, channel: v.channel || '', duration: v.duration || '', url: v.url, embedUrl: v.embedUrl
    })),

    // Quiz is embedded: tutor-course buyers can't read /assessments (rules are
    // University-Pass-gated), so inline works for both kinds. The sentinel keeps
    // the older course pages showing "Quiz" as available.
    quizQuestions: L.questions || [],
    quizAssessmentId: (L.questions || []).length ? 'inline' : null,

    createdBy: dest.kind === 'tutor' ? dest.tutorId : adminUid,
    generatedBy: adminUid,
    uploadedByRole: 'admin',
    uploadedByName: course.tutorName || 'Geo-Books',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (dest.kind === 'uni') { base.courseId = dest.courseId; base.institutionId = dest.institutionId; }
  else base.tutorCourseId = course.tutorCourseId;
  return base;
}

window.aiSubjectsPublish = async () => {
  if (state.generating) return;
  syncOutlineFromDom();
  const btn = $('aiSubPublishBtn');
  const status = $('aiSubPublishStatus');
  status.textContent = '';
  const idx = state.outline.map((_, i) => i).filter((i) => state.lessons[i]);
  if (!idx.length) { status.textContent = 'Generate at least one lesson first.'; return; }

  let dest;
  try { dest = readDestination(); } catch (e) { status.textContent = e.message; return; }
  const adminUid = auth.currentUser?.uid;
  if (!adminUid) { status.textContent = 'You are signed out.'; return; }

  const skipped = state.outline.length - idx.length;
  const targetLabel = dest.kind === 'uni' ? `${dest.courseId} (${dest.institutionId})` : 'the tutor course';
  if (!confirm(`Publish ${idx.length} topic(s) to ${targetLabel}?${skipped ? `\n\n${skipped} topic(s) without a generated lesson will be skipped.` : ''}\n\nStudents will be able to see them immediately.`)) return;

  btn.disabled = true;
  status.textContent = 'Publishing…';
  try {
    const aiSubjectId = `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const course = { tutorName: 'Geo-Books', tutorCourseId: dest.tutorCourseId };

    // Tutor: create the course doc first if requested.
    if (dest.kind === 'tutor') {
      const owner = state.tutors.find((t) => t.uid === dest.tutorId);
      course.tutorName = owner?.name || (dest.tutorId === adminUid ? 'Geo-Books' : (owner?.email || 'Tutor'));
      if (!dest.tutorCourseId) {
        const ref = await addDoc(collection(db, 'tutorCourses'), {
          title: state.config.title, subject: state.config.title, access: 'subscription',
          description: state.config.brief || `${state.config.title} — ${idx.length} AI-structured lessons with quizzes.`,
          coverUrl: null, tutorId: dest.tutorId, tutorName: course.tutorName, tutorLogoUrl: owner?.logoUrl || null,
          status: 'published', aiGenerated: true, aiSubjectId,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        course.tutorCourseId = ref.id;
        dest.tutorCourseId = ref.id;
      }
    }

    // Continue numbering after whatever is already in the course.
    const kindCfg = KIND[dest.kind];
    const courseKey = dest.kind === 'uni' ? dest.courseId : dest.tutorCourseId;
    const existing = await getDocs(query(collection(db, kindCfg.collection), where(kindCfg.courseField, '==', courseKey)));
    let nextNumber = existing.docs.reduce((m, d) => Math.max(m, Number(d.data().topicNumber) || 0), 0) + 1;

    const refs = [];
    for (let s = 0; s < idx.length; s += 400) {
      const batch = writeBatch(db);
      idx.slice(s, s + 400).forEach((i) => {
        const ref = doc(collection(db, kindCfg.collection));
        batch.set(ref, buildTopicDoc(i, nextNumber++, dest, course, adminUid, aiSubjectId));
        refs.push(ref.id);
      });
      await batch.commit();
    }

    const viewUrl = viewerUrl(dest.kind, courseKey, dest.institutionId);
    toast(`Published ${idx.length} topic${idx.length === 1 ? '' : 's'}.`);
    state.outline = []; state.lessons = {}; state.status = {}; state.errors = {}; state.config = {};
    saveDraft();
    renderOutline();
    $('aiSubReviewCard').classList.add('hidden');
    $('aiSubReviewList').innerHTML = '';
    status.textContent = '';
    // The review card is hidden now, so the confirmation goes in the (always visible) step-2 status line.
    $('aiSubOutlineStatus').innerHTML = `Published ✔ ${idx.length} topic${idx.length === 1 ? '' : 's'}. <a class="text-violet-600 underline" target="_blank" rel="noopener" href="${escapeHTML(viewUrl)}">Open the student view ↗</a>`;
    loadPublished();
    $('aiSubPublishedList').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (dest.kind === 'tutor') loadTutorOptions();
    if (dest.kind === 'uni') loadUniSuggestions();
  } catch (e) {
    console.error('Publish failed:', e);
    status.textContent = e.code === 'permission-denied' ? 'Permission denied — are you signed in as an admin?' : (e.message || 'Publish failed.');
  } finally {
    btn.disabled = false;
  }
};

const viewerUrl = (kind, courseKey, inst) =>
  new URL(`subject.htm?kind=${kind}&course=${encodeURIComponent(courseKey)}${inst ? `&inst=${encodeURIComponent(inst)}` : ''}`, location.href).href;

// ---------------------------------------------------------------------------
// Published subjects list (+ delete)
// ---------------------------------------------------------------------------
async function loadPublished() {
  const list = $('aiSubPublishedList');
  list.innerHTML = '<p class="p-12 text-center text-slate-400 font-bold">Loading...</p>';
  try {
    const [uni, tutor] = await Promise.all([
      getDocs(query(collection(db, 'courseTopics'), where('aiGenerated', '==', true))),
      getDocs(query(collection(db, 'tutorTopics'), where('aiGenerated', '==', true)))
    ]);
    const groups = new Map();
    const add = (kind, d) => {
      const x = d.data();
      const courseKey = kind === 'uni' ? x.courseId : x.tutorCourseId;
      const key = `${kind}|${courseKey}|${x.aiSubjectId || ''}`;
      const g = groups.get(key) || { kind, courseKey, inst: x.institutionId || '', aiSubjectId: x.aiSubjectId || '', title: x.subjectTitle || courseKey, count: 0, created: 0, quiz: 0 };
      g.count++;
      g.quiz += (x.quizQuestions || []).length;
      g.created = Math.max(g.created, x.createdAt?.toMillis ? x.createdAt.toMillis() : 0);
      groups.set(key, g);
    };
    uni.docs.forEach((d) => add('uni', d));
    tutor.docs.forEach((d) => add('tutor', d));
    state.published = [...groups.values()].sort((a, b) => b.created - a.created);

    if (!state.published.length) { list.innerHTML = '<p class="p-12 text-center text-slate-400 font-bold">No AI subjects published yet.</p>'; return; }
    list.innerHTML = state.published.map((g, n) => `
      <div class="p-6 flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-4 min-w-0">
          <div class="w-11 h-11 rounded-2xl ${g.kind === 'tutor' ? 'bg-fuchsia-100 text-fuchsia-600' : 'bg-violet-100 text-violet-600'} flex items-center justify-center shrink-0"><i data-lucide="${g.kind === 'tutor' ? 'users' : 'graduation-cap'}" class="w-5 h-5"></i></div>
          <div class="min-w-0"><p class="font-black text-sm truncate">${escapeHTML(g.title)}</p>
            <p class="text-[11px] font-bold text-slate-400">${g.kind === 'tutor' ? 'Tutor course' : 'University'} · ${escapeHTML(g.courseKey)}${g.inst ? ` · ${escapeHTML(g.inst)}` : ''} · ${g.count} topic${g.count === 1 ? '' : 's'} · ${g.quiz} quiz Qs${g.created ? ` · ${new Date(g.created).toLocaleDateString()}` : ''}</p></div>
        </div>
        <div class="flex gap-2">
          <a href="${escapeHTML(viewerUrl(g.kind, g.courseKey, g.inst))}" target="_blank" rel="noopener" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest">Student view ↗</a>
          <button onclick="window.aiSubjectsDeletePublished(${n})" class="px-4 py-2 rounded-xl bg-rose-50 text-rose-500 text-[10px] font-black uppercase tracking-widest">Delete</button>
        </div>
      </div>`).join('');
    refreshIcons();
  } catch (e) {
    console.error('Load published AI subjects failed:', e);
    list.innerHTML = `<p class="p-12 text-center text-rose-400 font-bold">Could not load: ${escapeHTML(e.message || '')}</p>`;
  }
}
window.aiSubjectsLoadPublished = loadPublished;

window.aiSubjectsDeletePublished = async (n) => {
  const g = state.published?.[n];
  if (!g) return;
  if (!confirm(`Delete "${g.title}" — all ${g.count} AI-generated topic(s) in ${g.courseKey}?\n\nThis cannot be undone. Topics added to this course by other means are not touched.`)) return;
  try {
    const col = KIND[g.kind].collection;
    const snap = await getDocs(query(collection(db, col), where('aiGenerated', '==', true), where('aiSubjectId', '==', g.aiSubjectId)));
    const docs = snap.docs.filter((d) => (g.kind === 'uni' ? d.data().courseId : d.data().tutorCourseId) === g.courseKey);
    for (let s = 0; s < docs.length; s += 400) {
      const batch = writeBatch(db);
      docs.slice(s, s + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    toast(`Deleted ${docs.length} topic(s).`);
    loadPublished();
  } catch (e) {
    console.error('Delete AI subject failed:', e);
    toast(e.code === 'failed-precondition' ? 'Firestore needs an index for this query — open the console link in the browser log.' : `Delete failed: ${e.message}`, 'error');
  }
};

// ---------------------------------------------------------------------------
// Draft banner / reset / init
// ---------------------------------------------------------------------------
function restoreDraft() {
  const d = loadDraft();
  if (!d || !d.outline?.length) return false;
  state.kind = d.kind || 'uni';
  state.outline = d.outline; state.lessons = d.lessons || {}; state.config = d.config || {};
  const dest = state.config.dest || {};
  document.querySelector(`input[name="aiSubKind"][value="${state.kind}"]`).checked = true;
  $('aiSubTitle').value = state.config.title || '';
  $('aiSubBrief').value = state.config.brief || '';
  if (state.config.level) $('aiSubLevel').value = state.config.level;
  $('aiSubQuizCount').value = state.config.quizCount ?? 5;
  $('aiSubTopicCount').value = state.outline.length;
  $('aiSubYoutube').checked = state.config.youtube !== false;
  $('aiSubAutoAttach').checked = state.config.autoAttach !== false;
  if (state.kind === 'uni') { $('aiSubCourseId').value = dest.courseId || ''; $('aiSubInstitutionId').value = dest.institutionId || ''; }
  applyKindUi();
  renderOutline(); renderReview();
  return true;
}
window.aiSubjectsDismissBanner = () => {
  $('aiSubResumeBanner').classList.add('hidden');
  if (!state.outline.length) restoreDraft();
  $('aiSubOutlineCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.aiSubjectsResetDraft = () => {
  if (state.generating) { toast('Wait for generation to finish (or cancel it) first.', 'error'); return; }
  if ((state.outline.length || loadDraft()) && !confirm('Discard the current outline and any generated lessons?')) return;
  state.outline = []; state.lessons = {}; state.status = {}; state.errors = {}; state.config = {};
  localStorage.removeItem(DRAFT_KEY);
  $('aiSubResumeBanner').classList.add('hidden');
  ['aiSubTitle', 'aiSubBrief'].forEach((id) => { $(id).value = ''; });
  setText('aiSubOutlineStatus', ''); setText('aiSubPublishStatus', '');
  renderOutline(); $('aiSubReviewCard').classList.add('hidden'); $('aiSubReviewList').innerHTML = '';
};

window.initAiSubjectsAdmin = () => {
  if (!state.inited) {
    state.inited = true;
    document.querySelectorAll('input[name="aiSubKind"]').forEach((r) => r.addEventListener('change', applyKindUi));
    $('aiSubTutorOwner').addEventListener('change', refreshTutorCourseOptions);
    $('aiSubTutorCourse').addEventListener('change', () => {
      $('aiSubTutorNewFields').classList.toggle('hidden', $('aiSubTutorCourse').value !== '__new__');
      updatePublishLabel();
    });
    $('aiSubCourseId').addEventListener('change', () => {
      const inst = state.courseInstitution?.get($('aiSubCourseId').value.trim());
      if (inst && !$('aiSubInstitutionId').value.trim()) $('aiSubInstitutionId').value = inst;
    });
    const d = loadDraft();
    if (d?.outline?.length) $('aiSubResumeBanner').classList.remove('hidden');
  }
  applyKindUi();
  loadUniSuggestions();
  loadPublished();
  refreshIcons();
};
