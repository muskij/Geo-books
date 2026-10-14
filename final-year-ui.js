// Final Year (browser side): SIWES logbook + report builder, and the project coach.
// Server half: final-year.js (owner-only storage, AI budget). Reference formatting: final-year-cite.js (no AI).
import { getApps } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import { STYLES, TYPES, formatCitation, plain, sortRefs } from './final-year-cite.js';

const SECTION_ID = 'finalYear';
const DRAFT_KEY = 'gbFyDraft_v1';
const API_BASE = window.GEO_BOOKS_API_URL || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3007' : '');
const KINDS = { survey: 'Survey or questionnaire study', experiment: 'Experimental or laboratory study', design: 'Design, build or software project', review: 'Literature or systematic review', case: 'Case study' };
const SECTIONS = { abstract: 'Abstract', introduction: 'Introduction / background', problem: 'Statement of the problem', literature: 'Literature review', methodology: 'Methodology', results: 'Results and discussion', conclusion: 'Conclusion and recommendations', other: 'Other section' };
const TOOLS = [['topics', 'Topic ideas'], ['outline', 'Chapter plan'], ['feedback', 'Draft feedback'], ['cite', 'Citations'], ['viva', 'Viva practice']];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg, type) => { try { if (typeof window.toast === 'function') return window.toast(msg, type); } catch (e) { /* ignore */ } const t = document.createElement('div'); t.textContent = msg; t.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:12px 18px;border-radius:14px;font-weight:700;font-size:14px;z-index:9999;max-width:90vw'; document.body.appendChild(t); setTimeout(() => t.remove(), 3800); };

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
const send = (method, path, body) => api('/api/final-year' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const get = (path) => api('/api/final-year' + path);

// ---------- dates (calendar days as "YYYY-MM-DD"; arithmetic in UTC so time zones cannot shift a day) ----------
const DAY = 86400000;
const pDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const localToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const weekOf = (start, day) => Math.floor((pDay(day) - pDay(start)) / (7 * DAY)) + 1;
const fmtDay = (s) => new Date(pDay(s)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtShort = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtLong = (s) => new Date(pDay(s)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const CSS = `
.fy{max-width:720px;margin:0 auto;padding:16px 16px 130px;color:#0f172a}
.fy h2{font-size:26px;font-weight:900;letter-spacing:-.02em}
.fy h3{font-size:17px;font-weight:900;margin:0 0 6px}
.fy h4{font-size:15.5px;font-weight:800;margin:14px 0 4px}
.fy h5{font-size:14.5px;font-weight:800;margin:12px 0 3px}
.fy p{margin:0}
.fy-lead{font-size:14px;font-weight:600;color:#64748b;margin:4px 0 14px!important}
.fy-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:16px;background:#eef2f7;margin-bottom:14px}
.fy-tabs button{min-height:44px;border-radius:12px;border:0;background:transparent;font-weight:800;font-size:14.5px;color:#64748b;cursor:pointer}
.fy-tabs button.on{background:#fff;color:#4a3bd9;box-shadow:0 1px 4px rgba(15,23,42,.1)}
.fy-card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;padding:16px;margin-bottom:12px}
.fy-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:14px;border:1.5px solid #e2e8f0;background:#fff;color:#334155;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit}
.fy-btn:active{transform:scale(.97)}.fy-btn[disabled]{opacity:.55;cursor:not-allowed}
.fy-main{background:#5b4cf0;border-color:#5b4cf0;color:#fff}
.fy-wide{width:100%;margin-top:8px}
.fy-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fy-link{background:none;border:0;padding:6px 8px;font-weight:800;font-size:13px;color:#5b4cf0;cursor:pointer;font-family:inherit}
.fy-del{color:#e11d48}
.fy-small{font-size:12.5px;font-weight:600;color:#94a3b8;line-height:1.45}
.fy-l{display:block;margin-bottom:10px}.fy-l>span{display:block;font-size:12.5px;font-weight:800;color:#475569;margin-bottom:4px}
.fy input:not([type=checkbox]),.fy textarea,.fy select{width:100%;box-sizing:border-box;min-height:46px;border-radius:12px;border:1px solid #e2e8f0;background:#f8fafc;padding:10px 12px;font-size:16px;font-weight:600;outline:none;font-family:inherit;color:#0f172a;line-height:1.45}
.fy textarea{resize:vertical}
.fy input:focus,.fy textarea:focus,.fy select:focus{border-color:#5b4cf0;background:#fff}
.fy-check{display:flex;align-items:center;gap:10px;margin:2px 0 12px;font-size:14px;font-weight:700;color:#475569}.fy-check input{width:20px;height:20px}
.fy-count{text-align:right;font-size:12px;font-weight:700;color:#94a3b8;margin-top:-6px;margin-bottom:6px}
.fy-quota{height:8px;border-radius:99px;background:#e2e8f0;overflow:hidden;margin:2px 0 4px}.fy-quota i{display:block;height:100%;background:#5b4cf0;border-radius:99px}
.fy-hero b{font-size:17px;font-weight:900;display:block;overflow-wrap:anywhere}.fy-hero span.fy-sub{font-size:13px;font-weight:600;color:#94a3b8;overflow-wrap:anywhere}
.fy-hero-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.fy-hero-top>div{min-width:0}
.fy-big{font-size:34px;font-weight:900;letter-spacing:-.03em;margin:8px 0 2px}
.fy-note{background:#fffbeb;color:#92400e;border-radius:16px;padding:12px 14px;font-size:13.5px;font-weight:700;margin:0 0 12px}
.fy-note p{font-weight:600;margin-top:2px}
.fy-info{background:#f1f0ff;color:#3b30b8;border-radius:16px;padding:12px 14px;font-size:13.5px;font-weight:700;margin:0 0 12px}
.fy-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.fy-chip{min-height:38px;padding:0 12px;border-radius:99px;border:1.5px solid #e2e8f0;background:#fff;font-weight:800;font-size:13px;color:#334155;cursor:pointer;font-family:inherit}
.fy-chip.on{background:#5b4cf0;border-color:#5b4cf0;color:#fff}
.fy-chip.amber{border-color:#fcd34d;background:#fffbeb;color:#92400e}
.fy-h{font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:18px 0 8px}
.fy-week{background:#fff;border:1px solid #e2e8f0;border-radius:18px;margin-bottom:8px;overflow:hidden}
.fy-week-h{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;padding:14px;cursor:pointer;font-family:inherit;font-size:14.5px;color:inherit}
.fy-week-h b{font-weight:900}.fy-week-h .fy-small{white-space:nowrap}
.fy-week-b{padding:0 14px 14px}
.fy-entry{border-top:1px solid #eef2f7;padding:10px 0}
.fy-entry-h{display:flex;justify-content:space-between;align-items:center;gap:6px}.fy-entry-h b{font-size:13.5px;font-weight:900;color:#4a3bd9}
.fy-entry p,.fy-sum p,.fy-res p,.fy-res li{font-size:14.5px;line-height:1.55;font-weight:500;overflow-wrap:anywhere}
.fy-sum{background:#f8fafc;border-radius:14px;padding:12px;margin-top:10px}.fy-sum b{font-size:12px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#5b4cf0}
.fy-skills{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.fy-skills span{font-size:11.5px;font-weight:800;color:#4a3bd9;background:#f1f0ff;border-radius:99px;padding:3px 9px}
.fy-res{margin-top:14px;border-top:1px solid #eef2f7;padding-top:6px}
.fy-res ul{padding-left:20px;margin:4px 0}.fy-res li{margin:3px 0}
.fy-lab{font-size:11.5px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#5b4cf0;margin:10px 0 2px}
.fy-topic{border:1px solid #e2e8f0;border-radius:16px;padding:12px;margin-top:10px}
.fy-todo{background:#fffbeb;border-radius:12px;padding:8px 12px;margin-top:6px;font-size:13.5px;font-weight:700;color:#92400e}
.fy-todo ul{margin:2px 0 0;padding-left:18px}.fy-todo li{font-weight:600}
.fy-draft{background:#f8fafc;border-radius:12px;padding:10px 12px;margin-top:6px}
.fy-quote{border-left:3px solid #fbbf24;background:#fffbeb;border-radius:0 10px 10px 0;padding:6px 10px;font-size:13.5px;font-style:italic;margin-bottom:4px;overflow-wrap:anywhere}
.fy-issue{border:1px solid #e2e8f0;border-radius:14px;padding:10px 12px;margin-top:8px}
.fy-score{display:flex;gap:5px;margin:6px 0}.fy-score i{width:26px;height:8px;border-radius:99px;background:#e2e8f0}.fy-score i.on{background:#059669}.fy-score.mid i.on{background:#d97706}.fy-score.low i.on{background:#e11d48}
.fy-prev{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:14px;padding:12px;font-size:14.5px;line-height:1.55;font-weight:500;overflow-wrap:anywhere;min-height:24px}
.fy-ref{display:flex;gap:8px;align-items:flex-start;border-top:1px solid #eef2f7;padding:10px 0;font-size:14px;line-height:1.5}.fy-ref>span{flex:1;min-width:0;overflow-wrap:anywhere}
.fy-q{font-size:16px;font-weight:800;line-height:1.4;margin:6px 0 10px}
.fy-badge{display:inline-block;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;border-radius:99px;padding:3px 9px;background:#eef2f7;color:#475569}
.fy-empty{text-align:center;padding:30px 18px;border:1.5px dashed #cbd5e1;border-radius:22px;background:#fff}
.fy-empty h3{font-size:17px;font-weight:900}.fy-empty p{font-size:13px;font-weight:600;color:#94a3b8;margin-top:6px}
html.dark .fy{color:#e2e8f0}
html.dark .fy-card,html.dark .fy-btn,html.dark .fy-week,html.dark .fy-empty,html.dark .fy-chip,html.dark .fy-tabs button.on{background:#0f172a;border-color:#1e293b;color:#e2e8f0}
html.dark .fy-tabs{background:#0b1220}
html.dark .fy input:not([type=checkbox]),html.dark .fy textarea,html.dark .fy select{background:#0b1220;border-color:#1e293b;color:#e2e8f0}
html.dark .fy-sum,html.dark .fy-draft,html.dark .fy-prev{background:#0b1220}
html.dark .fy-info{background:#1b1a45;color:#c7c2ff}html.dark .fy-note,html.dark .fy-todo,html.dark .fy-quote{background:#2a2110;color:#fde68a}
html.dark .fy-entry,html.dark .fy-ref,html.dark .fy-res,html.dark .fy-topic,html.dark .fy-issue{border-color:#1e293b}
html.dark .fy-main{color:#fff}`;

// ---------- state ----------
const S = {
  tab: 'siwes', siwesView: 'home', loaded: false, loading: false, loadedAt: 0, authErr: false, loadErr: '',
  quota: null, siwes: { profile: null, weekly: {}, report: null, entries: [] }, project: null,
  entry: { date: '', stage: 'write', skills: [], needsDetail: '', existing: false },
  open: {}, openNow: {}, editWeek: 0, busy: '', tool: '', scrollTo: '',
  topicsRes: null, outlineRes: null, feedbackRes: null, viva: { questions: [], idx: 0, answers: {}, grades: {} },
};
const F = {}; // every form field lives here so a repaint never loses typed text

const root = () => document.getElementById(SECTION_ID);
const v = (k) => esc(F[k] == null ? '' : F[k]);
function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }
function saveDraft(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) { /* storage blocked */ } }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }

function paint(html) {
  const el = root(); if (!el) return;
  el.innerHTML = '<style>' + CSS + '</style><div class="fy">' + html + '</div>';
  if (window.lucide && window.lucide.createIcons) { try { window.lucide.createIcons(); } catch (e) { /* ignore */ } }
  if (S.scrollTo) { const t = el.querySelector('#' + S.scrollTo); S.scrollTo = ''; if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

const btn = (act, label, o = {}) => '<button type="button" class="fy-btn' + (o.main ? ' fy-main' : '') + (o.wide ? ' fy-wide' : '') + (o.cls ? ' ' + o.cls : '') + '" data-fy="' + act + '"' + (o.attrs || '') + (S.busy || o.disabled ? ' disabled' : '') + '>' + (S.busy === (o.key || act) ? esc(o.busy || 'Working…') : label) + '</button>';
const link = (act, label, attrs, cls) => '<button type="button" class="fy-link' + (cls ? ' ' + cls : '') + '" data-fy="' + act + '"' + (attrs || '') + (S.busy ? ' disabled' : '') + '>' + label + '</button>';
const field = (label, inner) => '<label class="fy-l"><span>' + label + '</span>' + inner + '</label>';
const text = (key, o = {}) => '<input data-bind="' + key + '" value="' + v(key) + '"' + (o.type ? ' type="' + o.type + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.extra || '') + '>';
const area = (key, o = {}) => '<textarea data-bind="' + key + '" rows="' + (o.rows || 4) + '"' + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.count ? ' data-count="' + o.count + '"' : '') + '>' + v(key) + '</textarea>' + (o.count ? '<div class="fy-count" id="' + o.count + '">' + String((F[key] || '').length) + '/' + o.max + '</div>' : '');
const select = (key, options, cur) => '<select data-bind="' + key + '">' + options.map(([val, label]) => '<option value="' + esc(val) + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select>';
const paras = (s) => String(s || '').split(/\n{2,}/).map((x) => '<p>' + esc(x).replace(/\n/g, '<br>') + '</p>').join('');
const italics = (s) => esc(s).replace(/\*(.+?)\*/g, '<i>$1</i>');
const copyBtn = (kind, attrs) => '<button type="button" class="fy-link" data-fy="' + kind + '"' + (attrs || '') + '>Copy</button>';

async function copyText(t, okMsg) {
  try { await navigator.clipboard.writeText(t); toast(okMsg || 'Copied.', 'success'); return; } catch (e) { /* fall back */ }
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(okMsg || 'Copied.', 'success'); } catch (e) { toast('Could not copy. Select the text and copy it by hand.', 'error'); }
}

// ---------- shared header ----------
function header() {
  const q = S.quota;
  let quota = '';
  if (q && !S.authErr) {
    quota = q.unlimited ? '<p class="fy-small" style="margin:-4px 0 12px">AI actions: unlimited (admin).</p>'
      : '<div style="margin:-4px 0 12px"><div class="fy-quota"><i style="width:' + Math.min(100, Math.round((q.used / q.cap) * 100)) + '%"></i></div><p class="fy-small">AI actions today: ' + q.used + ' of ' + q.cap + '. Saving, editing and citations never use them. They reset every day.</p></div>';
  }
  return '<h2>Final Year</h2><p class="fy-lead">Your SIWES logbook and your project, with an AI coach that checks and explains. It never invents your work.</p>' +
    '<div class="fy-tabs" role="tablist"><button type="button" role="tab" aria-selected="' + (S.tab === 'siwes') + '" class="' + (S.tab === 'siwes' ? 'on' : '') + '" data-fy="tab" data-tab="siwes">SIWES logbook</button>' +
    '<button type="button" role="tab" aria-selected="' + (S.tab === 'project') + '" class="' + (S.tab === 'project' ? 'on' : '') + '" data-fy="tab" data-tab="project">Project coach</button></div>' + quota;
}

function render() {
  let body;
  if (S.loading && !S.loaded) body = '<p class="fy-small">Loading…</p>';
  else if (S.authErr) body = '<div class="fy-empty"><h3>Sign in to use this</h3><p>Your logbook and project are saved to your account.</p><button type="button" class="fy-btn" data-fy="reload" style="margin-top:12px">Try again</button></div>';
  else if (S.loadErr && !S.loaded) body = '<div class="fy-empty"><h3>Could not load</h3><p>' + esc(S.loadErr) + '</p><button type="button" class="fy-btn" data-fy="reload" style="margin-top:12px">Try again</button></div>';
  else if (S.tab === 'siwes') body = S.siwesView === 'setup' ? setupHtml() : S.siwesView === 'entry' ? entryHtml() : siwesHomeHtml();
  else body = projectHtml();
  paint(header() + body);
}

// =====================================================================================
// SIWES
// =====================================================================================
function setupHtml() {
  const editing = !!S.siwes.profile;
  return '<div class="fy-card"><h3>' + (editing ? 'Your placement' : 'Where are you doing your SIWES?') + '</h3><p class="fy-small" style="margin-bottom:12px">Week 1 starts on your start date. Your supervisor still signs your paper logbook. This helps you write the entries.</p>' +
    field('Company or organisation', text('sCompany', { max: 120, ph: 'e.g. Acme Networks Ltd' })) +
    field('Your unit or department there (optional)', text('sUnit', { max: 120 })) +
    field('Your course', text('sCourse', { max: 100, ph: 'e.g. Computer Science' })) +
    '<div class="fy-row">' + field('Start date', text('sStart', { type: 'date' })) + field('Planned weeks (optional)', text('sWeeks', { type: 'number', extra: ' min="1" max="60" inputmode="numeric"' })) + '</div>' +
    btn('profile-save', editing ? 'Save changes' : 'Save and start', { main: true, wide: true, busy: 'Saving…' }) +
    (editing ? btn('profile-cancel', 'Cancel', { wide: true }) : '') + '</div>';
}

function missingDays() {
  const p = S.siwes.profile; if (!p) return [];
  const have = new Set(S.siwes.entries.map((e) => e.date));
  const today = pDay(localToday()); const start = pDay(p.startDate); const out = [];
  for (let t = today - DAY; t >= Math.max(start, today - 27 * DAY) && out.length < 8; t -= DAY) {
    const dow = new Date(t).getUTCDay(); if (dow === 0 || dow === 6) continue;
    if (!have.has(iso(t))) out.push(iso(t));
  }
  return out;
}

function siwesHomeHtml() {
  const p = S.siwes.profile;
  if (!p) return setupHtml();
  const entries = S.siwes.entries; const today = localToday();
  const cw = weekOf(p.startDate, today);
  const started = cw >= 1;
  const have = entries.find((e) => e.date === today);
  const missing = missingDays();
  let h = '<div class="fy-card fy-hero"><div class="fy-hero-top"><div><b>' + esc(p.company) + '</b><span class="fy-sub">' + esc([p.unit, p.course].filter(Boolean).join(' · ')) + '</span></div>' + link('profile-edit', 'Edit') + '</div>';
  if (started) {
    h += '<div class="fy-big">Week ' + cw + (p.weeks ? '<span style="font-size:16px;font-weight:700;color:#94a3b8"> of ' + p.weeks + '</span>' : '') + '</div>';
    if (p.weeks) h += '<div class="fy-quota"><i style="width:' + Math.min(100, Math.round((cw / p.weeks) * 100)) + '%"></i></div>';
    h += '<p class="fy-small">' + entries.length + ' ' + (entries.length === 1 ? 'entry' : 'entries') + ' saved</p>';
    h += btn('entry-new', have ? 'Edit today’s entry' : 'Write today’s entry', { main: true, wide: true });
  } else {
    h += '<p class="fy-small" style="margin-top:8px">Your placement starts on ' + esc(fmtLong(p.startDate)) + '. You can write entries from that day.</p>';
  }
  h += '</div>';
  if (missing.length) {
    h += '<div class="fy-note"><b>' + missing.length + (missing.length === 8 ? '+' : '') + ' recent weekday' + (missing.length === 1 ? '' : 's') + ' without an entry</b><p>Tap a day to write it. Skip days you did not work.</p><div class="fy-chips">' +
      missing.map((d) => '<button type="button" class="fy-chip amber" data-fy="entry-day" data-date="' + esc(d) + '"' + (S.busy ? ' disabled' : '') + '>' + esc(fmtDay(d)) + '</button>').join('') + '</div></div>';
  }
  h += weeksHtml(p, entries, cw);
  h += reportHtml(p, entries);
  return h;
}

function weeksHtml(p, entries, cw) {
  const byWeek = {};
  entries.forEach((e) => { const w = weekOf(p.startDate, e.date); (byWeek[w] = byWeek[w] || []).push(e); });
  if (cw >= 1 && !byWeek[cw]) byWeek[cw] = [];
  const nums = Object.keys(byWeek).map(Number).sort((a, b) => b - a);
  if (!nums.length) return '<h3 class="fy-h">Your weeks</h3><div class="fy-empty"><h3>No entries yet</h3><p>Write today’s entry. It takes about a minute.</p></div>';
  const latest = nums.find((w) => byWeek[w].length) || nums[0];
  let h = '<h3 class="fy-h">Your weeks</h3>';
  nums.forEach((w) => {
    const list = byWeek[w].slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const open = S.open[w] !== undefined ? S.open[w] : (w === cw || w === latest);
    S.openNow[w] = open;
    const startMs = pDay(p.startDate) + (w - 1) * 7 * DAY;
    h += '<div class="fy-week"><button type="button" class="fy-week-h" data-fy="week-toggle" data-week="' + w + '" aria-expanded="' + open + '"><span><b>Week ' + w + '</b> · ' + esc(fmtShort(startMs)) + ' to ' + esc(fmtShort(startMs + 6 * DAY)) + '</span><span class="fy-small">' + list.length + (list.length === 1 ? ' entry' : ' entries') + '</span></button>';
    if (open) {
      h += '<div class="fy-week-b">';
      if (!list.length) h += '<p class="fy-small">Nothing saved for this week yet.</p>';
      list.forEach((e) => {
        h += '<div class="fy-entry"><div class="fy-entry-h"><b>' + esc(fmtDay(e.date)) + '</b><span>' + link('entry-edit', 'Edit', ' data-date="' + esc(e.date) + '"') + link('entry-delete', 'Delete', ' data-date="' + esc(e.date) + '"', 'fy-del') + '</span></div><p>' + esc(e.text) + '</p>' +
          (e.skills.length ? '<div class="fy-skills">' + e.skills.map((s) => '<span>' + esc(s) + '</span>').join('') + '</div>' : '') + '</div>';
      });
      const wk = S.siwes.weekly[String(w)];
      if (S.editWeek === w) {
        h += '<div class="fy-sum"><b>Weekly summary</b>' + area('wk' + w, { rows: 6, max: 2500 }) + '<div class="fy-row">' + btn('week-save', 'Save', { main: true, attrs: ' data-week="' + w + '"', busy: 'Saving…' }) + btn('week-cancel', 'Cancel') + '</div></div>';
      } else if (wk && wk.summary) {
        h += '<div class="fy-sum"><b>Weekly summary</b><p style="margin-top:4px">' + esc(wk.summary) + '</p><div style="margin-top:4px">' + link('week-edit', 'Edit', ' data-week="' + w + '"') + link('week-summary', S.busy === 'week-summary:' + w ? 'Working…' : 'Rewrite with AI', ' data-week="' + w + '"') + '</div></div>';
      } else if (list.length >= 2) {
        h += btn('week-summary', 'Write the weekly summary', { wide: true, attrs: ' data-week="' + w + '"', key: 'week-summary:' + w, busy: 'Writing…' });
      } else if (list.length) {
        h += '<p class="fy-small" style="margin-top:8px">Save 2 or more days to get a weekly summary.</p>';
      }
      if (list.length) h += '<div style="margin-top:6px">' + copyBtn('week-copy', ' data-week="' + w + '"') + ' <span class="fy-small">Copy this week to write into your paper logbook.</span></div>';
      h += '</div>';
    }
    h += '</div>';
  });
  return h;
}

function reportHtml(p, entries) {
  const r = S.siwes.report; const n = entries.length;
  let h = '<h3 class="fy-h">SIWES report</h3><div class="fy-card"><h3>Report builder</h3><p class="fy-small" style="margin-bottom:12px">Builds a chapter outline with drafts written only from your entries and from what you type here. Anything missing is marked “To add”. Add what you know about the company:</p>' +
    field('About the company (history, what it does)', area('ciAbout', { rows: 3, max: 1500 })) +
    field('Products or services', area('ciServices', { rows: 2, max: 1500 })) +
    field('Structure and departments', area('ciStructure', { rows: 2, max: 1500 })) +
    btn('report-build', r ? 'Build the report again (3 AI actions)' : 'Build my report outline (3 AI actions)', { main: true, wide: true, busy: 'Building… this takes up to a minute', disabled: n < 5 }) +
    (n < 5 ? '<p class="fy-small" style="margin-top:6px">Save at least 5 daily entries first. You have ' + n + '.</p>' : '');
  if (r) {
    h += '<div class="fy-res" id="fyReport"><h4 style="margin-top:8px">' + esc(r.title) + '</h4><p class="fy-small">Built from ' + (r.entryCount || n) + ' entries' + (r.generatedAtMs ? ' on ' + esc(new Date(r.generatedAtMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : '') + '. Check every fact and follow your department’s SIWES guide.</p>';
    r.chapters.forEach((c) => {
      h += '<h4>Chapter ' + c.number + ': ' + esc(c.title) + '</h4>';
      c.sections.forEach((s) => {
        h += '<h5>' + esc(s.heading) + '</h5>';
        if (s.draft) h += '<div class="fy-draft">' + paras(s.draft) + '</div>';
        if (s.todo.length) h += '<div class="fy-todo">To add:<ul>' + s.todo.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></div>';
      });
    });
    if (r.notes.length) h += '<div class="fy-info" style="margin-top:12px">' + r.notes.map((x) => esc(x)).join('<br>') + '</div>';
    h += '<div style="margin-top:8px">' + copyBtn('report-copy') + '</div></div>';
  }
  return h + '</div>';
}

function reportText(r) {
  const out = ['SIWES REPORT: ' + r.title, ''];
  r.chapters.forEach((c) => {
    out.push('CHAPTER ' + c.number + ': ' + c.title.toUpperCase(), '');
    c.sections.forEach((s) => { out.push(s.heading); if (s.draft) out.push(s.draft); s.todo.forEach((t) => out.push('[TO ADD: ' + t + ']')); out.push(''); });
  });
  return out.join('\n').trim();
}
function weekText(w) {
  const p = S.siwes.profile; const list = S.siwes.entries.filter((e) => weekOf(p.startDate, e.date) === w);
  const startMs = pDay(p.startDate) + (w - 1) * 7 * DAY;
  const out = ['WEEK ' + w + ' (' + fmtShort(startMs) + ' to ' + fmtShort(startMs + 6 * DAY) + ')', ''];
  list.forEach((e) => out.push(fmtDay(e.date) + ': ' + e.text, ''));
  const wk = S.siwes.weekly[String(w)]; if (wk && wk.summary) out.push('Weekly summary: ' + wk.summary);
  return out.join('\n').trim();
}

// ----- entry editor -----
function openEntry(date) {
  const ex = S.siwes.entries.find((e) => e.date === date);
  const d = loadDraft();
  S.entry = { date, existing: !!ex, skills: ex ? ex.skills.slice() : [], needsDetail: '', stage: 'write' };
  F.eRaw = ''; F.eText = '';
  if (ex) { F.eText = ex.text; S.entry.stage = 'review'; } else if (d && d.date === date) { F.eRaw = d.raw || ''; F.eText = d.text || ''; S.entry.stage = d.stage === 'review' && F.eText ? 'review' : 'write'; }
  S.siwesView = 'entry'; render();
}
const keepDraft = () => saveDraft({ date: S.entry.date, raw: F.eRaw || '', text: F.eText || '', stage: S.entry.stage });

function entryHtml() {
  const p = S.siwes.profile; const e = S.entry;
  const w = weekOf(p.startDate, e.date);
  const dateOk = pDay(e.date) >= pDay(p.startDate);
  let h = btn('entry-cancel', '← Back', { attrs: ' style="margin-bottom:10px"' }) + '<div class="fy-card"><h3>Logbook entry</h3>' +
    field('Date', '<input type="date" data-change="entry-date" data-bind="eDate" value="' + esc(e.date) + '" min="' + esc(p.startDate) + '" max="' + esc(localToday()) + '">') +
    '<p class="fy-small" style="margin:-4px 0 12px">' + (dateOk ? 'Week ' + w + ', ' + esc(fmtLong(e.date)) : 'This date is before your start date.') + '</p>';
  if (e.stage === 'write') {
    h += field('What did you do today?', area('eRaw', { rows: 6, max: 1500, count: 'eCount', ph: 'e.g. Helped Mr Tunde set up the new router, tested 12 cables, he showed me how to crimp RJ45 connectors' })) +
      '<p class="fy-small">Rough notes are fine. Say what you did, with what or with whom, and what you learned. You can speak with the microphone on your keyboard. The AI only uses what you write and will not add tasks you did not mention.</p>' +
      btn('entry-polish', 'Write my entry', { main: true, wide: true, busy: 'Writing…', disabled: (F.eRaw || '').trim().length < 15 }) +
      btn('entry-manual', 'I will write it myself', { wide: true });
  } else {
    if (e.needsDetail) h += '<div class="fy-note"><b>Add more detail</b><p>' + esc(e.needsDetail) + '</p></div>';
    h += field('Your logbook entry (edit anything)', area('eText', { rows: 8, max: 2500, count: 'eCount' }));
    if (e.skills.length) h += '<div class="fy-skills" style="margin:-4px 0 10px">' + e.skills.map((s) => '<span>' + esc(s) + '</span>').join('') + '</div>';
    h += '<p class="fy-small">Check it says exactly what you did. Your supervisor signs the paper logbook, so only keep what is true.</p>' +
      btn('entry-save', 'Save entry', { main: true, wide: true, busy: 'Saving…', disabled: !dateOk }) +
      btn('entry-back', 'Back to my notes', { wide: true }) +
      (e.existing ? '<button type="button" class="fy-btn fy-wide fy-del" data-fy="entry-delete" data-date="' + esc(e.date) + '"' + (S.busy ? ' disabled' : '') + '>Delete this entry</button>' : '');
  }
  return h + '</div>';
}

// ----- SIWES actions -----
async function saveProfile() {
  const out = await send('PUT', '/siwes/profile', { company: F.sCompany, unit: F.sUnit, course: F.sCourse, startDate: F.sStart, weeks: F.sWeeks });
  S.siwes.profile = out.profile; S.siwes.weekly = out.weekly || {}; S.siwes.report = out.report || null;
  fillFromProfile();
  S.siwesView = 'home';
  if (out.cleared) toast('Start date changed, so the weekly summaries and report were cleared. Your entries are safe.', 'info'); else toast('Saved.', 'success');
}
function fillFromProfile() {
  const p = S.siwes.profile; if (!p) return;
  F.sCompany = p.company; F.sUnit = p.unit || ''; F.sCourse = p.course || ''; F.sStart = p.startDate; F.sWeeks = p.weeks || '';
  const ci = p.companyInfo || {}; if (F.ciAbout == null) F.ciAbout = ci.about || ''; if (F.ciServices == null) F.ciServices = ci.services || ''; if (F.ciStructure == null) F.ciStructure = ci.structure || '';
}
const upsertEntry = (e) => { const list = S.siwes.entries.filter((x) => x.date !== e.date); list.push(e); list.sort((a, b) => (a.date < b.date ? -1 : 1)); S.siwes.entries = list; };

// =====================================================================================
// PROJECT COACH
// =====================================================================================
function projectHtml() {
  let h = '<div class="fy-card"><h3>Your project</h3><div class="fy-info">This coach explains, questions and checks. It will not write your chapters. Your supervisor and examiners will test you on your own work, and many schools check for AI-written text.</div>' +
    field('Department or field', text('pDept', { max: 80, ph: 'e.g. Computer Science' })) +
    field('Project type', select('pKind', [['', 'Choose one']].concat(Object.entries(KINDS)), F.pKind || '')) +
    field('Topic (add it when you have one)', text('pTopic', { max: 250 })) +
    field('Objectives or research questions (optional)', area('pObj', { rows: 3, max: 1200 })) +
    btn('proj-save', 'Save', { main: true, wide: true, busy: 'Saving…' }) + '</div>';
  h += '<div class="fy-chips" style="margin:0 0 12px">' + TOOLS.map(([k, label]) => '<button type="button" class="fy-chip' + (S.tool === k ? ' on' : '') + '" data-fy="tool" data-tool="' + k + '"' + (S.busy ? ' disabled' : '') + '>' + label + '</button>').join('') + '</div>';
  if (S.tool === 'topics') h += topicsHtml(); else if (S.tool === 'outline') h += outlineHtml(); else if (S.tool === 'feedback') h += feedbackHtml(); else if (S.tool === 'cite') h += citeHtml(); else if (S.tool === 'viva') h += vivaHtml();
  else h += '<div class="fy-empty"><h3>Pick a tool</h3><p>Start with Topic ideas if you have no topic yet.</p></div>';
  return h;
}

const when = (ms) => (ms ? ' <span class="fy-small">Saved ' + esc(new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) + '</span>' : '');

function topicsHtml() {
  const res = S.topicsRes || (S.project && S.project.results && S.project.results.topics) || null;
  let h = '<div class="fy-card"><h3>Topic ideas</h3><p class="fy-small" style="margin-bottom:12px">Tell the coach what interests you. It suggests narrow topics you can finish in one year.</p>' +
    field('Area you are interested in', text('tInterest', { max: 300, ph: 'e.g. solar power for small shops' })) +
    field('Limits (optional)', text('tConstraints', { max: 300, ph: 'e.g. no lab access, one semester for data' })) +
    btn('topics-run', 'Suggest topics', { main: true, wide: true, busy: 'Thinking…' });
  if (res && res.topics) {
    h += '<div class="fy-res" id="fyRes"><p class="fy-small">' + res.topics.length + ' suggestions' + when(res.atMs) + '. Check each one with your supervisor.</p>';
    res.topics.forEach((t, i) => {
      h += '<div class="fy-topic"><h4 style="margin-top:0">' + esc(t.title) + '</h4>' +
        (t.why ? '<div class="fy-lab">Why it matters</div><p>' + esc(t.why) + '</p>' : '') + (t.scope ? '<div class="fy-lab">Scope</div><p>' + esc(t.scope) + '</p>' : '') +
        (t.data ? '<div class="fy-lab">Getting data</div><p>' + esc(t.data) + '</p>' : '') + (t.risk ? '<div class="fy-lab">Main risk</div><p>' + esc(t.risk) + '</p>' : '') +
        (t.questions.length ? '<div class="fy-lab">Possible research questions</div><ul>' + t.questions.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ul>' : '') +
        btn('topic-use', 'Use this topic', { wide: true, attrs: ' data-i="' + i + '"', busy: 'Saving…' }) + '</div>';
    });
    h += '</div>';
  }
  return h + '</div>';
}

function outlineHtml() {
  const res = S.outlineRes || (S.project && S.project.results && S.project.results.outline) || null;
  let h = '<div class="fy-card"><h3>Chapter plan</h3><p class="fy-small" style="margin-bottom:12px">A plan for what each chapter must do, with the mistakes students usually make. It does not write the chapters.</p>' +
    (F.pTopic ? '<div class="fy-info">Topic: ' + esc(F.pTopic) + '</div>' : '<div class="fy-note">Add your topic above first.</div>') +
    btn('outline-run', res ? 'Build the plan again' : 'Build my chapter plan', { main: true, wide: true, busy: 'Planning…' });
  if (res && res.chapters) {
    h += '<div class="fy-res" id="fyRes">' + when(res.atMs);
    res.chapters.forEach((c, i) => {
      h += '<h4>' + (i + 1) + '. ' + esc(c.title) + '</h4>' + (c.purpose ? '<p>' + esc(c.purpose) + '</p>' : '') +
        (c.sections.length ? '<div class="fy-lab">What goes in it</div><ul>' + c.sections.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '') +
        (c.mistakes.length ? '<div class="fy-todo">Common mistakes:<ul>' + c.mistakes.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul></div>' : '');
    });
    if (res.supervisorTips && res.supervisorTips.length) h += '<div class="fy-info" style="margin-top:12px"><b>Tips</b><br>' + res.supervisorTips.map((t) => esc(t)).join('<br>') + '</div>';
    h += '</div>';
  }
  return h + '</div>';
}

function feedbackHtml() {
  const r = S.feedbackRes;
  let h = '<div class="fy-card"><h3>Draft feedback</h3><p class="fy-small" style="margin-bottom:12px">Paste one section you wrote. You get a list of problems and how to fix them. It will not rewrite your work.</p>' +
    field('Which section is it?', select('fSection', Object.entries(SECTIONS), F.fSection || 'introduction')) +
    field('Your text', area('fText', { rows: 9, max: 4000, count: 'fCount', ph: 'Paste a paragraph or a section here' })) +
    btn('feedback-run', 'Get feedback', { main: true, wide: true, busy: 'Reading your draft…', disabled: (F.fText || '').trim().length < 80 });
  if (r) {
    h += '<div class="fy-res" id="fyRes"><p>' + esc(r.overall) + '</p>';
    if (r.strengths.length) h += '<div class="fy-lab">Working well</div><ul>' + r.strengths.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>';
    if (r.issues.length) h += '<div class="fy-lab">To fix</div>' + r.issues.map((i) => '<div class="fy-issue">' + (i.quote ? '<div class="fy-quote">' + esc(i.quote) + '</div>' : '') + '<p><b>' + esc(i.problem) + '</b></p>' + (i.fix ? '<p>' + esc(i.fix) + '</p>' : '') + '</div>').join('');
    if (r.needsCitation.length) h += '<div class="fy-lab">Needs a source</div><ul>' + r.needsCitation.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    if (r.rewriteExample) h += '<div class="fy-lab">One sentence, clearer</div><div class="fy-quote">' + esc(r.rewriteExample.before) + '</div><p>' + esc(r.rewriteExample.after) + '</p>';
    if (r.supervisorQuestions.length) h += '<div class="fy-lab">Questions your supervisor may ask</div><ul>' + r.supervisorQuestions.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ul>';
    h += '<p class="fy-small" style="margin-top:10px">The AI can be wrong. Use your own judgement and your supervisor’s advice.</p></div>';
  }
  return h + '</div>';
}

// ----- citations (no AI) -----
const citeStyle = () => (STYLES[F.cStyle] ? F.cStyle : 'apa');
const citeType = () => (TYPES[F.cType] ? F.cType : 'journal');
function citeInput() { const o = {}; TYPES[citeType()].fields.forEach((f) => { o[f.key] = F['cf_' + f.key]; }); return o; }
function citePreview() {
  const r = formatCitation(citeStyle(), citeType(), citeInput());
  return { r, html: r.text ? italics(r.text) : '<span class="fy-small">Your reference appears here as you type.</span>' };
}
function citeHtml() {
  const spec = TYPES[citeType()]; const { r, html } = citePreview();
  const refs = (S.project && S.project.refs) || [];
  let h = '<div class="fy-card"><h3>Citations</h3><p class="fy-small" style="margin-bottom:12px">Type what is on the source. The reference is formatted for you, and nothing is made up. Schools differ, so check your department’s guide.</p>' +
    '<div class="fy-row">' + field('Style', select('cStyle', Object.entries(STYLES), citeStyle())) + field('Source type', select('cType', Object.entries(TYPES).map(([k, t]) => [k, t.label]), citeType())) + '</div>';
  spec.fields.forEach((f) => {
    const key = 'cf_' + f.key;
    if (f.kind === 'check') h += '<label class="fy-check"><input type="checkbox" data-bind="' + key + '"' + (F[key] ? ' checked' : '') + '>' + esc(f.label) + '</label>';
    else if (f.kind === 'area') h += field(esc(f.label) + (f.required ? ' *' : ''), '<textarea data-bind="' + key + '" rows="3" placeholder="' + esc(f.placeholder || '') + '">' + v(key) + '</textarea>');
    else if (f.kind === 'select') h += field(esc(f.label), select(key, f.options.map((o) => [o.value, o.label]), F[key] || f.options[0].value));
    else h += field(esc(f.label) + (f.required ? ' *' : ''), text(key, { max: 300, ph: f.placeholder }));
  });
  h += '<div class="fy-lab">Preview</div><div class="fy-prev" id="fyCitePrev">' + html + '</div><p class="fy-small" id="fyCiteMiss" style="margin-top:6px">' + (r.text && r.missing.length ? 'Still missing: ' + esc(r.missing.join(', ')) : '') + '</p>' +
    '<div class="fy-row"><button type="button" class="fy-btn fy-main" data-fy="cite-add" id="fyCiteAdd"' + (r.text && !S.busy ? '' : ' disabled') + '>Add to my list</button><button type="button" class="fy-btn" data-fy="cite-copy-preview">Copy</button></div>' +
    '<p class="fy-small" style="margin-top:6px">Titles are shown in italics here. When you paste into Word, italicise the title (and the journal name) yourself.</p></div>';
  h += '<h3 class="fy-h">My reference list (' + refs.length + ')</h3>';
  if (!refs.length) h += '<div class="fy-empty"><h3>No references yet</h3><p>Add a source above. The list is kept in A to Z order and saved to your account.</p></div>';
  else {
    h += '<div class="fy-card">' + refs.map((x, i) => '<div class="fy-ref"><span>' + italics(x) + '</span><span style="flex:none">' + link('cite-copy', 'Copy', ' data-i="' + i + '"') + link('cite-remove', 'Remove', ' data-i="' + i + '"', 'fy-del') + '</span></div>').join('') +
      '<button type="button" class="fy-btn fy-wide" data-fy="cite-copy-all"' + (S.busy ? ' disabled' : '') + '>Copy the whole list</button></div>';
  }
  return h;
}

// ----- viva -----
function vivaHtml() {
  const V = S.viva; const qs = V.questions;
  let h = '<div class="fy-card"><h3>Viva practice</h3>';
  if (!qs.length) {
    h += '<p class="fy-small" style="margin-bottom:12px">Get 8 questions an examiner could ask about your project, then answer each one and get feedback. Say your answer out loud first, then type the main points.</p>' +
      (F.pTopic ? '<div class="fy-info">Topic: ' + esc(F.pTopic) + '</div>' : '<div class="fy-note">Add your topic above first.</div>') +
      btn('viva-start', 'Get my questions', { main: true, wide: true, busy: 'Writing questions…' });
    return h + '</div>';
  }
  const q = qs[V.idx]; const g = V.grades[V.idx];
  h += '<div class="fy-chips" style="margin:0 0 10px">' + qs.map((_, i) => { const gr = V.grades[i]; return '<button type="button" class="fy-chip' + (i === V.idx ? ' on' : '') + (gr && i !== V.idx ? ' amber' : '') + '" data-fy="viva-goto" data-i="' + i + '"' + (S.busy ? ' disabled' : '') + '>' + (i + 1) + (gr ? ' · ' + gr.score + '/5' : '') + '</button>'; }).join('') + '</div>' +
    '<span class="fy-badge">' + esc(q.level) + '</span><div class="fy-q">' + esc(q.q) + '</div>' +
    field('Your answer', area('vAnswer', { rows: 6, max: 1500, count: 'vCount', ph: 'Type the main points of your answer' })) +
    btn('viva-check', g ? 'Check this answer again' : 'Check my answer', { main: true, wide: true, busy: 'Checking…', disabled: (F.vAnswer || '').trim().length < 10 });
  if (g) {
    const cls = g.score >= 4 ? '' : g.score === 3 ? ' mid' : ' low';
    h += '<div class="fy-res" id="fyRes"><div class="fy-score' + cls + '">' + [1, 2, 3, 4, 5].map((n) => '<i class="' + (n <= g.score ? 'on' : '') + '"></i>').join('') + '</div><p><b>' + g.score + ' out of 5</b></p>' +
      (g.good ? '<div class="fy-lab">Good</div><p>' + esc(g.good) + '</p>' : '') + (g.missing ? '<div class="fy-lab">Still missing</div><p>' + esc(g.missing) + '</p>' : '') +
      (g.points.length ? '<div class="fy-lab">A strong answer covers</div><ul>' + g.points.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') +
      (q.why ? '<p class="fy-small" style="margin-top:8px">The examiner is testing: ' + esc(q.why) + '</p>' : '') + '</div>';
  }
  h += '<div class="fy-row" style="margin-top:10px">' + btn('viva-prev', '← Previous', { disabled: V.idx === 0 }) + btn('viva-next', 'Next →', { disabled: V.idx === qs.length - 1 }) + '</div>' +
    '<button type="button" class="fy-btn fy-wide" data-fy="viva-reset"' + (S.busy ? ' disabled' : '') + '>Start again with new questions</button>';
  return h + '</div>';
}

// ----- project actions -----
const projectFormValues = () => ({ department: F.pDept || '', kind: F.pKind || '', topic: F.pTopic || '', objectives: F.pObj || '' });
function fillFromProject() {
  const p = S.project || {};
  F.pDept = p.department || ''; F.pKind = p.kind || ''; F.pTopic = p.topic || ''; F.pObj = p.objectives || '';
}
async function saveProject() {
  const out = await send('PUT', '/project', { ...projectFormValues(), refs: (S.project && S.project.refs) || [] });
  S.project = out.project; fillFromProject();
}
async function ensureProjectSaved() {
  const p = S.project || {}; const f = projectFormValues();
  if (!S.project || f.department !== (p.department || '') || f.kind !== (p.kind || '') || f.topic !== (p.topic || '') || f.objectives !== (p.objectives || '')) await saveProject();
}
async function coach(mode, extra) {
  await ensureProjectSaved();
  return send('POST', '/coach', { mode, ...projectFormValues(), ...extra });
}

// =====================================================================================
// plumbing
// =====================================================================================
async function refreshQuota() { try { S.quota = await get('/quota'); } catch (e) { /* ignore */ } }
function handleErr(e) {
  if (e && e.code === 'auth') { S.authErr = true; return; }
  if (e && e.body && e.body.quota) S.quota = { used: e.body.used, cap: e.body.cap, unlimited: false };
  toast((e && e.message) || 'Something went wrong.', 'error');
}
// Runs one action with a busy flag. AI actions refresh the quota afterwards.
async function run(key, fn, o = {}) {
  if (S.busy) return;
  S.busy = key; render();
  try { await fn(); if (o.ai) await refreshQuota(); } catch (e) { handleErr(e); } finally { S.busy = ''; render(); }
}

async function loadAll(quiet) {
  if (S.loading) return;
  S.loading = true; S.loadErr = ''; if (!quiet) render();
  try {
    const [sw, pr, q] = await Promise.all([get('/siwes'), get('/project'), get('/quota')]);
    S.siwes = { profile: sw.profile, weekly: sw.weekly || {}, report: sw.report || null, entries: (sw.entries || []).map((e) => ({ ...e, skills: e.skills || [] })) };
    S.project = pr.project ? { ...pr.project, refs: pr.project.refs || [], results: pr.project.results || {} } : null;
    S.quota = q; S.authErr = false; S.loaded = true; S.loadedAt = Date.now();
    if (!S.siwes.profile) S.siwesView = 'setup'; else if (S.siwesView === 'setup' && !F.__editing) S.siwesView = 'home';
    fillFromProfile(); if (F.pDept == null) fillFromProject();
    if (!F.sStart) F.sStart = localToday();
  } catch (e) { if (e.code === 'auth') S.authErr = true; else S.loadErr = e.message || 'Could not load.'; } finally { S.loading = false; render(); }
}

// ---------- events ----------
async function onClick(ev) {
  const t = ev.target.closest ? ev.target.closest('[data-fy]') : null; if (!t || t.disabled) return;
  const act = t.getAttribute('data-fy'); const date = t.getAttribute('data-date'); const wk = Number(t.getAttribute('data-week')); const i = Number(t.getAttribute('data-i'));
  const p = S.siwes.profile;
  try {
    switch (act) {
      case 'tab': S.tab = t.getAttribute('data-tab'); return render();
      case 'reload': return loadAll();
      case 'profile-edit': fillFromProfile(); F.__editing = true; S.siwesView = 'setup'; return render();
      case 'profile-cancel': F.__editing = false; fillFromProfile(); S.siwesView = 'home'; return render();
      case 'profile-save': return run('profile-save', async () => { await saveProfile(); F.__editing = false; });
      case 'entry-new': return openEntry(localToday());
      case 'entry-day': return openEntry(date);
      case 'entry-edit': return openEntry(date);
      case 'entry-cancel': keepDraft(); S.siwesView = 'home'; return render();
      case 'entry-manual': S.entry.stage = 'review'; F.eText = F.eText || F.eRaw || ''; S.entry.needsDetail = ''; keepDraft(); return render();
      case 'entry-back': S.entry.stage = 'write'; keepDraft(); return render();
      case 'entry-polish': return run('entry-polish', async () => {
        const out = await send('POST', '/siwes/polish', { date: S.entry.date, raw: F.eRaw });
        F.eText = out.text; S.entry.skills = out.skills || []; S.entry.needsDetail = out.needsDetail || ''; S.entry.stage = 'review'; keepDraft();
      }, { ai: true });
      case 'entry-save': return run('entry-save', async () => {
        const out = await send('PUT', '/siwes/entry', { date: S.entry.date, text: F.eText, skills: S.entry.skills });
        upsertEntry({ date: out.entry.date, text: out.entry.text, skills: out.entry.skills || [] });
        clearDraft(); S.siwesView = 'home'; S.open[out.week] = true;
        toast('Saved. Week ' + out.week + ', ' + fmtDay(out.entry.date) + '.', 'success');
      });
      case 'entry-delete': {
        if (!window.confirm('Delete this entry for good?')) return;
        return run('entry-delete', async () => {
          await send('DELETE', '/siwes/entry/' + encodeURIComponent(date));
          S.siwes.entries = S.siwes.entries.filter((e) => e.date !== date);
          const d = loadDraft(); if (d && d.date === date) clearDraft();
          S.siwesView = 'home'; toast('Deleted.', 'success');
        });
      }
      case 'week-toggle': S.open[wk] = !S.openNow[wk]; return render();
      case 'week-summary': return run('week-summary:' + wk, async () => {
        const out = await send('POST', '/siwes/week-summary', { week: wk });
        S.siwes.weekly[String(wk)] = { summary: out.summary, skills: out.skills || [] };
      }, { ai: true });
      case 'week-edit': F['wk' + wk] = (S.siwes.weekly[String(wk)] || {}).summary || ''; S.editWeek = wk; return render();
      case 'week-cancel': S.editWeek = 0; return render();
      case 'week-save': return run('week-save', async () => {
        const out = await send('PUT', '/siwes/week-summary', { week: wk, summary: F['wk' + wk] });
        if (out.summary) S.siwes.weekly[String(wk)] = { ...(S.siwes.weekly[String(wk)] || {}), summary: out.summary }; else delete S.siwes.weekly[String(wk)];
        S.editWeek = 0;
      });
      case 'week-copy': return copyText(weekText(wk), 'Week copied.');
      case 'report-build': return run('report-build', async () => {
        const out0 = await send('PUT', '/siwes/profile', { companyInfo: { about: F.ciAbout || '', services: F.ciServices || '', structure: F.ciStructure || '' } });
        S.siwes.profile = out0.profile;
        const out = await send('POST', '/siwes/report');
        S.siwes.report = out.report; S.scrollTo = 'fyReport';
      }, { ai: true });
      case 'report-copy': return copyText(reportText(S.siwes.report), 'Report copied.');

      case 'tool': S.tool = t.getAttribute('data-tool'); return render();
      case 'proj-save': return run('proj-save', async () => { await saveProject(); toast('Saved.', 'success'); });
      case 'topics-run': return run('topics-run', async () => { S.topicsRes = await coach('topics', { interest: F.tInterest, constraints: F.tConstraints }); S.scrollTo = 'fyRes'; }, { ai: true });
      case 'topic-use': return run('topic-use', async () => {
        const res = S.topicsRes || (S.project && S.project.results && S.project.results.topics); const tp = res && res.topics[i]; if (!tp) return;
        F.pTopic = tp.title;
        const qs = tp.questions.filter((q) => !(F.pObj || '').includes(q));
        if (qs.length) F.pObj = ((F.pObj || '').trim() ? F.pObj.trim() + '\n' : '') + qs.join('\n');
        await saveProject(); toast('Saved as your topic.', 'success');
      });
      case 'outline-run': return run('outline-run', async () => { S.outlineRes = await coach('outline', {}); S.scrollTo = 'fyRes'; }, { ai: true });
      case 'feedback-run': return run('feedback-run', async () => { S.feedbackRes = await coach('feedback', { section: F.fSection || 'introduction', text: F.fText }); S.scrollTo = 'fyRes'; }, { ai: true });
      case 'cite-add': {
        const r = formatCitation(citeStyle(), citeType(), citeInput()); if (!r.text) return;
        if (r.missing.length && !window.confirm('Still missing: ' + r.missing.join(', ') + '. Add it anyway?')) return;
        return run('cite-add', async () => {
          S.project = S.project || { refs: [], results: {} };
          S.project.refs = sortRefs([...new Set([...(S.project.refs || []), r.text])]);
          await saveProject();
          TYPES[citeType()].fields.forEach((f) => { delete F['cf_' + f.key]; });
          toast('Added to your list.', 'success');
        });
      }
      case 'cite-copy-preview': { const r = formatCitation(citeStyle(), citeType(), citeInput()); if (!r.text) return toast('Type the source details first.', 'info'); return copyText(plain(r.text), 'Reference copied.'); }
      case 'cite-copy': return copyText(plain(S.project.refs[i]), 'Reference copied.');
      case 'cite-copy-all': return copyText(S.project.refs.map(plain).join('\n\n'), 'Reference list copied.');
      case 'cite-remove': return run('cite-remove', async () => { S.project.refs = S.project.refs.filter((_, k) => k !== i); await saveProject(); });
      case 'viva-start': return run('viva-start', async () => { const out = await coach('viva_questions', {}); S.viva = { questions: out.questions, idx: 0, answers: {}, grades: {} }; F.vAnswer = ''; }, { ai: true });
      case 'viva-goto': case 'viva-prev': case 'viva-next': {
        const n = act === 'viva-goto' ? i : S.viva.idx + (act === 'viva-next' ? 1 : -1);
        if (n < 0 || n >= S.viva.questions.length) return;
        S.viva.answers[S.viva.idx] = F.vAnswer || ''; S.viva.idx = n; F.vAnswer = S.viva.answers[n] || ''; return render();
      }
      case 'viva-check': return run('viva-check', async () => {
        const q = S.viva.questions[S.viva.idx]; S.viva.answers[S.viva.idx] = F.vAnswer;
        S.viva.grades[S.viva.idx] = await coach('viva_grade', { question: q.q, answer: F.vAnswer }); S.scrollTo = 'fyRes';
      }, { ai: true });
      case 'viva-reset': if (!window.confirm('Start again? Your answers and scores will be cleared.')) return; S.viva = { questions: [], idx: 0, answers: {}, grades: {} }; F.vAnswer = ''; return render();
      default: return undefined;
    }
  } catch (e) { handleErr(e); render(); }
}

function onInput(ev) {
  const t = ev.target; const key = t.getAttribute && t.getAttribute('data-bind'); if (!key) return;
  F[key] = t.type === 'checkbox' ? t.checked : t.value;
  const cnt = t.getAttribute('data-count');
  if (cnt) { const c = document.getElementById(cnt); if (c) c.textContent = t.value.length + '/' + (t.getAttribute('maxlength') || ''); }
  if (key === 'eRaw' || key === 'eText') keepDraft();
  // Buttons that depend on how much is typed
  if (key === 'eRaw') { const b = root().querySelector('[data-fy="entry-polish"]'); if (b) b.disabled = !!S.busy || t.value.trim().length < 15; }
  if (key === 'fText') { const b = root().querySelector('[data-fy="feedback-run"]'); if (b) b.disabled = !!S.busy || t.value.trim().length < 80; }
  if (key === 'vAnswer') { const b = root().querySelector('[data-fy="viva-check"]'); if (b) b.disabled = !!S.busy || t.value.trim().length < 10; }
  if (key.startsWith('cf_')) { // live reference preview without repainting (keeps the keyboard open)
    const { r, html } = citePreview();
    const pv = document.getElementById('fyCitePrev'); if (pv) pv.innerHTML = html;
    const ms = document.getElementById('fyCiteMiss'); if (ms) ms.textContent = r.text && r.missing.length ? 'Still missing: ' + r.missing.join(', ') : '';
    const ad = document.getElementById('fyCiteAdd'); if (ad) ad.disabled = !r.text || !!S.busy;
  }
}

function onChange(ev) {
  const t = ev.target; const key = t.getAttribute && t.getAttribute('data-bind'); if (!key) return;
  if (t.getAttribute('data-change') === 'entry-date') {
    const d = t.value; const p = S.siwes.profile;
    if (!d || !(pDay(d) >= pDay(p.startDate)) || pDay(d) > pDay(localToday()) + DAY) { toast('Choose a day between your start date and today.', 'info'); t.value = S.entry.date; return; }
    const ex = S.siwes.entries.find((e) => e.date === d);
    if (ex) { openEntry(d); toast('Showing the entry you already saved for that day.', 'info'); return; }
    if (S.entry.existing) { openEntry(d); return; } // never carry a saved entry's text onto another day
    S.entry.date = d; S.entry.existing = false; keepDraft(); render(); return;
  }
  if (t.tagName === 'SELECT' && (key === 'cStyle' || key === 'cType')) { F[key] = t.value; render(); return; }
  if (t.tagName === 'SELECT') F[key] = t.value;
}

function boot() {
  const el = root(); if (!el) return;
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  const open = () => { if (!S.loaded) loadAll(); else if (Date.now() - S.loadedAt > 120000 && S.siwesView !== 'entry') loadAll(true); else render(); };
  new MutationObserver(() => { if (!el.classList.contains('hidden') && !el.dataset.ready) { el.dataset.ready = '1'; open(); } else if (el.classList.contains('hidden')) { el.dataset.ready = ''; } })
    .observe(el, { attributes: true, attributeFilter: ['class'] });
  if (!el.classList.contains('hidden')) { el.dataset.ready = '1'; open(); }
}

window.__finalYearTest = { S, F };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
