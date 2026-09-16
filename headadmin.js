/* ========================================================================
   Starways College – School Operations Dashboard
   Vanilla JavaScript – All rights reserved
   ======================================================================== */

'use strict';

/* ========================================================================
   (A) STORAGE LAYER
   ======================================================================== */
const Store = {
  keys: {
    students: 'sc_students',
    fees: 'sc_fees',
    results: 'sc_results',
    messages: 'sc_messages',
    announcements: 'sc_announcements',
    events: 'sc_events',
    settings: 'sc_settings',
    auth: 'sc_auth',
    theme: 'sc_theme',
    activity: 'sc_activity',
    seeded: 'sc_seeded_v1'
  },

  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Store.get failed for', key, e);
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Store.set failed for', key, e);
      toast('error', 'Storage Error', 'Could not save data locally.');
      return false;
    }
  },

  remove(key) { localStorage.removeItem(key); },

  resetAll() {
    Object.values(this.keys).forEach(k => localStorage.removeItem(k));
  },

  /* ---------- Seed demo data on first run ---------- */
  seedIfEmpty() {
    if (Store.get(Store.keys.seeded, false)) return;

    const now = new Date();
    const Y = now.getFullYear();

    /* --- Students --- */
    const firstNamesM = ['Adebayo','Chinedu','David','Emeka','Farouk','Gbenga','Hassan','Ibrahim','Jibril','Kelechi','Lateef','Musa','Nurudeen','Oluwaseun','Peter','Ridwan','Samuel','Tunde','Uchenna','Victor'];
    const firstNamesF = ['Aisha','Blessing','Chioma','Damilola','Elizabeth','Fatima','Grace','Hauwa','Ifeoma','Joy','Khadijah','Latifat','Mariam','Ngozi','Opeyemi','Patience','Queen','Rachael','Sarah','Zainab'];
    const surnames = ['Adeyemi','Okafor','Nwosu','Ibrahim','Bello','Abdullahi','Eze','Okoro','Chukwu','Ogunleye','Hassan','Yusuf','Afolabi','Ojo','Okeke','Nnamdi','Agu','Onyekachi','Lawal','Sani'];
    const classes = ['JSS1','JSS2','JSS3','SSS1','SSS2','SSS3'];
    const genders = ['Male','Female'];

    const students = [];
    for (let i = 0; i < 18; i++) {
      const gender = genders[i % 2];
      const firstNameList = gender === 'Male' ? firstNamesM : firstNamesF;
      const fn = firstNameList[i % firstNameList.length];
      const sn = surnames[(i * 3) % surnames.length];
      const cls = classes[i % classes.length];
      const admNo = `STU-${Y}-${String(i + 1).padStart(3, '0')}`;
      const annualFees = cls.startsWith('JSS') ? 120000 : 180000;
      const initPaidRolls = [0, 0.3, 0.5, 0.7, 1];
      const initPaidRatio = initPaidRolls[i % initPaidRolls.length];
      const initialPaid = Math.round(annualFees * initPaidRatio / 1000) * 1000;

      students.push({
        id: uid(),
        name: `${fn} ${sn}`,
        class: cls,
        gender: gender,
        admissionNo: admNo,
        parentName: `Mr/Mrs ${sn}`,
        parentPhone: `+234 ${800 + (i * 7) % 99} ${100 + i} ${String(1000 + i * 13).slice(-4)}`,
        annualFees: annualFees,
        createdAt: isoDaysAgo(18 - i)
      });

      /* Corresponding fee record */
      const fees = Store.get(Store.keys.fees, []);
      fees.push({
        id: uid(),
        studentId: students[i].id,
        amountDue: annualFees,
        amountPaid: initialPaid,
        method: initialPaid > 0 ? (i % 2 ? 'Bank Transfer' : 'Cash') : null,
        lastPaymentDate: initialPaid > 0 ? isoDaysAgo(18 - i - 1) : null,
        updatedAt: isoDaysAgo(18 - i - 1)
      });
      Store.set(Store.keys.fees, fees);
    }
    Store.set(Store.keys.students, students);

    /* --- Results --- */
    const results = [];
    for (let i = 0; i < 4; i++) {
      const s = students[i];
      const scores = {
        Mathematics: 50 + ((i * 11) % 48),
        English: 48 + ((i * 13) % 50),
        Science: 52 + ((i * 7) % 45),
        'Social Studies': 55 + ((i * 9) % 42)
      };
      const total = Object.values(scores).reduce((a, b) => a + b, 0);
      results.push({
        id: uid(),
        studentId: s.id,
        term: i % 2 ? '1st Term' : '2nd Term',
        session: `${Y - 1}/${Y}`,
        scores: scores,
        total: total,
        average: +(total / 4).toFixed(1),
        grade: gradeFor(total / 4),
        createdAt: isoDaysAgo(20 + i * 3)
      });
    }
    Store.set(Store.keys.results, results);

    /* --- Messages --- */
    const messages = [
      { id: uid(), recipient: 'all_parents', recipientLabel: 'All Parents', subject: 'Resumption Date Announced', body: 'Dear Parents, we are pleased to announce the resumption date for the next academic session. Please ensure your wards resume on time.', status: 'sent', createdAt: isoDaysAgo(2) },
      { id: uid(), recipient: 'class_sss', recipientLabel: 'SSS Parents', subject: 'WAEC Registration Reminder', body: 'This is to remind all SSS3 parents that WAEC registration closes soon. Please complete all necessary payments and documentation.', status: 'sent', createdAt: isoDaysAgo(5) },
      { id: uid(), recipient: students[2].id, recipientLabel: students[2].parentName + ' (' + students[2].name + ')', subject: 'Attendance Concern', body: 'Good day, we noticed your child has been absent for 3 days without notice. Please contact the school urgently.', status: 'sent', createdAt: isoDaysAgo(8) }
    ];
    Store.set(Store.keys.messages, messages);

    /* --- Announcements --- */
    const announcements = [
      { id: uid(), title: 'First Term Examinations Commence Soon', description: 'All students should prepare adequately. Examination time tables have been shared with class teachers. Latecomers will not be allowed into examination halls.', target: 'All', priority: 'Urgent', date: isoDaysAgo(0) },
      { id: uid(), title: 'PTA Meeting Scheduled', description: 'All parents are invited to the monthly Parents-Teachers Association meeting holding at the school auditorium by 10am.', target: 'Parents', priority: 'High', date: isoDaysAgo(3) },
      { id: uid(), title: 'Mid-Term Break Notice', description: 'The school will proceed on a one-week mid-term break. Resumption is Monday next week. Wishing all students a restful break.', target: 'All', priority: 'Normal', date: isoDaysAgo(10) },
      { id: uid(), title: 'Inter-House Sports', description: 'Our annual inter-house sports competition comes up next month. Interested students should see their sports masters.', target: 'Students', priority: 'Normal', date: isoDaysAgo(15) }
    ];
    Store.set(Store.keys.announcements, announcements);

    /* --- Calendar events --- */
    const events = [
      { id: uid(), title: 'First Term Exams Begins', date: isoDaysFromNow(5), type: 'Exam', notes: 'All classes' },
      { id: uid(), title: 'PTA Monthly Meeting', date: isoDaysFromNow(9), type: 'PTA', notes: '10:00am at Auditorium' },
      { id: uid(), title: 'Children\'s Day Holiday', date: isoDaysFromNow(20), type: 'Holiday', notes: '' },
      { id: uid(), title: 'Inter-House Sports', date: isoDaysFromNow(25), type: 'Event', notes: 'Sports Ground' },
      { id: uid(), title: 'End of Term', date: isoDaysFromNow(35), type: 'Holiday', notes: 'After exams' }
    ];
    Store.set(Store.keys.events, events);

    /* --- Default settings --- */
    Store.set(Store.keys.settings, {
      schoolName: 'Starways College',
      logo: null,
      email: 'admin@school.com',
      phone: '+234 800 000 0000',
      address: '123 Education Avenue, Academic District',
      session: `${Y}/${Y + 1}`,
      term: '1st Term'
    });

    /* --- Activity log seed --- */
    const activity = [
      { id: uid(), icon: 'fa-file-invoice-dollar', color: 'green', text: 'New payment recorded for ' + students[0].name, time: isoDaysAgo(0) + 'T08:45' },
      { id: uid(), icon: 'fa-user-plus', color: 'blue', text: students[2].name + ' was added to ' + students[2].class, time: isoDaysAgo(1) + 'T14:20' },
      { id: uid(), icon: 'fa-bullhorn', color: 'purple', text: 'Announcement: ' + announcements[0].title, time: isoDaysAgo(0) + 'T07:30' },
      { id: uid(), icon: 'fa-chart-bar', color: 'orange', text: 'Result saved for ' + students[0].name, time: isoDaysAgo(2) + 'T16:10' },
      { id: uid(), icon: 'fa-paper-plane', color: 'blue', text: 'Message sent to All Parents', time: isoDaysAgo(2) + 'T09:00' }
    ];
    Store.set(Store.keys.activity, activity);

    Store.set(Store.keys.seeded, true);
  }
};

/* ========================================================================
   (B) UTILITIES
   ======================================================================== */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function uid() {
  return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtNaira(n) {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  return '₦' + Math.round(n).toLocaleString('en-NG');
}

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(str) {
  if (!str) return '';
  const diff = (Date.now() - new Date(str).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
  return formatDate(str);
}

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

function gradeFor(average) {
  if (average >= 70) return 'A';
  if (average >= 60) return 'B';
  if (average >= 50) return 'C';
  if (average >= 45) return 'D';
  return 'F';
}

function gradeInfo(g) {
  return {
    A: { label: 'Excellent', color: '#10B981', cls: 'grade-a' },
    B: { label: 'Very Good', color: '#2563EB', cls: 'grade-b' },
    C: { label: 'Good', color: '#6366F1', cls: 'grade-c' },
    D: { label: 'Pass', color: '#F59E0B', cls: 'grade-d' },
    F: { label: 'Fail', color: '#EF4444', cls: 'grade-f' }
  }[g] || { label: '-', color: '#64748B', cls: '' };
}

function feeStatusFor(paid, due) {
  if (!due) return { key: 'Paid', label: 'Paid' };
  const ratio = paid / due;
  if (ratio >= 1) return { key: 'Paid', label: 'Fully Paid' };
  if (ratio > 0) return { key: 'Partial', label: 'Partially Paid' };
  return { key: 'Unpaid', label: 'Unpaid' };
}

function studentById(id) {
  return (Store.get(Store.keys.students, []) || []).find(s => s.id === id);
}

function feeForStudent(studentId) {
  return (Store.get(Store.keys.fees, []) || []).find(f => f.studentId === studentId);
}

/* ---------- Toast notifications ---------- */
function toast(type, title, message) {
  const container = $('#toastContainer');
  if (!container) return;
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };
  const colors = {
    success: 'var(--secondary)',
    error: 'var(--danger)',
    warning: 'var(--warning)',
    info: 'var(--primary)'
  };
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.innerHTML = `
    <div class="toast-icon"><i class="fas ${icons[type] || icons.info}"></i></div>
    <div class="toast-body">
      <h5>${title}</h5>
      <p>${message || ''}</p>
    </div>
    <button class="toast-close"><i class="fas fa-xmark"></i></button>
  `;
  toast.style.setProperty('--toast-c', colors[type] || colors.info);
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  const close = () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  };
  toast.querySelector('.toast-close').addEventListener('click', close);
  setTimeout(close, 4500);
}

