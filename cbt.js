/**
 * Geo-Books CBT Engine — cbt.htm
 *
 * This runs the actual exam-taking experience on its own dedicated page,
 * deliberately kept free of the main app's header/sidebar/bottom nav.
 *
 * How a session gets here: app.js generates the questions (AI scan, quick
 * drill, or official exam) while the user is still on the main app — that
 * step needs Firebase/AI access this page doesn't have — then calls
 * launchCbtExamPage(), which drops the exam payload into sessionStorage and
 * navigates here. sessionStorage (not localStorage) is intentional: it's
 * scoped to this tab and disappears if the tab closes, matching the
 * "your progress will be lost" copy already in the exit-confirm modal.
 *
 * When the exam ends, this page does NOT talk to Firestore directly (no db
 * context here). Instead it redirects back to the main app with the result
 * in the query string; app.js's checkCbtReward() picks it up and does the
 * actual stat write + XP reward — the same redirect-based pattern already
 * used for the AI Scan reward flow (see checkAIScanReward in app.js).
 */

import { $, S, toText, escapeHTML, toast, getAppEntryUrl } from "./utils.js";

const SESSION_KEY = 'geoBooksCbtSession';

const cbt = {
  subject: 'General',
  examType: 'GENERAL',
  questions: [],
  answers: [],
  flags: [],
  i: 0,
  timer: null,
  timeLeft: 1800,
  durationSec: 1800,
  paused: false,
  submitted: false,
  reviewMode: false,
  onTimeOut: null
};

// --- Helpers ---
function getCorrectIndex(q) {
  const idx = q?.correct;
  if (Number.isInteger(idx)) return idx;
  const a = q?.a;
  return Number.isInteger(a) ? a : 0;
}

function formatMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// --- Fullscreen (best-effort, matches the real CBT-center feel) ---
function getFullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement ||
         document.mozFullScreenElement || document.msFullscreenElement || null;
}

async function requestExamFullscreen() {
  const el = document.documentElement;
  try {
    if (getFullscreenEl()) return;
    const req = el.requestFullscreen || el.webkitRequestFullscreen ||
                el.mozRequestFullScreen || el.msRequestFullscreen;
    if (req) await req.call(el);
  } catch (e) {
    console.warn('CBT fullscreen request failed/unsupported:', e?.message || e);
  }
}

async function exitExamFullscreen() {
  try {
    if (!getFullscreenEl()) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen ||
                 document.mozCancelFullScreen || document.msExitFullscreen;
    if (exit) await exit.call(document);
  } catch (e) {
    console.warn('CBT fullscreen exit failed:', e?.message || e);
  }
}

document.addEventListener('fullscreenchange', () => {
  if (!cbt.submitted && !getFullscreenEl() && cbt.questions.length) {
    toast('Exited fullscreen. Tap anywhere to re-enter exam mode.', 'warning');
  }
});

// --- Timer ---
function startTimer(onTimeOut) {
  if (cbt.timer) clearInterval(cbt.timer);
  cbt.timer = null;
  cbt.onTimeOut = typeof onTimeOut === 'function' ? onTimeOut : null;
  if (!Number.isFinite(cbt.timeLeft) || cbt.timeLeft <= 0) cbt.timeLeft = cbt.durationSec || 1800;

  const tick = () => {
    if (S('cbtTimer')) {
      const span = S('cbtTimer').querySelector('span');
      if (span) span.textContent = formatMMSS(cbt.timeLeft);
    }
  };
  tick();

  cbt.timer = setInterval(() => {
    if (cbt.paused) return;
    cbt.timeLeft--;
    tick();
    if (cbt.timeLeft <= 0) {
      clearInterval(cbt.timer);
      cbt.timer = null;
      if (cbt.onTimeOut) cbt.onTimeOut();
    }
  }, 1000);
}

