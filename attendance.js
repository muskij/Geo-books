// Attendance tracker (University Life). Replaces the old Assessments tab.
// Data lives on this device (localStorage), like the department filter, so it needs no
// Firestore rule changes. It never leaves the phone.
(function () {
  'use strict';
  var KEY = 'geoBooksAttendance_v1';
  var SECTION_ID = 'universityAttendance';

  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.courses)) return d;
    } catch (e) { /* ignore */ }
    return { courses: [] };
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* storage blocked */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // Pure maths, kept separate so it can be tested.
  function stats(c) {
    var req = clamp(Number(c.req) || 75, 50, 95) / 100;
    var held = c.log.length;
    var att = c.log.filter(function (x) { return x.p; }).length;
    var pct = held ? (att / held) * 100 : null;
    var planned = Number(c.planned) > 0 ? Math.floor(Number(c.planned)) : 0;
    var out = { held: held, att: att, pct: pct, reqPct: Math.round(req * 100), tone: 'none', advice: '' };
    if (!held) { out.advice = 'Log your first class to start tracking.'; return out; }
    if (planned) {
      var remaining = Math.max(planned - held, 0);
      var neededTotal = Math.ceil(req * planned - 1e-9);
      var stillNeed = Math.max(neededTotal - att, 0);
      if (stillNeed > remaining) {
        out.tone = 'bad';
        out.advice = 'Even if you attend every remaining class (' + remaining + '), you will finish below ' + out.reqPct + '%. Speak to your course adviser early.';
        return out;
      }
      var canMissPlanned = remaining - stillNeed;
      out.tone = pct < out.reqPct ? 'bad' : (canMissPlanned <= 1 ? 'warn' : 'good');
      out.advice = stillNeed
        ? 'Attend at least ' + stillNeed + ' of the remaining ' + remaining + ' classes. You can miss ' + canMissPlanned + '.'
        : 'You have already secured ' + out.reqPct + '% of the semester. Keep going.';
      return out;
    }
    if (pct >= out.reqPct) {
      var canMiss = Math.max(Math.floor(att / req - held + 1e-9), 0);
      out.tone = canMiss <= 1 ? 'warn' : 'good';
      out.advice = canMiss === 0
        ? 'You are right on the line. Do not miss the next class.'
        : 'You can miss ' + canMiss + ' more class' + (canMiss === 1 ? '' : 'es') + ' and stay above ' + out.reqPct + '%.';
    } else {
      var need = Math.ceil((req * held - att) / (1 - req) - 1e-9);
      out.tone = 'bad';
      out.advice = 'Attend the next ' + need + ' class' + (need === 1 ? '' : 'es') + ' in a row to get back to ' + out.reqPct + '%.';
    }
    return out;
  }

  var CSS = '' +
    '.at{max-width:720px;margin:0 auto;padding:16px 16px 120px}' +
    '.at h2{font-size:26px;font-weight:900;letter-spacing:-.02em}' +
    '.at-lead{font-size:14px;font-weight:600;color:#64748b;margin-top:4px}' +
    '.at-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}' +
    '.at-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 18px;border-radius:14px;border:1.5px solid #e2e8f0;background:#fff;color:#334155;font-weight:800;font-size:14px;cursor:pointer}' +
    '.at-btn:active{transform:scale(.97)}' +
    '.at-main{background:#5b4cf0;border-color:#5b4cf0;color:#fff}' +
    '.at-btn svg{width:18px;height:18px}' +
    '.at-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}' +
    '.at-sum div{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:12px;text-align:center}' +
    '.at-sum b{display:block;font-size:22px;font-weight:900}' +
    '.at-sum span{font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em}' +
    '.at-form{background:#fff;border:1.5px solid #5b4cf0;border-radius:22px;padding:16px;margin-bottom:16px;display:grid;gap:10px}' +
    '.at-form label{font-size:12px;font-weight:800;color:#475569;display:grid;gap:4px}' +
    '.at-form input{min-height:46px;border-radius:12px;border:1px solid #e2e8f0;background:#f8fafc;padding:0 12px;font-size:16px;font-weight:600;outline:none;width:100%;box-sizing:border-box}' +
    '.at-form input:focus{border-color:#5b4cf0;background:#fff}' +
    '.at-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
    '.at-hint{font-size:12px;font-weight:600;color:#94a3b8}' +
    '.at-card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;padding:16px;margin-bottom:12px;animation:atIn .25s ease-out both}' +
    '@keyframes atIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '.at-head{display:flex;align-items:center;gap:14px}' +
    '.at-ring{--p:0;--c:#94a3b8;flex:none;width:68px;height:68px;border-radius:50%;background:conic-gradient(var(--c) calc(var(--p)*1%),#e2e8f0 0);display:flex;align-items:center;justify-content:center;position:relative}' +
    '.at-ring::after{content:"";position:absolute;inset:7px;border-radius:50%;background:#fff}' +
    '.at-ring b{position:relative;z-index:1;font-size:15px;font-weight:900}' +
    '.at-good{--c:#059669}.at-warn{--c:#d97706}.at-bad{--c:#e11d48}' +
    '.at-title{min-width:0;flex:1}' +
    '.at-title strong{display:block;font-size:17px;font-weight:900;overflow-wrap:anywhere}' +
    '.at-title span{font-size:12px;font-weight:700;color:#94a3b8}' +
    '.at-advice{margin:12px 0;padding:10px 12px;border-radius:14px;font-size:13.5px;font-weight:700;line-height:1.45;background:#f1f5f9;color:#334155}' +
    '.at-advice.at-good{background:#ecfdf5;color:#065f46}.at-advice.at-warn{background:#fffbeb;color:#92400e}.at-advice.at-bad{background:#fff1f2;color:#9f1239}' +
    '.at-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '.at-yes{background:#059669;border-color:#059669;color:#fff}.at-no{background:#fff;border-color:#fecdd3;color:#e11d48}' +
    '.at-foot{display:flex;gap:16px;margin-top:12px}' +
    '.at-link{background:none;border:0;padding:6px 0;font-size:13px;font-weight:800;color:#64748b;cursor:pointer}' +
    '.at-link.at-del{color:#e11d48}' +
    '.at-empty{text-align:center;padding:36px 20px;border:1.5px dashed #cbd5e1;border-radius:22px;background:#fff}' +
    '.at-empty h3{font-size:18px;font-weight:900}.at-empty p{font-size:13px;font-weight:600;color:#94a3b8;margin:6px 0 16px}' +
    '.at-note{font-size:12px;font-weight:600;color:#94a3b8;text-align:center;margin-top:18px}' +
    'html.dark .at-btn,html.dark .at-sum div,html.dark .at-card,html.dark .at-form,html.dark .at-empty{background:#0f172a;border-color:#1e293b;color:#e2e8f0}' +
    'html.dark .at-ring::after{background:#0f172a}html.dark .at-form input{background:#0b1220;border-color:#1e293b;color:#e2e8f0}' +
    'html.dark .at-main,html.dark .at-yes{color:#fff}html.dark .at-advice{background:#1e293b;color:#cbd5e1}' +
    '@media (prefers-reduced-motion:reduce){.at-card{animation:none}}';

  var formOpen = false;

  function render() {
    var el = document.getElementById(SECTION_ID);
    if (!el) return;
    var d = load();
    var rows = d.courses.map(function (c) { return { c: c, s: stats(c) }; });
    var risk = rows.filter(function (r) { return r.s.tone === 'bad'; }).length;
    var tracked = rows.filter(function (r) { return r.s.held > 0; });
    var avg = tracked.length ? Math.round(tracked.reduce(function (a, r) { return a + r.s.pct; }, 0) / tracked.length) : null;

    var html = '<style>' + CSS + '</style><div class="at">' +
      '<div class="at-top"><div><h2>Attendance</h2><p class="at-lead">Track every class and see exactly how many you can still miss.</p></div>' +
      '<button type="button" class="at-btn at-main" data-at="toggle"><i data-lucide="plus"></i>Course</button></div>';

    if (formOpen) {
      html += '<form class="at-form" data-at="form" autocomplete="off">' +
        '<label>Course name<input name="name" maxlength="60" placeholder="e.g. Organic Chemistry" required></label>' +
        '<div class="at-row2"><label>Course code (optional)<input name="code" maxlength="12" placeholder="CHM 201"></label>' +
        '<label>Required %<input name="req" type="number" inputmode="numeric" min="50" max="95" value="75"></label></div>' +
        '<label>Classes planned this semester (optional)<input name="planned" type="number" inputmode="numeric" min="1" max="200" placeholder="e.g. 30"></label>' +
        '<p class="at-hint">Most Nigerian universities require 75% to sit the exam. Check your own department’s rule. Adding planned classes gives a more exact answer.</p>' +
        '<div class="at-row2"><button type="button" class="at-btn" data-at="toggle">Cancel</button><button type="submit" class="at-btn at-main">Save course</button></div></form>';
    }

    if (d.courses.length) {
      html += '<div class="at-sum"><div><b>' + d.courses.length + '</b><span>Courses</span></div><div><b>' + (avg === null ? '–' : avg + '%') + '</b><span>Average</span></div><div><b style="color:' + (risk ? '#e11d48' : '#059669') + '">' + risk + '</b><span>At risk</span></div></div>';
    }

    if (!d.courses.length && !formOpen) {
      html += '<div class="at-empty"><h3>No courses yet</h3><p>Add a course, then tap Present or Absent after each class.</p><button type="button" class="at-btn at-main" data-at="toggle"><i data-lucide="plus"></i>Add your first course</button></div>';
    }

    rows.forEach(function (r) {
      var c = r.c, s = r.s, id = esc(c.id);
      var pctTxt = s.pct === null ? '–' : Math.round(s.pct) + '%';
      html += '<div class="at-card"><div class="at-head">' +
        '<div class="at-ring at-' + s.tone + '" style="--p:' + (s.pct === null ? 0 : Math.round(s.pct)) + '"><b>' + pctTxt + '</b></div>' +
        '<div class="at-title"><strong>' + esc(c.name) + '</strong><span>' + (c.code ? esc(c.code) + ' · ' : '') + s.att + ' of ' + s.held + ' attended · need ' + s.reqPct + '%</span></div></div>' +
        '<p class="at-advice at-' + s.tone + '">' + esc(s.advice) + '</p>' +
        '<div class="at-acts"><button type="button" class="at-btn at-yes" data-at="mark" data-id="' + id + '" data-p="1"><i data-lucide="check"></i>Present</button>' +
        '<button type="button" class="at-btn at-no" data-at="mark" data-id="' + id + '" data-p="0"><i data-lucide="x"></i>Absent</button></div>' +
        '<div class="at-foot"><button type="button" class="at-link" data-at="undo" data-id="' + id + '"' + (s.held ? '' : ' disabled style="opacity:.4"') + '>Undo last</button>' +
        '<button type="button" class="at-link at-del" data-at="del" data-id="' + id + '">Delete course</button></div></div>';
    });

    if (d.courses.length) html += '<p class="at-note">Saved on this phone only. Clearing browser data will erase it.</p>';
    html += '</div>';
    el.innerHTML = html;
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-at]') : null;
    if (!t) return;
    var act = t.getAttribute('data-at');
    if (act === 'form') return;
    var d = load();
    var id = t.getAttribute('data-id');
    var c = d.courses.filter(function (x) { return x.id === id; })[0];
    if (act === 'toggle') { formOpen = !formOpen; render(); return; }
    if (!c) return;
    if (act === 'mark') { c.log.push({ d: new Date().toISOString(), p: t.getAttribute('data-p') === '1' }); save(d); render(); return; }
    if (act === 'undo') { c.log.pop(); save(d); render(); return; }
    if (act === 'del') {
      if (!window.confirm('Delete "' + c.name + '" and its attendance log?')) return;
      d.courses = d.courses.filter(function (x) { return x.id !== id; });
      save(d); render();
    }
  }

  function onSubmit(e) {
    if (e.target.getAttribute && e.target.getAttribute('data-at') !== 'form') return;
    e.preventDefault();
    var f = e.target;
    var name = (f.elements.name.value || '').trim();
    if (!name) return;
    var d = load();
    d.courses.push({
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.slice(0, 60),
      code: (f.elements.code.value || '').trim().slice(0, 12),
      req: clamp(parseInt(f.elements.req.value, 10) || 75, 50, 95),
      planned: clamp(parseInt(f.elements.planned.value, 10) || 0, 0, 200),
      log: []
    });
    save(d);
    formOpen = false;
    render();
  }

  function boot() {
    var el = document.getElementById(SECTION_ID);
    if (!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    new MutationObserver(function () { if (!el.classList.contains('hidden')) render(); })
      .observe(el, { attributes: true, attributeFilter: ['class'] });
    if (!el.classList.contains('hidden')) render();
  }

  window.__attendanceStats = stats; // exposed for tests
  window.renderAttendance = render;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