/* ---------- Confirm Dialog ---------- */
function confirmDialog({ title = 'Are you sure?', message = 'This action cannot be undone.', iconClass = 'fa-triangle-exclamation', okText = 'Confirm', onOk }) {
  const modal = $('#confirmModal');
  $('#confirmIcon').innerHTML = `<i class="fas ${iconClass}"></i>`;
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmOkBtn').textContent = okText;
  openModal('confirmModal');
  const okBtn = $('#confirmOkBtn');
  const handler = () => {
    okBtn.removeEventListener('click', handler);
    closeAllModals();
    if (typeof onOk === 'function') onOk();
  };
  okBtn.addEventListener('click', handler);
}

/* ---------- Modals ---------- */
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('open');
  if ($$('.modal.open').length === 0) document.body.style.overflow = '';
}
function closeAllModals() {
  $$('.modal.open').forEach(m => m.classList.remove('open'));
  document.body.style.overflow = '';
}

/* ---------- Animated counter ---------- */
function animateCount(el, from, to, duration = 1200) {
  if (!el) return;
  const isCurrency = typeof to === 'string' && to.startsWith('₦');
  const rawTo = isCurrency ? parseInt(String(to).replace(/[^\d]/g, ''), 10) : Number(to);
  if (isNaN(rawTo)) return;
  const start = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = from + (rawTo - from) * eased;
    el.textContent = isCurrency ? fmtNaira(v) : Math.round(v).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = isCurrency ? fmtNaira(rawTo) : Math.round(rawTo).toLocaleString();
  }
  requestAnimationFrame(tick);
}

/* ---------- Pagination ---------- */
function renderPagination(containerId, page, totalPages, onChange) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = '';
  if (totalPages <= 1) return;

  const mkBtn = (label, p, opts = {}) => {
    const b = document.createElement('button');
    b.className = 'page-btn' + (opts.active ? ' active' : '') + (opts.disabled ? ' disabled' : '');
    b.innerHTML = label;
    if (!opts.disabled && !opts.active) {
      b.addEventListener('click', () => onChange(p));
    }
    return b;
  };

  c.appendChild(mkBtn('<i class="fas fa-chevron-left"></i>', page - 1, { disabled: page <= 1 }));

  const pages = [];
  const push = (p) => { if (!pages.includes(p)) pages.push(p); };
  push(1);
  for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) push(p);
  push(totalPages);
  pages.sort((a, b) => a - b);

  let prev = 0;
  pages.forEach(p => {
    if (p - prev > 1) {
      const s = document.createElement('span');
      s.className = 'page-ellipsis';
      s.textContent = '…';
      c.appendChild(s);
    }
    c.appendChild(mkBtn(String(p), p, { active: p === page }));
    prev = p;
  });

  c.appendChild(mkBtn('<i class="fas fa-chevron-right"></i>', page + 1, { disabled: page >= totalPages }));
}

/* ---------- CSV Export ---------- */
function exportCSV(filename, rows) {
  if (!rows || !rows.length) {
    toast('warning', 'No Data', 'There is nothing to export.');
    return;
  }
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('success', 'Exported', 'CSV file downloaded successfully.');
}

/* ---------- Add Activity ---------- */
function addActivity(icon, color, text) {
  const list = Store.get(Store.keys.activity, []);
  list.unshift({
    id: uid(), icon, color, text,
    time: new Date().toISOString().slice(0, 16)
  });
  Store.set(Store.keys.activity, list.slice(0, 50));
}

/* ========================================================================
   (C) SESSION & NAVIGATION
   ======================================================================== */
const AUTH = { email: 'admin@school.com', password: 'password123' };

function checkAuth() {
  const a = Store.get(Store.keys.auth, null);
  if (a && a.email && a.loggedIn) {
    showApp();
  } else {
    showLogin();
  }
}

function showLogin() {
  $('#loginPage').classList.add('active');
  $('#appShell').style.display = 'none';
}

function showApp() {
  $('#loginPage').classList.remove('active');
  $('#appShell').style.display = '';
  applySettingsToUI();
  renderNotifications();
  navigateTo(currentPage || 'dashboard');
}

function doLogin(email, pwd) {
  if (email === AUTH.email && pwd === AUTH.password) {
    Store.set(Store.keys.auth, { email, loggedIn: true, at: Date.now() });
    addActivity('fa-right-to-bracket', 'blue', 'Administrator signed in');
    toast('success', 'Welcome!', 'Signed in successfully.');
    showApp();
    return true;
  }
  toast('error', 'Invalid Credentials', 'Check your email and password.');
  return false;
}

function doLogout() {
  confirmDialog({
    title: 'Log out?',
    message: 'You will need to sign in again to access the dashboard.',
    iconClass: 'fa-right-from-bracket',
    okText: 'Log out',
    onOk: () => {
      Store.remove(Store.keys.auth);
      toast('info', 'Signed out', 'See you next time.');
      showLogin();
      closeSidebarMobile();
    }
  });
}

let currentPage = 'dashboard';