// --- Rendering ---
function renderQuestion() {
  const q = cbt.questions[cbt.i];
  const container = S('cbtQuestionContainer');
  if (!q || !container) return;

  if (S('cbtQuestionText')) S('cbtQuestionText').textContent = q.q;
  if (S('cbtQuestionBadge')) S('cbtQuestionBadge').textContent = `Question ${String(cbt.i + 1).padStart(2, '0')} / ${cbt.questions.length}`;
  if (S('cbtSubject')) S('cbtSubject').textContent = toText(cbt.subject || 'General');
  if (S('cbtSubjectInitial')) S('cbtSubjectInitial').textContent = (cbt.subject || 'G')[0].toUpperCase();

  const selected = cbt.answers[cbt.i];
  const correct = getCorrectIndex(q);
  const reveal = cbt.submitted || cbt.reviewMode;

  const optsWrap = S('cbtOptions');
  if (optsWrap) {
    optsWrap.innerHTML = (q.opts || []).map((opt, idx) => {
      const isSelected = selected === idx;
      const isCorrect = idx === correct;

      let btnClass = 'border-slate-100 dark:border-slate-800 hover:border-brand-200 dark:hover:border-brand-800 hover:bg-slate-50 dark:hover:bg-slate-800/50';
      let iconClass = 'bg-slate-100 dark:bg-slate-800 text-slate-500';

      if (reveal) {
        if (isCorrect) {
          btnClass = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.1)]';
          iconClass = 'bg-emerald-500 text-white';
        } else if (isSelected) {
          btnClass = 'border-rose-500 bg-rose-50 dark:bg-rose-900/20 text-rose-900 dark:text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.1)]';
          iconClass = 'bg-rose-500 text-white';
        }
      } else if (isSelected) {
        btnClass = 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-900 dark:text-brand-100 shadow-[0_0_20px_rgba(124,58,237,0.1)] scale-[1.02]';
        iconClass = 'bg-brand-600 text-white';
      }

      return `
        <button onclick="window.selectCbtOption(${idx})" class="w-full text-left p-6 rounded-3xl border-2 transition-all duration-300 flex items-center gap-6 group/opt ${btnClass}">
          <div class="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm transition-all duration-300 group-hover/opt:scale-110 ${iconClass}">${String.fromCharCode(65 + idx)}</div>
          <span class="font-bold text-lg">${escapeHTML(opt)}</span>
          ${reveal && isCorrect ? '<i data-lucide="check-circle" class="w-6 h-6 text-emerald-500 ml-auto"></i>' : ''}
          ${reveal && isSelected && !isCorrect ? '<i data-lucide="x-circle" class="w-6 h-6 text-rose-500 ml-auto"></i>' : ''}
        </button>
      `;
    }).join('');
  }

  const expWrap = S('cbtExplanationWrap');
  const expText = S('cbtExplanationText');
  const exp = toText(q?.exp || '').trim();
  if (expWrap) expWrap.classList.toggle('hidden', !(reveal && exp));
  if (expText) expText.textContent = reveal ? exp : '';

  if (S('prevQuestion')) S('prevQuestion').disabled = cbt.i === 0;
  if (S('nextQuestion')) S('nextQuestion').classList.toggle('hidden', cbt.i === cbt.questions.length - 1);
  if (S('submitExam')) S('submitExam').classList.toggle('hidden', cbt.i !== cbt.questions.length - 1);

  const progress = Math.round(((cbt.i + 1) / cbt.questions.length) * 100);
  if (S('cbtProgressBar')) S('cbtProgressBar').style.width = `${progress}%`;
  if (S('cbtProgressText')) S('cbtProgressText').textContent = `Progress: ${progress}%`;
  if (S('cbtProgressMeta')) S('cbtProgressMeta').textContent = `Question ${cbt.i + 1}/${cbt.questions.length}`;

  updateFlagUI();
  refreshIcons();
}

function renderQuestionMap() {
  const map = S('questionMap');
  if (!map) return;
  map.innerHTML = cbt.questions.map((_, idx) => `
    <button onclick="window.jumpToCbtQuestion(${idx})" class="aspect-square rounded-xl border-2 flex items-center justify-center font-black text-xs transition-all ${
      cbt.i === idx
        ? 'border-brand-500 bg-brand-50 text-brand-600'
        : cbt.answers[idx] !== null && cbt.answers[idx] !== undefined
          ? 'bg-emerald-500 border-emerald-500 text-white'
          : 'border-slate-100 dark:border-slate-800 text-slate-400'
    } ${cbt.flags[idx] ? 'ring-2 ring-amber-400/60' : ''}">
      ${idx + 1}
    </button>
  `).join('');
}

function updateFlagUI() {
  const count = cbt.flags.filter(Boolean).length;
  const wrap = S('cbtFlagCountWrap');
  if (wrap) wrap.classList.toggle('hidden', count === 0);
  if (S('cbtFlagCount')) S('cbtFlagCount').textContent = String(count);

  const btn = S('cbtFlagBtn');
  if (btn) {
    const active = !!cbt.flags[cbt.i];
    btn.classList.toggle('bg-amber-100', active);
    btn.classList.toggle('text-amber-700', active);
    btn.classList.toggle('dark:bg-amber-900/30', active);
    btn.classList.toggle('dark:text-amber-200', active);
  }
}

function updatePauseUI() {
  const btn = S('cbtPauseBtn');
  if (!btn) return;
  btn.innerHTML = cbt.paused
    ? '<i data-lucide="play" class="w-6 h-6"></i>'
    : '<i data-lucide="pause" class="w-6 h-6"></i>';
  btn.title = cbt.paused ? 'Resume' : 'Pause';
  refreshIcons();
}

// --- Modals ---
function setModalOpen(id, open) {
  const modal = S(id);
  if (!modal) return;
  modal.classList.toggle('hidden', !open);
  modal.classList.toggle('flex', !!open);
  if (open) refreshIcons();
}

// --- Actions (exposed for the inline onclick handlers rendered above) ---
window.selectCbtOption = (idx) => {
  if (cbt.submitted || cbt.reviewMode) {
    toast('Review mode is on. Tap Done to start a new exam.', 'info');
    return;
  }
  cbt.answers[cbt.i] = idx;
  renderQuestion();
  renderQuestionMap();
};

window.jumpToCbtQuestion = (idx) => {
  cbt.i = idx;
  renderQuestion();
  renderQuestionMap();
};

function goNext() {
  if (cbt.i < cbt.questions.length - 1) {
    cbt.i++;
    renderQuestion();
    renderQuestionMap();
  }
}

function goPrev() {
  if (cbt.i > 0) {
    cbt.i--;
    renderQuestion();
    renderQuestionMap();
  }
}

function togglePause() {
  if (cbt.submitted) return;
  cbt.paused = !cbt.paused;
  if (cbt.paused) {
    toast('Exam paused', 'info');
  } else {
    startTimer(handleTimeoutSubmit);
    toast('Exam resumed', 'success');
  }
  updatePauseUI();
}

function toggleFlag() {
  if (cbt.submitted) return;
  cbt.flags[cbt.i] = !cbt.flags[cbt.i];
  updateFlagUI();
  renderQuestionMap();
}

function abandonExam() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
  exitExamFullscreen();
  window.location.href = getAppEntryUrl();
}

function computeResult() {
  const total = cbt.questions.length;
  let correctCount = 0, wrongCount = 0, unanswered = 0;
  for (let i = 0; i < total; i++) {
    const ans = cbt.answers[i];
    const correct = getCorrectIndex(cbt.questions[i]);
    if (ans === null || ans === undefined) unanswered++;
    else if (ans === correct) correctCount++;
    else wrongCount++;
  }
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const usedSec = Math.max(0, (cbt.durationSec || 1800) - (Number(cbt.timeLeft) || 0));
  return { total, correctCount, wrongCount, unanswered, pct, usedSec };
}

function handleTimeoutSubmit() {
  if (cbt.submitted) return;
  toast("Time's up! Submitting your exam...", 'warning');
  finishExam();
}

function openSubmitConfirm() {
  const total = cbt.questions.length;
  const answered = cbt.answers.filter(a => a !== null && a !== undefined).length;
  const flaggedCount = cbt.flags.filter(Boolean).length;
  if (S('cbtSubmitUnansweredCount')) S('cbtSubmitUnansweredCount').textContent = String(total - answered);
  if (S('cbtSubmitFlaggedCount')) S('cbtSubmitFlaggedCount').textContent = String(flaggedCount);
  setModalOpen('cbtSubmitConfirmModal', true);
}

function finishExam() {
  if (cbt.submitted) return;
  cbt.submitted = true;
  cbt.reviewMode = false;
  if (cbt.timer) clearInterval(cbt.timer);
  cbt.timer = null;

  setModalOpen('cbtSubmitConfirmModal', false);
  exitExamFullscreen();

  if (window.confetti) {
    window.confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#7c3aed', '#4f46e5', '#06b6d4', '#10b981']
    });
  }

  const result = computeResult();
  if (S('cbtScorePct')) S('cbtScorePct').textContent = `${result.pct}%`;
  if (S('cbtScoreFrac')) S('cbtScoreFrac').textContent = `${result.correctCount}/${result.total}`;
  if (S('cbtWrong')) S('cbtWrong').textContent = String(result.wrongCount);
  if (S('cbtUnanswered')) S('cbtUnanswered').textContent = String(result.unanswered);
  if (S('cbtTimeUsed')) S('cbtTimeUsed').textContent = formatMMSS(result.usedSec);

  cbt.lastResult = result;

  // The session's job is done — clear it so a stray refresh doesn't
  // silently restart the same exam from scratch mid-review.
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }

  setModalOpen('cbtResultModal', true);
  renderQuestion();
  renderQuestionMap();
}

function reviewAnswers() {
  cbt.reviewMode = true;
  setModalOpen('cbtResultModal', false);
  renderQuestion();
  renderQuestionMap();
  toast('Review mode: correct answers are highlighted', 'success');
}