function navigateTo(pageId) {
  if (!pageId) return;
  $$('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (!target) { pageId = 'dashboard'; document.getElementById('page-dashboard').classList.add('active'); }
  else target.classList.add('active');

  $$('.sidebar-nav .nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === pageId));
  currentPage = pageId;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  closeSidebarMobile();

  switch (pageId) {
    case 'dashboard': renderDashboard(); break;
    case 'students': refreshStudentsTable(); break;
    case 'fees': refreshFeesTable(); break;
    case 'results': renderResultsPage(); break;
    case 'parents': renderParentsPage(); break;
    case 'announcements': renderAnnouncements(); break;
    case 'calendar': renderCalendar(); break;
    case 'settings': loadSettingsForm(); break;
  }
}

/* ========================================================================
   (D) THEME
   ======================================================================== */
function getThemePref() { return Store.get(Store.keys.theme, 'auto'); }

function applyTheme(pref) {
  if (pref) Store.set(Store.keys.theme, pref);
  const p = pref || getThemePref();
  const isDark = p === 'dark' || (p === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const icon = $('#themeIcon');
  if (icon) icon.className = 'fas ' + (isDark ? 'fa-sun' : 'fa-moon');
  $$('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.themePref === p));
}

function toggleTheme() {
  const p = getThemePref();
  applyTheme(p === 'dark' ? 'light' : p === 'light' ? 'auto' : 'dark');
}

/* ========================================================================
   (E) DASHBOARD RENDERERS
   ======================================================================== */
function renderDashboard() {
  const students = Store.get(Store.keys.students, []) || [];
  const fees = Store.get(Store.keys.fees, []) || [];
  const events = Store.get(Store.keys.events, []) || [];

  const totalDue = fees.reduce((s, f) => s + (f.amountDue || 0), 0);
  const totalPaid = fees.reduce((s, f) => s + (f.amountPaid || 0), 0);
  const outstanding = Math.max(0, totalDue - totalPaid);
  const upcomingExams = events.filter(e => e.type === 'Exam' && new Date(e.date) >= new Date(isoDaysAgo(0))).length;

  /* Counters */
  animateCount($('#statStudents'), 0, students.length, 1200);
  animateCount($('#statOutstanding'), 0, fmtNaira(outstanding), 1200);
  animateCount($('#statCollected'), 0, fmtNaira(totalPaid), 1200);
  animateCount($('#statExams'), 0, upcomingExams, 1200);

  /* Growth placeholders */
  $('#statStudentsGrowth').textContent = '12%';
  $('#statOutstandingGrowth').textContent = '3%';
  $('#statCollectedGrowth').textContent = '18%';

  /* Big progress ring */
  const pct = totalDue > 0 ? Math.min(100, Math.round((totalPaid / totalDue) * 100)) : 0;
  const ring = $('#feesProgressFill');
  if (ring) {
    ring.style.setProperty('--fill', pct + '%');
    // also update parent wrapper if needed
    const wrap = ring.closest('.big-progress');
    if (wrap) wrap.style.setProperty('--fill', pct + '%');
  }
  $('#feesProgressPercent').textContent = pct + '%';
  $('#feesPercentBadge').textContent = pct + '%';
  $('#progressCollected').textContent = fmtNaira(totalPaid);
  $('#progressOutstanding').textContent = fmtNaira(outstanding);
  $('#progressTotal').textContent = fmtNaira(totalDue);

  renderDefaulters();
  renderMessagesPreview();
  renderRecentActivity();
  renderUpcomingEvents();
  renderIncomeChart();
}

function renderDefaulters() {
  const c = $('#defaultersList');
  if (!c) return;
  const fees = Store.get(Store.keys.fees, []) || [];
  const list = fees
    .map(f => {
      const s = studentById(f.studentId);
      return { f, s, bal: Math.max(0, (f.amountDue || 0) - (f.amountPaid || 0)) };
    })
    .filter(x => x.s && x.bal > 0)
    .sort((a, b) => b.bal - a.bal)
    .slice(0, 5);

  if (!list.length) {
    c.innerHTML = `<div class="empty-state-sm"><i class="fas fa-circle-check"></i> No outstanding balances</div>`;
    return;
  }
  c.innerHTML = list.map(x => {
    const genderCls = x.s.gender === 'Female' ? 'av-pink' : 'av-blue';
    return `
      <div class="defaulter-item">
        <div class="student-cell">
          <div class="avatar ${genderCls}">${initials(x.s.name)}</div>
          <div>
            <strong>${x.s.name}</strong>
            <small>${x.s.class} · ${x.s.admissionNo}</small>
          </div>
        </div>
        <div class="defaulter-amount">
          <strong>${fmtNaira(x.bal)}</strong>
          <div class="progress-mini"><div class="progress-mini-fill" style="width:${Math.max(5, Math.min(100, 100 - Math.round(x.bal / (x.f.amountDue || 1) * 100)))}%"></div></div>
        </div>
      </div>`;
  }).join('');
}

function renderMessagesPreview() {
  const c = $('#messagesPreview');
  if (!c) return;
  const msgs = (Store.get(Store.keys.messages, []) || []).slice(0, 4);
  if (!msgs.length) {
    c.innerHTML = `<div class="empty-state-sm"><i class="fas fa-inbox"></i> No messages yet</div>`;
    return;
  }
  c.innerHTML = msgs.map(m => `
    <div class="msg-preview-item">
      <div class="msg-avatar"><i class="fas fa-user"></i></div>
      <div class="msg-p-body">
        <div class="msg-p-head">
          <strong>${m.recipientLabel || m.recipient}</strong>
          <small>${timeAgo(m.createdAt)}</small>
        </div>
        <h6>${m.subject}</h6>
        <p>${(m.body || '').slice(0, 90)}${m.body && m.body.length > 90 ? '…' : ''}</p>
      </div>
    </div>
  `).join('');
}

function renderRecentActivity() {
  const c = $('#activityList');
  if (!c) return;
  const list = (Store.get(Store.keys.activity, []) || []).slice(0, 8);
  if (!list.length) {
    c.innerHTML = `<div class="empty-state-sm"><i class="fas fa-list"></i> No recent activity</div>`;
    return;
  }
  c.innerHTML = list.map(a => `
    <div class="activity-item">
      <div class="activity-icon ai-${a.color || 'blue'}"><i class="fas ${a.icon}"></i></div>
      <div class="activity-body">
        <p>${a.text}</p>
        <small>${timeAgo(a.time)}</small>
      </div>
    </div>
  `).join('');
}

function renderUpcomingEvents() {
  const c = $('#upcomingList');
  if (!c) return;
  const today = new Date(isoDaysAgo(0));
  const list = (Store.get(Store.keys.events, []) || [])
    .filter(e => new Date(e.date) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);
  if (!list.length) {
    c.innerHTML = `<div class="empty-state-sm"><i class="fas fa-calendar"></i> No upcoming events</div>`;
    return;
  }
  const typeClass = { Exam: 'e-exam', PTA: 'e-pta', Holiday: 'e-holiday', Event: 'e-event' };
  c.innerHTML = list.map(e => {
    const d = new Date(e.date);
    return `
      <div class="upcoming-item">
        <div class="upc-date">
          <strong>${d.getDate()}</strong>
          <span>${d.toLocaleDateString('en-US', { month: 'short' })}</span>
        </div>
        <div class="upc-body">
          <h6>${e.title}</h6>
          <span class="evt-tag ${typeClass[e.type] || 'e-event'}">${e.type}</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ---------- Income chart (pure canvas) ---------- */
let lastMonthsCache = null;
function renderIncomeChart() {
  const canvas = $('#incomeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const range = parseInt($('#incomeChartRange')?.value || '7', 10);
  const months = [];
  const now = new Date();
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    });
  }

  /* Derive income from fee records: distribute payments evenly over recent months */
  const fees = Store.get(Store.keys.fees, []) || [];
  const totalPaid = fees.reduce((s, f) => s + (f.amountPaid || 0), 0);
  const seed = (Store.get(Store.keys.activity, []).length || 5);
  const values = months.map((m, i) => {
    // weight: later months slightly higher; small deterministic wobble
    const weight = 0.5 + (i / months.length) * 0.9;
    const noise = Math.sin((i + seed) * 1.3) * 0.15 + 1;
    const avgBase = totalPaid / months.length / 1.2;
    return Math.max(5000, Math.round(avgBase * weight * noise / 1000) * 1000);
  });

  lastMonthsCache = { months, values };
  drawLineChart(ctx, rect.width, rect.height, months.map(m => m.label), values);
}

function drawLineChart(ctx, W, H, labels, values) {
  const padL = 54, padR = 16, padT = 20, padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  ctx.clearRect(0, 0, W, H);

  const max = Math.max(...values) * 1.18;
  const min = 0;
  const ticks = 4;

  /* Grid */
  ctx.strokeStyle = getCss('--border') || '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = getCss('--text-4') || '#94A3B8';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ticks; i++) {
    const y = padT + (chartH * i) / ticks;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    const v = max - ((max - min) * i) / ticks;
    ctx.fillText('₦' + Math.round(v / 1000) + 'k', padL - 10, y);
  }

  /* X labels */
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  labels.forEach((lb, i) => {
    const x = padL + (i / (labels.length - 1 || 1)) * chartW;
    ctx.fillText(lb, x, padT + chartH + 12);
  });

  const xFor = i => padL + (i / (labels.length - 1 || 1)) * chartW;
  const yFor = v => padT + chartH - ((v - min) / (max - min || 1)) * chartH;

  /* Area gradient */
  const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  grad.addColorStop(0, 'rgba(37, 99, 235, 0.32)');
  grad.addColorStop(1, 'rgba(37, 99, 235, 0.0)');
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = xFor(i), y = yFor(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(xFor(values.length - 1), padT + chartH);
  ctx.lineTo(xFor(0), padT + chartH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  /* Line */
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = xFor(i), y = yFor(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#2563EB';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  /* Points */
  values.forEach((v, i) => {
    const x = xFor(i), y = yFor(v);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2563EB';
    ctx.stroke();
  });
}

function getCss(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/* ========================================================================
   (F) STUDENTS CRUD
   ======================================================================== */
const studentState = { page: 1, perPage: 8, q: '', classFilter: '', genderFilter: '', feeFilter: '' };

function filteredStudents() {
  const students = Store.get(Store.keys.students, []) || [];
  const fees = Store.get(Store.keys.fees, []) || [];
  const q = studentState.q.trim().toLowerCase();
  return students.filter(s => {
    if (q) {
      const hay = [s.name, s.admissionNo, s.class, s.parentName, s.parentPhone].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (studentState.classFilter && s.class !== studentState.classFilter) return false;
    if (studentState.genderFilter && s.gender !== studentState.genderFilter) return false;
    if (studentState.feeFilter) {
      const f = fees.find(x => x.studentId === s.id);
      const st = f ? feeStatusFor(f.amountPaid, f.amountDue).key : 'Unpaid';
      if (st !== studentState.feeFilter) return false;
    }
    return true;
  });
}

function refreshStudentsTable() {
  const body = $('#studentsTableBody');
  const info = $('#studentTableInfo');
  if (!body) return;
  const list = filteredStudents();
  const totalPages = Math.max(1, Math.ceil(list.length / studentState.perPage));
  if (studentState.page > totalPages) studentState.page = totalPages;
  const start = (studentState.page - 1) * studentState.perPage;
  const page = list.slice(start, start + studentState.perPage);

  if (!page.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-users-slash"></i><p>No students match your filters.</p></div></td></tr>`;
  } else {
    body.innerHTML = page.map(s => {
      const f = feeForStudent(s.id);
      const status = f ? feeStatusFor(f.amountPaid, f.amountDue) : { key: 'Unpaid', label: 'Unpaid' };
      const bal = f ? Math.max(0, (f.amountDue || 0) - (f.amountPaid || 0)) : 0;
      const genderCls = s.gender === 'Female' ? 'av-pink' : 'av-blue';
      return `
        <tr>
          <td>
            <div class="student-cell">
              <div class="avatar ${genderCls}">${initials(s.name)}</div>
              <div>
                <strong>${s.name}</strong>
                <small>${s.parentName}</small>
              </div>
            </div>
          </td>
          <td><code>${s.admissionNo}</code></td>
          <td><span class="chip">${s.class}</span></td>
          <td>${s.gender}</td>
          <td><div><small>${s.parentPhone}</small></div></td>
          <td><span class="badge-dot bd-${status.key.toLowerCase()}">${status.label}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" data-act="view-student-fees" data-id="${s.id}" title="Fees"><i class="fas fa-file-invoice-dollar"></i></button>
              <button class="icon-btn" data-act="edit-student" data-id="${s.id}" title="Edit"><i class="fas fa-pen"></i></button>
              <button class="icon-btn danger" data-act="del-student" data-id="${s.id}" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
  info.textContent = `Showing ${page.length ? start + 1 : 0}–${start + page.length} of ${list.length} students`;
  renderPagination('studentPagination', studentState.page, totalPages, (p) => {
    studentState.page = p;
    refreshStudentsTable();
  });
}

function openStudentModal(student) {
  $('#studentEditId').value = student ? student.id : '';
  $('#studentModalTitle').textContent = student ? 'Edit Student' : 'Add New Student';
  $('#studentModalBtnText').textContent = student ? 'Update Student' : 'Add Student';
  if (student) {
    $('#studentName').value = student.name || '';
    $('#studentAdmNo').value = student.admissionNo || '';
    $('#studentClass').value = student.class || '';
    $('#studentGender').value = student.gender || '';
    $('#studentParentName').value = student.parentName || '';
    $('#studentParentPhone').value = student.parentPhone || '';
    const f = feeForStudent(student.id);
    $('#studentAnnualFees').value = f ? f.amountDue : (student.annualFees || '');
    $('#studentInitialPaid').value = f ? f.amountPaid : '';
  } else {
    $('#studentForm').reset();
    $('#studentAnnualFees').value = '150000';
    $('#studentInitialPaid').value = '0';
  }
  openModal('studentModal');
}

function saveStudentSubmit(e) {
  e.preventDefault();
  const editId = $('#studentEditId').value;
  const name = $('#studentName').value.trim();
  const admNo = $('#studentAdmNo').value.trim();
  const cls = $('#studentClass').value;
  const gender = $('#studentGender').value;
  const parentName = $('#studentParentName').value.trim();
  const parentPhone = $('#studentParentPhone').value.trim();
  const annualFees = parseFloat($('#studentAnnualFees').value) || 0;
  const initialPaid = parseFloat($('#studentInitialPaid').value) || 0;

  if (!name || !admNo || !cls || !gender || !parentName || !parentPhone) {
    toast('warning', 'Validation', 'Please fill all required fields.');
    return;
  }

  const students = Store.get(Store.keys.students, []);
  const fees = Store.get(Store.keys.fees, []);

  if (editId) {
    const idx = students.findIndex(s => s.id === editId);
    if (idx >= 0) {
      students[idx] = { ...students[idx], name, admissionNo: admNo, class: cls, gender, parentName, parentPhone, annualFees };
      const fIdx = fees.findIndex(f => f.studentId === editId);
      if (fIdx >= 0) {
        fees[fIdx] = { ...fees[fIdx], amountDue: annualFees, amountPaid: initialPaid, updatedAt: new Date().toISOString() };
      }
      addActivity('fa-pen', 'orange', `${name} record was updated`);
      toast('success', 'Updated', `${name} has been updated.`);
    }
  } else {
    /* check admission no uniqueness */
    if (students.some(s => s.admissionNo === admNo)) {
      toast('error', 'Duplicate', 'Admission number already exists.');
      return;
    }
    const ns = {
      id: uid(), name, admissionNo: admNo, class: cls, gender, parentName, parentPhone,
      annualFees, createdAt: new Date().toISOString().slice(0, 10)
    };
    students.push(ns);
    fees.push({
      id: uid(),
      studentId: ns.id,
      amountDue: annualFees,
      amountPaid: initialPaid,
      method: initialPaid > 0 ? 'Cash' : null,
      lastPaymentDate: initialPaid > 0 ? isoDaysAgo(0) : null,
      updatedAt: new Date().toISOString()
    });
    addActivity('fa-user-plus', 'blue', `${name} was added to ${cls}`);
    toast('success', 'Added', `${name} has been added successfully.`);
  }

  Store.set(Store.keys.students, students);
  Store.set(Store.keys.fees, fees);
  closeModal('studentModal');
  if (currentPage === 'students') refreshStudentsTable();
  else if (currentPage === 'fees') refreshFeesTable();
  else if (currentPage === 'dashboard') renderDashboard();
  else refreshStudentsTable();
}

function deleteStudentConfirm(id) {
  const s = studentById(id);
  if (!s) return;
  confirmDialog({
    title: `Delete ${s.name}?`,
    message: 'This will remove the student record and associated fee information. This action cannot be undone.',
    iconClass: 'fa-trash',
    okText: 'Delete Student',
    onOk: () => {
      Store.set(Store.keys.students, Store.get(Store.keys.students, []).filter(x => x.id !== id));
      Store.set(Store.keys.fees, Store.get(Store.keys.fees, []).filter(x => x.studentId !== id));
      Store.set(Store.keys.results, Store.get(Store.keys.results, []).filter(x => x.studentId !== id));
      addActivity('fa-trash', 'red', `${s.name} was deleted`);
      toast('info', 'Deleted', `${s.name} has been removed.`);
      refreshStudentsTable();
    }
  });
}

function exportStudentsCSV() {
  const list = filteredStudents();
  const rows = [
    ['Name', 'Admission No.', 'Class', 'Gender', 'Parent Name', 'Parent Phone', 'Annual Fees', 'Amount Paid', 'Balance', 'Fee Status']
  ];
  const fees = Store.get(Store.keys.fees, []) || [];
  list.forEach(s => {
    const f = fees.find(x => x.studentId === s.id);
    const due = f ? f.amountDue : (s.annualFees || 0);
    const paid = f ? f.amountPaid : 0;
    const status = feeStatusFor(paid, due);
    rows.push([s.name, s.admissionNo, s.class, s.gender, s.parentName, s.parentPhone, due, paid, due - paid, status.label]);
  });
  exportCSV('students.csv', rows);
}

/* ========================================================================
   (G) FEES TRACKING
   ======================================================================== */
const feeState = { page: 1, perPage: 8, q: '', statusFilter: '' };

function filteredFees() {
  const students = Store.get(Store.keys.students, []) || [];
  const fees = Store.get(Store.keys.fees, []) || [];
  const q = feeState.q.trim().toLowerCase();
  return fees
    .map(f => ({ f, s: students.find(s => s.id === f.studentId) }))
    .filter(x => {
      if (!x.s) return false;
      if (q) {
        if (!(x.s.name.toLowerCase().includes(q) || x.s.admissionNo.toLowerCase().includes(q))) return false;
      }
      if (feeState.statusFilter) {
        const st = feeStatusFor(x.f.amountPaid, x.f.amountDue).key;
        if (st !== feeState.statusFilter) return false;
      }
      return true;
    })
    .sort((a, b) => (b.f.amountDue - b.f.amountPaid) - (a.f.amountDue - a.f.amountPaid));
}

function refreshFeesTable() {
  const body = $('#feesTableBody');
  if (!body) return;

  const students = Store.get(Store.keys.students, []) || [];
  const fees = Store.get(Store.keys.fees, []) || [];
  const totalDue = fees.reduce((s, f) => s + (f.amountDue || 0), 0);
  const totalPaid = fees.reduce((s, f) => s + (f.amountPaid || 0), 0);
  const fullyPaidCount = fees.filter(f => f.amountDue > 0 && f.amountPaid >= f.amountDue).length;

  animateCount($('#feeSummaryTotal'), 0, fmtNaira(totalDue), 800);
  animateCount($('#feeSummaryPaid'), 0, fmtNaira(totalPaid), 800);
  animateCount($('#feeSummaryOutstanding'), 0, fmtNaira(Math.max(0, totalDue - totalPaid)), 800);
  $('#feeSummaryFullyPaid').textContent = fullyPaidCount;

  const list = filteredFees();
  const totalPages = Math.max(1, Math.ceil(list.length / feeState.perPage));
  if (feeState.page > totalPages) feeState.page = totalPages;
  const start = (feeState.page - 1) * feeState.perPage;
  const page = list.slice(start, start + feeState.perPage);

  if (!page.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-file-invoice"></i><p>No fee records match your filters.</p></div></td></tr>`;
  } else {
    body.innerHTML = page.map(({ f, s }) => {
      const st = feeStatusFor(f.amountPaid, f.amountDue);
      const bal = Math.max(0, (f.amountDue || 0) - (f.amountPaid || 0));
      const genderCls = s.gender === 'Female' ? 'av-pink' : 'av-blue';
      return `
        <tr>
          <td>
            <div class="student-cell">
              <div class="avatar ${genderCls}">${initials(s.name)}</div>
              <div>
                <strong>${s.name}</strong>
                <small>${s.admissionNo}</small>
              </div>
            </div>
          </td>
          <td><span class="chip">${s.class}</span></td>
          <td><strong>${fmtNaira(f.amountDue)}</strong></td>
          <td><strong style="color:var(--secondary)">${fmtNaira(f.amountPaid)}</strong></td>
          <td><strong ${bal > 0 ? 'style="color:var(--danger)"' : ''}>${fmtNaira(bal)}</strong></td>
          <td><span class="badge-dot bd-${st.key.toLowerCase()}">${st.label}</span></td>
          <td>
            <div class="row-actions">
              <button class="btn btn-sm btn-outline" data-act="record-payment" data-id="${f.id}">
                <i class="fas fa-money-bill-wave"></i> Payment
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
  $('#feeTableInfo').textContent = `Showing ${page.length ? start + 1 : 0}–${start + page.length} of ${list.length} records`;
  renderPagination('feePagination', feeState.page, totalPages, p => {
    feeState.page = p;
    refreshFeesTable();
  });
}

function refreshFeesSummaryCards() {
  const fees = Store.get(Store.keys.fees, []) || [];
  const totalDue = fees.reduce((s, f) => s + (f.amountDue || 0), 0);
  const totalPaid = fees.reduce((s, f) => s + (f.amountPaid || 0), 0);
  const fullyPaidCount = fees.filter(f => f.amountDue > 0 && f.amountPaid >= f.amountDue).length;
  const el = (id, v) => { const e = document.getElementById(id); if (e) animateCount(e, 0, fmtNaira(v), 800); };
  el('feeSummaryTotal', totalDue);
  el('feeSummaryPaid', totalPaid);
  el('feeSummaryOutstanding', Math.max(0, totalDue - totalPaid));
  const e = $('#feeSummaryFullyPaid'); if (e) e.textContent = fullyPaidCount;
}

function openPaymentModal(feeIdOrStudentId) {
  $('#paymentForm').reset();
  $('#paymentFeeId').value = '';
  const sel = $('#paymentStudent');
  const students = Store.get(Store.keys.students, []) || [];
  sel.innerHTML = '<option value="">Select student</option>' +
    students.map(s => `<option value="${s.id}">${s.name} — ${s.class}</option>`).join('');
  $('#feeSummaryBox').style.display = 'none';
  if (feeIdOrStudentId) {
    const fees = Store.get(Store.keys.fees, []) || [];
    let fee, studentId;
    const byFee = fees.find(f => f.id === feeIdOrStudentId);
    if (byFee) { fee = byFee; studentId = byFee.studentId; $('#paymentFeeId').value = byFee.id; }
    else { studentId = feeIdOrStudentId; fee = fees.find(f => f.studentId === studentId); }
    if (studentId) {
      sel.value = studentId;
      updateFeeSummaryBox();
    }
  }
  openModal('paymentModal');
}

function updateFeeSummaryBox() {
  const sid = $('#paymentStudent').value;
  const box = $('#feeSummaryBox');
  if (!sid) { box.style.display = 'none'; return; }
  const f = feeForStudent(sid);
  if (!f) { box.style.display = 'none'; return; }
  box.style.display = '';
  $('#fsDue').textContent = fmtNaira(f.amountDue);
  $('#fsPaid').textContent = fmtNaira(f.amountPaid);
  const bal = Math.max(0, (f.amountDue || 0) - (f.amountPaid || 0));
  $('#fsBalance').textContent = fmtNaira(bal);
}

function recordPaymentSubmit(e) {
  e.preventDefault();
  const sid = $('#paymentStudent').value;
  const amount = parseFloat($('#paymentAmount').value) || 0;
  const method = $('#paymentMethod').value;
  const notes = $('#paymentNotes').value.trim();
  if (!sid) { toast('warning', 'Select Student', 'Please select a student.'); return; }
  if (amount <= 0) { toast('warning', 'Invalid Amount', 'Payment amount must be greater than zero.'); return; }
  const s = studentById(sid);
  const fees = Store.get(Store.keys.fees, []) || [];
  let f = fees.find(x => x.studentId === sid);
  if (!f) {
    f = { id: uid(), studentId: sid, amountDue: s.annualFees || 150000, amountPaid: 0, updatedAt: new Date().toISOString() };
    fees.push(f);
  }
  const balBefore = Math.max(0, (f.amountDue || 0) - (f.amountPaid || 0));
  if (amount > balBefore + 500) {
    toast('warning', 'Overpayment', 'Payment amount exceeds the outstanding balance by more than ₦500.');
    return;
  }
  f.amountPaid = Math.min((f.amountDue || 0), (f.amountPaid || 0) + amount);
  f.method = method;
  f.lastPaymentDate = isoDaysAgo(0);
  f.updatedAt = new Date().toISOString();
  Store.set(Store.keys.fees, fees);
  addActivity('fa-file-invoice-dollar', 'green', `Payment of ${fmtNaira(amount)} recorded for ${s.name}`);
  toast('success', 'Payment Recorded', `${fmtNaira(amount)} received from ${s.name}.`);
  closeModal('paymentModal');
  refreshFeesTable();
  if (currentPage === 'dashboard') renderDashboard();
}

/* ========================================================================
   (H) RESULTS
   ======================================================================== */
function renderResultsPage() {
  const sel = $('#resultStudent');
  const students = Store.get(Store.keys.students, []) || [];
  sel.innerHTML = '<option value="">Select a student</option>' +
    students.map(s => `<option value="${s.id}">${s.name} — ${s.class}</option>`).join('');

  const settings = Store.get(Store.keys.settings, {}) || {};
  $('#resultSession').value = settings.session || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);

  const filterSel = $('#resultsFilter');
  const terms = ['1st Term', '2nd Term', '3rd Term'];
  filterSel.innerHTML = '<option value="">All Results</option>' +
    terms.map(t => `<option value="${t}">${t}</option>`).join('') +
    '<option value="print">Printable Report Cards</option>';

  computeLiveResultPreview();
  renderResultsList();
}

function computeLiveResultPreview() {
  const inputs = $$('.subject-score');
  let total = 0, valid = 0;
  inputs.forEach(inp => {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v >= 0 && v <= 100) { total += v; valid++; }
  });
  const avg = valid > 0 ? total / valid : 0;
  $('#rpTotal').textContent = `${Math.round(total)} / 400`;
  $('#rpAverage').textContent = valid > 0 ? `${avg.toFixed(1)}%` : '0%';
  const g = $('#rpGrade');
  const grade = valid >= 4 ? gradeFor(avg) : '-';
  g.textContent = grade;
  const gi = gradeInfo(grade);
  g.style.color = gi.color;
}

function saveResultSubmit(e) {
  e.preventDefault();
  const sid = $('#resultStudent').value;
  if (!sid) { toast('warning', 'Select Student', 'Please choose a student.'); return; }
  const subjects = ['Mathematics', 'English', 'Science', 'Social Studies'];
  const scores = {};
  let total = 0;
  for (const sub of subjects) {
    const inp = document.querySelector(`.subject-score[data-subject="${sub}"]`);
    const v = parseFloat(inp.value);
    if (isNaN(v) || v < 0 || v > 100) { toast('warning', 'Invalid Score', `Enter a valid score (0-100) for ${sub}.`); return; }
    scores[sub] = v; total += v;
  }
  const term = $('#resultTerm').value;
  const session = $('#resultSession').value.trim() || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const results = Store.get(Store.keys.results, []) || [];
  const entry = {
    id: uid(),
    studentId: sid, term, session, scores,
    total: Math.round(total),
    average: +(total / 4).toFixed(1),
    grade: gradeFor(total / 4),
    createdAt: new Date().toISOString()
  };
  results.unshift(entry);
  Store.set(Store.keys.results, results);
  const s = studentById(sid);
  addActivity('fa-chart-bar', 'orange', `Result saved for ${s.name} (${term}, ${session})`);
  toast('success', 'Result Saved', `${s.name}: Grade ${entry.grade} (${entry.average}%)`);
  $('#resultForm').reset();
  $('#resultStudent').value = '';
  $('.subject-score[data-subject="Mathematics"]').value = '';
  renderResultsPage();
}

function renderResultsList() {
  const c = $('#resultsList');
  if (!c) return;
  let results = Store.get(Store.keys.results, []) || [];
  const filter = $('#resultsFilter')?.value || '';
  if (filter && filter !== 'print') results = results.filter(r => r.term === filter);
  if (!results.length) {
    c.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>No saved results yet. Use the form to compile results.</p></div>`;
    return;
  }
  c.innerHTML = results.map(r => {
    const s = studentById(r.studentId);
    if (!s) return '';
    const gi = gradeInfo(r.grade);
    const genderCls = s.gender === 'Female' ? 'av-pink' : 'av-blue';
    return `
      <div class="result-card">
        <div class="rc-head">
          <div class="student-cell">
            <div class="avatar ${genderCls}">${initials(s.name)}</div>
            <div>
              <strong>${s.name}</strong>
              <small>${s.class} · ${s.admissionNo}</small>
            </div>
          </div>
          <span class="grade-badge-large ${gi.cls}" style="border-color:${gi.color};color:${gi.color};">${r.grade}</span>
        </div>
        <div class="rc-subject-row">
          ${Object.entries(r.scores).map(([k, v]) => {
            const g = gradeFor(v); const gi2 = gradeInfo(g);
            return `<div class="rc-subject">
              <small>${k}</small>
              <strong>${v}</strong>
              <span style="color:${gi2.color}">${g}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="rc-foot">
          <div><small>Total:</small><strong>${r.total}/400</strong></div>
          <div><small>Avg:</small><strong>${r.average}%</strong></div>
          <div><small>Term:</small><strong>${r.term}</strong></div>
          <div><small>Session:</small><strong>${r.session}</strong></div>
          <div style="margin-left:auto">
            <button class="btn btn-sm btn-outline" data-act="view-report" data-id="${r.id}"><i class="fas fa-file-lines"></i> Report Card</button>
            <button class="btn btn-sm btn-danger" data-act="del-result" data-id="${r.id}"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openReportCard(resultId) {
  const r = (Store.get(Store.keys.results, []) || []).find(x => x.id === resultId);
  if (!r) return;
  const s = studentById(r.studentId);
  if (!s) return;
  const settings = Store.get(Store.keys.settings, {}) || {};
  const gi = gradeInfo(r.grade);
  const body = $('#reportCardBody');
  body.innerHTML = `
    <div class="report-card" id="reportCardPrintArea">
      <div class="rc-head-school">
        <div class="rcs-logo">
          ${settings.logo ? `<img src="${settings.logo}" alt="logo">` : `<i class="fas fa-graduation-cap"></i>`}
        </div>
        <div class="rcs-name">
          <h2>${settings.schoolName || 'Starways College'}</h2>
          <p>${settings.address || 'Academic Excellence & Integrity'}</p>
        </div>
      </div>
      <div class="rc-title-row">
        <h3>STUDENT REPORT CARD</h3>
        <div class="rc-session-tag">${r.term} · ${r.session}</div>
      </div>
      <div class="rc-student-info">
        <div><label>Student Name:</label><span>${s.name}</span></div>
        <div><label>Admission No:</label><span>${s.admissionNo}</span></div>
        <div><label>Class:</label><span>${s.class}</span></div>
        <div><label>Gender:</label><span>${s.gender}</span></div>
      </div>
      <table class="rc-table">
        <thead>
          <tr><th>Subject</th><th>Score (100)</th><th>Grade</th><th>Remarks</th></tr>
        </thead>
        <tbody>
          ${Object.entries(r.scores).map(([k, v]) => {
            const g = gradeFor(v); const g2 = gradeInfo(g);
            return `<tr>
              <td>${k}</td>
              <td><strong>${v}</strong></td>
              <td style="color:${g2.color}"><strong>${g}</strong></td>
              <td>${g2.label}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr><th>Total</th><th><strong>${r.total} / 400</strong></th><th style="color:${gi.color}"><strong>${r.grade}</strong></th><th>${gi.label}</th></tr>
          <tr><td>Average</td><td colspan="3"><strong>${r.average}%</strong></td></tr>
        </tfoot>
      </table>
      <div class="rc-footer">
        <div class="rc-sign">
          <span>Class Teacher: _____________________</span>
          <span>Date: ${formatDate(isoDaysAgo(0))}</span>
        </div>
        <div class="rc-sign">
          <span>Principal's Signature: _____________________</span>
          <span>Next Term Resumes: —</span>
        </div>
      </div>
      <div class="rc-remarks">
        <strong>General Remarks:</strong>
        <p>${r.average >= 70 ? 'Excellent performance. Keep up the outstanding work and serve as a role model to your peers.' :
           r.average >= 60 ? 'Very good result. There is still room for improvement in the coming term.' :
           r.average >= 50 ? 'Satisfactory performance. Encourage the student to study harder for better grades.' :
           r.average >= 45 ? 'Fair result. More attention and extra lessons are recommended.' :
           'Needs serious improvement. Parent(s)/Guardian(s) should please engage with the class teacher.'}
        </p>
      </div>
    </div>
  `;
  openModal('reportModal');
}

function printReport() {
  const area = $('#reportCardPrintArea');
  if (!area) return;
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { toast('error', 'Blocked', 'Please allow popups to print the report.'); return; }
  const settings = Store.get(Store.keys.settings, {}) || {};
  w.document.write(`<!DOCTYPE html><html><head><title>Report Card - ${settings.schoolName || 'School'}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      * { box-sizing: border-box; margin:0; padding:0; }
      body { font-family: 'Inter', sans-serif; color:#0F172A; padding:40px; background:#fff; font-size:13px; }
      .rc-head-school { display:flex; gap:20px; align-items:center; border-bottom:2px solid #2563EB; padding-bottom:16px; margin-bottom:24px; }
      .rcs-logo { width:70px; height:70px; border-radius:12px; background:linear-gradient(135deg,#2563EB,#4F46E5); color:#fff; display:flex; align-items:center; justify-content:center; font-size:32px; overflow:hidden; }
      .rcs-logo img { width:100%; height:100%; object-fit:cover; }
      .rcs-name h2 { font-size:22px; color:#0F172A; }
      .rc-title-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
      .rc-title-row h3 { font-size:16px; letter-spacing:1px; color:#2563EB; text-transform:uppercase; }
      .rc-session-tag { background:#DBEAFE; color:#1D4ED8; padding:6px 12px; border-radius:999px; font-weight:600; font-size:12px; }
      .rc-student-info { display:grid; grid-template-columns:repeat(2,1fr); gap:10px 30px; background:#F8FAFC; border-radius:10px; padding:14px 20px; margin-bottom:20px; }
      .rc-student-info > div { display:flex; justify-content:space-between; border-bottom:1px dashed #E2E8F0; padding:6px 0; }
      .rc-student-info label { color:#64748B; font-weight:500; }
      .rc-table { width:100%; border-collapse:collapse; margin-bottom:24px; }
      .rc-table th, .rc-table td { border:1px solid #E2E8F0; padding:10px 14px; text-align:left; }
      .rc-table thead th { background:#2563EB; color:#fff; text-transform:uppercase; font-size:11px; letter-spacing:0.5px; }
      .rc-table tfoot th, .rc-table tfoot td { background:#F1F5F9; font-weight:700; }
      .rc-footer { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:24px; }
      .rc-sign { display:flex; flex-direction:column; gap:30px; font-size:12px; color:#475569; border-top:1px dashed #CBD5E1; padding-top:14px; }
      .rc-remarks { margin-top:20px; padding:16px; background:#F8FAFC; border-left:3px solid #10B981; border-radius:6px; }
      .rc-remarks p { margin-top:6px; line-height:1.6; }
      @media print { body { padding:0; } }
    </style></head><body>${area.outerHTML}</body></html>`);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
}

/* ========================================================================
   (I) PARENT COMMUNICATION
   ======================================================================== */
function renderParentsPage() {
  populateParentOptions();
  renderMessagesHistory();
}

function populateParentOptions() {
  const grp = $('#parentOptionsGroup');
  const sel = $('#messageParent');
  if (grp) {
    const students = Store.get(Store.keys.students, []) || [];
    grp.innerHTML = students.map(s =>
      `<option value="p:${s.id}">${s.parentName} — ${s.name} (${s.class})</option>`
    ).join('');
  }
}

function sendMessageSubmit(e) {
  e.preventDefault();
  const val = $('#messageParent').value;
  const subject = $('#messageSubject').value.trim();
  const body = $('#messageBody').value.trim();
  if (!val) { toast('warning', 'Select Recipient', 'Please choose a parent or group.'); return; }
  if (!subject || !body) { toast('warning', 'Missing fields', 'Subject and message are required.'); return; }

  let recipientLabel = val;
  if (val.startsWith('p:')) {
    const sid = val.slice(2);
    const s = studentById(sid);
    recipientLabel = s ? `${s.parentName} (${s.name})` : val;
  } else if (val === 'all_parents') recipientLabel = 'All Parents';
  else if (val === 'class_jss') recipientLabel = 'JSS Parents';
  else if (val === 'class_sss') recipientLabel = 'SSS Parents';

  const msg = {
    id: uid(), recipient: val, recipientLabel,
    subject, body,
    status: 'sending',
    createdAt: new Date().toISOString()
  };
  const list = Store.get(Store.keys.messages, []);
  list.unshift(msg);
  Store.set(Store.keys.messages, list);
  addActivity('fa-paper-plane', 'blue', `Message sent: ${subject}`);

  /* Simulate sending */
  toast('info', 'Sending...', 'Message is being dispatched.');
  setTimeout(() => {
    const list2 = Store.get(Store.keys.messages, []);
    const idx = list2.findIndex(m => m.id === msg.id);
    if (idx >= 0) { list2[idx].status = 'sent'; Store.set(Store.keys.messages, list2); }
    renderMessagesHistory();
    toast('success', 'Message Sent', `Message delivered to ${recipientLabel}.`);
  }, 1100);

  $('#messageForm').reset();
  renderMessagesHistory();
}

function renderMessagesHistory() {
  const c = $('#messagesHistory');
  const badge = $('#msgCountBadge');
  if (!c) return;
  const list = Store.get(Store.keys.messages, []) || [];
  if (badge) badge.textContent = list.length;
  if (!list.length) {
    c.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>No communication yet. Compose your first message above.</p></div>`;
    return;
  }
  c.innerHTML = list.map(m => `
    <div class="msg-history-item ${m.status || 'sent'}">
      <div class="mhi-head">
        <div class="mhi-icon"><i class="fas fa-envelope${m.status === 'sent' ? '-open' : ''}"></i></div>
        <div class="mhi-title">
          <h6>${m.subject}</h6>
          <small>To: ${m.recipientLabel || m.recipient}</small>
        </div>
        <div class="mhi-meta">
          <span class="mhi-status ${m.status || 'sent'}">${m.status === 'sending' ? 'Sending…' : 'Sent'}</span>
          <small>${formatDateTime(m.createdAt)}</small>
        </div>
      </div>
      <div class="mhi-body"><p>${m.body}</p></div>
    </div>
  `).join('');
}

/* ========================================================================
   (J) ANNOUNCEMENTS
   ======================================================================== */
function renderAnnouncements() {
  const c = $('#announcementsGrid');
  if (!c) return;
  const list = (Store.get(Store.keys.announcements, []) || [])
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!list.length) {
    c.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-bullhorn"></i><p>No announcements yet. Create your first announcement.</p></div>`;
    return;
  }
  const priorityClass = { Urgent: 'p-urgent', High: 'p-high', Normal: 'p-normal' };
  const audienceIcon = { All: 'fa-users', Parents: 'fa-user-tie', Students: 'fa-user-graduate', Staff: 'fa-chalkboard-user' };
  c.innerHTML = list.map(a => `
    <article class="announcement-card">
      <div class="ac-priority ${priorityClass[a.priority] || 'p-normal'}"></div>
      <div class="ac-head">
        <div>
          <span class="chip chip-sm"><i class="fas ${audienceIcon[a.target] || 'fa-users'}"></i> ${a.target}</span>
          <span class="chip chip-sm chip-${a.priority === 'Urgent' ? 'danger' : a.priority === 'High' ? 'warning' : 'info'}">${a.priority}</span>
        </div>
        <div class="row-actions">
          <button class="icon-btn" data-act="edit-ann" data-id="${a.id}"><i class="fas fa-pen"></i></button>
          <button class="icon-btn danger" data-act="del-ann" data-id="${a.id}"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <h3 class="ac-title">${a.title}</h3>
      <p class="ac-body">${a.description}</p>
      <div class="ac-foot">
        <span><i class="far fa-calendar"></i> ${formatDate(a.date)}</span>
        <span><i class="fas fa-clock"></i> ${timeAgo(a.date + 'T09:00')}</span>
      </div>
    </article>
  `).join('');
}

function openAnnouncementModal(a) {
  $('#announcementEditId').value = a ? a.id : '';
  $('#annModalTitle').textContent = a ? 'Edit Announcement' : 'New Announcement';
  if (a) {
    $('#annTitle').value = a.title || '';
    $('#annTarget').value = a.target || 'All';
    $('#annPriority').value = a.priority || 'Normal';
    $('#annDescription').value = a.description || '';
  } else {
    $('#announcementForm').reset();
  }
  openModal('announcementModal');
}

function saveAnnouncementSubmit(e) {
  e.preventDefault();
  const editId = $('#announcementEditId').value;
  const title = $('#annTitle').value.trim();
  const target = $('#annTarget').value;
  const priority = $('#annPriority').value;
  const description = $('#annDescription').value.trim();
  if (!title || !description) { toast('warning', 'Validation', 'Title and description are required.'); return; }
  const list = Store.get(Store.keys.announcements, []) || [];
  if (editId) {
    const idx = list.findIndex(a => a.id === editId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], title, target, priority, description, date: isoDaysAgo(0) };
      addActivity('fa-pen', 'purple', `Announcement updated: ${title}`);
      toast('success', 'Updated', 'Announcement has been updated.');
    }
  } else {
    list.unshift({ id: uid(), title, target, priority, description, date: isoDaysAgo(0) });
    addActivity('fa-bullhorn', 'purple', `New announcement published: ${title}`);
    toast('success', 'Published', 'Announcement is now live.');
  }
  Store.set(Store.keys.announcements, list);
  closeModal('announcementModal');
  renderAnnouncements();
  if (currentPage === 'dashboard') renderRecentActivity();
}

function deleteAnnouncement(id) {
  const list = Store.get(Store.keys.announcements, []) || [];
  const a = list.find(x => x.id === id);
  confirmDialog({
    title: 'Delete Announcement?',
    message: a ? `Remove "${a.title}"? This cannot be undone.` : 'Remove this announcement?',
    iconClass: 'fa-trash',
    okText: 'Delete',
    onOk: () => {
      Store.set(Store.keys.announcements, list.filter(x => x.id !== id));
      toast('info', 'Deleted', 'Announcement removed.');
      renderAnnouncements();
    }
  });
}

/* ========================================================================
   (K) CALENDAR
   ======================================================================== */
let calState = { year: new Date().getFullYear(), month: new Date().getMonth(), selectedDate: null };

function renderCalendar() {
  const { year, month } = calState;
  const title = $('#calTitle');
  if (title) title.textContent = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const grid = $('#calDays');
  if (!grid) return;

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = first.getDay();
  const daysInMonth = last.getDate();
  const todayStr = isoDaysAgo(0);

  const events = Store.get(Store.keys.events, []) || [];

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ empty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayEvents = events.filter(e => e.date === ds);
    cells.push({
      empty: false, day: d, date: ds,
      isToday: ds === todayStr,
      isSelected: calState.selectedDate === ds,
      events: dayEvents
    });
  }
  while (cells.length % 7 !== 0) cells.push({ empty: true });

  const typeClass = { Exam: 'e-exam', PTA: 'e-pta', Holiday: 'e-holiday', Event: 'e-event' };

  grid.innerHTML = cells.map(c => {
    if (c.empty) return `<div class="cal-day empty"></div>`;
    const maxDots = 3;
    const visible = c.events.slice(0, maxDots);
    const extra = c.events.length - maxDots;
    return `
      <div class="cal-day ${c.isToday ? 'today' : ''} ${c.isSelected ? 'selected' : ''} ${c.events.length ? 'has-events' : ''}" data-date="${c.date}">
        <div class="cd-num">${c.day}</div>
        <div class="cd-dots">
          ${visible.map(e => `<span class="cd-dot ${typeClass[e.type] || 'e-event'}" title="${e.title}"></span>`).join('')}
          ${extra > 0 ? `<span class="cd-more">+${extra}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  renderEventDetails();
}

function renderEventDetails() {
  const c = $('#eventDetailsPanel');
  if (!c) return;
  const ds = calState.selectedDate;
  if (!ds) {
    c.innerHTML = `<div class="empty-state"><i class="fas fa-calendar-days"></i><p>Select a day on the calendar to view events.</p></div>`;
    return;
  }
  const events = (Store.get(Store.keys.events, []) || []).filter(e => e.date === ds);
  const typeClass = { Exam: 'e-exam', PTA: 'e-pta', Holiday: 'e-holiday', Event: 'e-event' };
  c.innerHTML = `
    <div class="ed-head">
      <h3>${formatDate(ds)}</h3>
      <button class="btn btn-sm btn-outline" id="btnAddEventHere"><i class="fas fa-plus"></i> Add</button>
    </div>
    ${events.length === 0 ? `<div class="empty-state-sm"><i class="fas fa-moon"></i> No events scheduled.</div>` : events.map(e => `
      <div class="ed-event">
        <div class="ev-tag ${typeClass[e.type] || 'e-event'}">${e.type}</div>
        <div class="ed-e-body">
          <h6>${e.title}</h6>
          ${e.notes ? `<small>${e.notes}</small>` : ''}
          <div class="row-actions" style="margin-top:8px">
            <button class="icon-btn danger" data-act="del-event" data-id="${e.id}"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      </div>
    `).join('')}
  `;
  $('#btnAddEventHere')?.addEventListener('click', () => openEventModal(ds));
}

function openEventModal(dateStr) {
  $('#eventForm').reset();
  if (dateStr) $('#eventDate').value = dateStr;
  else $('#eventDate').value = isoDaysFromNow(1);
  openModal('eventModal');
}

function saveEventSubmit(e) {
  e.preventDefault();
  const title = $('#eventTitle').value.trim();
  const date = $('#eventDate').value;
  const type = $('#eventType').value;
  const notes = $('#eventNotes').value.trim();
  if (!title || !date) { toast('warning', 'Validation', 'Title and date are required.'); return; }
  const list = Store.get(Store.keys.events, []) || [];
  list.push({ id: uid(), title, date, type, notes });
  Store.set(Store.keys.events, list);
  addActivity('fa-calendar-plus', 'purple', `Calendar event added: ${title}`);
  toast('success', 'Event Added', `${title} on ${formatDate(date)}`);
  closeModal('eventModal');
  renderCalendar();
  if (currentPage === 'dashboard') { renderUpcomingEvents(); renderDashboard(); }
}

function deleteEvent(id) {
  confirmDialog({
    title: 'Remove Event?',
    message: 'This event will be removed from the calendar.',
    iconClass: 'fa-trash',
    okText: 'Remove',
    onOk: () => {
      Store.set(Store.keys.events, (Store.get(Store.keys.events, []) || []).filter(e => e.id !== id));
      renderCalendar();
      toast('info', 'Removed', 'Event deleted.');
    }
  });
}

/* ========================================================================
   (L) SETTINGS
   ======================================================================== */
function applySettingsToUI() {
  const s = Store.get(Store.keys.settings, {}) || {};
  const sidebar = $('#sidebarSchoolName');
  if (sidebar) sidebar.textContent = (s.schoolName || 'Starways').split(/\s+/)[0];
  const dash = $('#dashSchoolName');
  if (dash) dash.textContent = s.schoolName || 'Starways College';
  document.title = `${s.schoolName || 'Starways College'} | School Operations Dashboard`;

  const avatarImg = $('#profileAvatarImg');
  const avatarText = $('#profileAvatarText');
  if (s.logo) {
    if (avatarImg) { avatarImg.src = s.logo; avatarImg.style.display = ''; }
    if (avatarText) avatarText.style.display = 'none';
  } else {
    if (avatarImg) avatarImg.style.display = 'none';
    if (avatarText) { avatarText.style.display = ''; avatarText.textContent = (s.schoolName || 'A')[0].toUpperCase(); }
  }
}

function loadSettingsForm() {
  const s = Store.get(Store.keys.settings, {}) || {};
  $('#settingSchoolName').value = s.schoolName || '';
  $('#settingEmail').value = s.email || '';
  $('#settingPhone').value = s.phone || '';
  $('#settingAddress').value = s.address || '';
  $('#settingSession').value = s.session || '';
  $('#settingTerm').value = s.term || '1st Term';

  const preview = $('#logoPreview');
  const removeBtn = $('#btnRemoveLogo');
  if (preview) {
    preview.innerHTML = s.logo
      ? `<img src="${s.logo}" alt="Logo">`
      : `<i class="fas fa-graduation-cap"></i>`;
  }
  if (removeBtn) removeBtn.style.display = s.logo ? '' : 'none';

  applyTheme();
}

function saveSettingsGeneral(e) {
  e.preventDefault();
  const cur = Store.get(Store.keys.settings, {}) || {};
  const next = {
    ...cur,
    schoolName: $('#settingSchoolName').value.trim() || 'Starways College',
    email: $('#settingEmail').value.trim(),
    phone: $('#settingPhone').value.trim(),
    address: $('#settingAddress').value.trim()
  };
  Store.set(Store.keys.settings, next);
  applySettingsToUI();
  toast('success', 'Saved', 'General settings updated.');
  addActivity('fa-gear', 'blue', 'School information updated');
}

function saveSettingsAcademic(e) {
  e.preventDefault();
  const cur = Store.get(Store.keys.settings, {}) || {};
  cur.session = $('#settingSession').value.trim();
  cur.term = $('#settingTerm').value;
  Store.set(Store.keys.settings, cur);
  toast('success', 'Saved', 'Academic settings updated.');
  addActivity('fa-gear', 'orange', 'Academic settings updated');
}

function handleLogoUpload(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('error', 'File Too Large', 'Logo must be under 2MB.'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const base64 = ev.target.result;
    const cur = Store.get(Store.keys.settings, {}) || {};
    cur.logo = base64;
    Store.set(Store.keys.settings, cur);
    applySettingsToUI();
    const preview = $('#logoPreview');
    if (preview) preview.innerHTML = `<img src="${base64}" alt="Logo">`;
    const rb = $('#btnRemoveLogo'); if (rb) rb.style.display = '';
    toast('success', 'Logo Updated', 'New school logo saved.');
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  const cur = Store.get(Store.keys.settings, {}) || {};
  cur.logo = null;
  Store.set(Store.keys.settings, cur);
  applySettingsToUI();
  const preview = $('#logoPreview');
  if (preview) preview.innerHTML = `<i class="fas fa-graduation-cap"></i>`;
  const rb = $('#btnRemoveLogo'); if (rb) rb.style.display = 'none';
  toast('info', 'Removed', 'Logo has been cleared.');
}

function resetDemoData() {
  confirmDialog({
    title: 'Reset Demo Data?',
    message: 'All your local data (students, fees, results, messages, announcements, events, settings) will be replaced with fresh demo data.',
    iconClass: 'fa-rotate',
    okText: 'Reset Data',
    onOk: () => {
      Store.resetAll();
      Store.seedIfEmpty();
      applySettingsToUI();
      applyTheme();
      navigateTo('dashboard');
      toast('success', 'Reset Complete', 'Demo data has been restored.');
    }
  });
}

/* ========================================================================
   (M) NOTIFICATIONS DROPDOWN
   ======================================================================== */
function renderNotifications() {
  const list = $('#notifList');
  const dot = $('#notifDot');
  if (!list) return;
  const students = Store.get(Store.keys.students, []) || [];
  const fees = Store.get(Store.keys.fees, []) || [];
  const events = Store.get(Store.keys.events, []) || [];
  const anns = Store.get(Store.keys.announcements, []) || [];

  const notifs = [];
  const balMore = fees
    .map(f => ({ s: studentById(f.studentId), bal: Math.max(0, (f.amountDue || 0) - (f.amountPaid || 0)) }))
    .filter(x => x.s && x.bal > 0);
  if (balMore.length > 0) {
    notifs.push({
      id: uid(), color: 'orange', icon: 'fa-triangle-exclamation', unread: true,
      title: `${balMore.length} student${balMore.length === 1 ? '' : 's'} with outstanding fees`,
      body: `Total of ${fmtNaira(balMore.reduce((s, x) => s + x.bal, 0))} pending`,
      time: isoDaysAgo(0) + 'T08:00'
    });
  }
  anns.slice(0, 2).forEach(a => notifs.push({
    id: uid(), color: 'purple', icon: 'fa-bullhorn', unread: false,
    title: a.title, body: `Target: ${a.target} · Priority: ${a.priority}`, time: a.date + 'T09:00'
  }));
  const upcoming = events.filter(e => {
    const diff = (new Date(e.date) - new Date(isoDaysAgo(0))) / 86400000;
    return diff >= 0 && diff <= 10;
  }).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 3);
  upcoming.forEach(e => notifs.push({
    id: uid(), color: 'blue', icon: 'fa-calendar', unread: false,
    title: `${e.type}: ${e.title}`,
    body: `${formatDate(e.date)}${e.notes ? ' · ' + e.notes : ''}`,
    time: e.date + 'T09:00'
  }));

  if (!notifs.length) {
    list.innerHTML = `<div class="empty-state-sm" style="padding:30px 10px"><i class="fas fa-circle-check"></i> All caught up!</div>`;
  } else {
    list.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.unread ? 'unread' : ''}">
        <div class="notif-icon ni-${n.color}"><i class="fas ${n.icon}"></i></div>
        <div class="notif-body">
          <h6>${n.title}</h6>
          <small>${n.body}</small>
          <span class="notif-time">${timeAgo(n.time)}</span>
        </div>
      </div>
    `).join('');
  }
  if (dot) dot.style.display = notifs.some(n => n.unread) ? '' : 'none';
}

/* ========================================================================
   (N) HEADER / SIDEBAR UI HELPERS
   ======================================================================== */
function toggleSidebarCollapse() {
  const sb = $('#sidebar');
  sb.classList.toggle('collapsed');
}

function openSidebarMobile() {
  $('#sidebar').classList.add('mobile-show');
  $('#sidebarOverlay').classList.add('show');
}
function closeSidebarMobile() {
  $('#sidebar').classList.remove('mobile-show');
  $('#sidebarOverlay').classList.remove('show');
}

/* ========================================================================
   (O) DOCUMENT READY / BOOTSTRAP
   ======================================================================== */
document.addEventListener('DOMContentLoaded', () => {

  /* ------ Preloader ------ */
  setTimeout(() => {
    const pl = $('#pageLoader');
    if (pl) pl.classList.add('hidden');
  }, 650);

  $('#loginYear').textContent = new Date().getFullYear();

  /* ------ Seed ------ */
  Store.seedIfEmpty();

  /* ------ Theme ------ */
  applyTheme();

  /* ------ Auth check ------ */
  checkAuth();

  /* ============================================================
     EVENT WIRING
     ============================================================ */

  /* ---------- Theme toggle ---------- */
  $('#themeToggleBtn')?.addEventListener('click', toggleTheme);
  $$('.theme-option').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.themePref)));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (getThemePref() === 'auto') applyTheme();
  });
  window.addEventListener('resize', () => {
    if (currentPage === 'dashboard') renderIncomeChart();
  });

  /* ---------- Password toggle ---------- */
  $('#passwordToggle')?.addEventListener('click', () => {
    const inp = $('#loginPassword');
    const icon = $('#passwordToggle i');
    if (inp.type === 'password') { inp.type = 'text'; icon.className = 'fas fa-eye-slash'; }
    else { inp.type = 'password'; icon.className = 'fas fa-eye'; }
  });

  /* ---------- Login ---------- */
  $('#loginForm')?.addEventListener('submit', e => {
    e.preventDefault();
    doLogin($('#loginEmail').value.trim(), $('#loginPassword').value);
  });

  /* ---------- Logout buttons ---------- */
  $('#logoutBtn')?.addEventListener('click', doLogout);
  $('#headerLogout')?.addEventListener('click', e => { e.preventDefault(); doLogout(); });

  /* ---------- Sidebar nav ---------- */
  $$('.sidebar-nav .nav-link').forEach(l => {
    l.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(l.dataset.page);
    });
  });
  $$('[data-page]').forEach(el => {
    if (!el.closest('.sidebar-nav')) {
      el.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(el.dataset.page);
      });
    }
  });

  /* ---------- Sidebar collapse & mobile ---------- */
  $('#sidebarCollapse')?.addEventListener('click', toggleSidebarCollapse);
  $('#headerMenuBtn')?.addEventListener('click', openSidebarMobile);
  $('#mobileSidebarToggle')?.addEventListener('click', openSidebarMobile);
  $('#sidebarOverlay')?.addEventListener('click', closeSidebarMobile);

  /* ---------- Modals: data-close-modal ---------- */
  $$('[data-close-modal]').forEach(el => {
    el.addEventListener('click', () => closeAllModals());
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllModals();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#headerSearch')?.focus();
    }
  });

  /* ---------- Header dropdowns ---------- */
  const notifBtn = $('#notifBtn');
  const notifDrop = $('#notificationsDropdown');
  notifBtn?.addEventListener('click', e => {
    e.stopPropagation();
    notifDrop.classList.toggle('show');
    $('#profileDropdown').classList.remove('show');
  });
  const profileTrigger = $('#profileTrigger');
  const profileDrop = $('#profileDropdown');
  profileTrigger?.addEventListener('click', e => {
    e.stopPropagation();
    profileDrop.classList.toggle('show');
    notifDrop.classList.remove('show');
  });
  document.addEventListener('click', () => {
    notifDrop?.classList.remove('show');
    profileDrop?.classList.remove('show');
  });
  $('.notif-mark-all')?.addEventListener('click', () => toast('info', 'Notifications', 'All notifications marked as read.'));

  /* ---------- Header search (live) ---------- */
  $('#headerSearch')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    /* lightweight: jump to relevant page if matches page name */
    const map = { dash: 'dashboard', student: 'students', fee: 'fees', result: 'results', parent: 'parents', announc: 'announcements', calendar: 'calendar', setting: 'settings' };
    for (const [k, v] of Object.entries(map)) {
      if (q.includes(k)) { navigateTo(v); return; }
    }
    /* else propagate to students if there's a query */
    if (currentPage === 'students') { studentState.q = q; studentState.page = 1; refreshStudentsTable(); }
    else if (currentPage === 'fees') { feeState.q = q; feeState.page = 1; refreshFeesTable(); }
  });

  /* ---------- Dashboard quick actions ---------- */
  $('#btnQuickStudent')?.addEventListener('click', () => openStudentModal(null));
  $('#btnQuickPayment')?.addEventListener('click', () => openPaymentModal(null));

  /* ---------- Income chart range ---------- */
  $('#incomeChartRange')?.addEventListener('change', renderIncomeChart);

  /* ================================================================
     STUDENTS PAGE EVENTS
     ================================================================ */
  $('#btnAddStudent')?.addEventListener('click', () => openStudentModal(null));
  $('#btnExportCSV')?.addEventListener('click', exportStudentsCSV);
  $('#studentSearch')?.addEventListener('input', e => { studentState.q = e.target.value; studentState.page = 1; refreshStudentsTable(); });
  $('#filterClass')?.addEventListener('change', e => { studentState.classFilter = e.target.value; studentState.page = 1; refreshStudentsTable(); });
  $('#filterGender')?.addEventListener('change', e => { studentState.genderFilter = e.target.value; studentState.page = 1; refreshStudentsTable(); });
  $('#filterFeeStatus')?.addEventListener('change', e => { studentState.feeFilter = e.target.value; studentState.page = 1; refreshStudentsTable(); });

  $('#studentForm')?.addEventListener('submit', saveStudentSubmit);

  /* students table actions (delegate) */
  $('#studentsTableBody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'edit-student') {
      const s = studentById(id);
      if (s) openStudentModal(s);
    } else if (act === 'del-student') {
      deleteStudentConfirm(id);
    } else if (act === 'view-student-fees') {
      openPaymentModal(id);
    }
  });

  /* ================================================================
     FEES PAGE EVENTS
     ================================================================ */
  $('#btnRecordPayment')?.addEventListener('click', () => openPaymentModal(null));
  $('#feeSearch')?.addEventListener('input', e => { feeState.q = e.target.value; feeState.page = 1; refreshFeesTable(); });
  $('#feeFilterStatus')?.addEventListener('change', e => { feeState.statusFilter = e.target.value; feeState.page = 1; refreshFeesTable(); });
  $('#paymentStudent')?.addEventListener('change', updateFeeSummaryBox);
  $('#paymentForm')?.addEventListener('submit', recordPaymentSubmit);

  $('#feesTableBody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act="record-payment"]');
    if (!btn) return;
    openPaymentModal(btn.dataset.id);
  });

  /* ================================================================
     RESULTS PAGE EVENTS
     ================================================================ */
  $$('.subject-score').forEach(inp => inp.addEventListener('input', computeLiveResultPreview));
  $('#btnResetResult')?.addEventListener('click', () => {
    $('#resultForm').reset();
    $('#resultStudent').value = '';
    computeLiveResultPreview();
  });
  $('#resultForm')?.addEventListener('submit', saveResultSubmit);
  $('#resultsFilter')?.addEventListener('change', renderResultsList);
  $('#btnPrintReport')?.addEventListener('click', printReport);

  $('#resultsList')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (act === 'view-report') openReportCard(id);
    else if (act === 'del-result') {
      confirmDialog({
        title: 'Delete Result?',
        message: 'This result record will be permanently removed.',
        iconClass: 'fa-trash',
        okText: 'Delete',
        onOk: () => {
          Store.set(Store.keys.results, (Store.get(Store.keys.results, []) || []).filter(r => r.id !== id));
          renderResultsList();
          toast('info', 'Deleted', 'Result removed.');
        }
      });
    }
  });

  /* ================================================================
     PARENTS PAGE EVENTS
     ================================================================ */
  $('#btnClearMsg')?.addEventListener('click', () => $('#messageForm').reset());
  $('#messageForm')?.addEventListener('submit', sendMessageSubmit);

  /* ================================================================
     ANNOUNCEMENTS EVENTS
     ================================================================ */
  $('#btnNewAnnouncement')?.addEventListener('click', () => openAnnouncementModal(null));
  $('#announcementForm')?.addEventListener('submit', saveAnnouncementSubmit);
  $('#announcementsGrid')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const a = (Store.get(Store.keys.announcements, []) || []).find(x => x.id === id);
    if (act === 'edit-ann') openAnnouncementModal(a);
    else if (act === 'del-ann') deleteAnnouncement(id);
  });

  /* ================================================================
     CALENDAR EVENTS
     ================================================================ */
  $('#calPrev')?.addEventListener('click', () => {
    calState.month--;
    if (calState.month < 0) { calState.month = 11; calState.year--; }
    renderCalendar();
  });
  $('#calNext')?.addEventListener('click', () => {
    calState.month++;
    if (calState.month > 11) { calState.month = 0; calState.year++; }
    renderCalendar();
  });
  $('#calDays')?.addEventListener('click', e => {
    const day = e.target.closest('.cal-day');
    if (!day || day.classList.contains('empty')) return;
    calState.selectedDate = day.dataset.date;
    renderCalendar();
  });
  $('#btnAddEvent')?.addEventListener('click', () => openEventModal(calState.selectedDate));
  $('#eventForm')?.addEventListener('submit', saveEventSubmit);
  $('#eventDetailsPanel')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act="del-event"]');
    if (btn) deleteEvent(btn.dataset.id);
  });

  /* ================================================================
     SETTINGS EVENTS
     ================================================================ */
  $$('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      $$('.settings-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    });
  });
  $('#settingsGeneralForm')?.addEventListener('submit', saveSettingsGeneral);
  $('#settingsAcademicForm')?.addEventListener('submit', saveSettingsAcademic);
  $('#btnUploadLogo')?.addEventListener('click', () => $('#logoInput').click());
  $('#logoInput')?.addEventListener('change', e => handleLogoUpload(e.target.files[0]));
  $('#btnRemoveLogo')?.addEventListener('click', removeLogo);
  $('#btnResetDemo')?.addEventListener('click', resetDemoData);

  /* ------ Render initial view ----- */
  if (Store.get(Store.keys.auth, null)?.loggedIn) {
    /* view already set via checkAuth -> navigateTo -> renderDashboard */
  }
});

/* ---------- End of file ---------- */