function finishAndReturn() {
  const result = cbt.lastResult || computeResult();
  const sid = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const params = new URLSearchParams({
    cbtSid: sid,
    cbtScore: String(result.pct),
    cbtCorrect: String(result.correctCount),
    cbtTotal: String(result.total),
    cbtSubject: cbt.subject || 'General'
  });
  window.location.href = `${getAppEntryUrl()}?${params.toString()}`;
}

// --- Wire up buttons (unobtrusive — cbt.htm ships with no inline onclick
// attributes except the ones rendered dynamically above) ---
function bindControls() {
  if (S('cbtPauseBtn')) S('cbtPauseBtn').onclick = togglePause;
  if (S('cbtFlagBtn')) S('cbtFlagBtn').onclick = toggleFlag;
  if (S('cbtExitBtn')) S('cbtExitBtn').onclick = () => setModalOpen('cbtExitConfirmModal', true);
  if (S('cbtExitCancelBtn')) S('cbtExitCancelBtn').onclick = () => setModalOpen('cbtExitConfirmModal', false);
  if (S('cbtExitConfirmBtn')) S('cbtExitConfirmBtn').onclick = abandonExam;

  if (S('prevQuestion')) S('prevQuestion').onclick = goPrev;
  if (S('nextQuestion')) S('nextQuestion').onclick = goNext;
  if (S('submitExam')) S('submitExam').onclick = openSubmitConfirm;

  if (S('cbtSubmitCancelBtn')) S('cbtSubmitCancelBtn').onclick = () => setModalOpen('cbtSubmitConfirmModal', false);
  if (S('cbtSubmitConfirmBtn')) S('cbtSubmitConfirmBtn').onclick = finishExam;

  if (S('cbtSubmitConfirmCloseBtn')) S('cbtSubmitConfirmCloseBtn').onclick = () => setModalOpen('cbtSubmitConfirmModal', false);
  if (S('cbtReviewBtn')) S('cbtReviewBtn').onclick = reviewAnswers;
  if (S('cbtDoneBtn')) S('cbtDoneBtn').onclick = finishAndReturn;

  // Re-enter fullscreen if the user taps back into the exam after
  // dismissing it (Esc, swipe-down, etc.)
  document.addEventListener('click', () => {
    if (!cbt.submitted && cbt.questions.length && !getFullscreenEl()) requestExamFullscreen();
  }, { once: false });
}

function showLoadFailure() {
  if (S('cbtLoadingState')) {
    S('cbtLoadingState').innerHTML = `
      <div class="w-16 h-16 rounded-full bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center text-rose-500">
        <i data-lucide="alert-triangle" class="w-8 h-8"></i>
      </div>
      <p class="text-sm font-black uppercase tracking-widest text-slate-400">No active exam found</p>
      <button id="cbtBackToAppBtn" class="mt-2 px-8 py-4 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest">Back to Geo-Books</button>
    `;
    refreshIcons();
    const btn = S('cbtBackToAppBtn');
    if (btn) btn.onclick = () => { window.location.href = getAppEntryUrl(); };
  }
}

function init() {
  let raw = null;
  try {
    raw = sessionStorage.getItem(SESSION_KEY);
  } catch (e) {
    console.error('Could not read CBT session:', e);
  }

  if (!raw) {
    showLoadFailure();
    return;
  }

  let session;
  try {
    session = JSON.parse(raw);
  } catch (e) {
    console.error('Malformed CBT session payload:', e);
    showLoadFailure();
    return;
  }

  if (!Array.isArray(session.questions) || session.questions.length === 0) {
    showLoadFailure();
    return;
  }

  cbt.subject = session.subject || 'General';
  cbt.examType = session.examType || 'GENERAL';
  cbt.questions = session.questions.map(q => ({ ...q, correct: Number.isInteger(q.correct) ? q.correct : q.a }));
  cbt.answers = new Array(cbt.questions.length).fill(null);
  cbt.flags = new Array(cbt.questions.length).fill(false);
  cbt.i = 0;
  cbt.durationSec = Number(session.durationSec) || 1800;
  cbt.timeLeft = cbt.durationSec;
  cbt.paused = false;
  cbt.submitted = false;
  cbt.reviewMode = false;

  bindControls();

  if (S('cbtLoadingState')) S('cbtLoadingState').classList.add('hidden');
  if (S('cbtExamArea')) S('cbtExamArea').classList.remove('hidden');

  requestExamFullscreen();
  startTimer(handleTimeoutSubmit);
  renderQuestion();
  renderQuestionMap();
  updatePauseUI();
}

document.addEventListener('DOMContentLoaded', init);
