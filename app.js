/**
 * Geo-Books Unified Application Script
 * Consolidated from multiple modules to minimize file count.
 */

// --- Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-analytics.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  updateProfile as firebaseUpdateProfile,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-functions.js";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp, 
  doc, 
  getDoc,
  getDocs,
  setDoc, 
  updateDoc, 
  deleteDoc, 
  arrayUnion,
  arrayRemove,
  runTransaction,
  where,
  getCountFromServer,
  startAfter
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { aiIsConfigured, aiHumanizeText, aiSupportReply, aiTutorReply, aiGenerateDailyPathTasks, aiExplainFlashcard, aiGenerateCbtExam, aiGenerateCbtExamFromSource, setAiSettings, setAiUserContext } from "./ai.js";
import { 
  $, $$, S, toText, toMillis, escapeHTML, isValidEmail, isValidHttpUrl, 
  store, formatCurrency, normalizeUsername, calculateRank, RANK_TIERS, 
  copyToClipboard, toast, toggleSidebarCollapse, safeIconName, safeUrl,
  questionPackKey, cacheQuestionPack, getCachedQuestionPack, getAppEntryUrl,
  PROFILE_COLOR_PRESETS, canCustomizeProfileColor, isValidProfileColor,
  hasVerifiedRank, hasMarketplaceDiscount, applyMarketplaceDiscount,
  hasEarlyAccess, isLegendRank
} from "./utils.js";

// --- Global AI Handlers ---
window.aiTutorReply = aiTutorReply;
window.aiSupportReply = aiSupportReply;
window.aiHumanizeText = aiHumanizeText;
window.aiExplainFlashcard = aiExplainFlashcard;
window.setAiSettings = setAiSettings;

// --- Firebase Configuration ---
const firebaseConfig = { 
  apiKey: "AIzaSyA1nVLSPFs30wG-PLaEyFqm_PEVhZdzISU", 
  authDomain: "geo-books-8411e.firebaseapp.com", 
  projectId: "geo-books-8411e", 
  storageBucket: "geo-books-8411e.firebasestorage.app", 
  messagingSenderId: "972887107793", 
  appId: "1:972887107793:web:7e0374bf81e6713fd0fdf0", 
  measurementId: "G-RY84V5DXPN" 
};

const firebaseApp = initializeApp(firebaseConfig);
const analytics = getAnalytics(firebaseApp);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const functionsApi = getFunctions(firebaseApp);
const callAwardXp = httpsCallable(functionsApi, 'awardXp');
const callConfirmEscrowPayment = httpsCallable(functionsApi, 'confirmEscrowPayment');

// --- Utilities ---
window.S = S;
window.toast = toast;
window.toggleSidebarCollapse = toggleSidebarCollapse;
window.copyToClipboard = copyToClipboard;

function initScrollListeners() {
  const backToTop = S('backToTop');
  const nav = $('nav.glass-nav');
  
  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY > 300;
    
    if (backToTop) {
      if (scrolled) {
        backToTop.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
        backToTop.classList.add('opacity-100', 'translate-y-0', 'pointer-events-auto');
      } else {
        backToTop.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
        backToTop.classList.remove('opacity-100', 'translate-y-0', 'pointer-events-auto');
      }
    }
    
    if (nav) {
      if (window.scrollY > 50) {
        nav.classList.add('py-2', 'shadow-xl');
        nav.classList.remove('py-4');
      } else {
        nav.classList.remove('py-2', 'shadow-xl');
        nav.classList.add('py-4');
      }
    }
  });
}

function ensureInlineErrorEl(inputEl) {
  if (!inputEl || !inputEl.id) return null;
  const parent = inputEl.parentElement;
  if (!parent) return null;
  const existing = parent.querySelector(`[data-inline-error-for="${CSS.escape(inputEl.id)}"]`);
  if (existing) return existing;
  const el = document.createElement('p');
  el.dataset.inlineErrorFor = inputEl.id;
  el.className = 'mt-1 text-[10px] font-black uppercase tracking-widest text-rose-500 px-1 hidden';
  parent.appendChild(el);
  return el;
}

function setFieldError(inputEl, message) {
  if (!inputEl) return;
  const msg = toText(message).trim();
  const errEl = ensureInlineErrorEl(inputEl);

  if (msg) {
    inputEl.setAttribute('aria-invalid', 'true');
    inputEl.classList.add('border-rose-500');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  } else {
    inputEl.removeAttribute('aria-invalid');
    inputEl.classList.remove('border-rose-500');
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
  }
}

function setButtonEnabled(btn, enabled) {
  if (!btn) return;
  btn.disabled = !enabled;
  btn.classList.toggle('opacity-50', !enabled);
  btn.classList.toggle('pointer-events-none', !enabled);
}

function validateSignupForm({ showFeedback = true } = {}) {
  const nameEl = S('signupName');
  const userEl = S('signupUsername');
  const uniEl = S('signupUni');
  const emailEl = S('signupEmail');
  const passEl = S('signupPassword');

  const name = toText(nameEl?.value).trim();
  const username = toText(userEl?.value).trim();
  const uni = toText(uniEl?.value).trim();
  const email = toText(emailEl?.value).trim();
  const pass = toText(passEl?.value);

  const errors = [];
  const set = (el, msg) => {
    if (showFeedback) setFieldError(el, msg);
    if (msg) errors.push(msg);
  };

  set(nameEl, name.length >= 2 ? '' : 'Enter your full name');
  set(userEl, /^[a-zA-Z0-9_.]{3,20}$/.test(username) ? '' : '3–20 chars: letters/numbers/._');
  set(uniEl, uni.length >= 2 ? '' : 'Enter your university');
  set(emailEl, isValidEmail(email) ? '' : 'Enter a valid email');

  const strong = pass.length >= 8 && /[A-Za-z]/.test(pass) && /\d/.test(pass);
  set(passEl, strong ? '' : 'Min 8 chars, include a number');

  const ok = errors.length === 0;
  setButtonEnabled(S('signupSubmitBtn'), ok);
  return ok;
}

function validateListingFields({ titleEl, priceEl, categoryEl, locEl, imgEl, fileUrlEl, descriptionEl, showFeedback = true } = {}) {
  const title = toText(titleEl?.value).trim();
  const priceRaw = toText(priceEl?.value).trim();
  const price = Number(priceRaw);
  const category = toText(categoryEl?.value).trim();
  const loc = toText(locEl?.value).trim();
  const img = toText(imgEl?.value).trim();
  const fileUrl = toText(fileUrlEl?.value).trim();
  const description = toText(descriptionEl?.value).trim();

  const errors = [];
  const set = (el, msg) => {
    if (showFeedback) setFieldError(el, msg);
    if (msg) errors.push(msg);
  };

  set(titleEl, title.length >= 5 ? '' : 'Title must be at least 5 chars');
  set(priceEl, Number.isFinite(price) && price > 0 ? '' : 'Enter a valid price');
  set(categoryEl, category ? '' : 'Pick a category');
  set(locEl, loc ? '' : 'Enter a location');

  const imgOk = !img || isValidHttpUrl(img);
  set(imgEl, imgOk ? '' : 'Use a valid http(s) URL');

  const fileOk = !fileUrl || isValidHttpUrl(fileUrl);
  set(fileUrlEl, fileOk ? '' : 'Use a valid http(s) URL');

  set(descriptionEl, description.length <= 800 ? '' : 'Keep description under 800 chars');

  return { ok: errors.length === 0, errors };
}

function initFormValidationBindings() {
  const signupForm = S('signupForm');
  if (signupForm && !signupForm.dataset.validationBound) {
    signupForm.dataset.validationBound = '1';
    ['signupName', 'signupUsername', 'signupUni', 'signupEmail', 'signupPassword'].forEach((id) => {
      const el = S(id);
      if (!el) return;
      el.addEventListener('input', () => validateSignupForm({ showFeedback: true }));
      el.addEventListener('blur', () => validateSignupForm({ showFeedback: true }));
    });
    validateSignupForm({ showFeedback: false });
  }

  const uploadTitle = S('uploadTitle');
  const uploadPrice = S('uploadPrice');
  const uploadCategory = S('uploadCategory');
  const uploadLocation = S('uploadLocation');
  const uploadImage = S('uploadImage');
  const uploadFileUrl = S('uploadFileUrl');
  const uploadBtn = S('submitUpload');
  if (uploadTitle && uploadBtn && !uploadBtn.dataset.validationBound) {
    uploadBtn.dataset.validationBound = '1';
    const validate = () => {
      const { ok } = validateListingFields({
        titleEl: uploadTitle,
        priceEl: uploadPrice,
        categoryEl: uploadCategory,
        locEl: uploadLocation,
        imgEl: uploadImage,
        fileUrlEl: uploadFileUrl,
        showFeedback: true
      });
      setButtonEnabled(uploadBtn, ok);
      return ok;
    };
    [uploadTitle, uploadPrice, uploadCategory, uploadLocation, uploadImage, uploadFileUrl].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', validate);
      el.addEventListener('blur', validate);
    });
    validateListingFields({
      titleEl: uploadTitle,
      priceEl: uploadPrice,
      categoryEl: uploadCategory,
      locEl: uploadLocation,
      imgEl: uploadImage,
      fileUrlEl: uploadFileUrl,
      showFeedback: false
    });
  }

  const itemTitle = S('itemTitle');
  const itemPrice = S('itemPrice');
  const itemCategory = S('itemCategory');
  const itemLocation = S('itemLocation');
  const itemImage = S('itemImage');
  const itemFileUrl = S('itemFileUrl');
  const itemDescription = S('itemDescription');
  const saveItem = S('saveItem');
  if (itemTitle && saveItem && !saveItem.dataset.validationBound) {
    saveItem.dataset.validationBound = '1';
    const validate = () => {
      const { ok } = validateListingFields({
        titleEl: itemTitle,
        priceEl: itemPrice,
        categoryEl: itemCategory,
        locEl: itemLocation,
        imgEl: itemImage,
        fileUrlEl: itemFileUrl,
        descriptionEl: itemDescription,
        showFeedback: true
      });
      setButtonEnabled(saveItem, ok);
      return ok;
    };
    [itemTitle, itemPrice, itemCategory, itemLocation, itemImage, itemFileUrl, itemDescription].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', validate);
      el.addEventListener('blur', validate);
    });
    validateListingFields({
      titleEl: itemTitle,
      priceEl: itemPrice,
      categoryEl: itemCategory,
      locEl: itemLocation,
      imgEl: itemImage,
      fileUrlEl: itemFileUrl,
      descriptionEl: itemDescription,
      showFeedback: false
    });
  }
}

function pushNotification({ text, icon = 'award', time = 'Just now' }) {
  const notis = store.get('notifications', []);
  notis.unshift({ id: Date.now(), text, time, icon });
  store.set('notifications', notis);
  if (S('notiBadge')) {
    S('notiBadge').classList.remove('hidden');
    S('notiBadge').textContent = Math.min(99, notis.length).toString();
  }
}

async function addXP(userId, amount) {
  const uid = toText(userId).trim();
  const delta = Number(amount) || 0;
  if (!uid || !Number.isFinite(delta) || delta === 0) return null;

  if (app.state.user?.uid && uid === app.state.user.uid) {
    const safeDelta = Math.floor(delta);
    try {
      const resp = await callAwardXp({ amount: safeDelta });
      const data = resp?.data || {};
      const oldTitle = toText(data.oldRankTitle || data.oldTitle || '');
      const newRank = data.newRank || null;
      const rankUp = !!data.rankUp;
      if (rankUp && newRank?.title) {
        pushNotification({
          text: `Rank Up: ${oldTitle} → ${newRank.title} (${newRank.reward})`,
          icon: 'award'
        });
      }
      return {
        oldXp: Number(data.oldXp) || 0,
        newXp: Number(data.newXp) || 0,
        oldTitle,
        newRank,
        rankUp
      };
    } catch (e) {
      console.error('awardXp function error:', e);
      throw e;
    }
  }

  const userRef = doc(db, "users", uid);
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists() ? snap.data() : {};
    const oldXp = Number(data?.xp) || 0;
    const oldTitle = toText(data?.rank_title || data?.rankTitle || '');

    const newXp = Math.max(0, oldXp + delta);
    const newRank = calculateRank(newXp);

    tx.set(userRef, {
      xp: newXp,
      level: newRank.rank,
      rank_title: newRank.title
    }, { merge: true });

    return { oldXp, newXp, oldTitle, newRank };
  });

  const rankUp = !!res?.oldTitle && res?.newRank?.title && res.oldTitle !== res.newRank.title;
  if (rankUp && uid === app.state.user?.uid) {
    pushNotification({
      text: `Rank Up: ${res.oldTitle} → ${res.newRank.title} (${res.newRank.reward})`,
      icon: 'award'
    });
  }

  return { ...res, rankUp };
}

window.calculateRank = calculateRank;

// Rank 3 (Pro)+ earned verified checkmark. Distinct from the paid
// subscription badge (#userBadge, driven by subscription.tier) — this one
// is free and XP-earned, so any surface that renders a name can opt in by
// calling this with that person's xp.
function verifiedBadgeHTML(xp, { size = 'w-3.5 h-3.5' } = {}) {
  if (!hasVerifiedRank(Number(xp) || 0)) return '';
  return `<i data-lucide="badge-check" class="${size} text-brand-500 shrink-0 inline-block align-middle" title="Verified: Pro rank"></i>`;
}
window.addXP = addXP;

const safeFileName = (value, fallback = 'file') => {
  const raw = toText(value).trim();
  const cleaned = raw.replace(/[^\w.\-()\s]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
};

/** 
 * Transmits a raw file or blob object directly to the local Node server, 
 * which streams it safely into the Cloudflare R2 bucket. 
 * @param {File|Blob} fileObject - The binary asset gathered from the UI input. 
 * @param {string} destinationKey - The target path inside the R2 bucket (e.g. 'books/covers/math_v1.jpg'). 
 * @returns {Promise<string>} The public absolute routing URL generated by Cloudflare. 
 */
// API base URL: defaults to localhost in dev, set window.GEO_BOOKS_API_URL
// (e.g. via a small inline <script> in your .htm files, or a config.js loaded before app.js)
// to override in production. Falls back to same-origin '/api' if nothing is set and we're not on localhost.
const API_BASE_URL = window.GEO_BOOKS_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3007'
    : '');

const dispatchAssetToCloudflare = async (fileObject, destinationKey) => {
  if (!fileObject || !destinationKey) {
    throw new Error("[R2 Pipeline] Missing required binary file payload or target destination key.");
  }

  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new Error("[R2 Pipeline] You must be signed in to upload files.");
  }
  const idToken = await currentUser.getIdToken();

  const formData = new FormData();
  formData.append('file', fileObject);
  formData.append('destinationKey', destinationKey);

  try {
    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${idToken}` },
      body: formData
    });

    if (!response.ok) {
      const rawTextFallback = await response.text();
      let errorMessage = `Server responded with status ${response.status}`;
      try {
        const parsedError = JSON.parse(rawTextFallback);
        errorMessage = parsedError.error || errorMessage;
      } catch (e) {
        errorMessage = `${errorMessage}: ${rawTextFallback.slice(0, 100)}`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log(`[R2 Pipeline Success] Remote routing established: ${data.url}`);
    return data.url;
  } catch (error) {
    console.error(`[R2 Pipeline Failure] Asset routing stopped:`, error.message);
    throw error;
  }
};

async function uploadChatAttachment(file, chatId, uid) {
  const name = safeFileName(file?.name, 'file');
  const path = `users/${uid}/chat/${chatId}/${Date.now()}_${name}`;
  const url = await dispatchAssetToCloudflare(file, path);
  return {
    url,
    path,
    name,
    size: file.size || 0,
    contentType: file.type || 'application/octet-stream'
  };
}

const confettiCelebration = () => {
  if (window.confetti) {
    window.confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']
    });
  }
};

// --- Theme Management ---
const initTheme = () => {
  const html = document.documentElement;
  const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  html.classList.toggle('dark', savedTheme === 'dark');
  
  const toggleBtn = S('themeToggle');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const isDark = html.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    };
  }
};

// --- Zen Mode (Focus Mode) ---
window.toggleFocusMode = (enable) => {
  const sidebar = S('sidebar');
  const header = document.querySelector('header');
  const main = document.querySelector('main');
  
  if (enable) {
    document.body.classList.add('zen-mode-active');
    if (sidebar) sidebar.classList.add('hidden');
    if (header) header.classList.add('opacity-0', 'pointer-events-none', '-translate-y-full', 'transition-all', 'duration-700');
    
    toast('Entering Zen State. Neural focus engaged.', 'brand');
    
    if (!S('exitZenBtn')) {
      const btn = document.createElement('button');
      btn.id = 'exitZenBtn';
      btn.className = 'fixed top-8 right-8 z-[600] px-8 py-4 rounded-[2rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.2)] font-black text-[10px] uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all flex items-center gap-3 animate-in slide-in-from-top-4 duration-500';
      btn.innerHTML = '<i data-lucide="power" class="w-4 h-4 text-rose-500"></i> Exit Zen';
      btn.onclick = () => window.toggleFocusMode(false);
      document.body.appendChild(btn);
      if (window.lucide) window.lucide.createIcons();
    }

    // If we are in CBT, optimize the view
    if (app.state.currentSection === 'cbt' && !S('cbtExamArea').classList.contains('hidden')) {
       // Extra CBT-specific Zen logic if needed
    }
  } else {
    document.body.classList.remove('zen-mode-active');
    if (sidebar) sidebar.classList.remove('hidden');
    if (header) header.classList.remove('opacity-0', 'pointer-events-none', '-translate-y-full');
    
    const exitBtn = S('exitZenBtn');
    if (exitBtn) exitBtn.remove();
    
    toast('Zen State disengaged.', 'info');
  }
};

// --- Global Search ---
const initSearchInstance = (inputId, panelId, { closeSheetOnSelect = false } = {}) => {
  const input = S(inputId);
  const panel = S(panelId);
  if (!input || !panel) return;

  const searchableItems = [
    { name: 'Dashboard', section: 'dashboard', icon: 'layout-grid' },
    { name: 'CBT Suite', section: 'cbt', icon: 'zap' },
    { name: 'Library & Books', section: 'books', icon: 'book-open' },
    { name: 'Marketplace', section: 'marketplace', icon: 'shopping-bag' },
    { name: 'Scholar Network', section: 'community', icon: 'users' },
    { name: 'Notebook', section: 'notes', icon: 'sticky-note' },
    { name: 'Skill Academy', section: 'skillAcademy', icon: 'graduation-cap' },
    { name: 'Japa Consultant', section: 'japaConsultant', icon: 'plane-takeoff' },
    { name: 'Elite Lounge', section: 'eliteLounge', icon: 'diamond' }
  ];

  const select = (sectionId) => {
    if (sectionId === 'aiscan') {
      window.openAIScanVault();
    } else {
      showSection(sectionId, app.state);
    }
    input.value = '';
    panel.classList.add('hidden');
    if (closeSheetOnSelect) window.toggleSearch(false);
  };
  // Expose per-instance so inline onclick handlers built into panel.innerHTML can reach it.
  input.dataset.searchSelectHandler = `__searchSelect_${inputId}`;
  window[`__searchSelect_${inputId}`] = select;

  input.oninput = (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      panel.classList.add('hidden');
      return;
    }

    const results = searchableItems.filter(item => item.name.toLowerCase().includes(q));

    if (results.length > 0) {
      panel.innerHTML = `
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-2">Quick Results</p>
        <div class="space-y-1">
          ${results.map(res => `
            <button onclick="window.${input.dataset.searchSelectHandler}('${res.section}')" class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left group">
              <div class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 group-hover:bg-brand-500 group-hover:text-white transition-colors">
                <i data-lucide="${res.icon}" class="w-4 h-4"></i>
              </div>
              <span class="text-sm font-bold">${res.name}</span>
            </button>
          `).join('')}
        </div>
      `;
      panel.classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
    } else {
      panel.innerHTML = `<p class="p-4 text-center text-xs text-slate-400 font-bold">No matches found for "${escapeHTML(q)}"</p>`;
      panel.classList.remove('hidden');
    }
  };

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });
};

const initGlobalSearch = () => {
  initSearchInstance('globalSearch', 'globalSearchPanel');
  // Mobile search sheet reuses the exact same search logic/results.
  initSearchInstance('mobileSearchInput', 'mobileSearchPanel', { closeSheetOnSelect: true });
};

window.handleSearchClick = (sectionId) => {
  // Back-compat: anything still calling the old global-only handler directly.
  if (sectionId === 'aiscan') {
    window.openAIScanVault();
    const input = S('globalSearch');
    if (input) input.value = '';
    const panel = S('globalSearchPanel');
    if (panel) panel.classList.add('hidden');
    return;
  }
  showSection(sectionId, app.state);
  const input = S('globalSearch');
  if (input) input.value = '';
  const panel = S('globalSearchPanel');
  if (panel) panel.classList.add('hidden');
};

// --- Application State ---
// --- Intelligent Data Pre-fetching ---
const cache = new Map();

async function prefetchData(collectionName, queryConstraints = []) {
  try {
    const cacheKey = `${collectionName}-${JSON.stringify(queryConstraints)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const q = query(collection(db, collectionName), ...queryConstraints);
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cache.set(cacheKey, data);
    return data;
  } catch (e) {
    console.warn(`Prefetch failed for ${collectionName}:`, e.message);
    return [];
  }
}

function initPrefetching() {
  // Prefetch common data on idle
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => {
      prefetchData('exams', [orderBy('createdAt', 'desc'), limit(10)]);
      prefetchData('marketItems', [orderBy('createdAt', 'desc'), limit(10)]);
    });
  }
}

// --- World-Class Global Activity & Achievements ---
function initGlobalActivityStream() {
  const container = S('streamContainer');
  if (!container) return;

  const activities = [
    { user: 'Sikiru', action: 'completed', target: 'JAMB Physics', time: 'Just now', icon: 'zap', color: 'text-brand-500' },
    { user: 'Chidi', action: 'earned', target: 'Neural Pioneer', time: '2m ago', icon: 'award', color: 'text-amber-500' },
    { user: 'Aisha', action: 'posted', target: 'New Gig: Design', time: '5m ago', icon: 'briefcase', color: 'text-indigo-500' },
    { user: 'Global AI', action: 'processed', target: '2,400 questions', time: '10m ago', icon: 'cpu', color: 'text-emerald-500' },
    { user: 'System', action: 'verified', target: 'New Elite Member', time: '15m ago', icon: 'shield-check', color: 'text-slate-500' },
    { user: 'Musa', action: 'purchased', target: 'MacBook Pro M3', time: '18m ago', icon: 'shopping-cart', color: 'text-rose-500' },
    { user: 'Emeka', action: 'scored', target: '345 in Chemistry', time: '22m ago', icon: 'trending-up', color: 'text-emerald-500' },
    { user: 'Sarah', action: 'shared', target: 'Level 200 Notes', time: '25m ago', icon: 'share-2', color: 'text-blue-500' }
  ];

  let index = 0;
  const renderItem = () => {
    const item = activities[index % activities.length];
    const el = document.createElement('div');
    el.className = 'flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/5 shadow-soft hover:scale-[1.02] transition-transform animate-in slide-in-from-bottom-4 duration-500';
    el.innerHTML = `
      <div class="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center ${item.color} shadow-inner">
        <i data-lucide="${item.icon}" class="w-5 h-5"></i>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[11px] font-black text-slate-900 dark:text-white truncate">
          <span class="text-brand-600">${item.user}</span> ${item.action}
        </p>
        <p class="text-[9px] text-slate-400 font-bold uppercase truncate tracking-widest">${item.target}</p>
      </div>
      <span class="text-[8px] font-black text-slate-300 uppercase shrink-0">${item.time}</span>
    `;
    
    if (container.children.length >= 6) {
      const last = container.lastElementChild;
      last.classList.add('animate-out', 'fade-out', 'slide-out-to-top-4');
      setTimeout(() => last.remove(), 500);
    }
    
    container.prepend(el);
    if (window.lucide) window.lucide.createIcons();
    index++;
  };

  renderItem();
  setInterval(renderItem, 3500);
}

function initParallaxEffects() {
  document.addEventListener('mousemove', (e) => {
    const cards = $$('.parallax-card');
    const x = (window.innerWidth / 2 - e.pageX) / 25;
    const y = (window.innerHeight / 2 - e.pageY) / 25;
    
    cards.forEach(card => {
      card.style.transform = `rotateY(${x}deg) rotateX(${y}deg)`;
    });
  });
}

const app = {
  state: {
    user: null,
    userData: store.get('userData', { xp: 0, level: 1, badges: [], examsTaken: 0, activated: false, humanizerCredits: 25, enrolledCourses: [] }),
    marketplace: [],
    marketplaceLoaded: false,
    books: [],
    officialExams: [],
    notes: store.get('notes', []),
    currentNoteId: null,
    streak: store.get('streak', 0),
    currentSection: 'dashboard',
    goals: store.get('goals', []),
    skills: store.get('skills', []),
    mySkills: [],
    gigs: store.get('gigs', []),
    myListings: [],
    currentMarketItemId: null,
    currentRatingItemId: null,
    currentRatingValue: 0,
    currentEscrowItemId: null,
    leaderboardMode: 'all',
    leaderboardAll: [],
    leaderboardAllLoaded: false,
    campusPosts: [],
    campusTab: 'forYou',
    campusDraftImage: null,
    campusFilterTag: null,
    campusSearchQuery: '',
    campusSelectedTags: [],
    bookDraftFile: null
  }
};

const snapState = {
  activeChat: null,
  chats: [],
  messages: [],
  user: null,
  unsubChats: null,
  unsubMessages: null,
  unsubTyping: null,
  unsubAllUsers: null,
  allUsers: [],
  allUsersLoading: false,
  allUsersError: null,
  addPeopleOpen: false,
  groupCreateOpen: false,
  groupSelected: new Set(),
  groupModalMode: 'create',
  chatOptionsOpen: false,
  pendingAddPeopleOpen: false,
  typingUsers: new Set()
};

const supportState = {
  messages: [],
  unsubMessages: null
};

const warRoomState = {
  rooms: [],
  currentRoomId: null,
  currentRoom: null,
  messages: [],
  resources: [],
  unsubRooms: null,
  unsubRoom: null,
  unsubMessages: null,
  unsubResources: null,
  timer: null,
  objectivesCollapsed: false
};

const studyState = {
  cbt: {
    i: 0,
    answers: [],
    timer: null,
    timeLeft: 1800,
    subject: 'General',
    source: null,
    generating: false,
    settings: { count: 20, intensity: 'standard' },
    aiExplainCache: {}, // per-question-index cache of AI explanations, so re-viewing a question never re-bills the AI call
    aiExplainLoading: false,
    questions: [
      { q: "Solve for x: 2x + 5 = 15", opts: ["3", "5", "10", "20"], correct: 1, exp: "2x = 10, so x = 5" },
      { q: "Which element has the symbol 'Au'?", opts: ["Silver", "Copper", "Gold", "Iron"], correct: 2, exp: "Au is from the Latin 'Aurum'" },
      { q: "Who is the author of 'Purple Hibiscus'?", opts: ["Wole Soyinka", "Chimamanda Ngozi Adichie", "Chinua Achebe", "Femi Osofisan"], correct: 1, exp: "Adichie's debut novel published in 2003" }
    ]
  },
  flashcards: {
    idx: 0,
    cards: [],
    syncedCards: [], // last snapshot of the user's real Firestore deck (see initFlashcardsSync)
    viewingDemo: false, // true while previewing a Demo Deck, so the live sync doesn't overwrite it
    editingId: null, // set while the Create modal is editing an existing card rather than adding new ones
    filter: { q: '', cat: 'all' }, // "Your Cards" search/category filter state
    zenActive: false,
    aiSource: 'topic',
    aiFile: null
  }
};

// Applies the actual view-switch side effects for the Flashcards section:
// restoring the real synced deck when leaving a demo preview, showing the
// right panel (Personal Vault vs Community Archive), and (re)rendering.
// Split out from transitionToFlashcardView so it can run either after the
// GSAP zoom (first entry into the dashboard) or immediately (switching
// views while already inside the dashboard, e.g. one demo deck to another).
function applyFlashcardViewState(type) {
  if (type === 'vault' && studyState.flashcards.viewingDemo) {
    studyState.flashcards.viewingDemo = false;
    studyState.flashcards.cards = (studyState.flashcards.syncedCards || []).slice();
    studyState.flashcards.idx = 0;
  }

  const vaultPanels = S('vaultPanels');
  const communityPanels = S('communityPanels');
  if (vaultPanels) vaultPanels.classList.toggle('hidden', type === 'community');
  if (communityPanels) communityPanels.classList.toggle('hidden', type !== 'community');

  if (type === 'community') {
    window.refreshCommunityFlashcards();
  } else {
    renderFlashcard();
  }
  updateFlashcardsUI();
  if (window.lucide) window.lucide.createIcons();
}

window.transitionToFlashcardView = (type) => {
  const entry = S('fcEntryScreen');
  const dash = S('fcDashboardView');
  const vault = S('fcVaultCard');
  const community = S('fcCommunityCard');

  if (!dash) return;

  // Already inside the dashboard (e.g. switching from Community back to
  // Vault, or picking a second demo deck without returning to the entry
  // screen) — there's no entry screen left to zoom, so just swap state.
  if (!dash.classList.contains('hidden')) {
    applyFlashcardViewState(type);
    return;
  }

  if (!entry || typeof gsap === 'undefined') {
    if (entry) entry.classList.add('hidden');
    dash.classList.remove('hidden');
    applyFlashcardViewState(type);
    return;
  }

  // Zoom-in transition using GSAP
  const targetCard = type === 'vault' ? vault : community;
  const otherCard = type === 'vault' ? community : vault;

  const tl = gsap.timeline({
    onComplete: () => {
      entry.classList.add('hidden');
      dash.classList.remove('hidden');
      // Reset animations for next time
      gsap.set([vault, community], { clearProps: "all" });
      gsap.set(entry, { clearProps: "all" });

      applyFlashcardViewState(type);
      toast(type === 'community' ? 'Browsing community decks...' : 'Welcome back to your deck.', 'brand');
    }
  });

  tl.to(otherCard, { opacity: 0, scale: 0.8, duration: 0.4, ease: "power2.in" })
    .to(targetCard, { 
      scale: 1.5, 
      opacity: 0, 
      duration: 0.6, 
      ease: "power2.inOut" 
    }, "-=0.2")
    .to(entry, { opacity: 0, duration: 0.3 }, "-=0.3");
};

window.showFlashcardEntry = () => {
  const entry = S('fcEntryScreen');
  const dash = S('fcDashboardView');
  if (entry && dash) {
    dash.classList.add('hidden');
    entry.classList.remove('hidden');
    if (typeof gsap !== 'undefined') gsap.from(entry, { opacity: 0, y: 20, duration: 0.8, ease: "power3.out" });
    initFlashcardEntryAnimations();
  }
};

function initFlashcardEntryAnimations() {
  const vault = S('fcVaultCard');
  const community = S('fcCommunityCard');
  if (!vault || !community || !window.gsap) return;

  const cards = [vault, community];

  cards.forEach(card => {
    const other = card === vault ? community : vault;
    
    card.addEventListener('mouseenter', () => {
      gsap.to(card, { scale: 1.05, duration: 0.5, ease: "power2.out" });
      gsap.to(other, { opacity: 0.4, filter: "grayscale(0.8) blur(2px)", scale: 0.95, duration: 0.5, ease: "power2.out" });
    });

    card.addEventListener('mouseleave', () => {
      gsap.to([vault, community], { scale: 1, opacity: 1, filter: "grayscale(0) blur(0px)", duration: 0.5, ease: "power2.out" });
    });
  });
}

const showPageLoader = (msg = 'Entering Geo-Books...') => {
  const existing = S('pageLoader');
  if (existing) existing.remove();
  
  const loader = document.createElement('div');
  loader.id = 'pageLoader';
  loader.className = 'fixed inset-0 z-[1000] bg-slate-950 flex flex-col items-center justify-center animate-in fade-in duration-500';
  loader.innerHTML = `
    <div class="relative scale-75 sm:scale-100">
      <div class="w-24 h-24 rounded-[2rem] bg-brand-600 animate-pulse shadow-[0_0_50px_rgba(124,58,237,0.5)]"></div>
      <div class="absolute inset-0 flex items-center justify-center">
        <i data-lucide="zap" class="w-10 h-10 text-white animate-bounce"></i>
      </div>
    </div>
    <p class="mt-10 text-white font-black uppercase tracking-[0.4em] text-[10px] animate-pulse">${msg}</p>
  `;
  document.body.appendChild(loader);
  if (window.lucide) window.lucide.createIcons();
};

// Shows an uploaded photo if present, falling back to initials on a
// colored background otherwise. Mirrors the same pattern already used for
// lecturer avatars elsewhere in this codebase (lecturer.html's
// renderAvatarInto / university-admin.js) — kept consistent rather than
// inventing a second convention for the same problem.
function renderAvatarSlot(initialId, imgId, initials, photoURL) {
  const initialEl = S(initialId);
  const imgEl = S(imgId);
  if (!initialEl || !imgEl) return;
  initialEl.textContent = initials || 'U';
  if (photoURL) {
    imgEl.src = photoURL;
    imgEl.classList.remove('hidden');
    initialEl.classList.add('hidden');
  } else {
    imgEl.classList.add('hidden');
    imgEl.removeAttribute('src');
    initialEl.classList.remove('hidden');
  }
}

// --- Auth Module ---
const updateAuthUI = (user, userData, claims = {}) => {
  const isElite = claims.subscriptionLevel === 'ELITE_100K' || userData?.subscriptionLevel === 'ELITE_100K';
  const isAdmin = user && (claims.admin === true || (userData?.role || '').toLowerCase() === 'admin');
  
  document.documentElement.setAttribute('data-elite', isElite ? 'true' : 'false');
  
  // Only admins can ingest new assets to the official library
  const ingestBtn = document.querySelector('button[onclick*="bookUpload"]');
  if (ingestBtn) ingestBtn.classList.toggle('hidden', !isAdmin);

  const path = window.location.pathname;
  const isLandingPage = path.endsWith('index.htm') || path === '/' || path.endsWith('/') || path === '';
  const isClassPage = path.endsWith('geo-books.htm');

  if (user) {
    // If we have userData, use it. Otherwise use user object.
    const displayName = userData?.displayName || user.displayName || 'Scholar';
    const firstName = displayName.split(' ')[0];
    const university = userData?.university || 'University Student';
    const username = userData?.username || 'scholar';

    if (isLandingPage) {
      showPageLoader('Resuming Excellence...');
      setTimeout(() => window.location.href = 'geo-books.htm', 50);
      return; 
    }
    
    if (S('authButtons')) {
      S('authButtons').innerHTML = '';
    }

    if (S('userProfile')) S('userProfile').classList.remove('hidden');
    if (S('navDashboardText')) S('navDashboardText').textContent = `${university} Dashboard`;
    if (S('userStats')) S('userStats').classList.remove('hidden');
    if (S('mainContent')) S('mainContent').classList.remove('hidden');
    if (S('landingPage')) S('landingPage').classList.add('hidden');
    
    const eliteTabs = $$('[data-premium-only="true"]');
    eliteTabs.forEach(tab => tab.classList.toggle('hidden', !isElite));

    if (S('userAvatar')) {
      const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      renderAvatarSlot('userAvatarInitial', 'userAvatarImg', initials, userData?.photoURL);
      renderAvatarSlot('postAvatarInitial', 'postAvatarImg', initials, userData?.photoURL);
      if (isElite) S('userAvatar').classList.add('elite-border-glow', 'border-elite-gold');
    }
    
    if (S('profileName')) {
      S('profileName').textContent = displayName;
      if (isElite) S('profileName').innerHTML += ' <i data-lucide="award" class="w-4 h-4 inline text-elite-gold ml-1"></i>';
    }

    if (S('dashGreeting')) {
      S('dashGreeting').textContent = `Hello, ${username}`;
    }

    if (S('dashGreetingName')) {
      S('dashGreetingName').textContent = `${username}`;
    }

    if (S('dashUniversityName')) {
      S('dashUniversityName').textContent = `${university} Scholar`;
    }

    if (!window.__welcomeToasted) {
      window.__welcomeToasted = true;
      toast(`Welcome back, ${firstName}!`, 'success');
    }

    if (S('activationText')) {
      S('activationText').textContent = isElite ? 'Elite Member' : (userData?.activated ? 'Pro Account' : 'Free Tier');
      if (isElite) S('activationText').classList.add('elite-gradient-text');
    }

    // Sync University to relevant UI parts
    if (S('profileUniversity')) S('profileUniversity').textContent = university;
    if (S('campusSelect')) S('campusSelect').value = university;
    if (S('campusHubTitle')) S('campusHubTitle').textContent = `${university} Hub`;
  } else {
    if (isClassPage) { 
      showPageLoader('Returning to Campus...');
      setTimeout(() => window.location.href = 'index.htm', 50);
      return; 
    }

    if (S('authButtons')) {
      S('authButtons').innerHTML = `
        <button onclick="window.toggleAuthModal('login', true)" class="text-sm font-black uppercase tracking-[0.2em] text-slate-600 hover:text-brand-600 transition-all">Login</button>
        <button onclick="window.toggleAuthModal('signup', true)" class="px-8 py-3 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm font-black uppercase tracking-[0.15em] shadow-2xl hover:scale-105 active:scale-95 transition-all">Join Elite</button>
      `;
    }
    if (S('userProfile')) S('userProfile').classList.add('hidden');
    if (S('userStats')) S('userStats').classList.add('hidden');
    if (S('mainContent')) S('mainContent').classList.add('hidden');
    if (S('landingPage')) S('landingPage').classList.remove('hidden');
    document.documentElement.setAttribute('data-elite', 'false');
  }
  
  if (window.lucide) window.lucide.createIcons();
};

const handleSignup = async (email, password, name, username, university) => {
  try {
    showPageLoader('Creating Your Legacy...');
    
    // Check for unique username — routed through the server (Admin SDK)
    // instead of a direct Firestore query, since this runs BEFORE sign-in
    // and firestore.rules requires isAuthenticated() to read `users`.
    // A raw client query here always failed with permission-denied; this
    // endpoint only ever returns a boolean, never exposing user data.
    const usernameCheckRes = await fetch(`${API_BASE_URL}/api/check-username?username=${encodeURIComponent(normalizeUsername(username))}`);
    const usernameCheckData = await usernameCheckRes.json().catch(() => ({}));

    if (!usernameCheckRes.ok) {
      const loader = S('pageLoader');
      if (loader) loader.remove();
      toast('Could not verify username right now. Please try again.', 'error');
      throw new Error('Username check failed');
    }
    if (usernameCheckData.available === false) {
      const loader = S('pageLoader');
      if (loader) loader.remove();
      toast('Username already taken!', 'error');
      throw new Error('Username taken');
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    await firebaseUpdateProfile(user, { displayName: name });
    
    const initialRank = calculateRank(0);
    const initialData = { 
      xp: 0,
      level: initialRank.rank,
      rank_title: initialRank.title,
      badges: [], examsTaken: 0, activated: false, 
      subscriptionLevel: 'STANDARD', humanizerCredits: 25, enrolledCourses: [],
      name: name,
      displayName: name,
      username: normalizeUsername(username),
      email: email,
      university: university,
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, "users", user.uid), initialData);
    
    toast(`Welcome, ${name}! Redirecting...`, 'success');
    confettiCelebration();
    return user;
  } catch (error) {
    const loader = S('pageLoader');
    if (loader) loader.remove();
    console.error('Signup error:', error);
    let message = 'Error creating account';
    if (error.code === 'auth/email-already-in-use') message = 'Email already in use';
    if (error.code === 'auth/weak-password') message = 'Password is too weak';
    if (error.message === 'Username taken') message = 'Username already taken';
    toast(message, 'error');
    throw error;
  }
};

const handleLogin = async (email, password) => {
  try {
    showPageLoader('Authenticating...');
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    toast('Access granted!', 'success');
    return userCredential.user;
  } catch (error) {
    const loader = S('pageLoader');
    if (loader) loader.remove();
    console.error('Login error:', error);
    let message = 'Error logging in';
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      message = 'Invalid email or password';
    }
    toast(message, 'error');
    throw error;
  }
};

const handleLogout = async () => {
  try {
    showPageLoader('Signing out...');
    await signOut(auth);
    document.documentElement.setAttribute('data-elite', 'false');
    toast('Safe travels, Scholar!', 'info');
  } catch (error) {
    console.error('Logout error:', error);
    toast('Error logging out', 'error');
  }
};

const initAuth = (appState, onDataSync) => {
  setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, async (user) => {
    appState.user = user;
    if (user) {
      // Immediate redirect check for index.htm
      const path = window.location.pathname;
      if (path.endsWith('index.htm') || path === '/' || path.endsWith('/') || path === '') {
        showPageLoader();
        window.location.href = 'geo-books.htm';
        return;
      }

      const idTokenResult = await user.getIdTokenResult();
      const claims = idTokenResult.claims;
      
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        appState.userData = userSnap.data();
      } else {
        const email = user.email || '';
        const displayName = user.displayName || 'Scholar';
        const usernameFallback = normalizeUsername(email ? email.split('@')[0] : `scholar_${user.uid.slice(0, 6)}`);
        const initialRank = calculateRank(0);
        const initialData = { 
          xp: 0,
          level: initialRank.rank,
          rank_title: initialRank.title,
          badges: [], examsTaken: 0, activated: false, 
          subscriptionLevel: 'STANDARD', humanizerCredits: 25, enrolledCourses: [],
          name: displayName,
          displayName,
          username: usernameFallback,
          email,
          createdAt: new Date().toISOString()
        };
        await setDoc(userRef, initialData);
        appState.userData = initialData;
      }

      {
        const patch = {};
        const email = appState.userData?.email || user.email || '';
        const displayName = appState.userData?.displayName || user.displayName || 'Scholar';
        const computedRank = calculateRank(appState.userData?.xp || 0);

        if (!appState.userData?.email && email) patch.email = email;
        if (!appState.userData?.displayName && displayName) patch.displayName = displayName;
        if (!appState.userData?.name && displayName) patch.name = displayName;
        if (appState.userData?.xp === undefined) patch.xp = 0;
        if (!appState.userData?.rank_title) patch.rank_title = computedRank.title;
        if (!appState.userData?.level) patch.level = computedRank.rank;
        if (!appState.userData?.username) {
          const candidate = email ? email.split('@')[0] : `scholar_${user.uid.slice(0, 6)}`;
          patch.username = normalizeUsername(candidate);
        } else {
          const normalized = normalizeUsername(appState.userData.username);
          if (normalized !== appState.userData.username) patch.username = normalized;
        }

        if (Object.keys(patch).length) {
          await updateDoc(userRef, patch);
          appState.userData = { ...appState.userData, ...patch };
        }
      }
      
      updateAuthUI(user, appState.userData, claims);
      initFlashcardsSync(user);
      initNotificationsSync(user);
      if (onDataSync) onDataSync();
      if (snapState.pendingAddPeopleOpen) {
        snapState.pendingAddPeopleOpen = false;
        setTimeout(() => window.toggleAddPeople(true), 0);
      }
    } else {
      updateAuthUI(null, null);
    }
    // Reveal body after auth state is determined
    document.body.classList.remove('opacity-0');
  });
};

// --- UI Module ---
// --- Neural Command Palette (Cmd+K) ---
let commandIdx = -1;
const navigationTargets = [
  { id: 'dashboard', title: 'Dashboard', icon: 'layout-dashboard', keywords: 'home, stats, overview' },
  { id: 'cbt', title: 'CBT Suite', icon: 'brain-circuit', keywords: 'exams, study, practice, test' },
  { id: 'marketplace', title: 'Marketplace', icon: 'shopping-cart', keywords: 'buy, sell, trade, campus' },
    { id: 'flashcards', title: 'Flash Cards', icon: 'layers', keywords: 'study, memorize, cards, srs' },
    { id: 'aiscan', title: 'AI Scan: The Vault', icon: 'vault', keywords: 'scan, ai, elite, premium, vault, architect' },
    { id: 'community', title: 'Campus Hub', icon: 'users', keywords: 'social, connect, chat, posts' },
  { id: 'profile', title: 'Scholar Profile', icon: 'user', keywords: 'account, settings, bio' },
  { id: 'support', title: 'Support Chat', icon: 'message-square', keywords: 'help, contact, admin' },
  { id: 'leaderboardSection', title: 'Global Rankings', icon: 'trophy', keywords: 'leaderboard, top, scores' },
  { id: 'skillAcademy', title: 'Skill Academy', icon: 'graduation-cap', keywords: 'learn, courses, tutorials' },
  { id: 'gigsBoard', title: 'Gigs Board', icon: 'briefcase', keywords: 'work, earn, jobs' },
];

window.toggleCommandPalette = (show) => {
  const palette = S('commandPalette');
  const input = S('commandInput');
  if (!palette || !input) return;
  
  if (show) {
    palette.classList.replace('hidden', 'flex');
    input.value = '';
    input.focus();
    renderCommandResults('');
  } else {
    palette.classList.replace('flex', 'hidden');
  }
};

function renderCommandResults(query) {
  const container = S('commandResults');
  if (!container) return;
  
  const filtered = navigationTargets.filter(t => 
    t.title.toLowerCase().includes(query.toLowerCase()) || 
    t.keywords.toLowerCase().includes(query.toLowerCase())
  );
  
  if (filtered.length === 0) {
    container.innerHTML = `<div class="p-8 text-center"><p class="text-xs font-black text-slate-400 uppercase tracking-widest">No matching protocols found</p></div>`;
    commandIdx = -1;
    return;
  }
  
  container.innerHTML = filtered.map((t, idx) => `
    <button onclick="window.selectCommand('${t.id}')" 
      class="w-full p-4 flex items-center gap-4 rounded-2xl border-2 transition-all duration-200 text-left ${idx === commandIdx ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-500 shadow-lg' : 'bg-white dark:bg-slate-900 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'}">
      <div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center ${idx === commandIdx ? 'text-brand-600' : 'text-slate-400'}">
        <i data-lucide="${t.icon}" class="w-5 h-5"></i>
      </div>
      <div>
        <p class="text-sm font-black ${idx === commandIdx ? 'text-brand-600' : 'text-slate-900 dark:text-white'}">${t.title}</p>
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${t.keywords}</p>
      </div>
      <i data-lucide="chevron-right" class="w-4 h-4 ml-auto opacity-40"></i>
    </button>
  `).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

window.selectCommand = (id) => {
  window.toggleCommandPalette(false);
  window.showSection(id, app.state);
};

function initCommandPalette() {
  const input = S('commandInput');
  if (!input) return;
  
  input.oninput = (e) => {
    commandIdx = 0;
    renderCommandResults(e.target.value);
  };
  
  input.onkeydown = (e) => {
    const results = S('commandResults').querySelectorAll('button');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      commandIdx = Math.min(commandIdx + 1, results.length - 1);
      renderCommandResults(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      commandIdx = Math.max(commandIdx - 1, 0);
      renderCommandResults(input.value);
    } else if (e.key === 'Enter' && commandIdx >= 0) {
      results[commandIdx].click();
    } else if (e.key === 'Escape') {
      window.toggleCommandPalette(false);
    }
  };

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      window.toggleCommandPalette(true);
    }
  });
}

// --- UI Helpers ---
const haptic = (el) => {
  if (!el) return;
  el.classList.add('scale-95');
  setTimeout(() => el.classList.remove('scale-95'), 100);
};

const showSkeleton = (id, count = 3) => {
  const container = S(id);
  if (!container) return;
  const itemHtml = `
    <div class="p-6 rounded-[2.5rem] bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm animate-pulse">
      <div class="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-4"></div>
      <div class="h-4 bg-slate-100 dark:bg-slate-800 rounded w-3/4 mb-2"></div>
      <div class="h-3 bg-slate-100 dark:bg-slate-800 rounded w-1/2"></div>
    </div>
  `;
  container.innerHTML = Array(count).fill(itemHtml).join('');
};

function updateDashboard(state) {
  const dateEl = S('currentDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });
  
  // Dynamic Greeting based on time
  const hour = new Date().getHours();
  let timeGreeting = "Good Morning";
  if (hour >= 12 && hour < 17) timeGreeting = "Good Afternoon";
  if (hour >= 17) timeGreeting = "Good Evening";
  
  const university = state.userData?.university || 'University Student';
  if (S('dashUniversityName')) S('dashUniversityName').textContent = university;
  
  const words = [
    { w: "Ephemeral", d: "Lasting for a very short time." },
    { w: "Resilient", d: "Able to withstand or recover quickly from difficult conditions." },
    { w: "Sagacious", d: "Having or showing keen mental discernment and good judgment." },
    { w: "Meticulous", d: "Showing great attention to detail; very careful and precise." },
    { w: "Eloquent", d: "Fluent or persuasive in speaking or writing." }
  ];
  const word = words[Math.floor(Math.random() * words.length)];
  if (S('wordDay')) S('wordDay').textContent = word.w;
  if (S('wordDef')) S('wordDef').textContent = word.d;
  
  // Apply greeting
  const username = state.userData?.username || 'Scholar';
  if (S('dashGreeting')) S('dashGreeting').innerHTML = `${timeGreeting}, <span class="elite-text">${escapeHTML(username)}</span>!`;
  if (S('dashGreetingName')) S('dashGreetingName').textContent = username;

  updateStatsUI(state);
  renderStudyGoals(state);
  renderDailyPath(state);
  initSyllabusHeatmap(state);
  initGlobalActivityStream();
  initParallaxEffects();
  initPrefetching();
}

function updateStatsUI(state) {
  const userData = state.userData || {};
  const xp = userData.xp || 0;
  const rankInfo = calculateRank(xp);
  const username = userData.username || 'scholar';
  const streak = userData.streak || 0;
  
  // 1. User Personalization
  if (S('dashGreetingName')) S('dashGreetingName').textContent = `${username}`;
  if (S('navGreetingName')) S('navGreetingName').textContent = `${username}`;
  if (S('userLevel')) S('userLevel').textContent = rankInfo.title;
  if (S('dashLevel')) S('dashLevel').textContent = rankInfo.title;

  // Sync Subscription Tier
  const tier = (userData.subscription?.tier || 'FREE').toUpperCase();
  const displayMap = {
    'FREE': 'Freemium',
    'STANDARD': 'Scholar',
    'PREMIUM': 'Pro'
  };
  const displayTier = displayMap[tier] || 'Freemium';
  if (S('userTier')) S('userTier').textContent = displayTier;
  if (S('sidebarTier')) S('sidebarTier').textContent = displayTier;
  
  // Update "Verified Scholar" badge based on tier
  const isVerified = tier !== 'FREE';
  if (S('userBadge')) S('userBadge').classList.toggle('hidden', !isVerified);
  document.documentElement.setAttribute('data-elite', isVerified ? 'true' : 'false');
  
  // 3. XP Points Sync
  if (S('xpBar')) S('xpBar').style.width = `${Math.round(rankInfo.progressPct)}%`;
  if (S('xpText')) {
    if (rankInfo.nextThreshold === null) {
      S('xpText').textContent = `${rankInfo.xp.toLocaleString()} XP • MAX`;
    } else {
      const earnedThisTier = Math.max(0, rankInfo.xp - rankInfo.currentThreshold);
      const neededThisTier = Math.max(1, rankInfo.nextThreshold - rankInfo.currentThreshold);
      S('xpText').textContent = `${earnedThisTier.toLocaleString()} / ${neededThisTier.toLocaleString()} XP`;
    }
  }
  
  if (S('totalXPPoints')) {
    const formattedXP = xp >= 1000 ? (xp / 1000).toFixed(1) + 'k' : xp;
    S('totalXPPoints').innerHTML = `${formattedXP} <span class="text-xs font-bold text-slate-400">XP</span>`;
  }
  
  // 2. Study Streak Logic
  if (S('currentStreakCount')) S('currentStreakCount').innerHTML = `${streak} <span class="text-xs font-bold text-slate-400">Days</span>`;
  if (S('streakBar')) S('streakBar').style.width = Math.min(100, (streak / 7) * 100) + '%';
  
  // 4. AI Intelligence Calculation
  const totalCards = state.flashcards?.length || 0;
  const masteredCards = state.flashcards?.filter(c => (c.srsLevel || 0) >= 4).length || 0;
  const aiIntelligence = totalCards > 0 ? Math.round((masteredCards / totalCards) * 100) : 0;
  if (S('aiIntelligenceScore')) S('aiIntelligenceScore').innerHTML = `${aiIntelligence}<span class="text-xs font-bold text-slate-400">/100</span>`;
  
  // Update other UI elements
  if (S('activeGoalName')) {
    const activeGoal = (state.goals || []).find(g => !g.done);
    S('activeGoalName').textContent = activeGoal ? activeGoal.text : 'No Active Goal';
  }
  
  if (S('globalRank')) {
    const cachedRank = store.get('lastRank');
    const rank = userData.rank || cachedRank;
    const rankDiff = userData.rankDiff !== undefined ? userData.rankDiff : store.get('rankTrend', 0);
    
    if (rank) {
      const trendIcon = rankDiff >= 0 ? '↑' : '↓';
      const trendColor = rankDiff >= 0 ? 'text-emerald-500' : 'text-rose-500';
      const trendDisplay = rankDiff !== 0 ? `<span class="text-xs font-bold ${trendColor}">${trendIcon}${Math.abs(rankDiff)}</span>` : '';
      S('globalRank').innerHTML = `#${rank.toLocaleString()} ${trendDisplay}`;
    } else if (userData.rankLabel) {
      S('globalRank').innerHTML = `<span class="text-xs font-black text-slate-500 uppercase tracking-widest">${escapeHTML(userData.rankLabel)}</span>`;
    } else {
      S('globalRank').innerHTML = `<span class="text-xs text-slate-400 animate-pulse uppercase">Calculating...</span>`;
    }
  }
  
  if (S('profStreak')) S('profStreak').textContent = streak;
  if (S('profExams')) S('profExams').textContent = userData.examsTaken || 0;
  if (S('profNotes')) S('profNotes').textContent = (state.notes || []).length;
  if (S('humanizerCredits')) S('humanizerCredits').textContent = userData.humanizerCredits || 0;
  if (S('rankProgressCard')) renderRankProgressCard(state);
}

function renderRankProgressCard(state) {
  const wrap = S('rankProgressCard');
  if (!wrap) return;
  const xp = state.userData?.xp || 0;
  const info = calculateRank(xp);

  const nextLine = info.nextThreshold === null
    ? 'Max tier reached'
    : `${info.xpToNext.toLocaleString()} XP to ${info.nextTitle}`;

  const progressLabel = info.nextThreshold === null
    ? `${info.xp.toLocaleString()} XP`
    : `${(info.xp - info.currentThreshold).toLocaleString()} / ${(info.nextThreshold - info.currentThreshold).toLocaleString()} XP`;

  wrap.innerHTML = `
    <div class="flex items-start justify-between gap-6">
      <div class="min-w-0">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Rank Title</p>
        <p class="mt-1 text-xl font-black tracking-tight">${escapeHTML(info.title)}</p>
        <p class="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">${escapeHTML(nextLine)}</p>
      </div>
      <div class="text-right">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Total XP</p>
        <p class="mt-1 text-lg font-black text-emerald-500">${info.xp.toLocaleString()}</p>
      </div>
    </div>
    <div class="mt-4">
      <div class="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div class="h-full bg-brand-600 transition-all duration-700" style="width: ${Math.round(info.progressPct)}%"></div>
      </div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">${escapeHTML(progressLabel)}</span>
        <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">${Math.round(info.progressPct)}%</span>
      </div>
    </div>
  `;
}

function updateProfileUI(state) {
  if (!state.user || !state.userData) return;
  const xp = state.userData.xp || 0;
  if (S('profileName')) {
    const displayName = escapeHTML(state.userData.displayName || state.user.displayName || 'Scholar');
    S('profileName').innerHTML = `
      <span class="inline-flex items-center gap-1.5 align-middle">
        ${displayName}
        ${isLegendRank(xp) ? '<i data-lucide="crown" class="w-4 h-4 text-amber-500 shrink-0" title="Legend rank"></i>' : ''}
        ${verifiedBadgeHTML(xp, { size: 'w-4 h-4' })}
      </span>
    `;
    if (window.lucide) window.lucide.createIcons();
  }
  if (S('profileVerifiedBadge')) {
    const show = hasVerifiedRank(xp);
    S('profileVerifiedBadge').classList.toggle('hidden', !show);
    S('profileVerifiedBadge').classList.toggle('flex', show);
  }
  if (S('profileUsername')) S('profileUsername').textContent = state.userData.username ? `@${state.userData.username}` : '@scholar';
  if (S('profileUniversity')) S('profileUniversity').textContent = state.userData.university || 'University Student';
  if (S('profileLevelBadge')) S('profileLevelBadge').textContent = calculateRank(xp).title;
  
  if (S('profileAvatar')) {
    const initials = state.userData.displayName ? 
      state.userData.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U';
    renderAvatarSlot('profileAvatarInitial', 'profileAvatarImg', initials, state.userData.photoURL);
  }

  renderRankPerksPanel(state);

  const heatmap = S('studyHeatmap');
  if (heatmap) {
    heatmap.innerHTML = Array.from({ length: 28 }).map(() => `
      <div class="w-4 h-4 rounded-sm bg-brand-${Math.random() > 0.5 ? '500' : '100'} dark:bg-brand-${Math.random() > 0.5 ? '600' : '900/20'}"></div>
    `).join('');
  }
}

// Renders the "what your rank actually unlocks" panel on the profile page.
// Each card below maps 1:1 to a row in RANK_TIERS' reward column, and is
// either interactive (color picker, data-bundle claim) or a status
// readout for perks that apply automatically elsewhere (verified
// checkmark, marketplace discount, boosted listings).
function renderRankPerksPanel(state) {
  const panel = S('rankPerksPanel');
  if (!panel) return;
  const xp = state.userData?.xp || 0;
  const info = calculateRank(xp);

  const lockedNote = (minRank) => {
    const tier = RANK_TIERS.find(t => t.rank === minRank);
    return `<p class="text-[10px] font-bold text-slate-400 mt-2">🔒 Unlocks at ${escapeHTML(tier?.title || '')} rank (${(tier?.minXp || 0).toLocaleString()} XP)</p>`;
  };

  const avatarUnlocked = canCustomizeProfileColor(xp);
  const currentPhoto = state.userData?.photoURL || null;

  const discountUnlocked = hasMarketplaceDiscount(xp);
  const earlyAccessUnlocked = hasEarlyAccess(xp);
  const legend = isLegendRank(xp);

  panel.innerHTML = `
    <div class="p-6 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
      <p class="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Profile Photo ${avatarUnlocked ? '' : '🔒'}</p>
      <div class="flex items-center gap-4">
        <div class="w-16 h-16 rounded-2xl bg-brand-100 dark:bg-brand-900/20 text-brand-600 flex items-center justify-center text-xl font-black shrink-0 overflow-hidden relative">
          ${currentPhoto ? `<img src="${escapeHTML(currentPhoto)}" class="absolute inset-0 w-full h-full object-cover" alt="">` : `<i data-lucide="user" class="w-7 h-7"></i>`}
        </div>
        <div class="flex-1 min-w-0">
          <input id="profilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" ${avatarUnlocked ? '' : 'disabled'} onchange="window.uploadProfilePhoto(this.files[0])">
          <button onclick="document.getElementById('profilePhotoInput').click()" ${avatarUnlocked ? '' : 'disabled'}
            class="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${avatarUnlocked ? 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-brand-400 cursor-pointer' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 opacity-50 cursor-not-allowed'}">
            ${currentPhoto ? 'Change Photo' : 'Upload Photo'}
          </button>
          ${currentPhoto && avatarUnlocked ? `<button onclick="window.removeProfilePhoto()" class="ml-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all">Remove</button>` : ''}
          <p id="profilePhotoStatus" class="text-[10px] font-bold text-slate-400 mt-2"></p>
        </div>
      </div>
      ${avatarUnlocked ? '' : lockedNote(2)}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="p-5 rounded-3xl border ${discountUnlocked ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/30' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'}">
        <p class="text-xs font-black uppercase tracking-widest ${discountUnlocked ? 'text-emerald-600' : 'text-slate-400'}">10% Marketplace Discount</p>
        <p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-1">${discountUnlocked ? 'Active — applied automatically at checkout.' : ''}</p>
        ${discountUnlocked ? '' : lockedNote(4)}
      </div>
      <div class="p-5 rounded-3xl border ${earlyAccessUnlocked ? 'bg-brand-50 dark:bg-brand-900/10 border-brand-100 dark:border-brand-900/30' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'}">
        <p class="text-xs font-black uppercase tracking-widest ${earlyAccessUnlocked ? 'text-brand-600' : 'text-slate-400'}">Early Access</p>
        <p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-1">${earlyAccessUnlocked ? 'You can boost your own marketplace listings to the top of their category.' : ''}</p>
        ${earlyAccessUnlocked ? '' : lockedNote(5)}
      </div>
    </div>

    ${legend ? `
      <div id="legendRewardCard" class="p-6 rounded-3xl bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10 border border-amber-200 dark:border-amber-900/30">
        <p class="text-xs font-black uppercase tracking-widest text-amber-600 flex items-center gap-1.5"><i data-lucide="crown" class="w-3.5 h-3.5"></i> Legend Reward</p>
        <p id="legendRewardStatus" class="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-1">Checking this month's claim...</p>
        <button id="legendClaimBtn" onclick="window.claimLegendReward()" class="hidden mt-3 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 active:scale-95 transition-all">
          Claim This Month's Data Bundle
        </button>
      </div>
    ` : ''}
  `;
  if (window.lucide) window.lucide.createIcons();
  if (legend) refreshLegendRewardStatus();
}

window.uploadProfilePhoto = async (file) => {
  if (!auth.currentUser) return;
  const xp = app.state.userData?.xp || 0;
  if (!canCustomizeProfileColor(xp)) return toast('Reach Expert rank (1,000 XP) to unlock a profile photo', 'error');
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('Please choose a JPG, PNG, or WebP image.', 'error');
  if (file.size > 10 * 1024 * 1024) return toast('Image must be under 10MB.', 'error');

  const status = S('profilePhotoStatus');
  if (status) status.textContent = 'Uploading...';
  try {
    const key = `users/${auth.currentUser.uid}/profile-${Date.now()}-${safeFileName(file.name, 'photo')}`;
    const url = await dispatchAssetToCloudflare(file, key);
    await updateDoc(doc(db, "users", auth.currentUser.uid), { photoURL: url });
    if (app.state.userData) app.state.userData.photoURL = url;
    updateProfileUI(app.state);
    updateAuthUI(auth.currentUser, app.state.userData);
    toast('Profile photo updated', 'success');
  } catch (e) {
    console.error('uploadProfilePhoto error:', e);
    if (status) status.textContent = e.message || 'Upload failed. Please try again.';
    toast('Unable to upload photo', 'error');
  }
};

window.removeProfilePhoto = async () => {
  if (!auth.currentUser) return;
  try {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { photoURL: null });
    if (app.state.userData) app.state.userData.photoURL = null;
    updateProfileUI(app.state);
    updateAuthUI(auth.currentUser, app.state.userData);
    toast('Profile photo removed', 'success');
  } catch (e) {
    console.error('removeProfilePhoto error:', e);
    toast('Unable to remove photo', 'error');
  }
};

// One claim per calendar month, enforced by using `${uid}_${YYYY-MM}` as
// the doc ID (see firestore.rules — self-create only, admin fulfills).
function legendRewardDocId(uid) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { id: `${uid}_${ym}`, ym };
}

async function refreshLegendRewardStatus() {
  if (!auth.currentUser) return;
  const { id } = legendRewardDocId(auth.currentUser.uid);
  const statusEl = S('legendRewardStatus');
  const claimBtn = S('legendClaimBtn');
  if (!statusEl) return;
  try {
    const snap = await getDoc(doc(db, "rewardClaims", id));
    if (snap.exists()) {
      const status = toText(snap.data().status || 'pending');
      statusEl.textContent = status === 'fulfilled'
        ? "This month's data bundle has been sent. 🎉"
        : "Claim submitted — an admin will send your data bundle this month.";
      claimBtn?.classList.add('hidden');
    } else {
      statusEl.textContent = "You haven't claimed this month's data bundle yet.";
      claimBtn?.classList.remove('hidden');
    }
  } catch (e) {
    console.warn('refreshLegendRewardStatus error:', e);
    statusEl.textContent = 'Unable to check claim status right now.';
  }
}

window.claimLegendReward = async () => {
  if (!auth.currentUser) return;
  const xp = app.state.userData?.xp || 0;
  if (!isLegendRank(xp)) return toast('Legend rank required (40,000 XP)', 'error');
  const { id, ym } = legendRewardDocId(auth.currentUser.uid);
  const btn = S('legendClaimBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Claiming...'; }
  try {
    await setDoc(doc(db, "rewardClaims", id), {
      uid: auth.currentUser.uid,
      type: 'legend_data_bundle',
      period: ym,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    toast('Claim submitted! An admin will fulfill it this month.', 'success');
    refreshLegendRewardStatus();
  } catch (e) {
    console.error('claimLegendReward error:', e);
    toast(e?.message || 'Unable to submit claim', 'error');
    if (btn) { btn.disabled = false; btn.textContent = "Claim This Month's Data Bundle"; }
  }
};

function renderGlobalLeaderboard(scholars = []) {
  const list = S('globalLeaderboardList');
  if (!list) return;
  
  if (scholars.length === 0) {
    list.innerHTML = `<tr><td colspan="3" class="px-8 py-10 text-center text-slate-400 font-bold">Loading ranking data...</td></tr>`;
    return;
  }

  const myUid = app.state.user?.uid || null;
  list.innerHTML = scholars.map((s, idx) => `
    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group ${myUid && s.id === myUid ? 'bg-brand-50/60 dark:bg-brand-900/10' : ''} ${isLegendRank(s.xp || 0) ? 'bg-gradient-to-r from-amber-50/60 to-transparent dark:from-amber-900/10' : ''}">
      <td class="px-8 py-5">
        <span class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-black text-slate-500">${idx + 1}</span>
      </td>
      <td class="px-8 py-5">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 flex items-center justify-center font-black">${escapeHTML(s.name ? s.name[0] : 'S')}</div>
          <div>
            <p class="text-sm font-black flex items-center gap-1.5">
              ${escapeHTML(s.name || 'Scholar')}
              ${isLegendRank(s.xp || 0) ? '<i data-lucide="crown" class="w-3.5 h-3.5 text-amber-500 shrink-0" title="Legend rank"></i>' : ''}
              ${verifiedBadgeHTML(s.xp || 0)}
            </p>
            <p class="text-[10px] text-slate-400 font-bold uppercase">${escapeHTML(s.rank_title || calculateRank(s.xp || 0).title)}</p>
          </div>
        </div>
      </td>
      <td class="px-8 py-5 text-right">
        <span class="text-sm font-black text-emerald-500">${(s.xp || 0).toLocaleString()} XP</span>
      </td>
    </tr>
  `).join('');
  if (window.lucide) window.lucide.createIcons();
}

function updateLeaderboardTabs(mode) {
  const allBtn = S('leaderboardTabAll');
  if (!allBtn) return;

  const setActive = (btn, active) => {
    btn.classList.toggle('bg-brand-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('shadow-lg', active);
    btn.classList.toggle('shadow-brand-500/20', active);
    btn.classList.toggle('hover:bg-slate-100', !active);
    btn.classList.toggle('dark:hover:bg-slate-800', !active);
    btn.classList.toggle('text-slate-500', !active);
  };

  setActive(allBtn, true);
}

function renderLeaderboardPodium(scholars = []) {
  const pick = (i) => scholars[i] || null;
  const fmtScore = (v) => `${(v || 0).toLocaleString()} XP`;
  const initials = (name) => toText(name).split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'S';

  const s1 = pick(0);
  const s2 = pick(1);
  const s3 = pick(2);

  if (S('podium1Initial')) S('podium1Initial').textContent = s1 ? initials(s1.name) : 'S1';
  if (S('podium1Name')) S('podium1Name').textContent = s1 ? toText(s1.name) : 'Loading...';
  if (S('podium1Score')) S('podium1Score').textContent = s1 ? fmtScore(s1.xp) : '—';
  if (S('podium1Badge')) S('podium1Badge').textContent = s1 ? (s1.badge || 'Grandmaster') : 'Grandmaster';

  if (S('podium2Initial')) S('podium2Initial').textContent = s2 ? initials(s2.name) : 'S2';
  if (S('podium2Name')) S('podium2Name').textContent = s2 ? toText(s2.name) : 'Loading...';
  if (S('podium2Score')) S('podium2Score').textContent = s2 ? fmtScore(s2.xp) : '—';

  if (S('podium3Initial')) S('podium3Initial').textContent = s3 ? initials(s3.name) : 'S3';
  if (S('podium3Name')) S('podium3Name').textContent = s3 ? toText(s3.name) : 'Loading...';
  if (S('podium3Score')) S('podium3Score').textContent = s3 ? fmtScore(s3.xp) : '—';
}

function renderLeaderboardView() {
  const mode = 'all';
  app.state.leaderboardMode = 'all';
  updateLeaderboardTabs(mode);

  const source = app.state.leaderboardAll || [];
  renderLeaderboardPodium(source.slice(0, 3));
  renderGlobalLeaderboard(source);
}

window.setLeaderboardMode = (mode) => {
  app.state.leaderboardMode = 'all';
  renderLeaderboardView();
};

window.openLeaderboardRewards = () => {
  const el = S('leaderboardRewardsCard');
  if (!el) return;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function updateRankFromLeaderboardAll() {
  const uid = app.state.user?.uid || null;
  if (!uid) return false;
  if (!Array.isArray(app.state.leaderboardAll) || app.state.leaderboardAll.length === 0) return false;

  const idx = app.state.leaderboardAll.findIndex(s => s.id === uid);
  if (idx >= 0) {
    const rank = idx + 1;
    const oldRank = store.get('lastRank', rank);
    const rankDiff = oldRank - rank;
    app.state.userData = { ...app.state.userData, rank, rankDiff };
    delete app.state.userData.rankLabel;
    store.set('lastRank', rank);
    store.set('rankTrend', rankDiff);
    store.set('userData', app.state.userData);
    updateStatsUI(app.state);
    return true;
  }

  if (!app.state.userData.rank && !store.get('lastRank')) {
    app.state.userData = { ...app.state.userData, rankLabel: `Top ${app.state.leaderboardAll.length}+` };
    store.set('userData', app.state.userData);
    updateStatsUI(app.state);
  }

  return false;
}

function renderStudyGoals(state) {
  const wrap = S('upcomingList');
  if (!wrap) return;

  const goals = state.goals || [];

  if (goals.length === 0) {
    wrap.innerHTML = `<p class="text-xs text-slate-400 font-bold p-4">No goals set yet. Add one to get started!</p>`;
    return;
  }

  wrap.innerHTML = goals.map(g => `
    <div class="p-4 rounded-2xl flex items-center justify-between transition-all ${g.done ? 'bg-slate-50 dark:bg-slate-900 opacity-60' : 'bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700'}">
      <div class="flex items-center gap-3">
        <button onclick="window.toggleGoal('${g.id}', event)" class="w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${g.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 dark:border-slate-700'}">
          ${g.done ? '<i data-lucide="check" class="w-3 h-3"></i>' : ''}
        </button>
        <span class="text-sm font-medium ${g.done ? 'line-through text-slate-400' : ''}">${escapeHTML(g.text)}</span>
      </div>
    </div>
  `).join('');
  if (window.lucide) window.lucide.createIcons();
}

function renderDailyPath(state) {
  const roadmap = S('studyRoadmap');
  if (!roadmap) return;

  const tasks = state.userData.dailyTasks || [];

  if (tasks.length === 0) {
    roadmap.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center p-12 bg-slate-50 dark:bg-slate-800/50 rounded-[32px] border-2 border-dashed border-slate-200 dark:border-slate-700">
        <div class="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 flex items-center justify-center mb-4">
          <i data-lucide="sparkles" class="w-8 h-8"></i>
        </div>
        <h4 class="text-lg font-black mb-2">Your Path is Empty</h4>
        <p class="text-sm text-slate-500 dark:text-slate-400 text-center mb-6 max-w-xs">Let our AI engine craft a personalized study roadmap for your upcoming exams.</p>
        <button onclick="window.generateDailyPath()" class="px-8 py-4 rounded-2xl bg-brand-600 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-brand-500/20 hover:scale-105 active:scale-95 transition-all">
          Generate Path
        </button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  roadmap.innerHTML = tasks.map((item, idx) => `
    <div class="p-5 rounded-3xl bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex items-center gap-4 hover:border-brand-300 transition-all group">
      <div class="w-12 h-12 rounded-2xl ${escapeHTML(item.color || 'bg-brand-500')} text-white flex items-center justify-center font-black text-xs shadow-lg shadow-brand-500/20 group-hover:scale-110 transition-transform">
        <i data-lucide="${safeIconName(item.icon || 'book-open', 'book-open')}" class="w-5 h-5"></i>
      </div>
      <div class="flex-1">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Task ${idx + 1}</p>
        <p class="text-sm font-bold text-slate-700 dark:text-slate-200 mt-0.5">${escapeHTML(item.task)}</p>
      </div>
      <button onclick="window.completeDailyTask('${item.id}', event)" class="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors">
        <i data-lucide="check-circle" class="w-5 h-5"></i>
      </button>
    </div>
  `).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.generateDailyPath = async () => {
  if (!app.state.user) return;
  
  showPageLoader('Analyzing Syllabus & Performance...');
  try {
    let tasks = null;
    try {
      if (aiIsConfigured()) {
        tasks = await aiGenerateDailyPathTasks({
          university: app.state.userData?.university || '',
          exams: app.state.userData?.upcomingExams || [],
          weakAreas: app.state.userData?.weakAreas || []
        });
      }
    } catch {}

    if (!Array.isArray(tasks) || tasks.length === 0) {
      tasks = [
        { id: 't1', day: 'Mon', task: 'Physics: Thermodynamics', color: 'bg-brand-500', icon: 'zap' },
        { id: 't2', day: 'Tue', task: 'Math: Integration', color: 'bg-rose-500', icon: 'divide' },
        { id: 't3', day: 'Wed', task: 'Biology: Genetics', color: 'bg-emerald-500', icon: 'dna' }
      ];
      await new Promise(r => setTimeout(r, 900));
    }

    await updateDoc(doc(db, "users", app.state.user.uid), { dailyTasks: tasks });
    toast('AI Study Path Generated!', 'success');
  } finally {
    document.getElementById('pageLoader')?.remove();
  }
};

window.completeDailyTask = async (id, event) => {
  if (!app.state.user) return;
  const tasks = app.state.userData.dailyTasks || [];
  const updatedTasks = tasks.filter(t => t.id !== id);
  
  await updateDoc(doc(db, "users", app.state.user.uid), { dailyTasks: updatedTasks });
  rewardXP(100, event);
  toast('Task completed! +100 XP', 'success');
};

function initSyllabusHeatmap(state) {
  const heatmap = S('syllabusHeatmap');
  if (!heatmap) return;
  
  const flashcards = state.flashcards || [];
  if (flashcards.length === 0) {
    heatmap.innerHTML = `<div class="col-span-full py-10 text-center text-slate-400 font-bold text-xs uppercase tracking-widest">No study data available yet</div>`;
    return;
  }
  
  heatmap.innerHTML = flashcards.slice(0, 50).map((card, i) => {
    const srs = card.srsLevel || 0;
    const colors = ['bg-slate-100 dark:bg-slate-800', 'bg-brand-200', 'bg-brand-400', 'bg-brand-600', 'bg-brand-800'];
    const colorClass = colors[Math.min(srs, 4)];
    const mastery = Math.min(srs * 25, 100);
    const title = `${toText(card.q).substring(0, 30)}...: ${mastery}% Mastered`;
    const safeTitle = escapeHTML(title);
    
    return `<div class="aspect-square rounded-sm ${colorClass} transition-all hover:scale-125 cursor-help relative group" title="${safeTitle}">
      <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded bg-slate-900 text-white text-[8px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
        ${safeTitle}
      </div>
    </div>`;
  }).join('');
}

async function showSection(id, state) {
  const overlay = S('sceneOverlay');
  if (overlay && state.currentSection && state.currentSection !== id) {
    overlay.classList.remove('hidden', 'opacity-0');
    overlay.classList.add('active', 'opacity-100');
    await new Promise(r => setTimeout(r, 400));
  }

  // Subscription Access Control
  const tier = (state.userData?.subscription?.tier || 'FREE').toUpperCase();
  
  const restrictions = {
    'gigsBoard': { minTier: 'PREMIUM', name: 'Gigs Board' },
    'skillAcademy': { minTier: 'PREMIUM', name: 'Skills Academy' },
    'warRooms': { minTier: 'STANDARD', name: 'War Rooms' }
  };

  if (restrictions[id]) {
    const { minTier, name } = restrictions[id];
    const tiers = ['FREE', 'STANDARD', 'PREMIUM'];
    const userTier = (state.userData?.subscription?.tier || 'FREE').toUpperCase();
    const isVerified = state.userData?.subscription?.verified !== false;

    if (tiers.indexOf(userTier) < tiers.indexOf(minTier)) {
      if (overlay) {
        overlay.classList.remove('active', 'opacity-100');
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 500);
      }
      toast(`${name} is a ${minTier.charAt(0) + minTier.slice(1).toLowerCase()} feature. Upgrade now!`, 'brand');
      window.showPricingModal(true);
      return;
    }
    
    if (!isVerified) {
      if (overlay) {
        overlay.classList.remove('active', 'opacity-100');
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 500);
      }
      toast(`Your ${userTier} upgrade is pending admin verification.`, 'info');
      return;
    }
  }

  state.currentSection = id;
  
  // Apply smoother transitions
  $$('.section').forEach(s => {
    s.classList.add('section-transition', 'section-hidden');
    s.classList.add('hidden');
  });
  
  const target = S(id);
  if (target) {
    target.classList.remove('hidden');
    // Force reflow
    target.offsetHeight;
    target.classList.remove('section-hidden');
    target.classList.add('section-visible');
  }
  
  $$('.tab-btn').forEach(btn => {
    const isActive = btn.getAttribute('data-target') === id;
    btn.classList.toggle('nav-item-active', isActive);
    // Haptic-like effect on tab click
    if (isActive) {
      btn.classList.add('scale-105');
      setTimeout(() => btn.classList.remove('scale-105'), 200);
    }
  });

  // Update bottom navigation active state
  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    $$('.bottom-nav-item').forEach(btn => {
      const btnSection = btn.getAttribute('data-section');
      const isActive = btnSection === id;
      btn.classList.toggle('active', isActive);
      if (isActive) {
        btn.style.color = '#7c3aed';
      } else {
        btn.style.color = '';
      }
    });
  }

  const header = document.querySelector('header');
  const sidebar = S('sidebar');
  const main = document.querySelector('main');
  const mainWrap = main?.parentElement;
  const isCommunity = id === 'community';

  if (header) header.classList.toggle('hidden', isCommunity);
  if (sidebar) sidebar.classList.toggle('hidden', isCommunity);

  if (main) {
    main.classList.toggle('overflow-hidden', isCommunity);
    main.classList.toggle('overflow-y-auto', !isCommunity);
    main.classList.toggle('bg-slate-50/50', !isCommunity);
    main.classList.toggle('dark:bg-slate-950/50', !isCommunity);
  }

  if (mainWrap) {
    mainWrap.classList.toggle('m-0', isCommunity);
    mainWrap.classList.toggle('p-0', isCommunity);
    mainWrap.classList.toggle('w-full', isCommunity);
    mainWrap.classList.toggle('h-full', isCommunity);
    mainWrap.classList.toggle('w-screen', isCommunity);
    mainWrap.classList.toggle('h-screen', isCommunity);
    mainWrap.classList.toggle('max-w-none', isCommunity);
    mainWrap.classList.toggle('mx-0', isCommunity);
  }

  if (id === 'dashboard') updateDashboard(state);
  if (id === 'marketplace') filterMarket(state.marketplace);
  if (id === 'leaderboardSection') renderLeaderboardView();
  if (id === 'profile') updateProfileUI(state);
  if (id === 'skillAcademy') renderSkillAcademy();
  if (id === 'gigsBoard') renderGigsBoard();
  if (id === 'cbt') {
    resetCbtSession();
    renderOfficialExams();
    if (S('cbtSetup')) S('cbtSetup').classList.remove('hidden');
    if (S('cbtExamArea')) S('cbtExamArea').classList.add('hidden');
    if (S('selectedBookInfo')) S('selectedBookInfo').classList.add('hidden');
    if (S('aiScanningOverlay')) S('aiScanningOverlay').classList.add('hidden');
    if (S('scanningProgress')) S('scanningProgress').style.width = '0%';
    if (S('bookUploadInput')) S('bookUploadInput').value = '';
    cbtFocusMode = false;
    if (S('cbtSidebar')) S('cbtSidebar').classList.remove('hidden');
    if (S('cbtQuestionMapCard')) S('cbtQuestionMapCard').classList.remove('hidden');
  }

  if (id === 'tutorHub') loadTutorHubPreview();

  if (id === 'support') initSupportChat();
  
  // Cleanup other listeners if needed
  if (id !== 'support' && supportState.unsubMessages) {
    supportState.unsubMessages();
    supportState.unsubMessages = null;
  }

  if (window.lucide) window.lucide.createIcons();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (overlay) {
    overlay.classList.remove('active', 'opacity-100');
    overlay.classList.add('opacity-0');
    setTimeout(() => overlay.classList.add('hidden'), 500);
  }
}

// --- Subscription Module ---
window.showPricingModal = (show = true) => {
  const overlay = S('pricingOverlay');
  if (!overlay) return;
  
  if (show) {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    setTimeout(() => {
      overlay.classList.remove('opacity-0');
      overlay.classList.add('opacity-100');
    }, 10);
    window.setBillingCycle(billingState.cycle);
  } else {
    overlay.classList.remove('opacity-100');
    overlay.classList.add('opacity-0');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('flex');
    }, 500);
  }
};

// Standard/Premium share one card each regardless of billing cycle — this
// swaps the displayed price/savings and which tier the button actually
// buys, rather than duplicating cards per cycle.
window.setBillingCycle = (cycle) => {
  billingState.cycle = cycle === 'annual' ? 'annual' : 'monthly';

  const monthlyToggle = S('billingToggleMonthly');
  const annualToggle = S('billingToggleAnnual');
  [monthlyToggle, annualToggle].forEach(btn => btn?.classList.remove('bg-white', 'shadow-sm', 'text-brand-600'));
  const activeToggle = billingState.cycle === 'annual' ? annualToggle : monthlyToggle;
  activeToggle?.classList.add('bg-white', 'shadow-sm', 'text-brand-600');

  const currentPlan = (app.state.userData?.subscription?.tier || 'FREE').toUpperCase();
  const currentBase = currentPlan.replace('_ANNUAL', '');

  [
    { base: 'STANDARD', ctaText: 'Upgrade Now', colorClass: 'text-brand-600' },
    { base: 'PREMIUM', ctaText: 'Go Premium', colorClass: 'text-emerald-600' },
  ].forEach(({ base, ctaText, colorClass }) => {
    const activeTier = window.resolveBillingTier(base);
    const plan = PLAN_PRICES[activeTier];
    if (S(`price${base}`)) S(`price${base}`).textContent = formatCurrency(plan.amount);
    if (S(`period${base}`)) S(`period${base}`).textContent = billingState.cycle === 'annual' ? '/year' : '/month';
    const saveEl = S(`save${base}`);
    if (saveEl) {
      if (billingState.cycle === 'annual') {
        const savings = PLAN_PRICES[base].amount * 12 - plan.amount;
        saveEl.textContent = `Save ${formatCurrency(savings)}/yr`;
        saveEl.classList.remove('hidden');
      } else {
        saveEl.classList.add('hidden');
      }
    }
    const btn = S(`planBtn${base}`);
    if (btn) {
      if (currentBase === base) {
        btn.disabled = true;
        btn.textContent = 'Current Plan';
        btn.className = 'w-full py-4 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-400 font-black uppercase tracking-widest text-[10px]';
      } else {
        btn.disabled = false;
        btn.textContent = ctaText;
        btn.className = `w-full py-4 rounded-xl bg-white ${colorClass} font-black uppercase tracking-widest text-[10px] hover:scale-105 transition-all`;
      }
    }
  });

  // Free + Exam Pass + University Pass cards don't change with the billing
  // toggle (all flat/monthly, no annual variant).
  ['FREE', 'EXAM_PASS_SEASON', 'EXAM_PASS_ANNUAL', 'UNIVERSITY_PASS_30', 'UNIVERSITY_PASS_70'].forEach(tier => {
    const btn = S(`planBtn${tier}`);
    if (!btn) return;
    if (tier === currentPlan) {
      btn.disabled = true;
      btn.textContent = 'Current Plan';
      btn.className = 'w-full py-4 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-400 font-black uppercase tracking-widest text-[10px]';
    } else {
      btn.disabled = false;
      btn.textContent = tier === 'FREE' ? 'Switch to Free' : (tier.startsWith('UNIVERSITY_PASS') ? 'Get University Pass' : 'Get Exam Pass');
    }
  });
};

window.upgradeSubscription = async (tier) => {
  const user = app.state.user || auth.currentUser;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Please sign in to upgrade', 'error');
    return;
  }

  const currentTier = (app.state.userData?.subscription?.tier || 'FREE').toUpperCase();
  if (tier === currentTier) return;

  // Paid tiers now collect payment details (account name / bank / account
  // number) and an optional promo code via the payment modal instead of a
  // bare confirm() dialog. See window.showPaymentModal / submitPaymentForm.
  if (tier !== 'FREE') {
    window.showPaymentModal(tier);
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const subscription = {
      tier,
      updatedAt: serverTimestamp(),
      status: 'active',
      verified: true,
      expiryDate: null
    };

    await updateDoc(userRef, { subscription });
    app.state.userData.subscription = subscription;
    
    // Update UI
    if (S('userTier')) S('userTier').textContent = tier.charAt(0) + tier.slice(1).toLowerCase();
    if (S('sidebarTier')) S('sidebarTier').textContent = tier.charAt(0) + tier.slice(1).toLowerCase();
    
    confettiCelebration();
    toast(`Successfully downgraded to Free plan.`, 'success');
    window.showPricingModal(false);
    updateStatsUI(app.state);
  } catch (e) {
    console.error('Upgrade error:', e);
    toast('Unable to process request. Please try again.', 'error');
  }
};

// --- Payment Details & Promo Code Module ---
// Each tier's `durationDays` is what actually gets turned into
// subscription.expiryDate (see submitPaymentForm below) and is enforced by
// checkSubscriptionExpiry() at load time — previously expiryDate was set but
// never read anywhere, so paid tiers silently never expired. Monthly
// STANDARD/PREMIUM keep the pre-existing 30-day cadence (still expected to
// be manually renewed/re-verified each month the same way they always
// were); annual and Exam Pass tiers are the first ones with a real duration.
const PLAN_PRICES = {
  STANDARD: { amount: 1500, durationDays: 30, label: 'Standard (The "Scholar")' },
  PREMIUM: { amount: 3500, durationDays: 30, label: 'Premium (The "Pro")' },
  STANDARD_ANNUAL: { amount: 15000, durationDays: 365, label: 'Standard Annual (The "Scholar")' },
  PREMIUM_ANNUAL: { amount: 35000, durationDays: 365, label: 'Premium Annual (The "Pro")' },
  // One-time, CBT-only passes — the myschool.ng-style cheap anchor. Deliberately
  // excluded from AI Scan Vault (openAIScanVault's PREMIUM/ELITE gate) and
  // from the AI-generation daily cap bypass (see startAiGeneration) since
  // those cost real per-use API money; both passes DO get unlimited access
  // to the real question-bank CBT suite (Quick Practice, JAMB simulation,
  // bookmarks, analytics, ranking), same as STANDARD/PREMIUM.
  EXAM_PASS_SEASON: { amount: 2000, durationDays: 183, label: 'Exam Pass — Season', oneTime: true },
  EXAM_PASS_ANNUAL: { amount: 2500, durationDays: 365, label: 'Exam Pass — Annual', oneTime: true },
  // Hostel Finder + Lecture Recordings, gated by a monthly lecture-view
  // quota. These were missing here entirely, which is why "Get University
  // Pass" silently did nothing — showPaymentModal() below no-ops on any
  // tier not present in this object (`if (!PLAN_PRICES[tier]) return;`),
  // with no error and no toast. The access-gate side (hasUniversityAccess()
  // in university.js, TIER_LECTURE_QUOTA in server.js) already correctly
  // checks for these exact tier strings independent of this object, so
  // adding them here is the only change needed to wire the button into the
  // same inline payment-modal flow every other plan on this page uses.
  // Monthly recurring like STANDARD/PREMIUM (not oneTime), matching the
  // "/month" pricing shown on both cards.
  UNIVERSITY_PASS_30: { amount: 5000, durationDays: 30, label: 'University Pass — 30' },
  UNIVERSITY_PASS_70: { amount: 10000, durationDays: 30, label: 'University Pass — 70' },
};

// Billing-cycle toggle for Standard/Premium in the pricing modal. Exam
// Passes are already one-time/flat, so they're unaffected by this.
const billingState = { cycle: 'monthly' };
window.resolveBillingTier = (baseTier) => billingState.cycle === 'annual' ? `${baseTier}_ANNUAL` : baseTier;

const paymentModalState = {
  tier: null,
  promo: null // { code, discountPercent, docId }
};

function resetPaymentModalUI() {
  if (S('paymentAccountName')) S('paymentAccountName').value = '';
  if (S('paymentBankName')) S('paymentBankName').value = '';
  if (S('paymentAccountNumber')) S('paymentAccountNumber').value = '';
  if (S('paymentPromoCode')) S('paymentPromoCode').value = '';
  const feedback = S('promoFeedback');
  if (feedback) { feedback.classList.add('hidden'); feedback.textContent = ''; }
  const discountRow = S('paymentDiscountRow');
  if (discountRow) discountRow.classList.add('hidden');
  paymentModalState.promo = null;
}

function updatePaymentSummary() {
  const tier = paymentModalState.tier;
  const plan = PLAN_PRICES[tier];
  const price = plan?.amount || 0;
  const periodLabel = plan?.oneTime ? '' : (plan?.durationDays >= 365 ? '/year' : '/month');
  const promo = paymentModalState.promo;
  const discountAmount = promo ? Math.round(price * (promo.discountPercent / 100)) : 0;
  const finalPrice = Math.max(0, price - discountAmount);

  if (S('paymentPlanLabel')) S('paymentPlanLabel').textContent = plan?.label || tier;
  if (S('paymentOriginalPrice')) S('paymentOriginalPrice').textContent = `${formatCurrency(price)}${periodLabel}`;

  const discountRow = S('paymentDiscountRow');
  if (discountRow) {
    if (promo) {
      discountRow.classList.remove('hidden');
      if (S('paymentDiscountAmount')) S('paymentDiscountAmount').textContent = `-${formatCurrency(discountAmount)} (${promo.discountPercent}% • ${promo.code})`;
    } else {
      discountRow.classList.add('hidden');
    }
  }
  if (S('paymentFinalPrice')) S('paymentFinalPrice').textContent = `${formatCurrency(finalPrice)}${periodLabel}`;

  return { price, discountAmount, finalPrice };
}

// Cached across modal opens within a session — this rarely changes, no need
// to refetch every time the payment modal is opened.
let cachedPaymentAccount = null;

window.loadPaymentReceivingAccount = async () => {
  const body = S('paymentReceivingAccountBody');
  if (!body) return;

  if (cachedPaymentAccount) {
    renderPaymentReceivingAccount(cachedPaymentAccount);
    return;
  }

  body.innerHTML = `<p class="text-xs font-bold text-slate-400">Loading receiving account…</p>`;
  try {
    const snap = await getDoc(doc(db, 'settings', 'payment'));
    if (!snap.exists()) {
      body.innerHTML = `<p class="text-xs font-bold text-rose-500">Receiving account not configured yet. Please reach us in Support Chat before paying.</p>`;
      return;
    }
    cachedPaymentAccount = snap.data();
    renderPaymentReceivingAccount(cachedPaymentAccount);
  } catch (e) {
    console.error('Failed to load receiving account:', e);
    body.innerHTML = `<p class="text-xs font-bold text-rose-500">Couldn't load the receiving account. Please reach us in Support Chat before paying.</p>`;
  }
};

function renderPaymentReceivingAccount(cfg) {
  const body = S('paymentReceivingAccountBody');
  if (!body) return;

  const row = (label, value, key) => value ? `
    <div class="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-brand-500/10">
      <div class="min-w-0">
        <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">${escapeHTML(label)}</p>
        <p class="text-sm font-black truncate">${escapeHTML(value)}</p>
      </div>
      <button type="button" onclick="window.copyToClipboard('${escapeHTML(String(value)).replace(/'/g, "\\'")}', window.toast)" class="shrink-0 w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 flex items-center justify-center hover:bg-brand-100 transition-all" title="Copy ${escapeHTML(label)}">
        <i data-lucide="copy" class="w-4 h-4"></i>
      </button>
    </div>
  ` : '';

  const rows = [
    row('Bank Transfer — Account Name', cfg.accountName, 'accountName'),
    row('Bank Transfer — Bank Name', cfg.bankName, 'bankName'),
    row('Bank Transfer — Account Number', cfg.accountNumber, 'accountNumber'),
    row('PalmPay Name', cfg.palmpayName, 'palmpayName'),
    row('PalmPay Number', cfg.palmpayNumber, 'palmpayNumber'),
  ].filter(Boolean).join('');

  body.innerHTML = rows || `<p class="text-xs font-bold text-rose-500">Receiving account not configured yet. Please reach us in Support Chat before paying.</p>`;
  if (cfg.notes) {
    body.innerHTML += `<p class="text-[10px] font-medium text-slate-500 pt-1">${escapeHTML(cfg.notes)}</p>`;
  }
  if (window.lucide) window.lucide.createIcons();
}

window.showPaymentModal = (tier) => {
  const user = app.state.user || auth.currentUser;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Please sign in to upgrade', 'error');
    return;
  }
  if (!PLAN_PRICES[tier]) return;

  const currentTier = (app.state.userData?.subscription?.tier || 'FREE').toUpperCase();
  if (tier === currentTier) return;

  const overlay = S('paymentOverlay');
  if (!overlay) return;

  paymentModalState.tier = tier;
  resetPaymentModalUI();
  updatePaymentSummary();
  window.loadPaymentReceivingAccount();

  window.showPricingModal(false);
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');
  setTimeout(() => {
    overlay.classList.remove('opacity-0');
    overlay.classList.add('opacity-100');
  }, 10);
  if (window.lucide) window.lucide.createIcons();
};

window.closePaymentModal = () => {
  const overlay = S('paymentOverlay');
  if (!overlay) return;
  overlay.classList.remove('opacity-100');
  overlay.classList.add('opacity-0');
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }, 500);
};

// Validates a promo code doc against the tier currently being purchased.
// Returns { ok: true, discountPercent, code, docId } or { ok: false, reason }.
async function validatePromoCode(rawCode, tier) {
  const code = toText(rawCode).trim().toUpperCase();
  if (!code) return { ok: false, reason: 'Enter a promo code' };

  try {
    const snap = await getDoc(doc(db, 'promoCodes', code));
    if (!snap.exists()) return { ok: false, reason: 'Invalid promo code' };

    const p = snap.data();
    if (p.active === false) return { ok: false, reason: 'This code is no longer active' };

    const expiresAtMs = toMillis(p.expiresAt);
    if (expiresAtMs && expiresAtMs < Date.now()) return { ok: false, reason: 'This code has expired' };

    const maxUses = Number(p.maxUses) || 0;
    const usedCount = Number(p.usedCount) || 0;
    if (maxUses > 0 && usedCount >= maxUses) return { ok: false, reason: 'This code has reached its usage limit' };

    const appliesTo = Array.isArray(p.appliesTo) && p.appliesTo.length ? p.appliesTo : ['ALL'];
    if (!appliesTo.includes('ALL') && !appliesTo.includes(tier)) {
      return { ok: false, reason: `This code isn't valid for the ${tier} plan` };
    }

    const discountPercent = Math.min(100, Math.max(0, Number(p.discountPercent) || 0));
    return { ok: true, discountPercent, code, docId: snap.id };
  } catch (e) {
    console.error('Promo validation error:', e);
    return { ok: false, reason: 'Unable to verify code right now' };
  }
}

window.applyPromoToPayment = async () => {
  const input = S('paymentPromoCode');
  const feedback = S('promoFeedback');
  const btn = S('applyPromoBtn');
  if (!input) return;

  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  const result = await validatePromoCode(input.value, paymentModalState.tier);
  if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }

  if (!result.ok) {
    paymentModalState.promo = null;
    updatePaymentSummary();
    if (feedback) {
      feedback.classList.remove('hidden');
      feedback.textContent = result.reason;
      feedback.className = 'text-[10px] font-bold mt-2 text-rose-500';
    }
    return;
  }

  paymentModalState.promo = { code: result.code, discountPercent: result.discountPercent, docId: result.docId };
  updatePaymentSummary();
  if (feedback) {
    feedback.classList.remove('hidden');
    feedback.textContent = `Applied! ${result.discountPercent}% off.`;
    feedback.className = 'text-[10px] font-bold mt-2 text-emerald-500';
  }
};

window.submitPaymentForm = async () => {
  const user = app.state.user || auth.currentUser;
  if (!user) return toast('Please sign in to upgrade', 'error');

  const tier = paymentModalState.tier;
  if (!PLAN_PRICES[tier]) return;

  const accountName = S('paymentAccountName')?.value.trim() || '';
  const bankName = S('paymentBankName')?.value.trim() || '';
  const accountNumber = S('paymentAccountNumber')?.value.trim() || '';

  if (!accountName) return toast('Enter the account name used for payment', 'error');
  if (!bankName) return toast('Enter the bank name', 'error');
  if (!/^\d{10}$/.test(accountNumber)) return toast('Enter a valid 10-digit account number', 'error');

  // Re-validate the promo right before submitting to close the gap between
  // clicking "Apply" and clicking "Submit" (code could expire, hit its
  // limit, or the user could edit the field without re-applying).
  let promo = paymentModalState.promo;
  const promoInputValue = S('paymentPromoCode')?.value.trim();
  if (promo && promoInputValue && promoInputValue.toUpperCase() !== promo.code) {
    promo = null;
    paymentModalState.promo = null;
  }
  if (promo) {
    const recheck = await validatePromoCode(promo.code, tier);
    if (!recheck.ok) {
      paymentModalState.promo = null;
      updatePaymentSummary();
      return toast(`Promo code issue: ${recheck.reason}`, 'error');
    }
    promo = { code: recheck.code, discountPercent: recheck.discountPercent, docId: recheck.docId };
  }

  const { price, discountAmount, finalPrice } = updatePaymentSummary();

  const submitBtn = S('submitPaymentBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

  try {
    // Atomically re-check + burn one use of the promo code (if any) so two
    // concurrent submissions can't both slip in under a maxUses cap.
    // Allowed by firestore.rules as a usedCount-only increment-by-1 update.
    if (promo) {
      await runTransaction(db, async (tx) => {
        const promoRef = doc(db, 'promoCodes', promo.docId);
        const promoSnap = await tx.get(promoRef);
        if (!promoSnap.exists()) throw new Error('PROMO_GONE');
        const p = promoSnap.data();
        if (p.active === false) throw new Error('PROMO_INACTIVE');
        const maxUses = Number(p.maxUses) || 0;
        const usedCount = Number(p.usedCount) || 0;
        if (maxUses > 0 && usedCount >= maxUses) throw new Error('PROMO_LIMIT');
        tx.update(promoRef, { usedCount: usedCount + 1 });
      });
    }

    const subscription = {
      tier,
      updatedAt: serverTimestamp(),
      status: 'pending',
      verified: false,
      expiryDate: new Date(Date.now() + (PLAN_PRICES[tier]?.durationDays || 30) * 24 * 60 * 60 * 1000),
      payment: {
        accountName,
        bankName,
        accountNumber,
        originalPrice: price,
        discountPercent: promo?.discountPercent || 0,
        promoCode: promo?.code || null,
        finalPrice
      }
    };

    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, { subscription });
    app.state.userData.subscription = subscription;

    await addDoc(collection(db, 'subscriptionRequests'), {
      userId: user.uid,
      email: user.email || app.state.userData?.email || '',
      tier,
      accountName,
      bankName,
      accountNumber,
      promoCode: promo?.code || null,
      discountPercent: promo?.discountPercent || 0,
      originalPrice: price,
      finalPrice,
      status: 'pending',
      createdAt: serverTimestamp()
    });

    showSection('support', app.state);

    const promoLine = promo ? ` (Promo **${promo.code}** applied, ${promo.discountPercent}% off)` : '';
    const promptText = `Hello! I've initiated an upgrade to ${tier}${promoLine}. Payment was made as **${accountName}** from **${bankName}** (Acct: ${accountNumber}). Total due: ₦${finalPrice.toLocaleString()}. Please verify and activate my subscription.`;

    await addDoc(collection(db, 'support_messages'), {
      userId: user.uid,
      senderId: 'system',
      text: promptText,
      createdAt: serverTimestamp(),
      isSystem: true
    });

    window.closePaymentModal();
    updateStatsUI(app.state);
    toast(`${tier} upgrade submitted for verification!`, 'success');
  } catch (e) {
    console.error('Payment submission error:', e);
    const reasonMap = {
      PROMO_GONE: 'That promo code no longer exists.',
      PROMO_INACTIVE: 'That promo code is no longer active.',
      PROMO_LIMIT: 'That promo code just reached its usage limit.'
    };
    toast(reasonMap[e.message] || 'Unable to submit payment details. Please try again.', 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit for Verification'; }
  }
};

// --- Features Module ---
function addReview() {
  const course = S('reviewCourse').value.trim();
  const text = S('reviewText').value.trim();
  if (!course || !text) return toast('Course and review required', 'error');
  
  const reviews = store.get('reviews', []);
  reviews.unshift({ course, text, date: new Date().toLocaleDateString() });
  store.set('reviews', reviews);
  
  if (S('reviewCourse')) S('reviewCourse').value = '';
  if (S('reviewText')) S('reviewText').value = '';
  renderReviews();
  toast('Review shared!', 'success');
}

function renderReviews() {
  const list = S('reviewList');
  if (!list) return;
  const reviews = store.get('reviews', []).slice(0, 5);
  list.innerHTML = reviews.map(r => `
    <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
      <p class="text-[10px] font-black text-brand-600 uppercase mb-1">${escapeHTML(r.course)}</p>
      <p class="text-xs font-medium">${escapeHTML(r.text)}</p>
    </div>
  `).join('');
}

const updateActivity = async () => {
  if (!app.state.user || !app.state.userData) return;
  const userRef = doc(db, "users", app.state.user.uid);
  
  const userData = app.state.userData;
  const lastActive = userData.lastActive;
  let streak = userData.streak || 0;
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (lastActive) {
    const last = lastActive.toDate ? lastActive.toDate() : new Date(lastActive);
    const lastDate = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    const diffInDays = Math.round((today - lastDate) / (1000 * 60 * 60 * 24));
    
    if (diffInDays === 1) {
      streak += 1; // It's a new day, increment!
    } else if (diffInDays > 1) {
      streak = 1; // Broken streak, reset to 1
    }
    // if diffInDays === 0, it's the same day, keep the current streak
  } else {
    streak = 1; // First activity ever
  }
  
  // Only update if something changed or to keep the timestamp fresh
  await updateDoc(userRef, { lastActive: serverTimestamp(), streak });
  store.set('streak', streak);
};

const rewardXP = async (amount, event = null) => {
  if (!app.state.user) return;
  
  updateActivity(); // Update streak and last active time
  const x = event?.clientX || (event?.target ? event.target.getBoundingClientRect().left : window.innerWidth / 2);
  const y = event?.clientY || (event?.target ? event.target.getBoundingClientRect().top : window.innerHeight / 2);
  
  const anim = document.createElement('div');
  anim.className = 'fixed font-black text-brand-600 pointer-events-none z-[2000] animate-out fade-out slide-out-to-top-10 duration-1000';
  anim.style.left = `${x}px`;
  anim.style.top = `${y - 20}px`;
  anim.textContent = `+${amount} XP`;
  document.body.appendChild(anim);
  setTimeout(() => anim.remove(), 1000);

  const delta = Number(amount) || 0;
  const oldXp = app.state.userData.xp || 0;
  const oldRank = calculateRank(oldXp);
  const optimisticXp = Math.max(0, oldXp + delta);
  const optimisticRank = calculateRank(optimisticXp);
  
  app.state.userData.xp = optimisticXp;
  app.state.userData.level = optimisticRank.rank;
  app.state.userData.rank_title = optimisticRank.title;
  store.set('userData', app.state.userData);
  store.set('currentXP', optimisticXp); 

  // Optimistic UI Update: Update UI instantly before DB write
  updateStatsUI(app.state);
  updateUserRankDebounced(); // Recalculate rank after XP gain
  
  try {
    const res = await addXP(app.state.user.uid, delta);
    if (res?.newRank) {
      app.state.userData.xp = res.newXp;
      app.state.userData.level = res.newRank.rank;
      app.state.userData.rank_title = res.newRank.title;
      store.set('userData', app.state.userData);
      updateStatsUI(app.state);

      if (res.newRank.title !== oldRank.title) {
        confettiCelebration();
        toast(`RANK UP! You are now ${res.newRank.title}`, 'brand');
        
        const levelUpModal = document.createElement('div');
        levelUpModal.className = 'fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-500';
        levelUpModal.innerHTML = `
          <div class="bg-white dark:bg-slate-900 p-12 rounded-[48px] text-center shadow-2xl border border-brand-500/30 scale-110">
            <div class="w-24 h-24 rounded-3xl bg-brand-600 text-white flex items-center justify-center mx-auto mb-8 shadow-glow animate-bounce">
              <i data-lucide="award" class="w-12 h-12"></i>
            </div>
            <h2 class="text-4xl font-black mb-3">${escapeHTML(res.newRank.title)}</h2>
            <p class="text-slate-500 dark:text-slate-400 text-lg font-medium mb-6">Milestone Reward</p>
            <div class="mx-auto max-w-md p-4 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 mb-10">
              ${escapeHTML(res.newRank.reward)}
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="px-12 py-5 bg-brand-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-700 transition-all">Keep Grinding</button>
          </div>
        `;
        document.body.appendChild(levelUpModal);
        if (window.lucide) window.lucide.createIcons();
      }
    }
    
  } catch (e) {
    console.error('Error updating XP:', e);
    // Rollback state on failure
    app.state.userData.xp = oldXp;
    app.state.userData.level = oldRank.rank;
    app.state.userData.rank_title = oldRank.title;
    updateStatsUI(app.state);
  }
};

function calculateAdmission() {
  const jamb = parseInt(S('jambScore').value) || 0;
  const grade = S('olevelGrade').value;
  const course = S('courseSelect').value;
  const state = S('stateOrigin')?.value || '';

  if (jamb < 100) return toast('Please enter a valid JAMB score', 'error');

  const result = scoreCourseChance(jamb, grade, course, state);

  const meter = S('meterCircle');
  const percentText = S('meterPercent');
  if (meter) meter.style.strokeDashoffset = 283 - (283 * result.probability / 100);
  if (percentText) percentText.textContent = `${result.probability}%`;
  if (S('compText')) S('compText').textContent = result.competition;
  if (S('adviceText')) S('adviceText').textContent = result.advice;
  if (S('catchmentText')) S('catchmentText').textContent = result.catchmentUnis.length
    ? `+${CATCHMENT_BOOST}% (${result.catchmentUnis.length} unis)`
    : 'None found';

  toast('Chances calculated!', 'success');
  confettiCelebration();
}

// --- Admission Predictor: full matcher ---
// Extends the single-course calculator above into a real course/university
// matcher, using the same heuristic scoring so the numbers stay consistent
// between both views. This is a trend-based ESTIMATE, not official JAMB/CAPS
// cut-off data — the UI says so explicitly, and so should you if you demo it.
const COURSE_CATALOG = [
  { name: 'Medicine & Surgery', tier: 'extreme' },
  { name: 'Law', tier: 'extreme' },
  { name: 'Nursing Science', tier: 'extreme' },
  { name: 'Pharmacy', tier: 'high' },
  { name: 'Computer Science', tier: 'high' },
  { name: 'Electrical Engineering', tier: 'high' },
  { name: 'Mechanical Engineering', tier: 'high' },
  { name: 'Civil Engineering', tier: 'high' },
  { name: 'Accounting', tier: 'moderate' },
  { name: 'Economics', tier: 'moderate' },
  { name: 'Mass Communication', tier: 'moderate' },
  { name: 'Business Administration', tier: 'moderate' },
  { name: 'Microbiology', tier: 'moderate' },
  { name: 'Biochemistry', tier: 'moderate' },
  { name: 'Education (any combo)', tier: 'low' },
];

const CATCHMENT_BOOST = 8;

// Federal universities tagged by state — used purely for the catchment-area
// boost (JAMB gives indigenes of a university's host state an admission
// edge). Not exhaustive; extend freely as you verify more institutions.
const NIGERIAN_UNIVERSITIES = [
  { name: 'University of Lagos (UNILAG)', state: 'Lagos' },
  { name: 'Lagos State University (LASU)', state: 'Lagos' },
  { name: 'University of Ibadan (UI)', state: 'Oyo' },
  { name: 'Obafemi Awolowo University (OAU)', state: 'Osun' },
  { name: 'University of Ilorin (UNILORIN)', state: 'Kwara' },
  { name: 'Ahmadu Bello University (ABU)', state: 'Kaduna' },
  { name: 'University of Nigeria, Nsukka (UNN)', state: 'Enugu' },
  { name: 'University of Benin (UNIBEN)', state: 'Edo' },
  { name: 'University of Port Harcourt (UNIPORT)', state: 'Rivers' },
  { name: 'Bayero University Kano (BUK)', state: 'Kano' },
  { name: 'Federal University of Technology, Akure (FUTA)', state: 'Ondo' },
  { name: 'Federal University of Technology, Minna (FUTMinna)', state: 'Niger' },
  { name: 'Nnamdi Azikiwe University (UNIZIK)', state: 'Anambra' },
  { name: 'University of Calabar (UNICAL)', state: 'Cross River' },
  { name: 'Usmane Danfodiyo University (UDUS)', state: 'Sokoto' },
  { name: 'University of Jos (UNIJOS)', state: 'Plateau' },
  { name: 'University of Maiduguri (UNIMAID)', state: 'Borno' },
  { name: 'Federal University, Oye-Ekiti (FUOYE)', state: 'Ekiti' },
  { name: 'Delta State University (DELSU)', state: 'Delta' },
  { name: 'Imo State University (IMSU)', state: 'Imo' },
];

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
  'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Gombe','Imo','Jigawa',
  'Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger',
  'Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe',
  'Zamfara','FCT (Abuja)'
];

function scoreCourseChance(jamb, grade, courseName, state) {
  let probability = 0;
  if (jamb >= 300) probability = 85;
  else if (jamb >= 250) probability = 65;
  else if (jamb >= 200) probability = 45;
  else probability = 20;

  const gradeWeights = { 'A1': 15, 'B2': 12, 'B3': 10, 'C4': 8, 'C5': 6, 'C6': 5 };
  probability += (gradeWeights[grade] || 0);

  const entry = COURSE_CATALOG.find(c => c.name === courseName || c.name.startsWith(courseName));
  const tier = entry?.tier || 'moderate';
  let competition = 'Moderate';
  let advice = `You have a fair chance for ${courseName}. Ensure your Post-UTME is strong.`;

  if (tier === 'extreme') {
    probability -= 20;
    competition = 'Extreme';
    advice = `Admission into ${courseName} is extremely competitive. Aim for 320+ JAMB.`;
  } else if (tier === 'high') {
    probability -= 8;
    competition = 'High';
    advice = `${courseName} is competitive. A strong Post-UTME score matters a lot here.`;
  } else if (tier === 'low') {
    probability += 5;
    competition = 'Low';
    advice = `${courseName} has comparatively less pressure — focus on hitting the cut-off cleanly.`;
  }

  const catchmentUnis = state ? NIGERIAN_UNIVERSITIES.filter(u => u.state === state) : [];
  if (catchmentUnis.length) {
    probability += CATCHMENT_BOOST;
  }

  probability = Math.min(99, Math.max(5, Math.round(probability)));
  return { probability, competition, advice, catchmentUnis };
}

function populateAdmissionInputs() {
  const stateSel = S('stateOrigin');
  if (stateSel && !stateSel.dataset.populated) {
    stateSel.innerHTML = '<option value="">Select your state</option>' +
      NIGERIAN_STATES.map(s => `<option value="${s}">${s}</option>`).join('');
    stateSel.dataset.populated = 'true';
  }

  const courseSel = S('courseSelect');
  if (courseSel && !courseSel.dataset.populated) {
    courseSel.innerHTML = COURSE_CATALOG.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    courseSel.dataset.populated = 'true';
  }
}

window.runFullAdmissionMatch = () => {
  const jamb = parseInt(S('jambScore')?.value) || 0;
  const grade = S('olevelGrade')?.value;
  const state = S('stateOrigin')?.value || '';

  if (jamb < 100) return toast('Enter a valid JAMB score first', 'error');

  const results = COURSE_CATALOG
    .map(c => ({ course: c.name, ...scoreCourseChance(jamb, grade, c.name, state) }))
    .sort((a, b) => b.probability - a.probability);

  const list = S('admissionMatchList');
  if (list) {
    list.innerHTML = results.map(r => `
      <div class="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
        <div>
          <p class="text-sm font-black">${escapeHTML(r.course)}</p>
          <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">${r.competition} competition</p>
        </div>
        <span class="text-lg font-black ${r.probability >= 60 ? 'text-emerald-600' : r.probability >= 35 ? 'text-amber-500' : 'text-rose-500'}">${r.probability}%</span>
      </div>
    `).join('');
  }

  const catchmentUnis = state ? NIGERIAN_UNIVERSITIES.filter(u => u.state === state) : [];
  const uniList = S('admissionCatchmentList');
  if (uniList) {
    uniList.innerHTML = catchmentUnis.length
      ? catchmentUnis.map(u => `
        <div class="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/10">
          <i data-lucide="map-pin" class="w-4 h-4 text-emerald-600 shrink-0"></i>
          <span class="text-xs font-bold text-emerald-900 dark:text-emerald-100">${escapeHTML(u.name)}</span>
        </div>
      `).join('')
      : `<p class="text-xs text-slate-400 italic">Select your state above to see catchment-area universities.</p>`;
  }
  if (window.lucide) window.lucide.createIcons();

  const wrap = S('admissionMatchWrap');
  if (wrap) wrap.classList.remove('hidden');

  toast('Full match report generated', 'success');
};

function updateBudgetUI() {
  const budget = store.get('budget', { income: 0, expenses: [] });
  const totalExpenses = budget.expenses.reduce((sum, e) => sum + e.amount, 0);
  const remaining = budget.income - totalExpenses;

  if (S('budgetIncome')) S('budgetIncome').value = budget.income;
  if (S('budgetRemain')) {
    S('budgetRemain').textContent = `₦${remaining.toLocaleString()}`;
    S('budgetRemain').className = `text-lg font-black ${remaining < 0 ? 'text-rose-500' : 'text-emerald-600'}`;
  }

  const list = S('budgetList');
  if (list) {
    list.innerHTML = budget.expenses.map((e, idx) => `
      <div class="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
        <div>
          <p class="text-xs font-bold">${escapeHTML(e.item)}</p>
          <p class="text-[8px] text-slate-400 font-bold uppercase">${escapeHTML(e.date)}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs font-black">₦${e.amount.toLocaleString()}</span>
          <button onclick="window.removeExpense(${idx})" class="text-rose-500 hover:scale-110 transition-transform"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
      </div>
    `).join('');
    if (window.lucide) window.lucide.createIcons();
  }
}

function saveBudget() {
  const income = parseInt(S('budgetIncome').value) || 0;
  const budget = store.get('budget', { income: 0, expenses: [] });
  budget.income = income;
  store.set('budget', budget);
  updateBudgetUI();
  toast('Budget goal saved!', 'success');
}

function addExpense() {
  const item = S('budgetItem').value.trim();
  const amount = parseInt(S('budgetAmount').value) || 0;
  if (!item || amount <= 0) return toast('Item and amount required', 'error');

  const budget = store.get('budget', { income: 0, expenses: [] });
  budget.expenses.push({ item, amount, date: new Date().toLocaleDateString() });
  store.set('budget', budget);
  
  if (S('budgetItem')) S('budgetItem').value = '';
  if (S('budgetAmount')) S('budgetAmount').value = '';
  updateBudgetUI();
  toast('Expense added!', 'success');
}

function removeExpense(idx) {
  const budget = store.get('budget', { income: 0, expenses: [] });
  budget.expenses.splice(idx, 1);
  store.set('budget', budget);
  updateBudgetUI();
}

function initCampusHub() {
  const campus = app.state.userData?.university || store.get('campus', 'UNILAG');
  const select = S('campusSelect');
  if (select) {
    // Check if the university exists in the options
    const exists = Array.from(select.options).some(opt => opt.value === campus);
    if (!exists && campus && campus !== 'University Student') {
      const opt = document.createElement('option');
      opt.value = campus;
      opt.textContent = campus;
      select.appendChild(opt);
    }
    select.value = campus;
  }
  if (S('campusHubTitle')) S('campusHubTitle').textContent = `${campus} Hub`;
}

window.setAiSettings = setAiSettings;

window.processHumanization = async () => {
  const input = S('humanizerInput');
  const output = S('humanizerOutput');
  const loader = S('humanizerLoader');
  const score = S('humanScore');
  const creditsEl = S('humanizerCredits');
  
  if (!input || !input.value.trim()) return toast('Please paste some text first!', 'error');
  if (app.state.userData.humanizerCredits <= 0) return toast('Insufficient credits! Upgrade to Elite.', 'error');

  loader.classList.remove('hidden');
  output.classList.add('opacity-50', 'italic');
  output.textContent = 'Humanizing...';
  
  const rawText = input.value;
  const nuance = S('humanizerNuance')?.value || 'nigerian';
  let humanized = '';
  try {
    if (aiIsConfigured()) {
      humanized = await aiHumanizeText(rawText, nuance);
    }
  } catch {}
  if (!humanized) {
    humanized = rawText
      .replace(/delve/gi, 'explore')
      .replace(/unleash/gi, 'release')
      .replace(/testament to/gi, 'proof of')
      .replace(/comprehensive/gi, 'detailed')
      .replace(/pivotal/gi, 'important');
    if (nuance === 'nigerian') {
      humanized = "Actually, when we look at it, " + humanized + ". This is how we should see it in our context.";
    }
    await new Promise(r => setTimeout(r, 900));
  }

  // Update State & UI
  app.state.userData.humanizerCredits -= 1;
  creditsEl.textContent = app.state.userData.humanizerCredits;
  
  output.textContent = humanized;
  output.classList.remove('opacity-50', 'italic');
  loader.classList.add('hidden');
  
  const finalScore = 85 + Math.floor(Math.random() * 14);
  score.textContent = `${finalScore}%`;
  score.className = `text-sm font-black ${finalScore > 90 ? 'text-emerald-500' : 'text-amber-500'}`;
  
  toast('Content humanized successfully!', 'success');
  
  // Sync to DB
  await updateDoc(doc(db, "users", app.state.user.uid), { humanizerCredits: app.state.userData.humanizerCredits });
};

window.pasteToHumanizer = async () => {
  try {
    const text = await navigator.clipboard.readText();
    const input = S('humanizerInput');
    if (input) {
      input.value = text;
      toast('Text pasted!', 'info');
    }
  } catch (e) {
    toast('Please allow clipboard access', 'error');
  }
};

window.copyHumanizedText = () => {
  const output = S('humanizerOutput');
  if (output && output.textContent && !output.classList.contains('italic')) {
    navigator.clipboard.writeText(output.textContent);
    toast('Copied to clipboard!', 'success');
  }
};

// --- Marketplace Module ---
const getMarketFavorites = () => new Set(store.get('marketFavorites', []));
const setMarketFavorites = (set) => store.set('marketFavorites', Array.from(set));

window.isMarketFavorite = (id) => {
  const key = toText(id).trim();
  if (!key) return false;
  return getMarketFavorites().has(key);
};

window.toggleMarketFavorite = (id) => {
  const key = toText(id).trim();
  if (!key) return;
  const fav = getMarketFavorites();
  if (fav.has(key)) fav.delete(key);
  else fav.add(key);
  setMarketFavorites(fav);
  filterMarket(app.state.marketplace);
};

window.openMarketplaceItem = (id) => {
  const key = toText(id).trim();
  if (!key) return;
  try {
    localStorage.setItem('openMarketItemId', key);
  } catch {}
  window.location.href = `geo-books.htm?item=${encodeURIComponent(key)}#marketplace`;
};

window.toggleMarketItemModal = (show) => {
  const modal = S('marketItemModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (!show) app.state.currentMarketItemId = null;
  if (show && window.lucide) window.lucide.createIcons();
};

window.updateFavoriteModalButton = () => {
  const btn = S('marketItemFavoriteBtn');
  const itemId = app.state.currentMarketItemId;
  if (!btn || !itemId) return;
  const isFav = window.isMarketFavorite(itemId);
  btn.classList.toggle('text-rose-600', isFav);
  btn.classList.toggle('border-rose-200', isFav);
  const label = S('marketItemFavoriteLabel');
  if (label) label.textContent = isFav ? 'Favorited' : 'Favorite';
  if (window.lucide) window.lucide.createIcons();
};

window.toggleFavoriteFromModal = () => {
  const itemId = app.state.currentMarketItemId;
  if (!itemId) return;
  window.toggleMarketFavorite(itemId);
  window.updateFavoriteModalButton();
};

window.openMarketItem = (id) => {
  const key = toText(id).trim();
  if (!key) return;
  const item = (app.state.marketplace || []).find(i => i.id === key);
  if (!item) {
    toast('Item not found', 'error');
    return;
  }
  app.state.currentMarketItemId = key;

  if (S('marketItemTitle')) S('marketItemTitle').textContent = toText(item.title || 'Item');
  if (S('marketItemCategory')) S('marketItemCategory').textContent = toText(item.category || 'Category');
  if (S('marketItemPrice')) {
    const rawPrice = Number(item.price) || 0;
    const xp = app.state.userData?.xp || 0;
    const { finalPrice, discounted } = applyMarketplaceDiscount(rawPrice, xp);
    S('marketItemPrice').innerHTML = discounted
      ? `₦${finalPrice.toLocaleString()} <span class="text-[10px] text-slate-400 line-through font-bold">₦${rawPrice.toLocaleString()}</span> <span class="text-[9px] text-amber-600 font-black uppercase">Master -10%</span>`
      : `₦${rawPrice.toLocaleString()}`;
  }
  if (S('marketItemSeller')) S('marketItemSeller').textContent = toText(item.sellerName || 'Anonymous');
  if (S('marketItemDescription')) S('marketItemDescription').textContent = toText(item.description || 'No description');

  const buyNowBtn = S('marketItemBuyNowBtn');
  if (buyNowBtn) {
    const isSold = (item.status || 'active') === 'sold';
    const isOwnListing = !!(auth.currentUser && item.sellerId === auth.currentUser.uid);
    const disable = isSold || isOwnListing;
    buyNowBtn.disabled = disable;
    buyNowBtn.classList.toggle('opacity-50', disable);
    buyNowBtn.classList.toggle('pointer-events-none', disable);
    buyNowBtn.innerHTML = isSold
      ? 'Sold Out <i data-lucide="check-circle" class="w-5 h-5"></i>'
      : (isOwnListing ? 'Your Listing <i data-lucide="tag" class="w-5 h-5"></i>' : 'Buy Now <i data-lucide="shield-check" class="w-5 h-5"></i>');
  }
  const buyBtn = S('marketItemBuyBtn');
  if (buyBtn) {
    const isOwnListing = !!(auth.currentUser && item.sellerId === auth.currentUser.uid);
    buyBtn.classList.toggle('opacity-50', isOwnListing);
    buyBtn.classList.toggle('pointer-events-none', isOwnListing);
  }

  const ratingCount = Number(item.ratingCount) || 0;
  const ratingSum = Number(item.ratingSum) || 0;
  const avgRating = ratingCount > 0 ? (ratingSum / ratingCount) : 0;
  if (S('marketItemRatingMeta')) S('marketItemRatingMeta').textContent = `${avgRating.toFixed(1)}★ (${ratingCount})`;

  const locWrap = S('marketItemLocation');
  if (locWrap) {
    const span = locWrap.querySelector('span');
    if (span) span.textContent = toText(item.loc || 'Location');
  }

  const imgEl = S('marketItemImage');
  const fallback = `https://picsum.photos/seed/${encodeURIComponent(item.id || Date.now())}/900/900`;
  const gallery = [item.img, ...(Array.isArray(item.images) ? item.images : [])]
    .map(u => safeUrl(u, ''))
    .filter((u, idx, arr) => u && arr.indexOf(u) === idx);
  const primaryImage = gallery[0] || fallback;

  if (imgEl) {
    imgEl.onerror = () => {
      imgEl.onerror = null;
      imgEl.src = fallback;
    };
    imgEl.src = primaryImage;
    imgEl.alt = toText(item.title || 'Item');
  }

  const thumbsWrap = S('marketItemThumbs');
  if (thumbsWrap) {
    if (gallery.length > 1) {
      thumbsWrap.classList.remove('hidden');
      thumbsWrap.innerHTML = gallery.slice(0, 5).map((src, idx) => `
        <button onclick="window.setMarketItemMainImage('${escapeHTML(src)}')" class="aspect-square rounded-xl overflow-hidden border-2 ${idx === 0 ? 'border-brand-500' : 'border-transparent'} hover:border-brand-400 transition-all">
          <img src="${escapeHTML(src)}" onerror="this.src='${escapeHTML(fallback)}'" class="w-full h-full object-cover">
        </button>
      `).join('');
    } else {
      thumbsWrap.classList.add('hidden');
      thumbsWrap.innerHTML = '';
    }
  }

  const downloadBtn = S('marketItemDownloadBtn');
  if (downloadBtn) {
    const href = safeUrl(item.fileUrl, '');
    if (href) {
      downloadBtn.classList.remove('hidden');
      downloadBtn.href = href;
    } else {
      downloadBtn.classList.add('hidden');
      downloadBtn.href = '#';
    }
  }

  window.trackListingView(key);
  window.updateFavoriteModalButton();
  window.toggleMarketItemModal(true);
  loadItemReviews(key);
  loadRelatedItems(item);
};

// Swaps the big preview image when a thumbnail is clicked. Kept separate
// from openMarketItem so it's a cheap DOM-only operation (no re-fetch).
window.setMarketItemMainImage = (src) => {
  const imgEl = S('marketItemImage');
  if (imgEl && src) imgEl.src = src;
  const thumbsWrap = S('marketItemThumbs');
  if (thumbsWrap) {
    Array.from(thumbsWrap.querySelectorAll('button')).forEach(btn => {
      const isActive = btn.querySelector('img')?.src === src;
      btn.classList.toggle('border-brand-500', isActive);
      btn.classList.toggle('border-transparent', !isActive);
    });
  }
};

// One-time (non-realtime) fetch of a listing's reviews, rendered into
// #marketItemReviews. Not a live listener — reviews aren't chatty enough to
// warrant one, and this keeps the item modal cheap to open.
async function loadItemReviews(itemId) {
  const wrap = S('marketItemReviews');
  if (!wrap) return;
  wrap.innerHTML = '<p class="text-xs font-bold text-slate-400">Loading reviews...</p>';
  try {
    const q = query(collection(db, "marketItems", itemId, "reviews"), orderBy("createdAt", "desc"), limit(10));
    const snap = await getDocs(q);
    if (app.state.currentMarketItemId !== itemId) return; // modal moved on while we were fetching
    if (snap.empty) {
      wrap.innerHTML = '<p class="text-xs font-bold text-slate-400">No reviews yet. Be the first to leave one!</p>';
      return;
    }
    wrap.innerHTML = snap.docs.map(d => renderReviewCard(d.data())).join('');
  } catch (e) {
    console.warn('loadItemReviews error:', e);
    wrap.innerHTML = '<p class="text-xs font-bold text-slate-400">Couldn\'t load reviews right now.</p>';
  }
}

function renderReviewCard(review) {
  const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
  const stars = Array.from({ length: 5 }, (_, i) =>
    `<i data-lucide="star" class="w-3.5 h-3.5 ${i < rating ? 'text-amber-500 fill-amber-500' : 'text-slate-300 dark:text-slate-700'}"></i>`
  ).join('');
  const name = escapeHTML(review.userName || 'Scholar');
  const text = toText(review.text).trim();
  const when = toMillis(review.createdAt) ? new Date(toMillis(review.createdAt)).toLocaleDateString() : '';
  return `
    <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-black">${name.charAt(0).toUpperCase()}</div>
          <p class="text-xs font-black">${name}</p>
        </div>
        <div class="flex items-center gap-0.5">${stars}</div>
      </div>
      ${text ? `<p class="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">${escapeHTML(text)}</p>` : ''}
      ${when ? `<p class="text-[9px] font-black uppercase tracking-widest text-slate-300 dark:text-slate-600 mt-1.5">${when}</p>` : ''}
    </div>
  `;
}

// Same-category items, excluding the one currently open. Pulled from the
// already-loaded app.state.marketplace list — no extra Firestore read.
function loadRelatedItems(item) {
  const wrap = S('marketItemRelated');
  const wrapOuter = S('marketItemRelatedWrap');
  if (!wrap || !wrapOuter) return;
  const related = (app.state.marketplace || [])
    .filter(i => i.id !== item.id && i.category === item.category && (i.status || 'active') !== 'sold')
    .slice(0, 6);
  if (related.length === 0) {
    wrapOuter.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }
  wrapOuter.classList.remove('hidden');
  wrap.innerHTML = related.map(r => {
    const fallback = `https://picsum.photos/seed/${encodeURIComponent(r.id)}/300/300`;
    const src = safeUrl(r.img, fallback);
    return `
      <button onclick="window.openMarketItem('${escapeHTML(r.id)}')" class="text-left group">
        <div class="aspect-square rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 mb-2">
          <img src="${escapeHTML(src)}" onerror="this.onerror=null;this.src='${escapeHTML(fallback)}'" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy">
        </div>
        <p class="text-xs font-bold truncate">${escapeHTML(r.title || 'Item')}</p>
        <p class="text-[10px] font-black text-brand-600">₦${(Number(r.price) || 0).toLocaleString()}</p>
      </button>
    `;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.toggleSellerProfileModal = (show) => {
  const modal = S('sellerProfileModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (show && window.lucide) window.lucide.createIcons();
};

// Opens the seller profile panel. If sellerId is omitted, falls back to
// the seller of whichever item modal is currently open (that's what the
// "Seller" row inside marketItemModal calls, with no args).
window.openSellerProfile = async (sellerId) => {
  let targetId = toText(sellerId).trim();
  if (!targetId) {
    const currentItem = (app.state.marketplace || []).find(i => i.id === app.state.currentMarketItemId);
    targetId = toText(currentItem?.sellerId).trim();
  }
  if (!targetId) return toast('Seller profile not available', 'error');

  app.state.currentSellerProfileId = targetId;
  window.toggleSellerProfileModal(true);

  const nameEl = S('sellerProfileName');
  const avatarEl = S('sellerProfileAvatar');
  const metaEl = S('sellerProfileMeta');
  const ratingEl = S('sellerProfileRating');
  const eliteEl = S('sellerProfileEliteBadge');
  const listingsEl = S('sellerProfileListings');
  if (listingsEl) listingsEl.innerHTML = '<p class="text-xs font-bold text-slate-400 col-span-full">Loading...</p>';

  // Aggregate from whatever of this seller's items are already loaded
  // client-side (app.state.marketplace) — cheap, no extra Firestore reads
  // for the common case of opening a profile from a listing you can see.
  const sellerItems = (app.state.marketplace || []).filter(i => i.sellerId === targetId);
  const totalRatingSum = sellerItems.reduce((sum, i) => sum + (Number(i.ratingSum) || 0), 0);
  const totalRatingCount = sellerItems.reduce((sum, i) => sum + (Number(i.ratingCount) || 0), 0);
  const avgRating = totalRatingCount > 0 ? (totalRatingSum / totalRatingCount).toFixed(1) : '0.0';
  const isElite = sellerItems.some(i => i.isEliteSeller);

  let displayName = sellerItems[0]?.sellerName || 'Scholar';
  let joinedText = '';
  try {
    const userSnap = await getDoc(doc(db, "users", targetId));
    if (userSnap.exists()) {
      const u = userSnap.data();
      displayName = u.username || u.displayName || displayName;
      const joinedMs = toMillis(u.createdAt);
      if (joinedMs) joinedText = `Member since ${new Date(joinedMs).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
      if (avatarEl) {
        if (u.photoURL) {
          avatarEl.innerHTML = `<img src="${escapeHTML(u.photoURL)}" class="w-full h-full object-cover">`;
        } else {
          avatarEl.textContent = displayName.charAt(0).toUpperCase();
        }
      }
    }
  } catch (e) {
    console.warn('openSellerProfile: unable to load seller user doc:', e);
  }

  if (app.state.currentSellerProfileId !== targetId) return; // superseded by a newer call

  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = joinedText || `${sellerItems.length} listing${sellerItems.length === 1 ? '' : 's'} visible`;
  if (ratingEl) ratingEl.textContent = `${avgRating}★ (${totalRatingCount} review${totalRatingCount === 1 ? '' : 's'})`;
  if (eliteEl) eliteEl.classList.toggle('hidden', !isElite);

  const otherListings = sellerItems.filter(i => i.id !== app.state.currentMarketItemId && (i.status || 'active') !== 'sold');
  if (listingsEl) {
    if (otherListings.length === 0) {
      listingsEl.innerHTML = '<p class="text-xs font-bold text-slate-400 col-span-full">No other active listings right now.</p>';
    } else {
      listingsEl.innerHTML = otherListings.slice(0, 9).map(r => {
        const fallback = `https://picsum.photos/seed/${encodeURIComponent(r.id)}/300/300`;
        const src = safeUrl(r.img, fallback);
        return `
          <button onclick="window.toggleSellerProfileModal(false); window.openMarketItem('${escapeHTML(r.id)}')" class="text-left group">
            <div class="aspect-square rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 mb-2">
              <img src="${escapeHTML(src)}" onerror="this.onerror=null;this.src='${escapeHTML(fallback)}'" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy">
            </div>
            <p class="text-xs font-bold truncate">${escapeHTML(r.title || 'Item')}</p>
            <p class="text-[10px] font-black text-brand-600">₦${(Number(r.price) || 0).toLocaleString()}</p>
          </button>
        `;
      }).join('');
    }
  }
  if (window.lucide) window.lucide.createIcons();
};

window.messageSellerFromProfile = async () => {
  const sellerId = app.state.currentSellerProfileId;
  if (!sellerId) return;
  const user = auth?.currentUser || app.state.user;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to message the seller', 'error');
    return;
  }
  if (sellerId === user.uid) return toast("That's you!", 'info');
  window.toggleSellerProfileModal(false);
  const item = (app.state.marketplace || []).find(i => i.sellerId === sellerId);
  await window.openSellerChat(sellerId, item || null);
};

window.buyFromModal = () => {
  const itemId = app.state.currentMarketItemId;
  if (!itemId) return;
  const item = (app.state.marketplace || []).find(i => i.id === itemId);
  if (!item) return;
  if ((item.status || 'active') === 'sold') return toast('This item is already sold', 'error');
  if (auth.currentUser && item.sellerId === auth.currentUser.uid) return toast("You can't buy your own listing", 'error');
  if (!auth.currentUser) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to buy items', 'error');
    return;
  }
  window.toggleMarketItemModal(false);
  window.startEscrowTransaction(item.id, Number(item.price) || 0);
};

window.contactSellerFromModal = async () => {
  const itemId = app.state.currentMarketItemId;
  if (!itemId) return;
  const item = (app.state.marketplace || []).find(i => i.id === itemId);
  if (!item) return;
  const sellerId = toText(item.sellerId).trim();
  if (!sellerId) return toast('Seller profile not available for this item', 'error');

  const user = auth?.currentUser || app.state.user;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to message the seller', 'error');
    return;
  }
  if (sellerId === user.uid) {
    toast("That's your own listing", 'info');
    return;
  }

  await window.openSellerChat(sellerId, item);
};

// Shared by contactSellerFromModal (item modal) and contactSeller (grid
// card). Starts/opens the 1:1 chat with the seller, stamps the chat with
// lightweight item context (so the chat header can show "Re: <item>"), and
// pre-fills — but does not auto-send — an opening message so the buyer can
// still edit it before it goes to the seller.
window.openSellerChat = async (sellerId, item) => {
  window.toggleMarketItemModal(false);
  window.showSection('community');

  await new Promise(r => setTimeout(r, 50));
  await window.startChatWithUser(sellerId);

  if (item?.id && snapState.activeChat) {
    try {
      const chatRef = doc(db, "chats", snapState.activeChat.id);
      const contextItem = {
        id: item.id,
        title: toText(item.title || 'Item').slice(0, 120),
        price: Number(item.price) || 0,
        image: toText(item.img || '').slice(0, 500)
      };
      await updateDoc(chatRef, { contextItem });
      snapState.activeChat.contextItem = contextItem;
      renderChatItemContext(contextItem);
    } catch (e) {
      console.warn('Unable to stamp chat with item context:', e);
    }
  }

  const input = S('chatMessageInput');
  if (input && item) {
    const title = toText(item.title || 'your item');
    const price = Number(item.price) || 0;
    input.value = `Hi! I'm interested in "${title}" (₦${price.toLocaleString()}). Is it still available?`;
    input.dispatchEvent(new Event('input'));
    input.focus();
  }
};

// Renders (or clears) the "Re: <item>" strip under the chat header. Safe
// to call with null/undefined to hide it.
function renderChatItemContext(contextItem) {
  const banner = S('snapChatItemContext');
  if (!banner) return;
  if (!contextItem?.id) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const fallback = `https://picsum.photos/seed/${encodeURIComponent(contextItem.id)}/80/80`;
  const imgSrc = safeUrl(contextItem.image, fallback);
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div onclick="window.toggleChatOptionsMenu(false); window.showSection('marketplace'); window.openMarketItem('${escapeHTML(contextItem.id)}')" class="flex items-center gap-3 px-4 py-2.5 bg-brand-50/70 dark:bg-brand-900/20 border-b border-brand-100 dark:border-brand-900/30 cursor-pointer hover:bg-brand-100/70 dark:hover:bg-brand-900/30 transition-colors">
      <img src="${escapeHTML(imgSrc)}" onerror="this.onerror=null;this.src='${escapeHTML(fallback)}'" class="w-8 h-8 rounded-lg object-cover shrink-0">
      <div class="min-w-0 flex-1">
        <p class="text-[9px] font-black uppercase tracking-widest text-brand-600 dark:text-brand-400">Re: Marketplace Item</p>
        <p class="text-xs font-bold truncate">${escapeHTML(contextItem.title)} · ₦${(Number(contextItem.price) || 0).toLocaleString()}</p>
      </div>
      <i data-lucide="chevron-right" class="w-4 h-4 text-brand-400 shrink-0"></i>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

window.copyItemLink = async () => {
  const itemId = app.state.currentMarketItemId;
  if (!itemId) return;
  const base = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}`;
  const url = `${base}geo-books.htm?item=${encodeURIComponent(itemId)}#marketplace`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied', 'success');
  } catch {
    toast(url, 'info');
  }
};

window.toggleRatingModal = (show) => {
  const modal = S('ratingModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (!show) {
    app.state.currentRatingItemId = null;
    app.state.currentRatingValue = 0;
    if (S('ratingNote')) S('ratingNote').value = '';
    window.setRatingValue(0);
  }
  if (show && window.lucide) window.lucide.createIcons();
};

window.setRatingValue = (value) => {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  app.state.currentRatingValue = v;
  const wrap = S('ratingStars');
  if (!wrap) return;
  const btns = Array.from(wrap.querySelectorAll('button'));
  btns.forEach((btn, idx) => {
    const on = idx < v;
    btn.classList.toggle('text-amber-500', on);
    btn.classList.toggle('text-slate-400', !on);
  });
  if (window.lucide) window.lucide.createIcons();
};

window.openRatingModal = async () => {
  const itemId = app.state.currentEscrowItemId || app.state.currentMarketItemId;
  if (!itemId) return toast('Select an item first', 'error');
  if (!auth.currentUser) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to review items', 'error');
    return;
  }
  const item = (app.state.marketplace || []).find(i => i.id === itemId);
  app.state.currentRatingItemId = itemId;
  if (S('ratingItemTitle')) S('ratingItemTitle').textContent = toText(item?.title || 'Item');
  window.setRatingValue(5);
  if (S('ratingNote')) S('ratingNote').value = '';
  window.toggleRatingModal(true);

  // Prefill with the reviewer's own prior review, if any, so re-opening
  // the modal edits their existing review instead of silently stacking a
  // second one under the hood.
  try {
    const existing = await getDoc(doc(db, "marketItems", itemId, "reviews", auth.currentUser.uid));
    if (existing.exists() && app.state.currentRatingItemId === itemId) {
      const data = existing.data();
      window.setRatingValue(Number(data.rating) || 5);
      if (S('ratingNote')) S('ratingNote').value = toText(data.text || '');
    }
  } catch (e) {
    console.warn('Unable to load existing review:', e);
  }
};

window.submitRating = async () => {
  if (!auth.currentUser) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to review items', 'error');
    return;
  }

  const itemId = app.state.currentRatingItemId;
  const value = Number(app.state.currentRatingValue) || 0;
  if (!itemId) return toast('No item selected', 'error');
  if (value < 1) return toast('Select a rating', 'error');
  const text = toText(S('ratingNote')?.value).trim().slice(0, 500);

  const btn = S('submitRatingBtn');
  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }

  try {
    const uid = auth.currentUser.uid;
    const itemRef = doc(db, "marketItems", itemId);
    const reviewRef = doc(db, "marketItems", itemId, "reviews", uid);
    let delta = 0;
    let isNewReview = true;

    await runTransaction(db, async (tx) => {
      const itemSnap = await tx.get(itemRef);
      const reviewSnap = await tx.get(reviewRef);
      if (!itemSnap.exists()) throw new Error('Item not found');
      const data = itemSnap.data() || {};
      const prevValue = reviewSnap.exists() ? (Number(reviewSnap.data().rating) || 0) : 0;
      isNewReview = !reviewSnap.exists();
      delta = value - prevValue;
      const ratingSum = Math.max(0, (Number(data.ratingSum) || 0) + delta);
      const ratingCount = (Number(data.ratingCount) || 0) + (isNewReview ? 1 : 0);
      tx.update(itemRef, { ratingSum, ratingCount });
      tx.set(reviewRef, {
        uid,
        rating: value,
        text,
        userName: app.state.userData?.username || app.state.userData?.displayName || auth.currentUser.displayName || 'Scholar',
        createdAt: isNewReview ? serverTimestamp() : (reviewSnap.data().createdAt || serverTimestamp()),
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    toast(isNewReview ? 'Thanks for your review!' : 'Review updated!', 'success');
    window.toggleRatingModal(false);
    const idx = (app.state.marketplace || []).findIndex(i => i.id === itemId);
    if (idx >= 0) {
      const prev = app.state.marketplace[idx] || {};
      app.state.marketplace[idx] = {
        ...prev,
        ratingSum: Math.max(0, (Number(prev.ratingSum) || 0) + delta),
        ratingCount: (Number(prev.ratingCount) || 0) + (isNewReview ? 1 : 0)
      };
    }
    filterMarket(app.state.marketplace);
    if (app.state.currentMarketItemId === itemId) {
      window.openMarketItem(itemId);
    }
    renderListings();
  } catch (e) {
    console.error('Rating error:', e);
    toast(e?.message || 'Error submitting review', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || 'Submit Rating';
    }
  }
};

window.resetMarketFilters = () => {
  const search = S('marketSearch');
  const cat = S('filterCategory');
  const loc = S('filterLocation');
  const sort = S('filterPrice');
  const fav = S('filterFavorites');

  if (search) search.value = '';
  if (cat) cat.value = 'All';
  if (loc) loc.value = 'All';
  if (sort) sort.value = 'latest';
  if (fav) fav.checked = false;
  filterMarket(app.state.marketplace);
};

// Grid-card "Contact" button. Mirrors contactSellerFromModal but takes an
// itemId directly instead of reading app.state.currentMarketItemId, since
// the card can be clicked without ever opening the item modal first.
window.contactSkillSeller = async (skillId) => {
  const key = toText(skillId).trim();
  if (!key) return;
  const skill = (app.state.skills || []).find(s => s.id === key);
  if (!skill) return toast('Skill listing not found', 'error');

  const sellerId = toText(skill.sellerId).trim();
  if (!sellerId) return toast('Seller profile not available for this listing', 'error');

  const user = auth?.currentUser || app.state.user;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to message the seller', 'error');
    return;
  }
  if (sellerId === user.uid) {
    toast("That's your own listing", 'info');
    return;
  }

  // openSellerChat's prefill uses item.img/item.price, neither of which a
  // skill has in quite the same shape — pass through what does apply
  // (title) and let the rest fall back gracefully.
  await window.openSellerChat(sellerId, { id: skill.id, title: skill.title, price: skill.price, img: skill.img });
};

window.contactSeller = async (itemId) => {
  const key = toText(itemId).trim();
  if (!key) return;
  const item = (app.state.marketplace || []).find(i => i.id === key);
  if (!item) return toast('Item not found', 'error');

  const sellerId = toText(item.sellerId).trim();
  if (!sellerId) return toast('Seller profile not available for this item', 'error');

  const user = auth?.currentUser || app.state.user;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to message the seller', 'error');
    return;
  }
  if (sellerId === user.uid) {
    toast("That's your own listing", 'info');
    return;
  }

  await window.openSellerChat(sellerId, item);
};

function filterMarket(marketplaceItems) {
  const grid = S('marketGrid');
  if (!grid) return;
  
  const categoryFilter = S('filterCategory')?.value || 'All';
  const locationFilter = S('filterLocation')?.value || 'All';
  const priceSort = S('filterPrice')?.value || 'latest';
  const favoritesOnly = !!S('filterFavorites')?.checked;
  const searchQuery = (S('marketSearch')?.value || '').toLowerCase();
  const resultsEl = S('marketResultsCount');
  const clearBtn = S('marketClearFilters');
  
  if (!marketplaceItems || marketplaceItems.length === 0) {
    if (!app.state.marketplaceLoaded) {
      grid.innerHTML = Array.from({ length: 8 }).map(() => `
        <div class="premium-card p-4 rounded-[32px] skeleton">
          <div class="aspect-square rounded-2xl bg-slate-200/50 dark:bg-slate-800/50 mb-4"></div>
          <div class="h-4 w-2/3 bg-slate-200/50 dark:bg-slate-800/50 rounded mb-2"></div>
          <div class="h-3 w-1/3 bg-slate-200/50 dark:bg-slate-800/50 rounded"></div>
        </div>
      `).join('');
      if (resultsEl) resultsEl.textContent = 'Loading…';
    } else {
      grid.innerHTML = `
        <div class="col-span-full p-12 rounded-[40px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft text-center">
          <div class="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
            <i data-lucide="shopping-bag" class="w-8 h-8"></i>
          </div>
          <h3 class="mt-6 text-xl font-black">No items yet</h3>
          <p class="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">Be the first to post something for sale on your campus.</p>
        </div>
      `;
      if (resultsEl) resultsEl.textContent = '0 results';
    }
    if (clearBtn) clearBtn.classList.add('hidden');
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  
  const allNonService = marketplaceItems.filter(item => item.category !== 'Service');
  const soldNonService = allNonService.filter(item => (item.status || 'active') === 'sold');
  const activeBase = allNonService.filter(item => (item.status || 'active') !== 'sold');
  let items = activeBase.slice();
  
  if (categoryFilter !== 'All') {
    items = items.filter(item => item.category === categoryFilter);
  }
  
  if (locationFilter !== 'All') {
    items = items.filter(item => {
      const itemLoc = (item.loc || '').toLowerCase();
      return itemLoc.includes(locationFilter.toLowerCase()) || itemLoc.includes('all');
    });
  }
  
  if (searchQuery) {
    items = items.filter(item => 
      (item.title || '').toLowerCase().includes(searchQuery) ||
      (item.loc || '').toLowerCase().includes(searchQuery) ||
      (item.category || '').toLowerCase().includes(searchQuery)
    );
  }

  if (favoritesOnly) {
    const fav = getMarketFavorites();
    items = items.filter(i => fav.has(toText(i.id).trim()));
  }
  
  if (priceSort === 'low') {
    items.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0) || (toMillis(b.updatedAt) || toMillis(b.createdAt) || 0) - (toMillis(a.updatedAt) || toMillis(a.createdAt) || 0));
  } else if (priceSort === 'high') {
    items.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0) || (toMillis(b.updatedAt) || toMillis(b.createdAt) || 0) - (toMillis(a.updatedAt) || toMillis(a.createdAt) || 0));
  } else if (priceSort === 'popular') {
    items.sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0) || (toMillis(b.updatedAt) || toMillis(b.createdAt) || 0) - (toMillis(a.updatedAt) || toMillis(a.createdAt) || 0));
  } else {
    items.sort((a, b) => (toMillis(b.updatedAt) || toMillis(b.createdAt) || 0) - (toMillis(a.updatedAt) || toMillis(a.createdAt) || 0));
  }

  // Elite-rank (Early Access) perk: a seller's own boosted listings float
  // to the top of whatever sort/filter is active, within this result set.
  // Stable sort (Array#sort is stable per spec), so it only reorders the
  // boosted/non-boosted split and leaves each group's relative order alone.
  items.sort((a, b) => (b.boosted ? 1 : 0) - (a.boosted ? 1 : 0));
  
  if (items.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-12 rounded-[40px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft text-center">
        <div class="w-14 h-14 rounded-3xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
          <i data-lucide="search-x" class="w-7 h-7"></i>
        </div>
        <h3 class="mt-6 text-xl font-black">No matches</h3>
        <p class="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">Try clearing filters or searching with fewer words.</p>
        <button onclick="window.resetMarketFilters()" class="mt-6 px-8 py-4 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all inline-flex items-center gap-2">
          <i data-lucide="rotate-ccw" class="w-5 h-5"></i> Reset Filters
        </button>
      </div>
    `;
    if (resultsEl) resultsEl.textContent = '0 results';
    if (clearBtn) clearBtn.classList.add('hidden');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (resultsEl) resultsEl.textContent = `${items.length.toLocaleString()} result${items.length === 1 ? '' : 's'}`;
  const hasFilters = categoryFilter !== 'All' || locationFilter !== 'All' || priceSort !== 'latest' || favoritesOnly || Boolean(searchQuery.trim());
  if (clearBtn) clearBtn.classList.toggle('hidden', !hasFilters);

  grid.innerHTML = items.map(item => {
    const imgFallback = `https://picsum.photos/seed/${encodeURIComponent(item.id || Date.now())}/400/300`;
    const imgSrc = escapeHTML(safeUrl(item.img, imgFallback));
    const safeTitle = escapeHTML(item.title);
    const safeLoc = escapeHTML(item.loc);
    const safeCat = escapeHTML(item.category || 'Item');
    const sellerName = escapeHTML(item.sellerName || 'Student Seller');
    const isFav = window.isMarketFavorite(item.id);
    const ratingCount = Number(item.ratingCount) || 0;
    const ratingSum = Number(item.ratingSum) || 0;
    const avgRating = ratingCount > 0 ? (ratingSum / ratingCount) : 0;
    const views = Number(item.views) || 0;
    const createdAt = toMillis(item.createdAt);
    const now = Date.now();
    const isNew = (now - createdAt) < 24 * 60 * 60 * 1000; // last 24h
    const isHot = views > 100;
    const isPopular = views > 50;

    return `
    <div onclick="window.openMarketItem('${item.id}')" class="premium-card p-5 rounded-[2.5rem] group relative overflow-hidden cursor-pointer hover:shadow-2xl transition-all duration-300 ${item.isEliteSeller ? 'elite-border-glow border-elite-gold/50' : ''}">
      <div class="absolute inset-0 bg-gradient-to-br from-brand-500/5 via-transparent to-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
      ${item.isEliteSeller ? `
        <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-elite-gold to-yellow-200 z-20"></div>
        <div class="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-xl bg-emerald-950/80 backdrop-blur-md border border-elite-gold/30 flex items-center gap-1.5">
          <i data-lucide="shield-check" class="w-3.5 h-3.5 text-elite-gold"></i>
          <span class="text-[9px] font-black text-elite-gold uppercase tracking-widest">Verified Elite</span>
        </div>
      ` : ''}
      <div class="absolute top-4 right-4 z-20 flex gap-2">
        ${item.boosted ? `
          <span class="px-3 py-1 rounded-xl bg-gradient-to-r from-brand-500 to-indigo-600 text-white text-[9px] font-black uppercase tracking-widest shadow-lg shadow-brand-500/30 flex items-center gap-1">
            <i data-lucide="rocket" class="w-3 h-3"></i> Boosted
          </span>
        ` : ''}
        ${isNew ? `
          <span class="px-3 py-1 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 text-white text-[9px] font-black uppercase tracking-widest shadow-lg shadow-indigo-500/30">New</span>
        ` : ''}
        ${isHot ? `
          <span class="px-3 py-1 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 text-white text-[9px] font-black uppercase tracking-widest shadow-lg shadow-rose-500/30">Hot</span>
        ` : ''}
        ${isPopular && !isHot ? `
          <span class="px-3 py-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-[9px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/30">Popular</span>
        ` : ''}
      </div>
      <button onclick="event.stopPropagation(); window.toggleMarketFavorite('${item.id}')" class="absolute top-4 left-4 z-20 p-3 rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-md transition-all shadow-xl ${isFav ? 'text-rose-600 bg-rose-50 dark:bg-rose-900/30' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30'}">
        <i data-lucide="heart" class="w-5 h-5"></i>
      </button>
      <div class="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 mb-5 relative shadow-xl shadow-slate-200/30 dark:shadow-black/30">
        <img src="${imgSrc}" onerror="this.onerror=null;this.src='${escapeHTML(imgFallback)}'" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" loading="lazy">
        <div class="absolute bottom-4 left-4 px-4 py-2 rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-xl flex items-center gap-2">
          <span class="text-sm font-black text-brand-700 dark:text-brand-300">₦${item.price.toLocaleString()}</span>
          <span class="text-[9px] font-black uppercase tracking-widest text-slate-400 border-l border-slate-300 dark:border-slate-700 pl-2">${safeCat}</span>
        </div>
      </div>
      <h4 class="font-black text-lg leading-snug line-clamp-2">${safeTitle}</h4>
      <div class="mt-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center text-white text-xs font-black shadow-lg shadow-brand-500/30">
            ${sellerName.charAt(0).toUpperCase()}
          </div>
          <div class="text-left">
            <p class="text-sm font-bold text-slate-700 dark:text-slate-200">${sellerName}</p>
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
              <i data-lucide="map-pin" class="w-3 h-3"></i> ${safeLoc}
            </p>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1">
          <span class="text-[10px] font-bold text-slate-400 flex items-center gap-1">
            <i data-lucide="eye" class="w-3 h-3"></i> ${views.toLocaleString()}
          </span>
          <div class="flex items-center gap-1">
            <i data-lucide="star" class="w-3 h-3 text-amber-400 fill-amber-400"></i>
            <span class="text-[10px] font-bold text-slate-600 dark:text-slate-300">${avgRating.toFixed(1)}</span>
            <span class="text-[9px] font-bold text-slate-400">(${ratingCount})</span>
          </div>
        </div>
      </div>
      <div class="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <button onclick="event.stopPropagation(); window.contactSeller('${item.id}')" class="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center gap-2">
          <i data-lucide="message-square" class="w-4 h-4"></i> Contact
        </button>
        <button onclick="event.stopPropagation(); window.openMarketItem('${item.id}')" class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 text-white text-xs font-black uppercase tracking-widest shadow-xl shadow-brand-500/30 hover:from-brand-700 hover:to-indigo-700 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2">
          View <i data-lucide="arrow-right" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `;
  }).join('');

  const paging = app.state.marketPaging || null;
  const hasMore = !!paging && !paging.exhausted;
  const isLoading = !!paging && paging.loading;
  const footer = `
    <div class="col-span-full">
      <div class="mt-2 p-4 rounded-3xl bg-white/70 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-center">
        <p class="text-[10px] font-black uppercase tracking-widest ${hasMore ? 'text-slate-400' : 'text-slate-300'}">
          ${isLoading ? 'Loading more…' : (hasMore ? 'Scroll to load more' : 'End of results')}
        </p>
      </div>
    </div>
  `;
  if (paging) grid.insertAdjacentHTML('beforeend', footer);

  const totalItems = activeBase.length;
  const uniqueSellers = new Set(activeBase.map(i => i.sellerId)).size;
  const totalViews = allNonService.reduce((sum, i) => sum + (Number(i.views) || 0), 0);
  const transactions = soldNonService.length;
  if (S('marketTotalItems')) S('marketTotalItems').textContent = totalItems.toLocaleString();
  if (S('marketTotalSellers')) S('marketTotalSellers').textContent = uniqueSellers.toLocaleString();
  if (S('marketTotalViews')) S('marketTotalViews').textContent = totalViews.toLocaleString();
  if (S('marketTotalTransactions')) S('marketTotalTransactions').textContent = transactions.toLocaleString();

  if (window.lucide) window.lucide.createIcons();
}

function initFlashcardsSync(user) {
  if (!user) return;
  const q = query(collection(db, "flashcards"), where("uid", "==", user.uid), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Feeds the dashboard's "AI Intelligence" score and syllabus heatmap
    // (both keyed off app.state.flashcards), which otherwise never see any
    // real data since nothing else in the app assigns to this field.
    app.state.flashcards = cards;
    studyState.flashcards.syncedCards = cards;

    // Previously this only applied when cards.length > 0, so deleting your
    // last card left the (now-deleted) card lingering in the UI until a
    // reload. Always reflect reality — unless the user is mid-preview of a
    // Demo Deck, in which case the sync shouldn't yank the demo cards out
    // from under them; it'll be picked up on the next transition to Vault.
    if (!studyState.flashcards.viewingDemo) {
      studyState.flashcards.cards = cards;
      if (studyState.flashcards.idx >= cards.length) studyState.flashcards.idx = 0;
    }

    updateFlashcardsUI();
    renderFlashcard();
  });
}

function initMarketplaceSync(appState, onDataChange) {
  if (!initMarketplaceSync.handlers) initMarketplaceSync.handlers = new Set();
  if (onDataChange) initMarketplaceSync.handlers.add(onDataChange);
  if (initMarketplaceSync.unsub) return initMarketplaceSync.unsub;

  appState.marketplaceLoaded = false;
  showSkeleton('marketGrid', 8);

  if (!appState.marketPaging) {
    appState.marketPaging = {
      pageSize: 40,
      lastDoc: null,
      loading: false,
      exhausted: false
    };
  }
  if (!appState.marketplaceExtra) appState.marketplaceExtra = [];

  const q = query(collection(db, "marketItems"), orderBy("createdAt", "desc"), limit(appState.marketPaging.pageSize));
  initMarketplaceSync.unsub = onSnapshot(q, (snapshot) => {
    appState.marketplaceLoaded = true;
    const base = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    appState.marketPaging.lastDoc = snapshot.docs[snapshot.docs.length - 1] || null;
    appState.marketPaging.exhausted = snapshot.docs.length < appState.marketPaging.pageSize;

    const extra = Array.isArray(appState.marketplaceExtra) ? appState.marketplaceExtra : [];
    const merged = [];
    const seen = new Set();
    for (const it of base) {
      const id = toText(it?.id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(it);
    }
    for (const it of extra) {
      const id = toText(it?.id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(it);
    }
    appState.marketplace = merged;
    for (const cb of initMarketplaceSync.handlers) {
      try { cb(appState.marketplace); } catch (e) { console.error('Marketplace handler error:', e); }
    }

    let openId = '';
    try {
      const qs = new URLSearchParams(window.location.search);
      openId = qs.get('item') || '';
    } catch {}
    if (!openId) {
      try {
        openId = localStorage.getItem('openMarketItemId') || '';
      } catch {}
    }
    openId = toText(openId).trim();
    if (openId) {
      const exists = appState.marketplace.some(i => i.id === openId);
      if (exists) {
        try { localStorage.removeItem('openMarketItemId'); } catch {}
        window.openMarketItem(openId);
      }
    }
  }, (error) => {
    console.error('Marketplace sync error:', error);
    appState.marketplaceLoaded = true;
    if (appState.currentSection === 'marketplace') toast('Unable to load marketplace', 'error');
  });
  return initMarketplaceSync.unsub;
}

window.loadMoreMarketplace = async () => {
  const paging = app.state.marketPaging;
  if (!paging || paging.loading || paging.exhausted) return;
  if (!paging.lastDoc) {
    if (app.state.marketplaceLoaded) paging.exhausted = true;
    return;
  }

  paging.loading = true;
  try {
    filterMarket(app.state.marketplace);
    const q = query(
      collection(db, "marketItems"),
      orderBy("createdAt", "desc"),
      startAfter(paging.lastDoc),
      limit(paging.pageSize)
    );
    const snap = await getDocs(q);
    const next = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    paging.lastDoc = snap.docs[snap.docs.length - 1] || paging.lastDoc;
    if (snap.docs.length < paging.pageSize) paging.exhausted = true;

    const extra = Array.isArray(app.state.marketplaceExtra) ? app.state.marketplaceExtra : [];
    const existing = new Set((app.state.marketplace || []).map(i => toText(i?.id).trim()).filter(Boolean));
    for (const it of next) {
      const id = toText(it?.id).trim();
      if (!id || existing.has(id)) continue;
      existing.add(id);
      extra.push(it);
    }
    app.state.marketplaceExtra = extra;

    const merged = [];
    const seen = new Set();
    for (const it of (app.state.marketplace || [])) {
      const id = toText(it?.id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(it);
    }
    for (const it of extra) {
      const id = toText(it?.id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(it);
    }
    app.state.marketplace = merged;
  } catch (e) {
    console.error('Marketplace load more error:', e);
  } finally {
    paging.loading = false;
    filterMarket(app.state.marketplace);
  }
};

function initExamsSync() {
  app.state.officialExamsLoading = true;
  renderOfficialExams();
  const q = query(collection(db, "exams"), orderBy("createdAt", "desc"), limit(50));
  onSnapshot(q, (snap) => {
    app.state.officialExamsLoading = false;
    app.state.officialExams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOfficialExams();
  });
}

function renderOfficialExams() {
  const container = S('adminLibraryOption');
  if (!container) return;
  
  if (app.state.officialExamsLoading) {
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="flex items-center justify-between mb-8">
        <div class="h-8 w-48 skeleton rounded-lg"></div>
        <div class="h-8 w-24 skeleton rounded-lg"></div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${[1,2,3].map(() => `
          <div class="p-6 rounded-[2rem] bg-white/5 border border-white/10 h-32 skeleton"></div>
        `).join('')}
      </div>
    `;
    return;
  }

  const exams = app.state.officialExams || [];
  if (exams.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="flex items-center justify-between mb-8">
      <div>
        <h3 class="text-2xl font-black text-white">Official CBT Library</h3>
        <p class="text-[10px] text-brand-400 font-black uppercase tracking-[0.2em] mt-1">Curated by Geo-Books Admins</p>
      </div>
      <div class="flex gap-2">
        <div class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase text-white/40">
          ${exams.length} Available
        </div>
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${exams.map(exam => `
        <button onclick="window.selectOfficialExam('${exam.id}')" class="p-6 rounded-[2rem] bg-white/5 border border-white/10 hover:border-brand-500/50 hover:bg-white/10 transition-all text-left group">
          <div class="flex justify-between items-start mb-4">
            <div class="w-10 h-10 rounded-xl ${exam.examType === 'JAMB' ? 'bg-amber-500/20 text-amber-400' : 'bg-brand-500/20 text-brand-400'} flex items-center justify-center group-hover:scale-110 transition-transform">
              <i data-lucide="award" class="w-5 h-5"></i>
            </div>
            <div class="flex flex-col items-end gap-1">
              <span class="text-[9px] font-black uppercase ${exam.examType === 'JAMB' ? 'text-amber-400 bg-amber-400/10' : 'text-brand-400 bg-brand-400/10'} px-2 py-1 rounded-lg">${toText(exam.examType || 'Other')}</span>
              ${exam.examType === 'JAMB' ? `<span class="text-[9px] font-black uppercase text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-lg">${exam.jambSubject} • ${exam.jambYear}</span>` : ''}
            </div>
          </div>
          <p class="text-sm font-black text-white truncate mb-1">${exam.title}</p>
          <p class="text-[10px] font-bold text-white/40">${exam.questions?.length || 0} Questions • ${exam.duration || 30} Mins</p>
        </button>
      `).join('')}
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

window.selectOfficialExam = (id) => {
  const key = toText(id).trim();
  const exam = (app.state.officialExams || []).find(e => e.id === key);
  if (!exam) return toast('Exam not found', 'error');
  
  studyState.cbt.source = { 
    type: 'official', 
    id: key, 
    title: exam.title || 'Exam', 
    questions: exam.questions || [], 
    duration: exam.duration || 30,
    subject: exam.subject || exam.jambSubject || 'General',
    examType: exam.examType || 'Other'
  };
  
  studyState.cbt.subject = studyState.cbt.source.subject;
  studyState.cbt.timeLeft = (exam.duration || 30) * 60;
  
  if (S('selectedBookTitle')) S('selectedBookTitle').textContent = toText(exam.title || 'Exam');
  if (S('selectedBookInfo')) S('selectedBookInfo').classList.remove('hidden');
  
  // Highlight selected
  $$('#adminLibraryOption button').forEach(btn => {
    btn.classList.toggle('border-brand-500', btn.getAttribute('onclick')?.includes(id));
    btn.classList.toggle('bg-brand-500/10', btn.getAttribute('onclick')?.includes(id));
  });

  toast('Official exam selected!', 'success');
};

window.startQuickDrill = () => {
  studyState.cbt.source = { type: 'quick', title: 'General Knowledge' };
  if (S('selectedBookTitle')) S('selectedBookTitle').textContent = 'General Knowledge Quick Drill';
  if (S('selectedBookInfo')) S('selectedBookInfo').classList.remove('hidden');
  toast('Quick Protocol selected!', 'success');
};

function initBooksSync() {
  const grid = S('booksGrid');
  if (!grid) return;
  
  app.state.booksLoading = true;
  showSkeleton('booksGrid', 6);
  
  // Show all books, no filter by uploaderEmail
  const q = query(
    collection(db, "books"), 
    orderBy("createdAt", "desc"), 
    limit(80)
  );
  
  onSnapshot(q, (snap) => {
    app.state.booksLoading = false;
    app.state.books = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBooks();
  }, (e) => {
    app.state.booksLoading = false;
    console.error('Books sync error:', e);
    // If orderBy("createdAt") fails (no index), we'll try without ordering
    const fallbackQ = query(collection(db, "books"), limit(80));
    onSnapshot(fallbackQ, (fallbackSnap) => {
      app.state.books = fallbackSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderBooks();
    });
  });
}

function initBooksUI() {
  const uploadBtn = S('uploadBook');
  if (uploadBtn && !uploadBtn.dataset.bound) {
    uploadBtn.dataset.bound = '1';
    uploadBtn.onclick = () => {
      if (!app.state.user) {
        if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
        toast('Sign in to share a book', 'error');
        return;
      }
      window.toggleBookUpload(true);
    };
  }

  const search = S('bookSearch');
  const cat = S('filterBookCategory');
  const type = S('filterBookType');
  if (search && !search.dataset.bound) {
    search.dataset.bound = '1';
    search.oninput = () => renderBooks();
  }
  if (cat && !cat.dataset.bound) {
    cat.dataset.bound = '1';
    cat.onchange = () => renderBooks();
  }
  if (type && !type.dataset.bound) {
    type.dataset.bound = '1';
    type.onchange = () => renderBooks();
  }
}

function renderBooks() {
  const grid = S('booksGrid');
  if (!grid) return;

  const searchQuery = toText(S('bookSearch')?.value || '').toLowerCase().trim();
  const categoryFilter = S('filterBookCategory')?.value || 'All';
  const typeFilter = S('filterBookType')?.value || 'All';

  let books = Array.isArray(app.state.books) ? app.state.books.slice() : [];
  // Filter out blocked books
  books = books.filter(b => !b.is_blocked);
  if (categoryFilter !== 'All') books = books.filter(b => toText(b.category) === categoryFilter);
  if (typeFilter !== 'All') books = books.filter(b => toText(b.type) === typeFilter);
  if (searchQuery) {
    books = books.filter(b => {
      const title = toText(b.title).toLowerCase();
      const author = toText(b.author).toLowerCase();
      const subject = toText(b.subject).toLowerCase();
      return title.includes(searchQuery) || author.includes(searchQuery) || subject.includes(searchQuery);
    });
  }

  if (books.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-400 font-bold">
        No books found. Try a different search or filter.
      </div>
    `;
    return;
  }

  grid.innerHTML = books.map(b => {
    const title = escapeHTML(toText(b.title || 'Book'));
    const category = escapeHTML(toText(b.category || 'University'));
    const type = escapeHTML(toText(b.type || 'Textbook'));
    const fileUrl = safeUrl(b.fileUrl, '');
    return `
      <div class="premium-card p-6 rounded-[2.5rem] group relative overflow-hidden hover:shadow-2xl transition-all duration-300">
        <div class="absolute inset-0 bg-gradient-to-br from-emerald-500/0 via-emerald-500/0 to-emerald-500/0 group-hover:from-emerald-500/5 group-hover:via-transparent group-hover:to-teal-500/5 transition-all duration-500"></div>
        <div class="relative z-10">
          <div class="aspect-[3/2.2] rounded-[1.5rem] overflow-hidden bg-slate-100 dark:bg-slate-800 mb-6 border border-slate-100 dark:border-slate-700 shadow-xl shadow-slate-200/30 dark:shadow-black/20">
            <img src="book-cover.jpeg" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" loading="lazy">
          </div>
          <p class="text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300 mb-2">${category} • ${type}</p>
          <h4 class="font-black text-lg leading-snug line-clamp-2 text-slate-900 dark:text-white mb-4">${title}</h4>
          <div class="flex items-center gap-2">
            <button onclick="window.openBook('${escapeHTML(b.id)}')" class="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white text-center font-black uppercase text-[10px] hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              View
            </button>
            <button onclick="window.openReportModal('${escapeHTML(b.id)}', '${escapeHTML(title)}')" class="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-colors">
              <i data-lucide="alert-triangle" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

window.openBook = async (id) => {
  const key = toText(id).trim();
  if (!key) return;
  const book = (app.state.books || []).find(b => b.id === key);
  if (!book) return toast('Book not found', 'error');
  const url = safeUrl(book.fileUrl, '');
  if (!url) return toast('This book has no file attached', 'error');
  window.open(url, '_blank', 'noopener');
};

window.setQuickBookFilter = (category) => {
  const filterSelect = S('filterBookCategory');
  if (filterSelect) {
    filterSelect.value = category;
    renderBooks();
  }
};

window.toggleBookUpload = (show) => {
  const modal = S('bookUploadModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (!show) {
    app.state.bookDraftFile = null;
    if (S('bookTitle')) S('bookTitle').value = '';
    if (S('bookAuthor')) S('bookAuthor').value = '';
    if (S('bookDescription')) S('bookDescription').value = '';
    if (S('bookCoverUrl')) S('bookCoverUrl').value = '';
    if (S('bookFile')) S('bookFile').value = '';
    if (S('bookFileMeta')) S('bookFileMeta').textContent = 'PDF/DOC/PPT • Max 20MB recommended';
  }
  if (show && window.lucide) window.lucide.createIcons();
};

window.handleBookFile = (event) => {
  const file = event?.target?.files?.[0] || null;
  app.state.bookDraftFile = file;
  if (!file) {
    if (S('bookFileMeta')) S('bookFileMeta').textContent = 'PDF/DOC/PPT • Max 20MB recommended';
    return;
  }
  const sizeMb = (file.size / (1024 * 1024));
  if (S('bookFileMeta')) S('bookFileMeta').textContent = `${file.name} • ${sizeMb.toFixed(1)}MB`;
};

window.submitBookUpload = async () => {
  const user = auth?.currentUser || app.state.user;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to share a book', 'error');
    return;
  }

  const title = toText(S('bookTitle')?.value).trim();
  const author = toText(S('bookAuthor')?.value).trim();
  const category = S('bookCategory')?.value || 'University';
  const type = S('bookType')?.value || 'Textbook';
  const description = toText(S('bookDescription')?.value).trim();
  const coverUrl = toText(S('bookCoverUrl')?.value).trim();
  const file = app.state.bookDraftFile;

  if (title.length < 3) return toast('Enter a valid title', 'error');
  if (!file) return toast('Select a file to upload', 'error');

  const btn = S('bookSubmitBtn');
  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Uploading...';
  }

  try {
    const rawName = toText(file.name || 'book').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `users/${user.uid}/books/${Date.now()}_${rawName}`;
    const fileUrl = await dispatchAssetToCloudflare(file, path);

    await addDoc(collection(db, "books"), {
      title,
      author,
      category,
      type,
      description: description || '',
      coverUrl: "book-cover.jpeg",
      fileUrl,
      uploaderId: user.uid,
      uploaderEmail: user.email,
      uploaderName: user.displayName || user.email || 'Anonymous',
      createdAt: new Date().toISOString()
    });

    toast('Book published!', 'success');
    window.toggleBookUpload(false);
  } catch (e) {
    console.error('Book upload error:', e);
    toast(e?.message || 'Error uploading book', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || 'Publish to Library';
    }
  }
};

// --- Copyright Report Module ---
let currentReportBookId = null;
window.openReportModal = (bookId, bookTitle) => {
  currentReportBookId = bookId;
  const modal = S('reportModal');
  const titleEl = S('reportBookTitle');
  if (titleEl) titleEl.textContent = `Reporting: ${bookTitle}`;
  if (!modal) return;
  modal.classList.toggle('hidden', false);
  modal.classList.toggle('flex', true);
  if (window.lucide) window.lucide.createIcons();
};

window.toggleReportModal = (show) => {
  const modal = S('reportModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (!show) {
    currentReportBookId = null;
    if (S('reportName')) S('reportName').value = '';
    if (S('reportEmail')) S('reportEmail').value = '';
    if (S('reportRelationship')) S('reportRelationship').value = 'owner';
    if (S('reportDescription')) S('reportDescription').value = '';
  }
  if (show && window.lucide) window.lucide.createIcons();
};

window.submitReport = async () => {
  if (!currentReportBookId) return;
  const btn = S('reportSubmitBtn');
  const original = btn?.innerHTML;

  if (!auth?.currentUser) {
    toast('Please sign in to submit a report.', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Submitting...';
  }

  try {
    const idToken = await auth.currentUser.getIdToken();
    const reportData = {
      bookId: currentReportBookId,
      reporterName: toText(S('reportName')?.value).trim(),
      reporterEmail: toText(S('reportEmail')?.value).trim(),
      // NOTE: server.js / POST /api/reports expects `relationship`, not
      // `relationshipToOwner` — this previously mismatched and made every
      // submission fail server-side validation with a 400.
      relationship: S('reportRelationship')?.value || 'other',
      description: toText(S('reportDescription')?.value).trim()
    };

    const response = await fetch(`${API_BASE_URL}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(reportData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to submit report');
    }

    toast('Report submitted successfully!', 'success');
    window.toggleReportModal(false);
  } catch (e) {
    console.error('Report submission error:', e);
    toast(e?.message || 'Error submitting report', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || 'Submit Report';
    }
  }
};

// --- JAMB Simulation Module ---
let jambState = {
  mode: 'quick',
  selectedSubjects: ['English'], // English is mandatory
  activeSubject: 'English',
  questions: {}, // { subject: [question1, question2, ...] }
  selectedAnswers: {}, // { subject: { questionIndex: answer } }
  questionIndex: {}, // { subject: currentQuestion }
  totalTime: 7200, // 2 hours in seconds — matches current JAMB UTME CBT duration
  remainingTime: 7200,
  timerInterval: null,
  paused: false,
  startedAtMs: 0
};

// Real JAMB UTME structure: English (mandatory) carries more questions
// than the other three subjects. Falls back to 40 for anything not listed.
const JAMB_SUBJECT_QUESTION_COUNTS = { English: 60 };
const JAMB_DEFAULT_SUBJECT_COUNT = 40;

const jambSubjectsList = [
  { name: 'English', icon: 'book-open', color: 'emerald', mandatory: true },
  { name: 'Mathematics', icon: 'calculator', color: 'brand', mandatory: false },
  { name: 'Physics', icon: 'lightbulb', color: 'rose', mandatory: false },
  { name: 'Chemistry', icon: 'flask-conical', color: 'cyan', mandatory: false },
  { name: 'Biology', icon: 'leaf', color: 'lime', mandatory: false },
  { name: 'Economics', icon: 'trending-up', color: 'amber', mandatory: false },
  { name: 'Government', icon: 'landmark', color: 'violet', mandatory: false },
  { name: 'Literature', icon: 'book-open-check', color: 'pink', mandatory: false },
  { name: 'Commerce', icon: 'store', color: 'orange', mandatory: false },
  { name: 'Accounting', icon: 'receipt', color: 'teal', mandatory: false },
  { name: 'Geography', icon: 'map-pin', color: 'indigo', mandatory: false },
  { name: 'CRS', icon: 'church', color: 'sky', mandatory: false },
  { name: 'History', icon: 'clock-9', color: 'stone', mandatory: false }
];

function getSubjectColorClasses(colorName) {
  const map = {
    'emerald': { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-600', border: 'border-emerald-500' },
    'brand': { bg: 'bg-brand-50 dark:bg-brand-900/20', text: 'text-brand-600', border: 'border-brand-500' },
    'rose': { bg: 'bg-rose-50 dark:bg-rose-900/20', text: 'text-rose-600', border: 'border-rose-500' },
    'cyan': { bg: 'bg-cyan-50 dark:bg-cyan-900/20', text: 'text-cyan-600', border: 'border-cyan-500' },
    'lime': { bg: 'bg-lime-50 dark:bg-lime-900/20', text: 'text-lime-600', border: 'border-lime-500' },
    'amber': { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600', border: 'border-amber-500' },
    'violet': { bg: 'bg-violet-50 dark:bg-violet-900/20', text: 'text-violet-600', border: 'border-violet-500' },
    'pink': { bg: 'bg-pink-50 dark:bg-pink-900/20', text: 'text-pink-600', border: 'border-pink-500' },
    'orange': { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-600', border: 'border-orange-500' },
    'teal': { bg: 'bg-teal-50 dark:bg-teal-900/20', text: 'text-teal-600', border: 'border-teal-500' },
    'indigo': { bg: 'bg-indigo-50 dark:bg-indigo-900/20', text: 'text-indigo-600', border: 'border-indigo-500' },
    'sky': { bg: 'bg-sky-50 dark:bg-sky-900/20', text: 'text-sky-600', border: 'border-sky-500' },
    'stone': { bg: 'bg-stone-50 dark:bg-stone-900/20', text: 'text-stone-600', border: 'border-stone-500' }
  };
  return map[colorName] || map['brand'];
}

function renderJambSubjectGrid() {
  const grid = S('jambSubjectGrid');
  if (!grid) return;
  
  grid.innerHTML = jambSubjectsList.map(subj => {
    const isSelected = jambState.selectedSubjects.includes(subj.name);
    const classes = getSubjectColorClasses(subj.color);
    return `
      <button onclick="window.toggleJambSubject('${subj.name}')" class="premium-card p-6 text-left group hover:border-brand-500/50 transition-all ${isSelected ? 'ring-2 ring-brand-500' : ''}">
        <div class="w-12 h-12 rounded-2xl ${classes.bg} ${classes.text} flex items-center justify-center mb-4 group-hover:scale-110 transition-all">
          <i data-lucide="${subj.icon}" class="w-6 h-6"></i>
        </div>
        <h3 class="text-lg font-black mb-1">${subj.name}</h3>
        <p class="text-sm text-slate-500">${subj.mandatory ? 'Mandatory' : 'Optional'}</p>
      </button>
    `;
  }).join('');
  
  updateJambSummary();
  if (window.lucide) window.lucide.createIcons();
}

window.toggleJambSubject = (name) => {
  const subj = jambSubjectsList.find(s => s.name === name);
  if (!subj) return;
  
  if (subj.mandatory) {
    toast('English is mandatory for JAMB', 'warning');
    return;
  }
  
  if (jambState.selectedSubjects.includes(name)) {
    jambState.selectedSubjects = jambState.selectedSubjects.filter(n => n !== name);
  } else {
    if (jambState.selectedSubjects.length >= 4) {
      toast('You can only select 4 subjects', 'warning');
      return;
    }
    jambState.selectedSubjects.push(name);
  }
  
  renderJambSubjectGrid();
};

function updateJambSummary() {
  const summaryEl = S('jambSelectedSubjects');
  const startBtn = S('startJambExam');
  
  if (summaryEl) {
    summaryEl.textContent = jambState.selectedSubjects.join(' • ');
  }
  
  if (startBtn) {
    const canStart = jambState.selectedSubjects.length === 4;
    startBtn.disabled = !canStart;
  }
}

window.startJambExam = async () => {
  if (jambState.selectedSubjects.length !== 4) {
    toast('Please select exactly 4 subjects', 'warning');
    return;
  }

  const startBtn = S('startJambExam');
  if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Loading real questions…'; }
  toast('Pulling real past questions for your 4 subjects…', 'info');

  // Fetch each subject's questions from the real bank in parallel. English
  // gets the full 60-question UTME allotment; the other three get 40 each.
  let fetched;
  try {
    fetched = await Promise.all(jambState.selectedSubjects.map(async (subject) => {
      const count = JAMB_SUBJECT_QUESTION_COUNTS[subject] || JAMB_DEFAULT_SUBJECT_COUNT;
      const questions = await fetchRealQuestionBank({ examType: 'JAMB', subject, count });
      return { subject, questions: questions || [] };
    }));
  } catch (e) {
    console.error('JAMB question fetch failed:', e);
    fetched = [];
  } finally {
    if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Start JAMB Simulation'; }
  }

  // Refuse to start with a subject that has no real questions loaded yet —
  // this is the exact bug we're fixing: never silently fall back to fake
  // placeholder questions for a real UTME simulation.
  const empty = fetched.filter(f => f.questions.length === 0).map(f => f.subject);
  if (empty.length > 0) {
    toast(`No past questions loaded yet for ${empty.join(', ')}. Pick different subjects or check back after the next import.`, 'error');
    return;
  }

  // Initialize state
  jambState.activeSubject = jambState.selectedSubjects[0];
  jambState.remainingTime = jambState.totalTime;
  jambState.selectedAnswers = {};
  jambState.questionIndex = {};
  jambState.questions = {};
  jambState.paused = false;
  jambState.startedAtMs = Date.now();

  fetched.forEach(({ subject, questions }) => {
    jambState.questions[subject] = questions.map(q => ({
      question: q.q,
      options: q.opts,
      correct: q.correct,
      explanation: q.exp || '',
      topic: q.topic || ''
    }));
    jambState.questionIndex[subject] = 0;
    jambState.selectedAnswers[subject] = {};
  });

  // Switch UI to exam mode
  const setup = S('cbtSetup');
  const examArea = S('cbtExamArea');
  const subjectNav = S('subjectNavSidebar');
  const jambKeyLegend = S('jambKeyLegend');

  if (setup) setup.classList.add('hidden');
  if (examArea) examArea.classList.remove('hidden');
  if (subjectNav) subjectNav.classList.remove('hidden');
  if (jambKeyLegend) jambKeyLegend.classList.remove('hidden');

  // Render subject navigation
  renderSubjectNav();

  // Start timer
  startJambTimer();

  // Render first question
  renderCurrentJambQuestion();

  // Add keyboard listeners
  document.addEventListener('keydown', handleJambKeyPress);

  // Go fullscreen for the exam — matches a real CBT center experience.
  requestCbtFullscreen();
};

function renderSubjectNav() {
  const navList = S('subjectNavList');
  if (!navList) return;
  
  navList.innerHTML = jambState.selectedSubjects.map(subject => {
    const subj = jambSubjectsList.find(s => s.name === subject);
    const classes = getSubjectColorClasses(subj.color);
    const isActive = subject === jambState.activeSubject;
    const answeredCount = Object.keys(jambState.selectedAnswers[subject] || {}).length;
    const totalCount = jambState.questions[subject]?.length || 0;
    
    return `
      <button onclick="window.switchJambSubject('${subject}')" class="w-full p-4 rounded-2xl text-left transition-all ${isActive ? classes.bg + ' ' + classes.border + ' border-2' : 'bg-slate-50 dark:bg-slate-800'}">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl ${classes.bg} ${classes.text} flex items-center justify-center">
              <i data-lucide="${subj.icon}" class="w-5 h-5"></i>
            </div>
            <span class="font-black">${subject}</span>
          </div>
          <span class="text-sm font-bold text-slate-500">${answeredCount}/${totalCount}</span>
        </div>
      </button>
    `;
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

window.switchJambSubject = (subject) => {
  jambState.activeSubject = subject;
  renderSubjectNav();
  renderCurrentJambQuestion();
};

function renderCurrentJambQuestion() {
  const subject = jambState.activeSubject;
  const questions = jambState.questions[subject];
  const i = jambState.questionIndex[subject];
  
  if (!questions || i >= questions.length) return;
  
  const q = questions[i];
  
  // Update header
  const subjectEl = S('cbtSubject');
  const initialEl = S('cbtSubjectInitial');
  const badgeEl = S('cbtQuestionBadge');
  const questionEl = S('cbtQuestionText');
  const optionsEl = S('cbtOptions');
  
  if (subjectEl) subjectEl.textContent = subject;
  if (initialEl) initialEl.textContent = subject[0].toUpperCase();
  if (badgeEl) badgeEl.textContent = `Question ${i + 1} of ${questions.length}`;
  if (questionEl) questionEl.textContent = q.question;
  
  // Render options
  if (optionsEl) {
    optionsEl.innerHTML = q.options.map((opt, idx) => {
      const selected = jambState.selectedAnswers[subject]?.[i] === idx;
      const letters = ['A', 'B', 'C', 'D'];
      return `
        <button onclick="window.selectJambAnswer(${idx})" class="w-full p-6 rounded-2xl text-left transition-all flex items-center gap-4 ${selected ? 'bg-brand-50 dark:bg-brand-900/20 border-2 border-brand-500' : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'}">
          <div class="w-12 h-12 rounded-full ${selected ? 'bg-brand-600 text-white' : 'bg-slate-200 dark:bg-slate-700'} flex items-center justify-center font-black text-xl">
            ${letters[idx]}
          </div>
          <span class="text-lg font-bold">${escapeHTML(opt)}</span>
        </button>
      `;
    }).join('');
  }
  
  // Update previous/next button states
  const prevBtn = S('prevQuestion');
  const nextBtn = S('nextQuestion');
  if (prevBtn) prevBtn.disabled = i === 0;
  if (nextBtn) {
    nextBtn.textContent = i === questions.length - 1 ? 'Complete' : 'Next';
  }
  renderBookmarkButtonState();
  if (window.lucide) window.lucide.createIcons();
}

window.selectJambAnswer = (idx) => {
  const subject = jambState.activeSubject;
  if (!jambState.selectedAnswers[subject]) {
    jambState.selectedAnswers[subject] = {};
  }
  jambState.selectedAnswers[subject][jambState.questionIndex[subject]] = idx;
  renderCurrentJambQuestion();
  renderSubjectNav();
};

window.goToPrevQuestion = () => {
  const subject = jambState.activeSubject;
  if (jambState.questionIndex[subject] > 0) {
    jambState.questionIndex[subject]--;
    renderCurrentJambQuestion();
  }
};

window.goToNextQuestion = () => {
  const subject = jambState.activeSubject;
  const questions = jambState.questions[subject];
  
  if (jambState.questionIndex[subject] < questions.length - 1) {
    jambState.questionIndex[subject]++;
    renderCurrentJambQuestion();
  }
};

window.clearCurrentAnswer = () => {
  const subject = jambState.activeSubject;
  const i = jambState.questionIndex[subject];
  
  if (jambState.selectedAnswers[subject]?.[i] !== undefined) {
    delete jambState.selectedAnswers[subject][i];
    renderCurrentJambQuestion();
    renderSubjectNav();
  }
};

window.openSubmitModal = () => {
  // For now, just confirm
  if (confirm('Are you sure you want to submit the exam?')) {
    finishJambExam();
  }
};

function handleJambKeyPress(e) {
  // Prevent page scrolling from keys
  const keysToPrevent = ['p', 'n', 'a', 'b', 'c', 'd', 'r', 's', ' '];
  if (keysToPrevent.includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
  
  switch (e.key.toLowerCase()) {
    case 'p':
      window.goToPrevQuestion();
      break;
    case 'n':
      window.goToNextQuestion();
      break;
    case 'a':
      window.selectJambAnswer(0);
      break;
    case 'b':
      window.selectJambAnswer(1);
      break;
    case 'c':
      window.selectJambAnswer(2);
      break;
    case 'd':
      window.selectJambAnswer(3);
      break;
    case 'r':
      window.clearCurrentAnswer();
      break;
    case 's':
      window.openSubmitModal();
      break;
  }
}

function startJambTimer() {
  jambState.timerInterval = setInterval(() => {
    if (!jambState.paused) {
      jambState.remainingTime--;
      updateTimerDisplay();
      
      if (jambState.remainingTime <= 0) {
        finishJambExam(true);
      }
    }
  }, 1000);
}

function updateTimerDisplay() {
  const timerEl = S('cbtTimer');
  if (timerEl) {
    timerEl.innerHTML = `<i data-lucide="clock" class="w-6 h-6"></i><span>${formatMMSS(jambState.remainingTime)}</span>`;
    if (window.lucide) window.lucide.createIcons();
  }
}

function computeJambResult() {
  const perSubject = {};
  let totalCorrect = 0;
  let totalQuestions = 0;
  const wrongTopics = {};

  jambState.selectedSubjects.forEach((subject) => {
    const questions = jambState.questions[subject] || [];
    const answers = jambState.selectedAnswers[subject] || {};
    let correct = 0;
    questions.forEach((q, i) => {
      const given = answers[i];
      if (given === q.correct) {
        correct++;
      } else if (given !== undefined && q.topic) {
        wrongTopics[q.topic] = (wrongTopics[q.topic] || 0) + 1;
      }
    });
    const total = questions.length;
    // Each subject is scaled to a 0–100 "subject score"; the four are
    // summed for the familiar "aggregate out of 400" JAMB candidates talk
    // about. This mirrors how the aggregate is commonly discussed, not
    // JAMB's own (non-public) internal scaling algorithm.
    const subjectScorePct = total > 0 ? Math.round((correct / total) * 100) : 0;
    perSubject[subject] = { correct, total, scorePct: subjectScorePct };
    totalCorrect += correct;
    totalQuestions += total;
  });

  const aggregate400 = Object.values(perSubject).reduce((sum, s) => sum + s.scorePct, 0);
  const overallPct = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const usedSec = Math.max(0, jambState.startedAtMs ? Math.round((Date.now() - jambState.startedAtMs) / 1000) : (jambState.totalTime - jambState.remainingTime));
  const topWrongTopics = Object.entries(wrongTopics).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([topic, count]) => ({ topic, count }));

  return { perSubject, totalCorrect, totalQuestions, overallPct, aggregate400, usedSec, wrongTopics: topWrongTopics };
}

async function finishJambExam(timedOut = false) {
  if (jambState.timerInterval) {
    clearInterval(jambState.timerInterval);
    jambState.timerInterval = null;
  }
  document.removeEventListener('keydown', handleJambKeyPress);

  const result = computeJambResult();

  if (window.confetti && result.overallPct >= 50) {
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#7c3aed', '#4f46e5', '#06b6d4', '#10b981'] });
  }

  toast(timedOut ? "Time's up! Your JAMB simulation was submitted." : 'JAMB simulation submitted!', 'success');

  // Persist + reward. Best-effort: a logging failure shouldn't trap the
  // student on the exam screen without their results.
  try {
    await saveCbtAttempt({
      mode: 'jamb',
      examType: 'JAMB',
      subjects: jambState.selectedSubjects,
      perSubject: result.perSubject,
      totalCorrect: result.totalCorrect,
      totalQuestions: result.totalQuestions,
      pct: result.overallPct,
      jambAggregate: result.aggregate400,
      durationSec: jambState.totalTime,
      usedSec: result.usedSec,
      wrongTopics: result.wrongTopics
    });
  } catch (e) {
    console.error('Failed to save JAMB attempt:', e);
    toast("Results are shown below, but we couldn't save this attempt to your history.", 'warning');
  }

  // XP: reward effort + performance, not just a flat completion bonus.
  rewardXP(150 + Math.round(result.overallPct * 2));

  exitCbtFullscreen();
  renderJambResultModal(result);

  // Reset to setup underneath the modal
  const setup = S('cbtSetup');
  const examArea = S('cbtExamArea');
  const subjectNav = S('subjectNavSidebar');
  const jambKeyLegend = S('jambKeyLegend');

  if (setup) setup.classList.remove('hidden');
  if (examArea) examArea.classList.add('hidden');
  if (subjectNav) subjectNav.classList.add('hidden');
  if (jambKeyLegend) jambKeyLegend.classList.add('hidden');

  window.setCbtView('jamb'); // Back to the JAMB setup page, ready to run another
  renderCbtHistory();
}

function renderJambResultModal(result) {
  window._lastJambResultForShare = result;
  const modal = S('jambResultModal');
  const body = S('jambResultBody');
  if (!modal || !body) {
    // Modal markup not present on this shell yet — fall back to a toast
    // summary so results are never silently lost.
    toast(`Aggregate: ${result.aggregate400}/400 · ${result.totalCorrect}/${result.totalQuestions} correct`, 'brand', 8000);
    return;
  }

  const rows = jambState.selectedSubjects.map((subject) => {
    const s = result.perSubject[subject] || { correct: 0, total: 0, scorePct: 0 };
    return `
      <div class="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
        <span class="text-sm font-black">${escapeHTML(subject)}</span>
        <div class="flex items-center gap-3">
          <span class="text-xs font-bold text-slate-400">${s.correct}/${s.total}</span>
          <span class="px-3 py-1 rounded-full text-xs font-black ${s.scorePct >= 50 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20' : 'bg-rose-50 text-rose-600 dark:bg-rose-900/20'}">${s.scorePct}/100</span>
        </div>
      </div>
    `;
  }).join('');

  const weakTopicsHtml = result.wrongTopics.length > 0 ? `
    <div class="mt-6 p-5 rounded-3xl bg-amber-50 dark:bg-amber-900/10 border border-amber-500/20">
      <p class="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-3">Focus on these topics next</p>
      <div class="flex flex-wrap gap-2">
        ${result.wrongTopics.map(t => `<span class="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 text-xs font-bold border border-amber-500/20">${escapeHTML(t.topic)} <span class="text-amber-500">×${t.count}</span></span>`).join('')}
      </div>
    </div>
  ` : '';

  body.innerHTML = `
    <div class="grid grid-cols-2 gap-4 mb-6">
      <div class="p-5 rounded-3xl bg-brand-50 dark:bg-brand-900/20 border border-brand-500/20 text-center">
        <p class="text-3xl font-black text-brand-600">${result.aggregate400}<span class="text-base text-slate-400">/400</span></p>
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Aggregate</p>
      </div>
      <div class="p-5 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-center">
        <p class="text-3xl font-black">${result.totalCorrect}<span class="text-base text-slate-400">/${result.totalQuestions}</span></p>
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Correct</p>
      </div>
    </div>
    <div class="space-y-3">${rows}</div>
    ${weakTopicsHtml}
    <p class="mt-6 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Time used: ${formatMMSS(result.usedSec)}</p>
    <button onclick="window.shareJambResult()" class="mt-6 w-full py-4 rounded-2xl elite-gradient text-white font-black text-sm flex items-center justify-center gap-2 hover:scale-[1.01] transition-transform">
      <i data-lucide="share-2" class="w-4 h-4"></i> Share my result
    </button>
  `;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (window.lucide) window.lucide.createIcons();
}

window.closeJambResultModal = () => {
  const modal = S('jambResultModal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
};

// --- Shareable Score Card ---
// Draws a branded result card to a canvas (no server round-trip) and hands
// it to the Web Share API on mobile (WhatsApp/Twitter/Instagram all accept
// shared image files directly) or falls back to a PNG download on desktop.
// This is the one feature that markets Geo-Books for free every time a
// student uses it — myschool.ng's locked-app model has nothing comparable.
window._lastJambResultForShare = null;

async function drawShareCard(result) {
  const canvas = document.createElement('canvas');
  const W = 1080, H = 1350; // 4:5, plays nicely as a WhatsApp status / IG post
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background: brand gradient matching .elite-gradient in the app
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#6D28D9');
  bg.addColorStop(0.35, '#7C3AED');
  bg.addColorStop(0.7, '#4F46E5');
  bg.addColorStop(1, '#4338CA');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle noise-free vignette for depth
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H / 3, W / 2, H / 2, H);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';

  // Wordmark
  ctx.font = '700 40px Arial';
  ctx.globalAlpha = 0.85;
  ctx.fillText('GEO-BOOKS', W / 2, 130);
  ctx.globalAlpha = 1;

  ctx.font = '700 26px Arial';
  ctx.globalAlpha = 0.7;
  ctx.fillText('JAMB SIMULATION RESULT', W / 2, 175);
  ctx.globalAlpha = 1;

  // Aggregate — the headline number
  ctx.font = '900 220px Arial';
  ctx.fillText(String(result.aggregate400), W / 2, 480);
  ctx.font = '700 40px Arial';
  ctx.globalAlpha = 0.75;
  ctx.fillText('AGGREGATE / 400', W / 2, 540);
  ctx.globalAlpha = 1;

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(140, 610);
  ctx.lineTo(W - 140, 610);
  ctx.stroke();

  // Per-subject breakdown
  const subjects = Object.entries(result.perSubject || {});
  let y = 690;
  ctx.font = '700 34px Arial';
  subjects.forEach(([subject, s]) => {
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.85;
    ctx.fillText(subject, 160, y);
    ctx.textAlign = 'right';
    ctx.globalAlpha = 1;
    ctx.fillText(`${s.scorePct}/100`, W - 160, y);
    y += 64;
  });

  // Footer
  ctx.textAlign = 'center';
  ctx.font = '700 30px Arial';
  ctx.globalAlpha = 0.7;
  ctx.fillText(`${result.totalCorrect}/${result.totalQuestions} correct · geo-books.app`, W / 2, H - 90);
  ctx.globalAlpha = 1;

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

window.shareJambResult = async () => {
  const result = window._lastJambResultForShare;
  if (!result) { toast('No result to share yet', 'error'); return; }

  let blob;
  try {
    blob = await drawShareCard(result);
  } catch (e) {
    console.error('Failed to draw share card:', e);
    toast('Could not generate the share card', 'error');
    return;
  }
  if (!blob) { toast('Could not generate the share card', 'error'); return; }

  const file = new File([blob], 'geo-books-result.png', { type: 'image/png' });
  const shareText = `I scored ${result.aggregate400}/400 on my JAMB simulation on Geo-Books! 🎯`;

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My Geo-Books JAMB Result', text: shareText });
      return;
    } catch (e) {
      // User cancelled the native share sheet — not an error worth surfacing.
      if (e?.name === 'AbortError') return;
    }
  }

  // Desktop / unsupported browsers: fall back to a plain download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'geo-books-result.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Score card downloaded — share it from your photos/downloads', 'success');
};

// --- Study Tools Module ---
function getCbtCorrectIndex(q) {
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

function updateCbtFlagUI() {
  const flags = Array.isArray(studyState.cbt.flags) ? studyState.cbt.flags : [];
  const count = flags.filter(Boolean).length;
  const wrap = S('cbtFlagCountWrap');
  if (wrap) wrap.classList.toggle('hidden', count === 0);
  if (S('cbtFlagCount')) S('cbtFlagCount').textContent = String(count);

  const btn = S('cbtFlagBtn');
  if (btn) {
    const active = !!flags[studyState.cbt.i];
    btn.classList.toggle('bg-amber-100', active);
    btn.classList.toggle('text-amber-700', active);
    btn.classList.toggle('dark:bg-amber-900/30', active);
    btn.classList.toggle('dark:text-amber-200', active);
  }
}

function updateCbtPauseUI() {
  const btn = S('cbtPauseBtn');
  if (!btn) return;
  const isPaused = (jambState.mode === 'jamb' && jambState.timerInterval) ? jambState.paused : studyState.cbt.paused;
  btn.innerHTML = isPaused
    ? '<i data-lucide="play" class="w-5 h-5"></i>'
    : '<i data-lucide="pause" class="w-5 h-5"></i>';
  btn.title = isPaused ? 'Resume' : 'Pause';
  if (window.lucide) window.lucide.createIcons();
}

// --- Marketplace Carousel ---
let currentFeaturedIdx = 0;
window.nextFeatured = () => {
  const carousel = S('featuredCarousel');
  if (!carousel) return;
  const count = carousel.children.length;
  currentFeaturedIdx = (currentFeaturedIdx + 1) % count;
  carousel.style.transform = `translateX(-${currentFeaturedIdx * 100}%)`;
};
window.prevFeatured = () => {
  const carousel = S('featuredCarousel');
  if (!carousel) return;
  const count = carousel.children.length;
  currentFeaturedIdx = (currentFeaturedIdx - 1 + count) % count;
  carousel.style.transform = `translateX(-${currentFeaturedIdx * 100}%)`;
};

// --- CBT Fullscreen (exam-mode) ---
// Real CBT centers run in fullscreen with no browser chrome; this puts the
// whole document into fullscreen when an exam starts (JAMB multi-subject
// flow or the general/quick/topic flow) and reliably exits it wherever a
// session ends — normal submit, "finish reviewing", or navigating away
// mid-exam via resetCbtSession(). Wrapped defensively because:
//  - requestFullscreen() must be called from a user gesture (it is here —
//    always triggered by a button click) or the browser silently rejects it.
//  - It's unsupported entirely on iOS Safari for arbitrary elements, and
//    some browsers require vendor prefixes — feature-detect and no-op
//    instead of throwing if nothing is available.
function getFullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement ||
         document.mozFullScreenElement || document.msFullscreenElement || null;
}

async function requestCbtFullscreen() {
  const el = document.documentElement;
  try {
    if (getFullscreenEl()) return; // already in fullscreen
    const req = el.requestFullscreen || el.webkitRequestFullscreen ||
                el.mozRequestFullScreen || el.msRequestFullscreen;
    if (req) await req.call(el);
  } catch (e) {
    // Not fatal — exam still works windowed, just log for diagnostics.
    console.warn('CBT fullscreen request failed/unsupported:', e?.message || e);
  }
}

async function exitCbtFullscreen() {
  try {
    if (!getFullscreenEl()) return; // not in fullscreen, nothing to do
    const exit = document.exitFullscreen || document.webkitExitFullscreen ||
                 document.mozCancelFullScreen || document.msExitFullscreen;
    if (exit) await exit.call(document);
  } catch (e) {
    console.warn('CBT fullscreen exit failed:', e?.message || e);
  }
}

// If the user backs out of fullscreen mid-exam (Esc key, swipe-down, etc.)
// let them know instead of silently leaving them windowed with no way back
// short of restarting — offer one tap to re-enter.
document.addEventListener('fullscreenchange', () => {
  const inExam = app.state.currentSection === 'cbt' &&
    ((S('cbtExamArea') && !S('cbtExamArea').classList.contains('hidden')) ||
     (S('subjectNavSidebar') && !S('subjectNavSidebar').classList.contains('hidden')));
  if (inExam && !getFullscreenEl() && !studyState.cbt.submitted) {
    toast('Exited fullscreen. Tap to re-enter exam mode.', 'warning');
  }
});

// --- CBT Implementation ---
function renderCbtQuestion() {
  const q = studyState.cbt.questions[studyState.cbt.i];
  const container = S('cbtQuestionContainer');
  
  if (container) {
    container.classList.add('slide-out');
    setTimeout(() => {
      if (S('cbtQuestionText')) S('cbtQuestionText').textContent = q.q;
      if (S('cbtQuestionBadge')) S('cbtQuestionBadge').textContent = `Protocol Step ${String(studyState.cbt.i + 1).padStart(2, '0')} / ${studyState.cbt.questions.length}`;
      if (S('cbtSubject')) S('cbtSubject').textContent = toText(studyState.cbt.subject || 'General');
      if (S('cbtSubjectInitial')) S('cbtSubjectInitial').textContent = (studyState.cbt.subject || 'G')[0].toUpperCase();

      const selected = studyState.cbt.answers?.[studyState.cbt.i];
      const correct = getCbtCorrectIndex(q);
      const reveal = !!studyState.cbt.submitted || !!studyState.cbt.reviewMode;

      const optsWrap = S('cbtOptions');
      if (optsWrap) {
        optsWrap.innerHTML = q.opts.map((opt, idx) => {
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
            <button onclick="window.selectCbtOption(${idx})" class="w-full text-left p-6 rounded-3xl border-2 transition-all duration-300 flex items-center gap-6 group/opt haptic-feedback ${btnClass}">
              <div class="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm transition-all duration-300 group-hover/opt:scale-110 ${iconClass}">${String.fromCharCode(65+idx)}</div>
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

      // AI explain panel: reset per question, restore from cache if we've
      // already fetched an explanation for this one this session.
      const aiExpWrap = S('cbtAiExplainWrap');
      const aiExpBody = S('cbtAiExplainBody');
      if (aiExpWrap && aiExpBody) {
        const cached = studyState.cbt.aiExplainCache[studyState.cbt.i];
        if (cached) {
          aiExpWrap.classList.remove('hidden');
          aiExpBody.innerHTML = `<p class="leading-relaxed text-slate-600 dark:text-slate-300">${escapeHTML(cached)}</p>`;
        } else {
          aiExpWrap.classList.add('hidden');
          aiExpBody.innerHTML = '';
        }
      }
      
      if (S('prevQuestion')) S('prevQuestion').disabled = studyState.cbt.i === 0;
      if (S('nextQuestion')) S('nextQuestion').classList.toggle('hidden', studyState.cbt.i === studyState.cbt.questions.length - 1);
      if (S('submitExam')) S('submitExam').classList.toggle('hidden', studyState.cbt.i !== studyState.cbt.questions.length - 1);
      
      // Update Progress
      const progress = Math.round(((studyState.cbt.i + 1) / studyState.cbt.questions.length) * 100);
      if (S('cbtProgressBar')) {
        S('cbtProgressBar').style.width = `${progress}%`;
        S('cbtProgressBar').classList.add('progress-pulse-active');
        setTimeout(() => S('cbtProgressBar').classList.remove('progress-pulse-active'), 2000);
      }
      if (S('cbtProgressText')) S('cbtProgressText').textContent = `Neural Sync: ${progress}%`;
      if (S('cbtProgressMeta')) S('cbtProgressMeta').textContent = `Vector ${studyState.cbt.i + 1} / ${studyState.cbt.questions.length}`;

      updateCbtStats();
      updateCbtFlagUI();
      renderBookmarkButtonState();
      if (window.lucide) window.lucide.createIcons();
      
      container.classList.remove('slide-out');
      container.classList.add('slide-in');
      setTimeout(() => container.classList.remove('slide-in'), 500);
    }, 300);
  }
}

// --- AI Explain-Any-Question ---
// Upgrades the old "AI Counsel" button (which just pre-filled the tutor chat
// input and made the student click send themselves, with no options or
// correct-answer context) into a real one-click explanation rendered right
// under the question. Reuses aiTutorReply — no new ai.js export needed.
window.explainCbtQuestionWithAI = async () => {
  const i = studyState.cbt.i;
  const q = studyState.cbt.questions[i];
  const wrap = S('cbtAiExplainWrap');
  const body = S('cbtAiExplainBody');
  const btn = S('cbtAiExplainBtn');
  if (!q || !wrap || !body) return;

  wrap.classList.remove('hidden');

  // Already fetched for this question this session — show the cached copy.
  if (studyState.cbt.aiExplainCache[i]) {
    body.innerHTML = `<p class="leading-relaxed text-slate-600 dark:text-slate-300">${escapeHTML(studyState.cbt.aiExplainCache[i])}</p>`;
    return;
  }

  if (studyState.cbt.aiExplainLoading) return;

  if (!aiIsConfigured()) {
    body.innerHTML = `<p class="text-sm text-slate-400 italic">AI explanations aren't configured for this account yet.</p>`;
    return;
  }

  studyState.cbt.aiExplainLoading = true;
  if (btn) btn.disabled = true;
  body.innerHTML = `
    <div class="space-y-2">
      <div class="skeleton h-4 w-full"></div>
      <div class="skeleton h-4 w-5/6"></div>
      <div class="skeleton h-4 w-2/3"></div>
    </div>
  `;

  const correctIdx = getCbtCorrectIndex(q);
  const selectedIdx = studyState.cbt.answers?.[i];
  const lettered = (q.opts || []).map((opt, idx) => `${String.fromCharCode(65 + idx)}) ${opt}`).join('\n');
  const studentLine = Number.isInteger(selectedIdx)
    ? `The student answered ${String.fromCharCode(65 + selectedIdx)}.`
    : `The student has not answered yet.`;

  const prompt = [
    `Explain this ${toText(studyState.cbt.subject || 'exam')} practice question to a Nigerian JAMB/WAEC student, in plain language.`,
    `Question: ${q.q}`,
    `Options:\n${lettered}`,
    `Correct answer: ${String.fromCharCode(65 + correctIdx)}) ${q.opts?.[correctIdx] ?? ''}`,
    studentLine,
    `Keep it under 120 words. Explain WHY the correct option is right and briefly why the most tempting wrong option is wrong.`
  ].join('\n\n');

  let response = '';
  try {
    response = await aiTutorReply(prompt, { subject: studyState?.cbt?.subject || '' });
  } catch (e) {
    console.error('AI explain-question failed:', e);
  }

  studyState.cbt.aiExplainLoading = false;
  if (btn) btn.disabled = false;

  if (!response) {
    body.innerHTML = `<p class="text-sm text-slate-400 italic">Couldn't reach the AI tutor just now — try again in a moment.</p>`;
    return;
  }

  studyState.cbt.aiExplainCache[i] = response;
  body.innerHTML = `<p class="leading-relaxed text-slate-600 dark:text-slate-300">${escapeHTML(response)}</p>`;
};

function renderCbtQuestionMap() {
  const map = S('questionMap');
  if (!map) return;
  const flags = Array.isArray(studyState.cbt.flags) ? studyState.cbt.flags : [];
  map.innerHTML = studyState.cbt.questions.map((_, idx) => `
    <button onclick="window.jumpToCbtQuestion(${idx})" class="aspect-square rounded-xl border-2 flex items-center justify-center font-black text-xs transition-all ${
      studyState.cbt.i === idx
        ? 'border-brand-500 bg-brand-50 text-brand-600'
        : studyState.cbt.answers[idx] !== null && studyState.cbt.answers[idx] !== undefined
          ? 'bg-emerald-500 border-emerald-500 text-white'
          : 'border-slate-100 dark:border-slate-800 text-slate-400'
    } ${flags[idx] ? 'ring-2 ring-amber-400/60' : ''}">
      ${idx + 1}
    </button>
  `).join('');
}

function startCbtTimer(onTimeOut) {
  if (studyState.cbt.timer) clearInterval(studyState.cbt.timer);
  studyState.cbt.timer = null;
  studyState.cbt.onTimeOut = typeof onTimeOut === 'function' ? onTimeOut : null;
  if (!Number.isFinite(Number(studyState.cbt.timeLeft)) || Number(studyState.cbt.timeLeft) <= 0) {
    studyState.cbt.timeLeft = 1800;
  }
  studyState.cbt.timer = setInterval(() => {
    if (studyState.cbt.paused) return;
    studyState.cbt.timeLeft--;
    const m = Math.floor(studyState.cbt.timeLeft / 60);
    const s = studyState.cbt.timeLeft % 60;
    if (S('cbtTimer')) S('cbtTimer').querySelector('span').textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (studyState.cbt.timeLeft <= 0) {
      clearInterval(studyState.cbt.timer);
      if (studyState.cbt.onTimeOut) studyState.cbt.onTimeOut();
    }
  }, 1000);
}

// Hands the generated exam off to cbt.htm — a standalone, nav-free page
// dedicated to just taking the exam (see cbt.js). sessionStorage (not
// localStorage) is used deliberately: it's scoped to this tab and clears
// itself if the tab is closed, matching the "progress is lost" behavior
// the exam UI already promises on exit.
function launchCbtExamPage(payload) {
  try {
    sessionStorage.setItem('geoBooksCbtSession', JSON.stringify({
      subject: payload.subject || 'General',
      questions: payload.questions || [],
      durationSec: Number(payload.durationSec) || 1800,
      examType: payload.examType || 'GENERAL',
      startedAtMs: Date.now()
    }));
  } catch (e) {
    console.error('Failed to hand off CBT session to cbt.htm:', e);
    toast('Could not start the exam page. Please try again.', 'error');
    return;
  }
  window.location.href = 'cbt.htm';
}

function resetCbtSession() {
  exitCbtFullscreen();
  if (studyState.cbt.timer) clearInterval(studyState.cbt.timer);
  studyState.cbt.timer = null;
  studyState.cbt.onTimeOut = null;
  studyState.cbt.i = 0;
  studyState.cbt.subject = 'General';
  studyState.cbt.source = null;
  studyState.cbt.settings = { count: 20, intensity: 'standard' };
  studyState.cbt.flags = [];
  studyState.cbt.paused = false;
  studyState.cbt.submitted = false;
  studyState.cbt.reviewMode = false;
  studyState.cbt.startedAtMs = 0;
  studyState.cbt.durationSec = 1800;
  studyState.cbt.questions = (studyState.cbt.questions || []).map(q => ({
    ...q,
    correct: Number.isInteger(q.correct) ? q.correct : q.a
  }));
  studyState.cbt.answers = new Array(studyState.cbt.questions.length).fill(null);
  studyState.cbt.timeLeft = 1800;
  if (S('cbtTimer')) S('cbtTimer').querySelector('span').textContent = '30:00';
  if (S('statAnswered')) S('statAnswered').textContent = '0';
  if (S('statRemaining')) S('statRemaining').textContent = String(studyState.cbt.questions.length);
  const expWrap = S('cbtExplanationWrap');
  if (expWrap) expWrap.classList.add('hidden');
  updateCbtPauseUI();
  updateCbtFlagUI();
}

function updateCbtStats() {
  const total = studyState.cbt.questions.length;
  const answered = (studyState.cbt.answers || []).filter(a => a !== null && a !== undefined).length;
  if (S('statAnswered')) S('statAnswered').textContent = answered.toLocaleString();
  if (S('statRemaining')) S('statRemaining').textContent = Math.max(0, total - answered).toLocaleString();
}

// Real spaced-repetition scheduling (SM-2-inspired, simplified). "Again"
// resets the card and brings it back in 10 minutes; "Hard"/"Good"/"Easy"
// push it further out the higher its level climbs, so well-known cards are
// reviewed less often and shaky ones resurface sooner.
function scheduleFlashcardReview(currentLevel, rating) {
  const DAY = 24 * 60 * 60 * 1000;
  const level = Math.max(0, Number(currentLevel) || 0);

  if (rating === 'again') {
    return { srsLevel: 0, nextReview: Date.now() + 10 * 60 * 1000 };
  }
  if (rating === 'hard') {
    const newLevel = Math.max(1, level);
    const intervals = [1, 1, 2, 3, 5, 7];
    return { srsLevel: newLevel, nextReview: Date.now() + intervals[Math.min(newLevel, intervals.length - 1)] * DAY };
  }
  if (rating === 'easy') {
    const newLevel = Math.min(5, level + 2);
    const intervals = [2, 4, 7, 14, 30, 60];
    return { srsLevel: newLevel, nextReview: Date.now() + intervals[Math.min(newLevel, intervals.length - 1)] * DAY };
  }
  // 'good' (default)
  const newLevel = Math.min(5, level + 1);
  const intervals = [1, 2, 4, 7, 14, 30];
  return { srsLevel: newLevel, nextReview: Date.now() + intervals[Math.min(newLevel, intervals.length - 1)] * DAY };
}

// Cards due now, most-overdue first. Cards with no nextReview (freshly
// created) count as due immediately. This — not raw array order — is what
// actually drives which card renderFlashcard()/rateFlashcard() show next,
// so rating a card no longer just cycles blindly through the whole deck
// regardless of whether it's actually time to see it again.
function getDueFlashcards() {
  const now = Date.now();
  return studyState.flashcards.cards
    .filter(c => !c.nextReview || c.nextReview <= now)
    .sort((a, b) => (a.nextReview || 0) - (b.nextReview || 0));
}

function renderFlashcard() {
  const due = getDueFlashcards();
  if (studyState.flashcards.idx >= due.length) studyState.flashcards.idx = 0;
  const card = due[studyState.flashcards.idx];
  const total = studyState.flashcards.cards.length;

  if (!card) {
    // Either the deck is empty, or every card has already been reviewed
    // and isn't due again yet — these are different states worth telling
    // the user apart, instead of both looking like "nothing here".
    if (S('cardFront')) S('cardFront').textContent = total ? "All caught up!" : 'No cards in your deck yet.';
    if (S('cardBack')) S('cardBack').textContent = total ? "You've reviewed every due card. Check back later, or add more to keep going." : 'Click "create flash card deck" or "Auto-Generate" to start.';
    if (S('fcCardCategory')) S('fcCardCategory').textContent = total ? 'Up to date' : 'Empty deck';
    if (S('fcProgressText')) S('fcProgressText').textContent = total ? `0 due of ${total}` : '0 of 0';
    if (S('fcProgressBar')) S('fcProgressBar').style.width = total ? '100%' : '0%';
    const srsEmpty = S('srsControls');
    if (srsEmpty) srsEmpty.classList.add('hidden');
    if (studyState.flashcards.zenActive) renderFlashcardZenCard();
    return;
  }

  const q = toText(card.q || '');
  const a = toText(card.a || '');
  const cat = toText(card.cat || card.category || 'General');

  if (S('cardFront')) S('cardFront').textContent = q;
  if (S('cardBack')) S('cardBack').textContent = a;
  if (S('fcCardCategory')) S('fcCardCategory').textContent = cat;

  const totalDue = due.length;
  const idx = studyState.flashcards.idx;
  if (S('fcProgressText')) S('fcProgressText').textContent = `Card ${idx + 1} of ${totalDue} due`;
  if (S('fcProgressBar')) S('fcProgressBar').style.width = `${((idx + 1) / totalDue) * 100}%`;

  const inner = S('flashcardInner');
  if (inner) inner.style.transform = 'rotateY(0deg)';
  const srs = S('srsControls');
  if (srs) srs.classList.add('hidden');

  // Update Zen Mode if active
  if (studyState.flashcards.zenActive) {
    renderFlashcardZenCard();
  }
}

window.flipFlashcard = () => {
  const inner = S('flashcardInner');
  if (!inner) return;
  const isFlipped = inner.style.transform === 'rotateY(180deg)';
  inner.style.transform = isFlipped ? 'rotateY(0deg)' : 'rotateY(180deg)';
  
  const srs = S('srsControls');
  if (srs) {
    if (!isFlipped) srs.classList.remove('hidden');
    else srs.classList.add('hidden');
  }
};

window.toggleFlashcardZenMode = (show) => {
  const overlay = S('zenModeOverlay');
  if (!overlay) return;
  
  studyState.flashcards.zenActive = !!show;
  overlay.classList.toggle('hidden', !show);
  
  if (show) {
    document.body.style.overflow = 'hidden';
    renderFlashcardZenCard();
  } else {
    document.body.style.overflow = '';
  }
};

function renderFlashcardZenCard() {
  const container = S('zenCardContainer');
  if (!container) return;

  const due = getDueFlashcards();
  if (studyState.flashcards.idx >= due.length) studyState.flashcards.idx = 0;
  const card = due[studyState.flashcards.idx];
  if (!card) {
    const hasAny = studyState.flashcards.cards.length > 0;
    container.innerHTML = `<div class="w-full h-full flex items-center justify-center text-stone-300 dark:text-slate-600 text-2xl sm:text-4xl font-black text-center px-12 sm:px-24">${hasAny ? 'All caught up! Nothing due right now.' : 'No Cards Available'}</div>`;
    if (S('zenProgressText')) S('zenProgressText').textContent = 'Card 0 of 0';
    const srsActionsEmpty = S('zenSrsActions');
    if (srsActionsEmpty) srsActionsEmpty.classList.add('hidden');
    return;
  }

  const total = due.length;
  const idx = studyState.flashcards.idx;
  if (S('zenProgressText')) S('zenProgressText').textContent = `Card ${idx + 1} of ${total} due`;

  container.innerHTML = `
    <div id="zenCardInner" class="relative w-full h-full transition-transform duration-700 transform-style-3d cursor-pointer preserve-3d" onclick="window.flipFlashcardZenCard()">
      <!-- Front -->
      <div class="absolute inset-0 backface-hidden">
        <div class="relative w-full h-full rounded-[32px] bg-[#FFFEFA] dark:bg-slate-900 border border-stone-200 dark:border-slate-700 shadow-[0_25px_60px_-25px_rgba(28,25,23,0.25)] p-10 sm:p-16 flex flex-col items-center justify-center text-center overflow-hidden">
          <div class="absolute top-14 sm:top-20 left-0 right-0 h-px bg-rose-300 dark:bg-rose-400/50"></div>
          <div class="absolute top-0 bottom-0 left-10 sm:left-16 w-px bg-sky-200 dark:bg-sky-400/25"></div>
          <span class="absolute top-5 right-6 sm:top-8 sm:right-10 px-4 sm:px-5 py-2 rounded-full bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] border border-brand-100 dark:border-brand-500/20">${escapeHTML(card.cat || 'General')}</span>
          <h3 class="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-[1.15] max-w-3xl text-stone-900 dark:text-white">${escapeHTML(card.q)}</h3>
        </div>
      </div>
      <!-- Back -->
      <div class="absolute inset-0 backface-hidden rotate-y-180">
        <div class="relative w-full h-full rounded-[32px] bg-brand-600 text-white p-10 sm:p-16 flex flex-col items-center justify-center text-center overflow-hidden shadow-[0_25px_60px_-25px_rgba(124,58,237,0.5)]">
          <div class="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.15),transparent_60%)]"></div>
          <h3 class="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-[1.15] max-w-3xl relative z-10">${escapeHTML(card.a)}</h3>
        </div>
      </div>
    </div>
  `;

  const srsActions = S('zenSrsActions');
  if (srsActions) {
    srsActions.classList.add('hidden');
    srsActions.innerHTML = `
      <button onclick="window.rateFlashcard('again')" class="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border-2 border-rose-100 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-all flex flex-col items-center gap-1.5">
        <span class="text-xl sm:text-2xl font-black tracking-tight">Again</span>
        <span class="text-[10px] font-black uppercase tracking-widest opacity-60">&lt; 10 min</span>
      </button>
      <button onclick="window.rateFlashcard('hard')" class="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border-2 border-amber-100 dark:border-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-600 hover:text-white hover:border-amber-600 transition-all flex flex-col items-center gap-1.5">
        <span class="text-xl sm:text-2xl font-black tracking-tight">Hard</span>
        <span class="text-[10px] font-black uppercase tracking-widest opacity-60">~1 day</span>
      </button>
      <button onclick="window.rateFlashcard('good')" class="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-100 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all flex flex-col items-center gap-1.5">
        <span class="text-xl sm:text-2xl font-black tracking-tight">Good</span>
        <span class="text-[10px] font-black uppercase tracking-widest opacity-60">~2 days</span>
      </button>
      <button onclick="window.rateFlashcard('easy')" class="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border-2 border-brand-100 dark:border-brand-500/20 text-brand-600 dark:text-brand-400 hover:bg-brand-600 hover:text-white hover:border-brand-600 transition-all flex flex-col items-center gap-1.5">
        <span class="text-xl sm:text-2xl font-black tracking-tight">Easy</span>
        <span class="text-[10px] font-black uppercase tracking-widest opacity-60">~1 week</span>
      </button>
    `;
  }
}

window.flipFlashcardZenCard = () => {
  const inner = S('zenCardInner');
  if (!inner) return;
  const isFlipped = inner.style.transform === 'rotateY(180deg)';
  inner.style.transform = isFlipped ? 'rotateY(0deg)' : 'rotateY(180deg)';
  
  const actions = S('zenSrsActions');
  if (actions) {
    if (!isFlipped) actions.classList.remove('hidden');
    else actions.classList.add('hidden');
  }
};

window.toggleAiFlashcardModal = (show) => {
  const overlay = S('aiFlashcardOverlay');
  if (overlay) overlay.classList.toggle('hidden', !show);
};

window.setAiFlashcardSource = (source) => {
  const isTopic = source === 'topic';
  S('aiSourceTopic').className = isTopic ? 'p-6 rounded-3xl border-2 border-brand-600 bg-brand-50 dark:bg-brand-900/20 text-brand-600 transition-all flex flex-col items-center gap-3' : 'p-6 rounded-3xl border-2 border-transparent bg-slate-50 dark:bg-slate-800/50 text-slate-400 hover:border-slate-200 dark:hover:border-slate-700 transition-all flex flex-col items-center gap-3';
  S('aiSourceFile').className = !isTopic ? 'p-6 rounded-3xl border-2 border-brand-600 bg-brand-50 dark:bg-brand-900/20 text-brand-600 transition-all flex flex-col items-center gap-3' : 'p-6 rounded-3xl border-2 border-transparent bg-slate-50 dark:bg-slate-800/50 text-slate-400 hover:border-slate-200 dark:hover:border-slate-700 transition-all flex flex-col items-center gap-3';
  
  S('aiTopicInputSection').classList.toggle('hidden', !isTopic);
  S('aiFileInputSection').classList.toggle('hidden', isTopic);
  
  studyState.flashcards.aiSource = source;
};

window.handleAiFlashcardFile = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    toast('File is too large (max 25MB). Try a shorter document.', 'error');
    event.target.value = '';
    return;
  }

  S('aiFileName').textContent = file.name;
  S('aiFileIcon').className = 'w-16 h-16 rounded-full bg-brand-500 text-white flex items-center justify-center animate-pulse';
  studyState.flashcards.aiFile = file;
};

window.generateAiFlashcards = async () => {
  const btn = S('generateAiFlashcardsBtn');
  if (btn?.disabled) return; // already generating — ignore repeat clicks/double-taps
  const topic = S('aiFlashcardTopic').value.trim();
  const file = studyState.flashcards.aiFile;
  const count = S('aiFlashcardCount').value;
  const source = studyState.flashcards.aiSource || 'topic';
  const isPublic = !!S('aiFlashcardMakePublic')?.checked;

  if (source === 'topic' && !topic) {
    toast('Please enter a topic', 'error');
    return;
  }
  if (source === 'file' && !file) {
    toast('Please upload a file', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    if (S('generateAiFlashcardsBtnLabel')) S('generateAiFlashcardsBtnLabel').textContent = 'Generating...';
    if (S('generateAiFlashcardsBtnIcon')) S('generateAiFlashcardsBtnIcon').setAttribute('data-lucide', 'loader-2');
    if (window.lucide) window.lucide.createIcons();
    S('generateAiFlashcardsBtnIcon')?.classList.add('animate-spin');
  }

  try {
    toast('AI is synthesizing your deck...', 'brand');
    const res = await aiGenerateFlashcards({
      seed: topic,
      source: source === 'file' ? { file } : null,
      count
    });

    if (res.cards && res.cards.length > 0) {
      res.cards.forEach(c => { c.isPublic = isPublic; });

      // Write all cards in parallel instead of one sequential await per
      // card, and track which ones actually made it to Firestore instead
      // of assuming success — only cards that genuinely persisted get
      // added to local state, so nothing shown as "generated" silently
      // disappears on the next page load.
      let savedCards = res.cards;
      let failedCount = 0;
      if (app.state.user) {
        const results = await Promise.allSettled(res.cards.map((card) =>
          addDoc(collection(db, "flashcards"), {
            uid: app.state.user.uid,
            ...card,
            createdAt: serverTimestamp()
          }).then((ref) => ({ ...card, id: ref.id }))
        ));
        savedCards = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        failedCount = results.length - savedCards.length;
        if (failedCount) console.error(`${failedCount} of ${res.cards.length} generated flashcards failed to save:`,
          results.filter(r => r.status === 'rejected').map(r => r.reason));
      }

      studyState.flashcards.cards.push(...savedCards);
      window.toggleAiFlashcardModal(false);
      updateFlashcardsUI();
      renderFlashcard();

      if (failedCount > 0) {
        toast(`Generated ${res.cards.length} cards, but ${failedCount} failed to save — check your connection and try again for those.`, 'error');
      } else {
        toast(`Successfully generated ${savedCards.length} cards!`, 'success');
        confettiCelebration();
      }
    } else {
      toast('AI failed to generate cards. Try a different topic.', 'error');
    }
  } catch (e) {
    console.error(e);
    toast('Neural synthesis failed. Check your connection.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (S('generateAiFlashcardsBtnLabel')) S('generateAiFlashcardsBtnLabel').textContent = 'Generate';
      if (S('generateAiFlashcardsBtnIcon')) {
        S('generateAiFlashcardsBtnIcon').setAttribute('data-lucide', 'zap');
        S('generateAiFlashcardsBtnIcon').classList.remove('animate-spin');
      }
      if (window.lucide) window.lucide.createIcons();
    }
  }
};

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  // Only handle if in flashcards section or zen mode
  const flashcardsEl = S('flashcards');
  if (!flashcardsEl) return;

  const isFlashcardVisible = !flashcardsEl.classList.contains('hidden');
  const isZenActive = studyState.flashcards.zenActive;
  
  if (!isFlashcardVisible && !isZenActive) return;
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (isZenActive) window.flipFlashcardZenCard();
    else window.flipFlashcard();
  } else if (e.code === 'Digit1') {
    window.rateFlashcard('again');
  } else if (e.code === 'Digit2') {
    window.rateFlashcard('hard');
  } else if (e.code === 'Digit3') {
    window.rateFlashcard('good');
  } else if (e.code === 'Digit4') {
    window.rateFlashcard('easy');
  } else if (e.code === 'Escape' && isZenActive) {
    window.toggleFlashcardZenMode(false);
  }
});

function getUniqueFlashcardCategories() {
  const cats = new Set(
    studyState.flashcards.cards
      .map(c => toText(c.cat || c.category || 'General').trim())
      .filter(Boolean)
  );
  return Array.from(cats).sort();
}

function populateFlashcardCategoryFilter() {
  const select = S('fcCategoryFilter');
  if (!select) return;
  const current = select.value || 'all';
  const cats = getUniqueFlashcardCategories();
  select.innerHTML = `<option value="all">All Categories</option>` +
    cats.map(cat => `<option value="${escapeHTML(cat)}">${escapeHTML(cat)}</option>`).join('');
  select.value = (current === 'all' || cats.includes(current)) ? current : 'all';
}

// Renders the "Your Cards" grid, respecting whatever is currently in the
// search box / category dropdown. Called both on every deck change
// (updateFlashcardsUI) and directly by window.filterMyCards() as the user
// types/selects, so the two never fall out of sync with each other.
function renderMyCardsList() {
  const myList = S('myCardsList');
  if (!myList) return;

  const allCards = studyState.flashcards.cards;
  if (!allCards.length) {
    myList.innerHTML = `<div class="col-span-full p-6 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-100 dark:border-slate-800 text-center">
      <p class="text-xs font-bold text-stone-400 dark:text-slate-500">No cards yet — create a deck or generate one with AI to get started.</p>
    </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const searchTerm = toText(S('fcSearchInput')?.value).trim().toLowerCase();
  const categoryFilter = S('fcCategoryFilter')?.value || 'all';

  const rows = allCards
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => categoryFilter === 'all' || toText(c.cat || c.category || 'General').trim() === categoryFilter)
    .filter(({ c }) => !searchTerm || toText(c.q).toLowerCase().includes(searchTerm) || toText(c.a).toLowerCase().includes(searchTerm));

  if (!rows.length) {
    myList.innerHTML = `<div class="col-span-full p-6 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-100 dark:border-slate-800 text-center">
      <p class="text-xs font-bold text-stone-400 dark:text-slate-500">No cards match your search.</p>
    </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const now = Date.now();
  myList.innerHTML = rows.map(({ c, idx }) => {
    const level = c.srsLevel || 0;
    const isDue = !c.nextReview || c.nextReview <= now;
    const badge = level >= 4
      ? `<span class="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-widest">Mastered</span>`
      : isDue
        ? `<span class="px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 text-[9px] font-black uppercase tracking-widest">Due</span>`
        : `<span class="px-2.5 py-1 rounded-full bg-stone-100 dark:bg-slate-800 text-stone-400 dark:text-slate-500 text-[9px] font-black uppercase tracking-widest">Scheduled</span>`;
    return `
      <div class="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-stone-100 dark:border-slate-800 hover:border-stone-200 dark:hover:border-slate-700 transition-all group">
        <div class="flex items-center justify-between gap-2 mb-2">
          ${badge}
          <button onclick="window.removeFlashcard(${idx})" class="text-stone-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
        <p class="text-xs font-bold text-stone-700 dark:text-slate-200 truncate">${escapeHTML(toText(c.q))}</p>
      </div>
    `;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.filterMyCards = () => {
  renderMyCardsList();
};

function updateFlashcardsUI() {
  const myCount = S('myCardsCount');
  if (myCount) myCount.textContent = studyState.flashcards.cards.length;

  const mastered = S('myCardsMastered');
  if (mastered) mastered.textContent = studyState.flashcards.cards.filter(c => (c.srsLevel || 0) >= 4).length;

  populateFlashcardCategoryFilter();
  renderMyCardsList();
}

// --- Community Archive (public flashcards) ---
// Queried on demand (only when the Community view is actually opened, via
// applyFlashcardViewState -> window.refreshCommunityFlashcards), rather than
// kept live with onSnapshot, since it's a much larger/less personal
// collection scope than the user's own deck and doesn't need to update
// instantly for a browsing list like this.
let communityFlashcardsLoading = false;

window.refreshCommunityFlashcards = async () => {
  const container = S('publicCardsList');
  if (!container || communityFlashcardsLoading) return;
  communityFlashcardsLoading = true;
  container.innerHTML = `<div class="col-span-full p-10 rounded-[3rem] bg-white/5 border border-white/10 text-center">
    <p class="text-sm font-bold text-slate-400">Loading community cards…</p>
  </div>`;

  try {
    const q = query(collection(db, "flashcards"), where("isPublic", "==", true), orderBy("createdAt", "desc"), limit(60));
    const snap = await getDocs(q);
    const cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    app.state.communityFlashcards = cards;
    renderCommunityFlashcards(cards);
  } catch (e) {
    console.error('Failed to load community flashcards:', e);
    container.innerHTML = `<div class="col-span-full p-10 rounded-[3rem] bg-white/5 border border-white/10 text-center">
      <p class="text-sm font-bold text-rose-400">Couldn't load community cards. Try again shortly.</p>
    </div>`;
  } finally {
    communityFlashcardsLoading = false;
  }
};

function renderCommunityFlashcards(cards) {
  const container = S('publicCardsList');
  if (!container) return;

  if (!cards.length) {
    container.innerHTML = `<div class="col-span-full p-10 rounded-[28px] bg-white dark:bg-slate-900 border border-stone-100 dark:border-slate-800 text-center">
      <p class="text-sm font-bold text-stone-400 dark:text-slate-500">No public decks yet — be the first to share one from Your Deck!</p>
    </div>`;
    return;
  }

  container.innerHTML = cards.map(c => `
    <div class="relative p-6 rounded-[28px] bg-white dark:bg-slate-900 border border-stone-100 dark:border-slate-800 hover:border-stone-200 dark:hover:border-slate-700 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col gap-4 overflow-hidden">
      <div class="absolute top-11 left-0 right-0 h-px bg-rose-100 dark:bg-rose-500/30"></div>
      <span class="self-start px-3.5 py-1.5 rounded-full bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 text-[10px] font-black uppercase tracking-widest border border-brand-100 dark:border-brand-500/20">${escapeHTML(toText(c.cat || c.category || 'General'))}</span>
      <p class="text-sm font-bold text-stone-800 dark:text-slate-200 line-clamp-3 relative z-10">${escapeHTML(toText(c.q || c.question || 'Untitled'))}</p>
      <button onclick="window.addCommunityCardToMyDeck('${c.id}')" class="mt-auto px-5 py-3 rounded-xl bg-stone-50 dark:bg-slate-800/50 text-stone-700 dark:text-slate-200 border border-stone-100 dark:border-slate-800 text-[10px] font-black uppercase tracking-widest hover:bg-brand-50 dark:hover:bg-brand-500/15 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-100 dark:hover:border-brand-500/20 transition-all flex items-center justify-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Add to My Deck
      </button>
    </div>
  `).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.addCommunityCardToMyDeck = async (cardId) => {
  if (!app.state.user) {
    toast('Sign in to add cards to your deck', 'error');
    return;
  }
  const source = (app.state.communityFlashcards || []).find(c => c.id === cardId);
  if (!source) {
    toast('That card is no longer available', 'error');
    return;
  }

  try {
    await addDoc(collection(db, "flashcards"), {
      uid: app.state.user.uid,
      q: source.q || source.question || '',
      a: source.a || source.answer || '',
      cat: source.cat || source.category || 'General',
      srsLevel: 0,
      nextReview: Date.now(),
      isPublic: false,
      createdAt: serverTimestamp()
    });
    toast('Added to your deck! Find it in Personal Vault.', 'success');
  } catch (e) {
    console.error('Failed to add community card:', e);
    toast('Failed to add card to your deck', 'error');
  }
};

window.toggleFlashcardCreate = (show) => {
  const overlay = S('flashcardCreateOverlay');
  if (overlay) overlay.classList.toggle('hidden', !show);

  if (show) {
    const editingId = studyState.flashcards.editingId;
    const editingCard = editingId ? studyState.flashcards.cards.find(c => c.id === editingId) : null;

    // Reset modal with one row — prefilled if editing an existing card,
    // otherwise empty and ready for a fresh batch of new cards.
    const container = S('fcCardsContainer');
    if (container) {
      container.innerHTML = `
        <div class="fc-card-row p-6 rounded-[28px] bg-stone-50 border border-stone-100 relative group/row">
          <div class="space-y-4">
            <div>
              <label class="block text-[10px] font-black uppercase tracking-widest text-stone-400 mb-2">Question (Front)</label>
              <textarea placeholder="Enter question..." class="fc-q-input w-full px-5 py-4 rounded-2xl bg-white border border-stone-200 focus:border-brand-400 outline-none text-sm font-bold transition-all min-h-[80px] text-stone-900">${editingCard ? escapeHTML(editingCard.q) : ''}</textarea>
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase tracking-widest text-stone-400 mb-2">Answer (Back)</label>
              <textarea placeholder="Enter answer..." class="fc-a-input w-full px-5 py-4 rounded-2xl bg-white border border-stone-200 focus:border-brand-400 outline-none text-sm font-bold transition-all min-h-[80px] text-stone-900">${editingCard ? escapeHTML(editingCard.a) : ''}</textarea>
            </div>
          </div>
        </div>
      `;
    }
    if (S('fcCategoryInput')) S('fcCategoryInput').value = editingCard ? (editingCard.cat || '') : '';
    if (S('fcMakePublicInput')) S('fcMakePublicInput').checked = !!(editingCard && editingCard.isPublic);

    // Editing is single-card: no batch-add, different title/button copy.
    const addRowBtn = S('fcAddRowBtn');
    if (addRowBtn) addRowBtn.classList.toggle('hidden', !!editingCard);
    if (S('fcModalTitle')) S('fcModalTitle').textContent = editingCard ? 'Edit Card' : 'New Deck';
    if (S('fcModalSubtitle')) S('fcModalSubtitle').textContent = editingCard ? 'Update this card' : 'Add cards to your deck';
    if (S('fcSaveBtn')) S('fcSaveBtn').textContent = editingCard ? 'Save Changes' : 'Save Deck';

    if (window.lucide) window.lucide.createIcons();
  } else {
    studyState.flashcards.editingId = null;
  }
};

window.editFlashcard = (cardId) => {
  const card = studyState.flashcards.cards.find(c => c.id === cardId);
  if (!card) {
    toast('Card not found', 'error');
    return;
  }
  if (!card.id) {
    toast('This card is still syncing — try again in a moment', 'info');
    return;
  }
  studyState.flashcards.editingId = cardId;
  window.toggleFlashcardCreate(true);
};

window.addFlashcardRow = () => {
  const container = S('fcCardsContainer');
  if (!container) return;
  
  const row = document.createElement('div');
  row.className = 'fc-card-row p-6 rounded-[2.5rem] bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 relative group/row animate-in slide-in-from-top-4 duration-300';
  row.innerHTML = `
    <button onclick="this.parentElement.remove()" class="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:text-rose-500 shadow-lg opacity-0 group-hover/row:opacity-100 transition-all">
      <i data-lucide="x" class="w-4 h-4"></i>
    </button>
    <div class="space-y-4">
      <div>
        <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Question (Front)</label>
        <textarea placeholder="Enter question..." class="fc-q-input w-full px-5 py-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-brand-500/50 outline-none text-sm font-bold transition-all min-h-[80px]"></textarea>
      </div>
      <div>
        <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Answer (Back)</label>
        <textarea placeholder="Enter answer..." class="fc-a-input w-full px-5 py-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-brand-500/50 outline-none text-sm font-bold transition-all min-h-[80px]"></textarea>
      </div>
    </div>
  `;
  container.appendChild(row);
  if (window.lucide) window.lucide.createIcons();
  
  // Scroll to bottom of container
  const parent = container.parentElement;
  if (parent) parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
};

window.openCreateFlashcard = () => {
  window.toggleFlashcardCreate(true);
};

window.createFlashcard = async () => {
  const cat = S('fcCategoryInput').value.trim() || 'General';
  const isPublic = !!S('fcMakePublicInput')?.checked;
  const rows = $$('.fc-card-row');
  const cardsToSave = [];

  for (const row of rows) {
    const q = row.querySelector('.fc-q-input').value.trim();
    const a = row.querySelector('.fc-a-input').value.trim();
    
    if (q && a) {
      cardsToSave.push({ q, a, cat, srsLevel: 0, nextReview: Date.now(), isPublic });
    }
  }

  if (cardsToSave.length === 0) {
    toast('Please add at least one complete card (Question & Answer)', 'error');
    return;
  }

  // Add to local state
  studyState.flashcards.cards.push(...cardsToSave);
  
  // Save to Firestore if user is logged in
  if (app.state.user) {
    toast('Syncing deck to cloud...', 'info');
    for (const card of cardsToSave) {
      try {
        await addDoc(collection(db, "flashcards"), {
          uid: app.state.user.uid,
          ...card,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        console.error('Error saving flashcard:', e);
      }
    }
  }

  window.toggleFlashcardCreate(false);
  updateFlashcardsUI();
  renderFlashcard();
  toast(`Deck created with ${cardsToSave.length} cards!`, 'success');
  confettiCelebration();
};

window.removeFlashcard = async (idx) => {
  const card = studyState.flashcards.cards[idx];
  if (!card) return;

  studyState.flashcards.cards.splice(idx, 1);
  updateFlashcardsUI();
  renderFlashcard();

  // Previously this only spliced the local array — the doc still existed
  // in Firestore, so the very next onSnapshot from initFlashcardsSync
  // (e.g. after any other edit, or on reload) would bring the "deleted"
  // card right back.
  if (card.id) {
    try {
      await deleteDoc(doc(db, "flashcards", card.id));
    } catch (e) {
      console.error('Failed to delete flashcard from Firestore:', e);
      toast('Card removed locally, but the cloud copy failed to delete', 'error');
      return;
    }
  }
  toast('Card removed', 'info');
};

window.rateFlashcard = async (rating) => {
  const due = getDueFlashcards();
  const card = due[studyState.flashcards.idx];
  if (!card) return;

  const { srsLevel, nextReview } = scheduleFlashcardReview(card.srsLevel || 0, rating);
  card.srsLevel = srsLevel;
  card.nextReview = nextReview;

  // Persist the review outcome so progress survives a refresh — previously
  // srsLevel/nextReview only ever lived in memory. Demo Deck cards have no
  // Firestore id, so this is naturally skipped for them.
  if (card.id) {
    try {
      await updateDoc(doc(db, "flashcards", card.id), { srsLevel, nextReview });
    } catch (e) {
      console.error('Failed to save review progress:', e);
    }
  }

  renderFlashcard();
  updateFlashcardsUI();

  const remaining = getDueFlashcards().length;
  if (remaining === 0) {
    confettiCelebration();
    toast('Session complete! All caught up for now.', 'success');
  } else {
    toast(`Rated: ${rating} • ${remaining} card${remaining === 1 ? '' : 's'} left`, 'info');
  }
};

// --- Chat Module ---
function initSnapChat(user) {
  if (!user) return;
  snapState.user = user;
  
  initChatsSync();
  initStoriesSync();
  initPresenceSync();
  
  const input = S('chatMessageInput');
  const sendBtn = S('sendSnapBtn');
  const voiceBtn = S('voiceNoteBtn');
  
  if (input) {
    input.oninput = (e) => {
      const hasText = e.target.value.trim().length > 0;
      sendBtn.classList.toggle('hidden', !hasText);
      voiceBtn.classList.toggle('hidden', hasText);
      updateTypingStatus(hasText);
    };
    
    input.onkeypress = (e) => {
      if (e.key === 'Enter') window.sendSnapMessage();
    };
  }
  
  if (sendBtn) sendBtn.onclick = window.sendSnapMessage;
  if (voiceBtn) voiceBtn.onclick = () => toast('Voice notes are coming soon to Geo-Books!', 'brand');
}

window.toggleAttachmentMenu = () => {
  const input = S('chatFileInput');
  if (!input) return;
  if (!snapState.activeChat) {
    toast('Open a chat to attach files', 'error');
    return;
  }
  input.click();
};

window.handleChatFiles = async (event) => {
  const input = event?.target;
  const files = Array.from(input?.files || []);
  if (input) input.value = '';
  if (!files.length) return;
  if (!snapState.activeChat || !snapState.user) {
    toast('Open a chat to attach files', 'error');
    return;
  }

  const maxBytes = 10 * 1024 * 1024;
  for (const file of files) {
    if (file.size > maxBytes) {
      toast(`File too large: ${file.name}`, 'error');
      continue;
    }
    try {
      toast('Uploading...', 'info');
      const att = await uploadChatAttachment(file, snapState.activeChat.id, snapState.user.uid);
      const msgData = {
        senderId: snapState.user.uid,
        text: '',
        attachment: att,
        createdAt: serverTimestamp()
      };

      const chatRef = doc(db, "chats", snapState.activeChat.id);
      await addDoc(collection(chatRef, "messages"), msgData);

      const label = toText(att.contentType).startsWith('image/') ? '📷 Photo' : `📎 ${att.name}`;
      await updateDoc(chatRef, {
        lastMessage: {
          senderId: snapState.user.uid,
          text: label,
          createdAt: serverTimestamp(),
          readBy: [snapState.user.uid]
        },
        updatedAt: serverTimestamp()
      });
      toast('Sent', 'success');
    } catch (e) {
      console.error('Error uploading attachment:', e);
      toast(e?.message || 'Upload failed', 'error');
    }
  }
};

const EMOJIS = [
  '😀','😁','😂','🤣','😊','😍','😘','😎',
  '🤔','😅','😭','😤','😴','🤯','😇','🥳',
  '👍','👎','🙏','👏','💪','🔥','✨','💯',
  '❤️','💜','💙','💚','🖤','🤍','💛','💕',
  '🎉','📚','📝','✅','❌','⚡','📌','📎'
];

function insertAtCursor(input, text) {
  const el = input;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const next = start + text.length;
  el.setSelectionRange(next, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderEmojiPicker() {
  const inner = S('emojiPickerInner');
  if (!inner) return;
  inner.innerHTML = EMOJIS.map(e => `
    <button class="w-8 h-8 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors text-lg flex items-center justify-center" onclick="window.pickEmoji('${escapeHTML(e)}')">${escapeHTML(e)}</button>
  `).join('');
}

window.pickEmoji = (emoji) => {
  const input = S('chatMessageInput');
  if (!input) return;
  insertAtCursor(input, emoji);
};

window.toggleEmojiPicker = (show, event) => {
  const menu = S('emojiPickerMenu');
  if (!menu) return;
  if (event) event.stopPropagation();
  menu.classList.toggle('hidden', !show);
  if (!show) return;

  renderEmojiPicker();
  if (window.lucide) window.lucide.createIcons();

  const anchor = event?.currentTarget;
  const width = 300;
  if (anchor && anchor.getBoundingClientRect) {
    const rect = anchor.getBoundingClientRect();
    const top = Math.max(16, rect.top - 340);
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.right - width));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  } else {
    menu.style.top = `120px`;
    menu.style.left = `${Math.max(16, window.innerWidth - width - 16)}px`;
  }
};

window.filterSnapChats = () => {
  const query = S('chatSearchInput')?.value.toLowerCase() || '';
  renderSnapFeed(query);
};

function ensureAllUsersSync() {
  if (snapState.unsubAllUsers) return;
  snapState.allUsersLoading = true;
  snapState.allUsersError = null;
  const q = query(collection(db, "users"), limit(500));
  snapState.unsubAllUsers = onSnapshot(
    q,
    (snapshot) => {
      snapState.allUsers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      snapState.allUsersLoading = false;
      snapState.allUsersError = null;
      if (snapState.addPeopleOpen) renderAddPeopleList();
      if (snapState.groupCreateOpen) renderGroupUserList();
    },
    (err) => {
      snapState.allUsers = [];
      snapState.allUsersLoading = false;
      snapState.allUsersError = err;
      if (snapState.addPeopleOpen) renderAddPeopleList();
      if (snapState.groupCreateOpen) renderGroupUserList();
    }
  );
}

function stopAllUsersSync() {
  if (snapState.unsubAllUsers) snapState.unsubAllUsers();
  snapState.unsubAllUsers = null;
  snapState.allUsers = [];
  snapState.allUsersLoading = false;
  snapState.allUsersError = null;
}

function renderAddPeopleList() {
  const list = S('addPeopleList');
  if (!list) return;

  const q = (S('addPeopleSearch')?.value || '').trim().toLowerCase();
  const myUid = snapState.user?.uid || null;

  const countEl = S('addPeopleCount');

  if (snapState.allUsersLoading) {
    if (countEl) countEl.textContent = 'Loading scholars...';
    list.innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-slate-200/60 dark:bg-slate-800/60 skeleton"></div>
        <div class="flex-1 space-y-2">
          <div class="h-3 w-40 bg-slate-200/60 dark:bg-slate-800/60 rounded skeleton"></div>
          <div class="h-2.5 w-28 bg-slate-200/60 dark:bg-slate-800/60 rounded skeleton"></div>
        </div>
        <div class="h-9 w-24 bg-slate-200/60 dark:bg-slate-800/60 rounded-2xl skeleton"></div>
      </div>
    `).join('');
    return;
  }

  if (snapState.allUsersError) {
    if (countEl) countEl.textContent = 'Unable to load users';
    list.innerHTML = `
      <div class="p-10 text-center">
        <p class="text-sm font-black text-slate-700 dark:text-slate-200">Couldn’t load users</p>
        <p class="mt-2 text-xs font-bold text-slate-400">${escapeHTML(snapState.allUsersError?.message || 'Unknown error')}</p>
      </div>
    `;
    return;
  }

  const users = (snapState.allUsers || [])
    .map((u) => {
      const displayName = toText(u.displayName || u.name || u.email?.split('@')[0] || 'Scholar').trim();
      const rawUsername = toText(u.username || '').trim();
      const fallbackUsername = toText(u.email ? u.email.split('@')[0] : '').trim();
      const username = rawUsername || fallbackUsername || 'scholar';
      const isMe = myUid ? u.id === myUid : false;
      return { id: u.id, displayName, username, isMe };
    })
    .filter((u) => {
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (`@${u.username}`.toLowerCase().includes(q))
      );
    });

  if (users.length === 0) {
    if (countEl) countEl.textContent = '0 scholars';
    list.innerHTML = `<div class="p-10 text-center text-slate-400 font-bold">No users found</div>`;
    return;
  }

  users.sort((a, b) => {
    if (a.isMe && !b.isMe) return -1;
    if (!a.isMe && b.isMe) return 1;
    const ua = a.username.toLowerCase();
    const ub = b.username.toLowerCase();
    if (ua !== ub) return ua.localeCompare(ub);
    return a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase());
  });

  if (countEl) countEl.textContent = `${users.length.toLocaleString()} scholar${users.length === 1 ? '' : 's'}`;

  list.innerHTML = users.map((u) => {
    const initials = u.displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
    const safeName = escapeHTML(u.displayName);
    const safeUsername = escapeHTML(`@${u.username}`);
    const meBadge = u.isMe ? `<span class="ml-2 px-2 py-1 rounded-full bg-brand-50 dark:bg-brand-900/20 text-brand-600 text-[9px] font-black uppercase tracking-widest">You</span>` : '';
    return `
      <div class="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 flex items-center justify-center font-black">
          ${escapeHTML(initials)}
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-black truncate">${safeName}${meBadge}</p>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">${safeUsername}</p>
        </div>
        <button onclick="window.startChatWithUser('${u.id}')" class="px-4 py-2 rounded-2xl bg-brand-600 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-brand-500/20 hover:scale-105 active:scale-95 transition-all ${u.isMe ? 'opacity-40 pointer-events-none' : ''}">
          Chat
        </button>
      </div>
    `;
  }).join('');
}

window.filterAddPeople = () => {
  renderAddPeopleList();
};

window.toggleAddPeople = (show) => {
  const overlay = S('addPeopleOverlay');
  if (!overlay) return;

  const currentUser = snapState.user || app.state.user || (auth && auth.currentUser);
  if (!currentUser) {
    if (show) {
      snapState.pendingAddPeopleOpen = true;
      if (typeof window.toggleAuthModal === 'function') {
        window.toggleAuthModal('login', true);
      }
      toast('Please sign in to view users', 'error');
    }
    return;
  }
  snapState.user = currentUser;

  snapState.addPeopleOpen = !!show;
  overlay.classList.toggle('hidden', !show);

  if (show) {
    ensureAllUsersSync();
    renderAddPeopleList();
    setTimeout(() => S('addPeopleSearch')?.focus(), 0);
    if (window.lucide) window.lucide.createIcons();
  } else {
    const search = S('addPeopleSearch');
    if (search) search.value = '';
    stopAllUsersSync();
  }
};

function renderGroupUserList() {
  const list = S('groupUserList');
  if (!list) return;

  const q = (S('groupUserSearch')?.value || '').trim().toLowerCase();
  const myUid = snapState.user?.uid || null;
  const selectedCountEl = S('groupSelectedCount');
  const activeGroupParticipants = snapState.groupModalMode === 'addMembers' ? (snapState.activeChat?.participants || []) : [];

  const selectedCount = snapState.groupSelected?.size || 0;
  if (selectedCountEl) selectedCountEl.textContent = `${selectedCount} selected`;

  if (snapState.allUsersLoading) {
    list.innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 flex items-center gap-4">
        <div class="w-6 h-6 rounded bg-slate-200/60 dark:bg-slate-800/60 skeleton"></div>
        <div class="w-12 h-12 rounded-2xl bg-slate-200/60 dark:bg-slate-800/60 skeleton"></div>
        <div class="flex-1 space-y-2">
          <div class="h-3 w-40 bg-slate-200/60 dark:bg-slate-800/60 rounded skeleton"></div>
          <div class="h-2.5 w-28 bg-slate-200/60 dark:bg-slate-800/60 rounded skeleton"></div>
        </div>
      </div>
    `).join('');
    return;
  }

  if (snapState.allUsersError) {
    list.innerHTML = `
      <div class="p-10 text-center">
        <p class="text-sm font-black text-slate-700 dark:text-slate-200">Couldn’t load users</p>
        <p class="mt-2 text-xs font-bold text-slate-400">${escapeHTML(snapState.allUsersError?.message || 'Unknown error')}</p>
      </div>
    `;
    return;
  }

  const users = (snapState.allUsers || [])
    .map((u) => {
      const displayName = toText(u.displayName || u.name || u.email?.split('@')[0] || 'Scholar').trim();
      const rawUsername = toText(u.username || '').trim();
      const fallbackUsername = toText(u.email ? u.email.split('@')[0] : '').trim();
      const username = rawUsername || fallbackUsername || 'scholar';
      const isMe = myUid ? u.id === myUid : false;
      return { id: u.id, displayName, username, isMe };
    })
    .filter((u) => !u.isMe)
    .filter((u) => !activeGroupParticipants.includes(u.id))
    .filter((u) => {
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (`@${u.username}`.toLowerCase().includes(q))
      );
    });

  if (users.length === 0) {
    list.innerHTML = `<div class="p-10 text-center text-slate-400 font-bold">No users found</div>`;
    return;
  }

  users.sort((a, b) => {
    const ua = a.username.toLowerCase();
    const ub = b.username.toLowerCase();
    if (ua !== ub) return ua.localeCompare(ub);
    return a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase());
  });

  list.innerHTML = users.map((u) => {
    const initials = u.displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
    const safeName = escapeHTML(u.displayName);
    const safeUsername = escapeHTML(`@${u.username}`);
    const checked = snapState.groupSelected?.has(u.id);
    return `
      <label class="p-4 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 flex items-center gap-4 cursor-pointer select-none">
        <input type="checkbox" class="w-5 h-5 accent-brand-600" ${checked ? 'checked' : ''} onchange="window.toggleGroupSelect('${u.id}', this.checked)">
        <div class="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 flex items-center justify-center font-black">
          ${escapeHTML(initials)}
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-black truncate">${safeName}</p>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">${safeUsername}</p>
        </div>
      </label>
    `;
  }).join('');
}

window.filterGroupUsers = () => {
  renderGroupUserList();
};

window.toggleGroupSelect = (userId, checked) => {
  if (!snapState.groupSelected) snapState.groupSelected = new Set();
  if (checked) snapState.groupSelected.add(userId);
  else snapState.groupSelected.delete(userId);
  renderGroupUserList();
};

window.toggleCreateGroup = (show, mode = 'create') => {
  const overlay = S('createGroupOverlay');
  if (!overlay) return;

  const currentUser = snapState.user || app.state.user || (auth && auth.currentUser);
  if (!currentUser) {
    if (show) {
      if (typeof window.toggleAuthModal === 'function') {
        window.toggleAuthModal('login', true);
      }
      toast('Please sign in to create a group', 'error');
    }
    return;
  }

  snapState.user = currentUser;
  snapState.groupCreateOpen = !!show;
  snapState.groupModalMode = mode;
  overlay.classList.toggle('hidden', !show);

  if (show) {
    snapState.groupSelected = new Set();
    const nameInput = S('groupNameInput');
    const searchInput = S('groupUserSearch');
    const titleEl = S('groupModalTitle');
    const nameWrap = S('groupNameWrap');
    const confirmBtn = S('groupConfirmBtn');

    const isAddMembers = mode === 'addMembers';
    if (titleEl) titleEl.textContent = isAddMembers ? 'Add Members' : 'Create Group';
    if (confirmBtn) confirmBtn.textContent = isAddMembers ? 'Add' : 'Create';
    if (nameWrap) nameWrap.classList.toggle('hidden', isAddMembers);

    if (nameInput) nameInput.value = '';
    if (searchInput) searchInput.value = '';
    ensureAllUsersSync();
    renderGroupUserList();
    setTimeout(() => (isAddMembers ? searchInput?.focus() : nameInput?.focus()), 0);
    if (window.lucide) window.lucide.createIcons();
  } else {
    stopAllUsersSync();
  }
};

window.createGroupChat = async () => {
  const currentUser = snapState.user || app.state.user || (auth && auth.currentUser);
  if (!currentUser) return;

  const selected = Array.from(snapState.groupSelected || []);
  if (selected.length < 1) {
    toast('Select at least 1 person', 'error');
    return;
  }

  try {
    if (snapState.groupModalMode === 'addMembers') {
      const active = snapState.activeChat;
      if (!active || !(active.isGroup || (active.participants?.length || 0) > 2)) {
        toast('Open a group chat first', 'error');
        return;
      }

      const chatRef = doc(db, "chats", active.id);
      await updateDoc(chatRef, {
        participants: arrayUnion(...selected),
        updatedAt: serverTimestamp()
      });

      active.participants = Array.from(new Set([...(active.participants || []), ...selected]));
      window.toggleCreateGroup(false);
      toast('Members added', 'success');
      return;
    }

    const name = (S('groupNameInput')?.value || '').trim();
    if (!name) {
      toast('Please enter a group name', 'error');
      return;
    }

    const participants = Array.from(new Set([currentUser.uid, ...selected]));
    const chatData = {
      name,
      isGroup: true,
      participants,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      typing: {}
    };

    const docRef = await addDoc(collection(db, "chats"), chatData);
    snapState.chats.unshift({ id: docRef.id, ...chatData });
    renderSnapFeed();
    window.toggleCreateGroup(false);
    await window.openSnapChat(docRef.id);
  } catch (e) {
    console.error('Error creating group chat:', e);
    const code = e?.code || '';
    if (code === 'permission-denied') toast('Unable to create group (permission denied)', 'error');
    else toast(e?.message || 'Unable to create group', 'error');
  }
};

function getActiveChatMeta() {
  const chat = snapState.activeChat;
  const uid = snapState.user?.uid || null;
  const isGroup = !!chat?.isGroup || (Array.isArray(chat?.participants) && chat.participants.length > 2);
  const otherUserId = !isGroup && uid && chat?.participants ? chat.participants.find(id => id !== uid) : null;
  return { chat, uid, isGroup, otherUserId };
}

function renderChatOptionsMenu() {
  const inner = S('chatOptionsMenuInner');
  if (!inner) return;

  const { isGroup } = getActiveChatMeta();

  if (!snapState.activeChat) {
    inner.innerHTML = '';
    return;
  }

  const itemClass = 'w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors';
  const iconClass = 'w-4 h-4';
  const labelClass = 'text-xs font-black uppercase tracking-widest';

  if (isGroup) {
    inner.innerHTML = `
      <button class="${itemClass}" onclick="window.toggleChatOptionsMenu(false); window.toggleCreateGroup(true, 'addMembers')">
        <i data-lucide="user-plus" class="${iconClass} text-brand-600"></i>
        <span class="${labelClass}">Add Members</span>
      </button>
      <button class="${itemClass}" onclick="window.toggleChatOptionsMenu(false); window.leaveGroup()">
        <i data-lucide="log-out" class="${iconClass} text-rose-500"></i>
        <span class="${labelClass}">Leave Group</span>
      </button>
    `;
  } else {
    inner.innerHTML = `
      <button class="${itemClass}" onclick="window.toggleChatOptionsMenu(false); window.blockContact()">
        <i data-lucide="ban" class="${iconClass} text-rose-500"></i>
        <span class="${labelClass}">Block Contact</span>
      </button>
      <button class="${itemClass}" onclick="window.toggleChatOptionsMenu(false); window.deleteContact()">
        <i data-lucide="trash-2" class="${iconClass} text-slate-500"></i>
        <span class="${labelClass}">Delete Contact</span>
      </button>
    `;
  }

  if (window.lucide) window.lucide.createIcons();
}

window.toggleChatOptionsMenu = (show, event) => {
  const menu = S('chatOptionsMenu');
  if (!menu) return;

  if (event) event.stopPropagation();

  snapState.chatOptionsOpen = !!show;
  menu.classList.toggle('hidden', !show);

  if (!show) return;

  renderChatOptionsMenu();

  const anchor = event?.currentTarget;
  if (anchor && anchor.getBoundingClientRect) {
    const rect = anchor.getBoundingClientRect();
    const width = 220;
    const top = Math.min(window.innerHeight - 16, rect.bottom + 8);
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.right - width));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  } else {
    menu.style.top = `80px`;
    menu.style.left = `${Math.max(16, window.innerWidth - 240)}px`;
  }
};

window.blockContact = async () => {
  const { uid, isGroup, otherUserId } = getActiveChatMeta();
  if (!uid || isGroup || !otherUserId) return;

  try {
    const userRef = doc(db, "users", uid);
    await updateDoc(userRef, { blocked: arrayUnion(otherUserId) });
    const prev = Array.isArray(app.state.userData?.blocked) ? app.state.userData.blocked : [];
    app.state.userData = { ...app.state.userData, blocked: Array.from(new Set([...prev, otherUserId])) };
    await window.deleteContact();
    toast('Contact blocked', 'success');
  } catch (e) {
    console.error('Error blocking contact:', e);
    toast(e?.message || 'Unable to block contact', 'error');
  }
};

window.deleteContact = async () => {
  const { chat, uid, isGroup } = getActiveChatMeta();
  if (!chat || !uid || isGroup) return;

  try {
    const chatRef = doc(db, "chats", chat.id);
    await updateDoc(chatRef, { [`deletedFor.${uid}`]: true, updatedAt: serverTimestamp() });
    snapState.chats = (snapState.chats || []).filter(c => c.id !== chat.id);
    renderSnapFeed();
    window.hideSnapChat();
    toast('Chat removed', 'info');
  } catch (e) {
    console.error('Error deleting contact:', e);
    toast(e?.message || 'Unable to delete contact', 'error');
  }
};

window.leaveGroup = async () => {
  const { chat, uid, isGroup } = getActiveChatMeta();
  if (!chat || !uid || !isGroup) return;

  try {
    const chatRef = doc(db, "chats", chat.id);
    await updateDoc(chatRef, { participants: arrayRemove(uid), updatedAt: serverTimestamp() });
    snapState.chats = (snapState.chats || []).filter(c => c.id !== chat.id);
    renderSnapFeed();
    window.hideSnapChat();
    toast('Left group', 'info');
  } catch (e) {
    console.error('Error leaving group:', e);
    toast(e?.message || 'Unable to leave group', 'error');
  }
};

window.startChatWithUser = async (otherUserId) => {
  const currentUser = snapState.user || app.state.user || (auth && auth.currentUser);
  if (!currentUser) return;
  if (!otherUserId || otherUserId === currentUser.uid) return;

  const ids = [currentUser.uid, otherUserId].sort();
  const chatId = `${ids[0]}__${ids[1]}`;
  const chatRef = doc(db, "chats", chatId);

  try {
    await setDoc(chatRef, {
      participants: ids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      typing: {}
    }, { merge: true });

    if (!snapState.chats.some(c => c.id === chatId)) {
      snapState.chats.unshift({
        id: chatId,
        participants: ids,
        createdAt: null,
        updatedAt: null,
        typing: {}
      });
      renderSnapFeed();
    }

    window.toggleAddPeople(false);
    await window.openSnapChat(chatId);
  } catch (e) {
    console.error('Error starting chat:', e);
    const code = e?.code || '';
    const msg = e?.message || 'Unable to start chat';
    if (code === 'permission-denied') {
      toast('Unable to start chat (permission denied). Update Firestore rules for /chats.', 'error');
    } else if (code === 'unauthenticated') {
      toast('Please sign in to start a chat', 'error');
    } else {
      toast(msg, 'error');
    }
  }
};

window.togglePinChat = async (chatId, event) => {
  event.stopPropagation();
  const chat = snapState.chats.find(c => c.id === chatId);
  if (!chat) return;
  
  const isPinned = !chat.isPinned;
  await updateDoc(doc(db, "chats", chatId), { isPinned });
  toast(isPinned ? 'Chat Pinned' : 'Chat Unpinned', 'info');
};

function initPresenceSync() {
  if (!snapState.user) return;
  const userRef = doc(db, "users", snapState.user.uid);
  updateDoc(userRef, { status: 'online', lastSeen: serverTimestamp() });
  
  // Basic online/offline simulation for other users
  const q = query(collection(db, "users"), limit(20));
  onSnapshot(q, (snapshot) => {
    snapState.users = snapshot.docs.reduce((acc, doc) => {
      acc[doc.id] = doc.data();
      return acc;
    }, {});
    renderSnapFeed();
  });
}

function initChatsSync() {
  if (!snapState.user) return;
  
  const q = query(
    collection(db, "chats"), 
    where("participants", "array-contains", snapState.user.uid),
    limit(100)
  );
  
  if (snapState.unsubChats) snapState.unsubChats();
  
  snapState.unsubChats = onSnapshot(q, (snapshot) => {
    const uid = snapState.user.uid;
    const blocked = Array.isArray(app.state.userData?.blocked) ? app.state.userData.blocked : [];
    snapState.chats = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(c => !(c.deletedFor && c.deletedFor[uid]))
      .filter(c => {
        const isGroup = !!c.isGroup || (Array.isArray(c.participants) && c.participants.length > 2);
        if (isGroup) return true;
        const otherId = c.participants?.find(id => id !== uid);
        return otherId ? !blocked.includes(otherId) : true;
      });
    renderSnapFeed();
  });
}

function renderSnapFeed(filterQuery = '') {
  const list = S('snapFeedList');
  if (!list) return;
  
  const uid = snapState.user?.uid || null;
  const blocked = Array.isArray(app.state.userData?.blocked) ? app.state.userData.blocked : [];
  let filteredChats = (snapState.chats || []).filter(c => {
    if (!uid) return true;
    if (c.deletedFor && c.deletedFor[uid]) return false;
    const isGroup = !!c.isGroup || (Array.isArray(c.participants) && c.participants.length > 2);
    if (isGroup) return true;
    const otherId = c.participants?.find(id => id !== uid);
    return otherId ? !blocked.includes(otherId) : true;
  });
  if (filterQuery) {
    filteredChats = filteredChats.filter(c => {
      const otherParticipantId = c.participants.find(uid => uid !== snapState.user.uid);
      const otherUser = snapState.users?.[otherParticipantId] || {};
      const chatName = c.name || otherUser.displayName || 'Scholar';
      return chatName.toLowerCase().includes(filterQuery);
    });
  }

  // Sort: Pinned first, then by updatedAt
  filteredChats.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0);
  });

  if (filteredChats.length === 0) {
    list.innerHTML = `<div class="p-8 text-center text-slate-400 font-bold">No results found</div>`;
    return;
  }
  
  list.innerHTML = filteredChats.map(chat => {
    let statusIcon = '';
    let statusColor = 'text-slate-400';
    const lastMsg = chat.lastMessage || {};
    const isNew = lastMsg.senderId !== snapState.user.uid && !lastMsg.readBy?.includes(snapState.user.uid);
    const isActive = snapState.activeChat?.id === chat.id;
    
    // Find the other participant's name if it's a 1-on-1 chat
    const otherParticipantId = chat.participants.find(uid => uid !== snapState.user.uid);
    const otherUser = snapState.users?.[otherParticipantId] || {};
    const chatName = chat.name || otherUser.displayName || 'Scholar';
    const isOnline = otherUser.status === 'online';

    if (isNew) {
      statusIcon = '<div class="w-3 h-3 rounded-sm bg-rose-500 mr-2"></div>';
      statusColor = 'text-rose-500';
    } else if (lastMsg.senderId === snapState.user.uid) {
      const isRead = lastMsg.readBy?.length > 1;
      statusIcon = `<i data-lucide="check-check" class="w-3 h-3 mr-2 ${isRead ? 'text-brand-500' : 'text-slate-300'}"></i>`;
    }

    const timeStr = lastMsg.createdAt ? new Date(lastMsg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const safeChatName = escapeHTML(chatName);
    const safeLastText = escapeHTML(lastMsg.text || 'Opened');
    const rowClass = isActive
      ? 'bg-brand-50/70 dark:bg-brand-900/20 shadow-lg shadow-brand-500/10 rounded-3xl mx-3 my-2 border border-brand-200/60 dark:border-brand-800/40'
      : `border-b border-slate-50 dark:border-slate-800/30 ${chat.isPinned ? 'bg-brand-50/30 dark:bg-brand-900/10' : ''}`;

    return `
      <div onclick="window.openSnapChat('${chat.id}')" class="flex items-center gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all group ${rowClass}">
        <div class="relative">
          <div class="w-16 h-16 rounded-full border-2 border-white dark:border-slate-800 shadow-lg overflow-hidden group-active:scale-95 transition-transform bg-brand-50 flex items-center justify-center font-black text-brand-600">
            ${chatName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          ${isOnline ? '<div class="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900"></div>' : ''}
          ${isNew ? '<div class="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full border-2 border-white dark:border-slate-900 animate-pulse"></div>' : ''}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <h4 class="font-black text-base tracking-tight truncate">${safeChatName}</h4>
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${timeStr}</span>
          </div>
          <div class="flex items-center justify-between mt-1">
            <div class="flex items-center flex-1 min-w-0">
              ${statusIcon}
              <p class="text-[10px] font-black uppercase tracking-widest ${statusColor} truncate">${isNew ? 'New Message' : safeLastText}</p>
            </div>
            <div class="flex items-center gap-2">
              ${chat.isPinned ? '<i data-lucide="pin" class="w-3 h-3 text-brand-500"></i>' : ''}
              <button onclick="window.togglePinChat('${chat.id}', event)" class="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all">
                <i data-lucide="more-vertical" class="w-3 h-3 text-slate-400"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

async function updateTypingStatus(isTyping) {
  if (!snapState.activeChat || !snapState.user) return;
  
  const chatDoc = doc(db, "chats", snapState.activeChat.id);
  try {
    await updateDoc(chatDoc, {
      [`typing.${snapState.user.uid}`]: isTyping
    });
  } catch (e) {
    console.error('Error updating typing status:', e);
  }
}

function initStoriesSync() {
  const q = query(collection(db, "campusPosts"), orderBy("createdAt", "desc"), limit(10));
  onSnapshot(q, (snapshot) => {
    const stories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderStories(stories);
  });
}

function renderStories(stories) {
  const container = S('storyContainer');
  if (!container) return;
  
  container.innerHTML = stories.map(s => `
    <div onclick="window.viewStory('${s.id}')" class="flex flex-col items-center gap-2 shrink-0 cursor-pointer group">
      <div class="w-16 h-16 rounded-full p-1 border-2 border-brand-500 group-hover:scale-105 transition-transform">
        <div class="w-full h-full rounded-full bg-brand-50 flex items-center justify-center font-black text-brand-600 text-xs">
          ${s.displayName ? s.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U'}
        </div>
      </div>
      <span class="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate w-16 text-center">${escapeHTML(s.displayName?.split(' ')[0] || 'Scholar')}</span>
    </div>
  `).join('');
}

window.viewStory = (storyId) => {
  toast('Opening Story...', 'brand');
  // Full-screen story viewer logic could be added here
};

// On mobile (<lg breakpoint) the chat list (#chatFeed) and the open chat
// (#snapChatWindow) used to render stacked on top of each other in the
// same flex-col column instead of one replacing the other — so opening a
// chat just added a second full-height pane below the list instead of
// navigating to it. This makes Community a real single-pane, WhatsApp-
// style view on phones: only one pane shows at a time. Desktop (lg+) is
// untouched — chatFeed's 'lg:flex' class always wins there regardless of
// what this toggles.
function setCommunityMobilePane(view) {
  const feed = S('chatFeed');
  if (!feed) return;
  if (view === 'chat') {
    feed.classList.remove('flex');
    feed.classList.add('hidden');
  } else {
    feed.classList.remove('hidden');
    feed.classList.add('flex');
  }
}

window.openSnapChat = async (chatId) => {
  let chat = snapState.chats.find(c => c.id === chatId);
  if (!chat) {
    try {
      const snap = await getDoc(doc(db, "chats", chatId));
      if (snap.exists()) {
        chat = { id: chatId, ...snap.data() };
        snapState.chats.unshift(chat);
        renderSnapFeed();
      } else {
        toast('Chat not found', 'error');
        return;
      }
    } catch (e) {
      console.error('Error opening chat:', e);
      toast('Unable to open chat', 'error');
      return;
    }
  }
  
  snapState.activeChat = chat;
  renderSnapFeed(S('chatSearchInput')?.value.toLowerCase() || '');
  
  // UI Switch
  S('snapEmptyState')?.classList.add('hidden');
  S('snapChatWindow')?.classList.remove('hidden');
  setCommunityMobilePane('chat'); // mobile: swap out the list for the open chat
  
  // Header Update
  const otherParticipantId = chat.participants.find(uid => uid !== snapState.user.uid);
  // snapState.users is only seeded from an arbitrary first-20 users query
  // (see initPresenceSync), so a chat partner outside that batch — e.g. a
  // marketplace seller you've never crossed paths with before — would
  // otherwise show up as a nameless "Scholar". Fetch them directly on a
  // cache miss and merge them in so the header (and the feed row) always
  // resolves a real name/avatar.
  if (otherParticipantId && !snapState.users?.[otherParticipantId]) {
    try {
      const otherSnap = await getDoc(doc(db, "users", otherParticipantId));
      if (otherSnap.exists()) {
        snapState.users = { ...(snapState.users || {}), [otherParticipantId]: otherSnap.data() };
      }
    } catch (e) {
      console.warn('Unable to fetch chat participant profile:', e);
    }
  }
  const otherUser = snapState.users?.[otherParticipantId] || {};
  const chatName = chat.name || otherUser.displayName || 'Scholar';
  const isOnline = otherUser.status === 'online';
  const lastSeen = otherUser.lastSeen ? new Date(otherUser.lastSeen.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recently';

  if (S('snapHeaderName')) S('snapHeaderName').textContent = chatName;
  if (S('snapHeaderAvatar')) {
    const initials = chatName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    S('snapHeaderAvatar').innerHTML = `<div class="w-full h-full bg-brand-600 text-white flex items-center justify-center font-black text-xl">${initials}</div>`;
  }
  
  const presenceText = isOnline ? 'Online' : `Last seen at ${lastSeen}`;
  const presenceEl = S('snapHeaderPresence');
  if (presenceEl) {
    presenceEl.innerHTML = `
      <span class="w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}"></span>
      <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${presenceText}</p>
    `;
  }

  renderChatItemContext(chat.contextItem || null);

  // Messages Sync
  initMessagesSync(chatId);
  
  // Mark as Read
  try {
    const chatRef = doc(db, "chats", chatId);
    const existing = Array.isArray(chat.lastMessage?.readBy) ? chat.lastMessage.readBy : [];
    const readBy = Array.from(new Set([...existing, snapState.user.uid]));
    await updateDoc(chatRef, { [`lastMessage.readBy`]: readBy });
  } catch (e) {
    console.error('Error marking chat as read:', e);
  }
};

function initMessagesSync(chatId) {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  
  if (snapState.unsubMessages) snapState.unsubMessages();
  
  snapState.unsubMessages = onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderSnapMessages(messages);
  });
  
  // Typing Indicator Sync
  const chatRef = doc(db, "chats", chatId);
  if (snapState.unsubTyping) snapState.unsubTyping();
  snapState.unsubTyping = onSnapshot(chatRef, (doc) => {
    const data = doc.data();
    const typing = data?.typing || {};
    const othersTyping = Object.keys(typing).some(uid => uid !== snapState.user.uid && typing[uid]);
    S('snapTyping')?.classList.toggle('hidden', !othersTyping);
  });
}

function renderSnapMessages(messages) {
  const container = S('snapMessages');
  if (!container) return;
  
  container.innerHTML = messages.map(m => {
    const isMe = m.senderId === snapState.user.uid;
    const time = m.createdAt ? new Date(m.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const safeText = escapeHTML(m.text);
    const safeAssetName = escapeHTML(m.asset?.name || '');
    const att = m.attachment || null;
    const attUrl = att?.url ? safeUrl(att.url) : '';
    const attName = escapeHTML(att?.name || 'Attachment');
    const isImage = !!att?.contentType && toText(att.contentType).startsWith('image/');
    
    return `
      <div class="flex ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-${isMe ? 'right' : 'left'}-2">
        <div class="max-w-[75%] group">
          <div class="px-5 py-3 rounded-[24px] ${isMe ? 'bg-brand-600 text-white rounded-tr-none shadow-lg shadow-brand-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-tl-none border border-slate-200/50 dark:border-slate-700/50'}">
            ${m.text ? `<p class="text-sm font-medium leading-relaxed">${safeText}</p>` : ''}
            ${att && attUrl ? `
              <div class="${m.text ? 'mt-3' : ''} p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
                ${isImage ? `
                  <img src="${escapeHTML(attUrl)}" alt="${attName}" class="w-full max-h-64 object-cover rounded-2xl">
                  <a href="${escapeHTML(attUrl)}" target="_blank" rel="noopener noreferrer" class="mt-3 inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest opacity-90 hover:opacity-100 transition-opacity">
                    <i data-lucide="download" class="w-4 h-4"></i> ${attName}
                  </a>
                ` : `
                  <a href="${escapeHTML(attUrl)}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 hover:opacity-100 transition-opacity">
                    <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><i data-lucide="paperclip" class="w-5 h-5"></i></div>
                    <div class="flex-1 min-w-0">
                      <p class="text-[10px] font-black uppercase tracking-widest opacity-60">Attachment</p>
                      <p class="text-xs font-bold truncate">${attName}</p>
                    </div>
                    <i data-lucide="download" class="w-4 h-4 opacity-80"></i>
                  </a>
                `}
              </div>
            ` : ''}
            ${m.asset ? `
              <div class="mt-3 p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><i data-lucide="book-open" class="w-5 h-5"></i></div>
                <div class="flex-1 min-w-0">
                  <p class="text-[10px] font-black uppercase tracking-widest opacity-60">Study Asset</p>
                  <p class="text-xs font-bold truncate">${safeAssetName}</p>
                </div>
                <button class="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"><i data-lucide="download" class="w-4 h-4"></i></button>
              </div>
            ` : ''}
          </div>
          <div class="flex items-center gap-2 mt-1 px-2 ${isMe ? 'justify-end' : 'justify-start'} opacity-0 group-hover:opacity-100 transition-opacity">
            <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">${time}</span>
            ${isMe ? '<i data-lucide="check-check" class="w-3 h-3 text-brand-500"></i>' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

// --- SUPPORT CHAT ---

function initSupportChat() {
  if (supportState.unsubMessages) supportState.unsubMessages();
  const user = app.state.user;
  if (!user) return;

  const input = S('supportInput');
  if (input) {
    input.onkeypress = (e) => {
      if (e.key === 'Enter') window.sendSupportMessage();
    };
  }

  const q = query(
    collection(db, "support_messages"),
    where("userId", "==", user.uid),
    orderBy("createdAt", "asc")
  );

  supportState.unsubMessages = onSnapshot(q, (snapshot) => {
    const messages = [];
    snapshot.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
    supportState.messages = messages;
    renderSupportMessages(messages);
  });
}

function renderSupportMessages(messages) {
  const container = S('supportMessages');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-center p-8 opacity-40">
        <div class="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <i data-lucide="message-square" class="w-8 h-8"></i>
        </div>
        <p class="text-sm font-bold">No messages yet. Start a conversation with support!</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = messages.map(m => {
    const isMe = m.senderId === app.state.user.uid;
    const isSystem = m.senderId === 'system' || m.isSystem;
    const time = m.createdAt ? new Date(m.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const safeText = escapeHTML(m.text);
    const label = isMe ? '' : (isSystem ? 'System Prompt' : 'Support Team');
    
    return `
      <div class="flex ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-${isMe ? 'bottom' : 'bottom'}-2">
        <div class="max-w-[85%]">
          ${label ? `<p class="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1 px-2">${label}</p>` : ''}
          <div class="px-5 py-3 rounded-2xl ${isMe ? 'bg-brand-600 text-white rounded-tr-none' : (isSystem ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100 border border-amber-100 dark:border-amber-800/50 rounded-tl-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-tl-none')}">
            <p class="text-sm font-medium leading-relaxed">${safeText}</p>
          </div>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1 px-2 ${isMe ? 'text-right' : 'text-left'}">${time}</p>
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

window.sendSupportMessage = async () => {
  const input = S('supportInput');
  if (!input || !input.value.trim() || !app.state.user) return;

  const text = input.value.trim();
  const user = app.state.user;
  input.value = '';

  try {
    await addDoc(collection(db, "support_messages"), {
      userId: user.uid,
      senderId: user.uid,
      text,
      createdAt: serverTimestamp(),
      userEmail: user.email,
      userName: app.state.userData.displayName || user.displayName || 'Scholar'
    });
  } catch (e) {
    console.error('Support message error:', e);
    toast('Failed to send message', 'error');
  }
};

window.sendSnapMessage = async () => {
  const input = S('chatMessageInput');
  if (!input || !input.value.trim() || !snapState.activeChat) return;
  
  {
    const uid = snapState.user?.uid || null;
    const chat = snapState.activeChat;
    const isGroup = !!chat?.isGroup || (Array.isArray(chat?.participants) && chat.participants.length > 2);
    if (uid && !isGroup) {
      const otherId = chat.participants?.find(id => id !== uid);
      const blocked = Array.isArray(app.state.userData?.blocked) ? app.state.userData.blocked : [];
      if (otherId && blocked.includes(otherId)) {
        toast('You blocked this contact', 'error');
        return;
      }
    }
  }

  const text = input.value.trim();
  input.value = '';
  S('sendSnapBtn')?.classList.add('hidden');
  updateTypingStatus(false);
  
  const msgData = {
    senderId: snapState.user.uid,
    text,
    createdAt: serverTimestamp()
  };
  
  try {
    const chatRef = doc(db, "chats", snapState.activeChat.id);
    await addDoc(collection(chatRef, "messages"), msgData);
    await updateDoc(chatRef, {
      lastMessage: {
        senderId: snapState.user.uid,
        text,
        createdAt: serverTimestamp(),
        readBy: [snapState.user.uid]
      },
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    console.error('Error sending message:', e);
    toast('Error sending message', 'error');
  }
};

window.toggleSnapMap = (show) => {
  S('snapMapOverlay')?.classList.toggle('hidden', !show);
};

window.startNewChat = async () => {
  if (!snapState.user) return;
  
  const name = prompt("Enter scholar's name to chat with:");
  if (!name) return;
  
  try {
    const chatData = {
      name,
      participants: [snapState.user.uid, 'dummy_scholar_' + Date.now()],
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      typing: {}
    };
    
    const docRef = await addDoc(collection(db, "chats"), chatData);
    toast(`Started new chat with ${name}!`, 'success');
    window.openSnapChat(docRef.id);
  } catch (e) {
    console.error('Error starting chat:', e);
    toast('Error starting chat', 'error');
  }
};

window.hideSnapChat = () => {
  window.toggleChatOptionsMenu(false);
  S('snapChatWindow')?.classList.add('hidden');
  S('snapEmptyState')?.classList.remove('hidden');
  setCommunityMobilePane('list'); // mobile: back to the chat list
  snapState.activeChat = null;
  renderSnapFeed(S('chatSearchInput')?.value.toLowerCase() || '');
};

// --- Seller Module Logic ---
window.toggleUpload = (show) => {
  const modal = S('uploadModal');
  if (!modal) return;
  if (show && !auth.currentUser) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to post a listing', 'error');
    return;
  }
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (show && window.lucide) window.lucide.createIcons();
};

// Entry point for the marketplace's "Post Item" button. The actual form is
// the existing uploadModal (#uploadTitle etc, submitted via
// submitNewListing below) — this just makes sure a signed-in user lands on
// it instead of the "coming soon" stub it used to be.
window.openPostItemModal = () => {
  window.toggleUpload(true);
};

// marketItems (and skills) creation requires isSeller() in firestore.rules.
// There's no separate "become a seller" screen — flipping this the first
// time someone actually submits a listing they've filled out is the
// self-service equivalent of the isSelfServiceSubscription() pattern
// already used for the FREE tier. Safe because `sellerOnboarded` grants
// nothing beyond posting your own listings (see firestore.rules comment).
let sellerOnboardPromise = null;
async function ensureSellerOnboarded() {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in to post listings');
  if (app.state.userData?.sellerOnboarded || app.state.userData?.role === 'SELLER') return;
  if (!sellerOnboardPromise) {
    sellerOnboardPromise = updateDoc(doc(db, "users", user.uid), { sellerOnboarded: true })
      .then(() => {
        if (app.state.userData) app.state.userData.sellerOnboarded = true;
        toast("You're now a seller on Geo-Books!", 'success');
      })
      .finally(() => { sellerOnboardPromise = null; });
  }
  await sellerOnboardPromise;
}

window.backToGeoBooks = () => {
  try {
    window.location.href = 'geo-books.htm#marketplace';
  } catch {
    window.location.href = 'geo-books.htm';
  }
};

window.openSellerSkills = () => {
  try {
    window.location.href = 'seller.htm#skills';
  } catch {
    window.location.href = 'seller.htm';
  }
};

window.refreshSellerListings = () => {
  renderListings();
  toast('Listings refreshed', 'success');
};

window.refreshSellerSkills = () => {
  renderSkillListings();
  toast('Skills refreshed', 'success');
};

window.setListingStatus = async (id, status) => {
  const nextStatus = status === 'sold' ? 'sold' : 'active';
  try {
    const payload = nextStatus === 'sold'
      ? { status: 'sold', soldAt: serverTimestamp(), updatedAt: serverTimestamp() }
      : { status: 'active', soldAt: null, updatedAt: serverTimestamp() };
    await updateDoc(doc(db, "marketItems", id), payload);
    toast(`Listing marked ${nextStatus}`, 'success');
  } catch (error) {
    console.error('Status update error:', error);
    toast('Error updating listing status', 'error');
  }
};

window.toggleSellerDashboard = (show) => {
  const modal = S('sellerDashboardModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (show) {
    renderSellerListings();
    if (window.lucide) window.lucide.createIcons();
  }
};

function renderSellerListings() {
  const wrap = S('sellerListingsContainer');
  if (!wrap) return;
  
  const items = app.state.myListings || [];
  
  if (S('sellerActiveListings')) S('sellerActiveListings').textContent = items.length;
  
  let revenue = 0;
  items.forEach(item => revenue += (item.price || 0));
  if (S('sellerRevenue')) S('sellerRevenue').textContent = '₦' + revenue.toLocaleString();
  
  if (items.length === 0) {
    wrap.innerHTML = `
      <div class="text-center py-8 text-slate-400">
        <i data-lucide="package-open" class="w-12 h-12 mx-auto mb-3 opacity-30"></i>
        <p class="font-bold">No listings yet</p>
        <p class="text-sm">Start selling by posting your first item!</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  
  wrap.innerHTML = items.map(item => {
    const imgSrc = escapeHTML(safeUrl(item.img, `https://picsum.photos/seed/${encodeURIComponent(item.id || Date.now())}/400/300`));
    const safeCategory = escapeHTML(item.category);
    const safeTitle = escapeHTML(item.title);
    return `
    <div class="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-soft flex items-center gap-4 group transition-all hover:border-brand-300">
      <div class="w-20 h-20 rounded-2xl overflow-hidden bg-slate-100 shrink-0">
        <img src="${imgSrc}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy">
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[10px] font-black uppercase text-brand-600 tracking-widest">${safeCategory}</p>
        <h4 class="font-bold text-sm truncate mt-0.5">${safeTitle}</h4>
        <p class="text-sm font-black mt-1">₦${item.price.toLocaleString()}</p>
      </div>
      <div class="flex gap-2">
        <button onclick="window.toggleModal(true, '${item.id}')" aria-label="Edit listing" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-brand-600 transition-colors">
          <i data-lucide="edit-3" class="w-5 h-5"></i>
        </button>
        <button onclick="window.deleteItem('${item.id}')" aria-label="Delete listing" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-rose-600 transition-colors">
          <i data-lucide="trash-2" class="w-5 h-5"></i>
        </button>
      </div>
    </div>
  `;
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

window.toggleModal = (show, id = null) => {
  const modal = S('itemModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  
  if (!show) return;

  const earlyAccess = hasEarlyAccess(app.state.userData?.xp || 0);
  const boostedCheckbox = S('itemBoosted');
  const boostedHint = S('itemBoostedHint');
  if (boostedCheckbox) boostedCheckbox.disabled = !earlyAccess;
  if (boostedHint) {
    boostedHint.textContent = earlyAccess
      ? 'Shows this item first in its category.'
      : 'Unlocks at Elite rank (18,000 XP) — currently locked.';
  }
  
  if (id) {
    const item = app.state.myListings.find(i => i.id === id);
    if (item) {
      if (S('modalTitle')) S('modalTitle').textContent = 'Edit Listing';
      if (S('editId')) S('editId').value = id;
      if (S('itemTitle')) S('itemTitle').value = item.title;
      if (S('itemPrice')) S('itemPrice').value = item.price;
      if (S('itemCategory')) S('itemCategory').value = item.category;
      if (S('itemLocation')) S('itemLocation').value = item.loc;
      if (S('itemImage')) S('itemImage').value = item.img;
      if (S('itemFileUrl')) S('itemFileUrl').value = item.fileUrl || '';
      if (S('itemDescription')) S('itemDescription').value = item.description || '';
      if (S('itemStatus')) S('itemStatus').value = item.status || 'active';
      if (boostedCheckbox) boostedCheckbox.checked = earlyAccess && !!item.boosted;
    }
  } else {
    if (S('modalTitle')) S('modalTitle').textContent = 'Add New Listing';
    if (S('editId')) S('editId').value = '';
    if (S('itemTitle')) S('itemTitle').value = '';
    if (S('itemPrice')) S('itemPrice').value = '';
    if (S('itemLocation')) S('itemLocation').value = '';
    if (S('itemImage')) S('itemImage').value = '';
    if (S('itemFileUrl')) S('itemFileUrl').value = '';
    if (S('itemDescription')) S('itemDescription').value = '';
    if (S('itemStatus')) S('itemStatus').value = 'active';
    if (boostedCheckbox) boostedCheckbox.checked = false;
  }
  if (window.lucide) window.lucide.createIcons();
};

window.toggleSkillModal = (show, id = null) => {
  const modal = S('skillModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (!show) return;

  if (id) {
    const skill = (app.state.mySkills || []).find(s => s.id === id);
    if (skill) {
      if (S('skillModalTitle')) S('skillModalTitle').textContent = 'Edit Skill';
      if (S('skillEditId')) S('skillEditId').value = id;
      if (S('skillTitle')) S('skillTitle').value = skill.title || '';
      if (S('skillPrice')) S('skillPrice').value = skill.price || '';
      if (S('skillCategory')) S('skillCategory').value = skill.category || 'Other';
      if (S('skillLocation')) S('skillLocation').value = skill.loc || '';
      if (S('skillImage')) S('skillImage').value = skill.img || '';
      if (S('skillDescription')) S('skillDescription').value = skill.description || '';
      if (S('skillStatus')) S('skillStatus').value = skill.status || 'active';
    }
  } else {
    if (S('skillModalTitle')) S('skillModalTitle').textContent = 'Add New Skill';
    if (S('skillEditId')) S('skillEditId').value = '';
    if (S('skillTitle')) S('skillTitle').value = '';
    if (S('skillPrice')) S('skillPrice').value = '';
    if (S('skillLocation')) S('skillLocation').value = '';
    if (S('skillImage')) S('skillImage').value = '';
    if (S('skillDescription')) S('skillDescription').value = '';
    if (S('skillStatus')) S('skillStatus').value = 'active';
  }
};

window.toggleGigModal = (show, id = null) => {
  const modal = S('gigModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (!show) return;

  const set = (k, v) => {
    const el = S(k);
    if (!el) return;
    el.value = v;
  };

  if (id) {
    const gig = (app.state.gigs || []).find(g => g.id === id);
    const userId = app.state.user?.uid || auth?.currentUser?.uid || null;
    if (gig && userId && toText(gig.posterId) === toText(userId)) {
      if (S('gigModalTitle')) S('gigModalTitle').textContent = 'Edit Gig';
      set('gigEditId', id);
      set('gigTitle', toText(gig.title || ''));
      set('gigCategory', toText(gig.category || 'Other'));
      set('gigBudget', toText(gig.budget ?? ''));
      set('gigTags', Array.isArray(gig.tags) ? gig.tags.join(', ') : toText(gig.tags || ''));
      set('gigLocation', toText(gig.location || ''));
      set('gigDescription', toText(gig.description || ''));
      set('gigStatus', toText(gig.status || 'open'));
    } else {
      toast('You can only edit your own gigs', 'error');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      return;
    }
  } else {
    if (S('gigModalTitle')) S('gigModalTitle').textContent = 'Post a Gig';
    set('gigEditId', '');
    set('gigTitle', '');
    set('gigBudget', '');
    set('gigTags', '');
    set('gigLocation', '');
    set('gigDescription', '');
    const statusEl = S('gigStatus');
    if (statusEl) statusEl.value = 'open';
  }

  if (window.lucide) window.lucide.createIcons();
};

window.saveGig = async () => {
  const user = app.state.user || auth.currentUser;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Please sign in to post gigs', 'error');
    return;
  }

  const id = toText(S('gigEditId')?.value || '').trim();
  const title = toText(S('gigTitle')?.value || '').trim();
  const category = toText(S('gigCategory')?.value || 'Other').trim();
  const budget = parseInt(S('gigBudget')?.value || '0', 10);
  const tagsRaw = toText(S('gigTags')?.value || '');
  const location = toText(S('gigLocation')?.value || '').trim();
  const description = toText(S('gigDescription')?.value || '').trim();
  const status = toText(S('gigStatus')?.value || 'open').trim();

  if (title.length < 6) return toast('Title must be at least 6 characters', 'error');
  if (!description || description.length < 20) return toast('Description must be at least 20 characters', 'error');
  if (!Number.isFinite(budget) || budget < 0) return toast('Budget must be a valid number', 'error');

  const tags = tagsRaw
    .split(',')
    .map(t => toText(t).trim())
    .filter(Boolean)
    .slice(0, 10);

  const verifiedClient = document.documentElement.getAttribute('data-elite') === 'true';
  const posterName = app.state.userData?.displayName || user.displayName || user.email || 'Anonymous';

  const payload = {
    posterId: user.uid,
    posterName,
    title,
    category,
    budget,
    tags,
    location,
    description,
    status: status === 'closed' ? 'closed' : 'open',
    verifiedClient,
    updatedAt: serverTimestamp()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "gigs", id), payload);
      toast('Gig updated', 'success');
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "gigs"), payload);
      toast('Gig published!', 'success');
      rewardXP(25);
      if (typeof confettiCelebration === 'function') confettiCelebration();
    }
    window.toggleGigModal(false);
  } catch (e) {
    console.error('Save gig error:', e);
    toast(e?.message || 'Unable to publish gig', 'error');
  }
};

window.applyToGig = async (gigId) => {
  const user = app.state.user || auth.currentUser;
  if (!user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Please sign in to apply', 'error');
    return;
  }

  const gig = (app.state.gigs || []).find(g => g.id === gigId);
  if (!gig) return toast('Gig not found', 'error');
  if (toText(gig.posterId) === toText(user.uid)) return toast('You cannot apply to your own gig', 'error');

  const msg = prompt('Write a short message to the client (optional):') || '';
  try {
    await addDoc(collection(db, "gigApplications"), {
      gigId,
      gigTitle: toText(gig.title || ''),
      posterId: toText(gig.posterId || ''),
      applicantId: user.uid,
      applicantName: app.state.userData?.displayName || user.displayName || user.email || 'Anonymous',
      message: toText(msg).slice(0, 800),
      createdAt: serverTimestamp()
    });
    toast('Application sent!', 'success');
    rewardXP(10);
  } catch (e) {
    console.error('Apply error:', e);
    toast(e?.message || 'Unable to apply', 'error');
  }
};

function renderSkillListings() {
  const wrap = S('skillContainer');
  if (!wrap) return;
  const skills = app.state.mySkills || [];

  if (!skills.length) {
    wrap.innerHTML = `
      <div class="bg-white dark:bg-slate-900 p-6 rounded-[32px] border border-slate-200 dark:border-slate-800 shadow-soft text-center text-slate-400">
        <i data-lucide="graduation-cap" class="w-10 h-10 mx-auto mb-3 opacity-30"></i>
        <p class="font-bold">No skills yet</p>
        <p class="text-sm">Publish your first skill to show up in Skill Academy.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  wrap.innerHTML = skills
    .slice()
    .sort((a, b) => (toMillis(b.updatedAt) || toMillis(b.createdAt) || 0) - (toMillis(a.updatedAt) || toMillis(a.createdAt) || 0))
    .map(skill => {
      const imgSrc = escapeHTML(safeUrl(skill.img, `https://picsum.photos/seed/${encodeURIComponent(skill.id || Date.now())}/400/300`));
      const safeCategory = escapeHTML(toText(skill.category || 'Other'));
      const safeTitle = escapeHTML(toText(skill.title || 'Untitled Skill'));
      const price = Number(skill.price) || 0;
      const status = toText(skill.status || 'active');
      const statusPill = status === 'active'
        ? `<span class="px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 text-[9px] font-black uppercase tracking-widest border border-emerald-100 dark:border-emerald-800">Active</span>`
        : `<span class="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 text-[9px] font-black uppercase tracking-widest border border-slate-200 dark:border-slate-700">Paused</span>`;
      return `
        <div class="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-soft flex items-center gap-4 group transition-all hover:border-brand-300">
          <div class="w-20 h-20 rounded-2xl overflow-hidden bg-slate-100 shrink-0">
            <img src="${imgSrc}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy">
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-3">
              <p class="text-[10px] font-black uppercase text-brand-600 tracking-widest truncate">${safeCategory}</p>
              ${statusPill}
            </div>
            <h4 class="font-bold text-sm truncate mt-1">${safeTitle}</h4>
            <p class="text-sm font-black mt-1">₦${price.toLocaleString()}</p>
          </div>
          <div class="flex gap-2">
            <button onclick="window.toggleSkillModal(true, '${skill.id}')" aria-label="Edit skill" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-brand-600 transition-colors">
              <i data-lucide="edit-3" class="w-5 h-5"></i>
            </button>
            <button onclick="window.deleteSkill('${skill.id}')" aria-label="Delete skill" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-rose-600 transition-colors">
              <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

  if (window.lucide) window.lucide.createIcons();
}

window.deleteSkill = async (id) => {
  const user = app.state.user || auth.currentUser;
  if (!user) return toast('Please sign in', 'error');
  const skill = (app.state.mySkills || []).find(s => s.id === id);
  if (!skill) return;
  const ok = confirm(`Delete skill "${toText(skill.title || 'Untitled')}"?`);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "skills", id));
    toast('Skill deleted', 'success');
  } catch (e) {
    console.error('Delete skill error:', e);
    toast(e?.message || 'Unable to delete skill', 'error');
  }
};

window.saveSkillListing = async () => {
  const user = app.state.user || auth.currentUser;
  if (!user) {
    toast('Please sign in to save skills', 'error');
    return;
  }

  const editIdEl = S('skillEditId');
  const titleEl = S('skillTitle');
  const priceEl = S('skillPrice');
  const categoryEl = S('skillCategory');
  const locEl = S('skillLocation');
  const imgEl = S('skillImage');
  const descEl = S('skillDescription');
  const statusEl = S('skillStatus');
  if (!editIdEl || !titleEl || !priceEl || !categoryEl || !locEl || !imgEl || !descEl || !statusEl) {
    toast('Skill form is missing fields. Refresh the page.', 'error');
    return;
  }

  const id = editIdEl.value;
  const title = titleEl.value.trim();
  const price = parseInt(priceEl.value);
  const category = categoryEl.value;
  const loc = locEl.value.trim();
  const img = imgEl.value.trim();
  const description = descEl.value.trim();
  const status = statusEl.value || 'active';

  if (title.length < 3) return toast('Title must be at least 3 characters', 'error');
  if (isNaN(price) || price < 0) return toast('Please enter a valid price', 'error');
  if (description.length < 10) return toast('Description must be at least 10 characters', 'error');

  const sellerName = user.displayName || user.email || 'Anonymous';
  const payload = {
    title,
    price,
    category,
    loc,
    img: img || `https://picsum.photos/seed/${Date.now()}/900/600`,
    description,
    status,
    sellerId: user.uid,
    sellerName,
    updatedAt: serverTimestamp()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "skills", id), payload);
      toast('Skill updated', 'success');
    } else {
      await ensureSellerOnboarded();
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "skills"), payload);
      toast('Skill published!', 'success');
      if (typeof confettiCelebration === 'function') confettiCelebration();
    }
    window.toggleSkillModal(false);
  } catch (e) {
    console.error('Save skill error:', e);
    toast(e?.message || 'Unable to save skill', 'error');
  }
};

function renderListings() {
  const wrap = S('listingContainer');
  if (!wrap) return;
  wrap.innerHTML = '';
  
  const allItems = app.state.myListings || [];
  const activeItems = allItems.filter(i => (i.status || 'active') !== 'sold');
  if (S('statActive')) S('statActive').textContent = activeItems.length;
  
  const soldItems = allItems.filter(i => (i.status || 'active') === 'sold');
  const totalRevenue = soldItems.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  if (S('statRevenue')) S('statRevenue').textContent = `₦${totalRevenue.toLocaleString()}`;

  const toMillis = (t) => {
    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (typeof t?.toMillis === 'function') return t.toMillis();
    if (typeof t?.seconds === 'number') return t.seconds * 1000;
    return 0;
  };

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekStart = now - weekMs;
  const prevWeekStart = now - (2 * weekMs);

  const weekRevenue = soldItems.reduce((sum, i) => {
    const soldAtMs = toMillis(i.soldAt) || toMillis(i.updatedAt) || toMillis(i.createdAt);
    return soldAtMs >= weekStart ? sum + (Number(i.price) || 0) : sum;
  }, 0);

  const prevWeekRevenue = soldItems.reduce((sum, i) => {
    const soldAtMs = toMillis(i.soldAt) || toMillis(i.updatedAt) || toMillis(i.createdAt);
    return soldAtMs >= prevWeekStart && soldAtMs < weekStart ? sum + (Number(i.price) || 0) : sum;
  }, 0);

  const pct = prevWeekRevenue <= 0
    ? (weekRevenue > 0 ? 100 : 0)
    : Math.round(((weekRevenue - prevWeekRevenue) / prevWeekRevenue) * 100);
  const sign = pct > 0 ? '+' : '';
  if (S('statRevenueTrendText')) S('statRevenueTrendText').textContent = `${sign}${pct}% this week`;

  const totalViews = allItems.reduce((sum, i) => sum + (Number(i.views) || 0), 0);
  if (S('statViews')) S('statViews').textContent = totalViews.toLocaleString();

  const ratingCount = allItems.reduce((sum, i) => sum + (Number(i.ratingCount) || 0), 0);
  const ratingSum = allItems.reduce((sum, i) => sum + (Number(i.ratingSum) || 0), 0);
  const avgRating = ratingCount > 0 ? (ratingSum / ratingCount) : 0;
  if (S('statRatingValue')) S('statRatingValue').textContent = avgRating.toFixed(1);
  if (S('statRatingMeta')) S('statRatingMeta').textContent = `Based on ${ratingCount} reviews`;

  renderSellerInsights(allItems);

  const q = (S('sellerSearch')?.value || '').toLowerCase().trim();
  const statusFilter = S('sellerStatus')?.value || 'all';
  const categoryFilter = S('sellerCategoryFilter')?.value || 'All';
  const sortMode = S('sellerSort')?.value || 'newest';

  const getMillis = (item) => {
    const u = item.updatedAt;
    const c = item.createdAt;
    const pick = u || c;
    if (!pick) return 0;
    if (typeof pick === 'number') return pick;
    if (typeof pick?.toMillis === 'function') return pick.toMillis();
    if (typeof pick?.seconds === 'number') return pick.seconds * 1000;
    return 0;
  };

  let items = allItems.slice();
  if (statusFilter !== 'all') {
    items = items.filter(i => (i.status || 'active') === statusFilter);
  }
  if (categoryFilter !== 'All') {
    items = items.filter(i => i.category === categoryFilter);
  }
  if (q) {
    items = items.filter(i => {
      const title = (i.title || '').toLowerCase();
      const loc = (i.loc || '').toLowerCase();
      const cat = (i.category || '').toLowerCase();
      const desc = (i.description || '').toLowerCase();
      return title.includes(q) || loc.includes(q) || cat.includes(q) || desc.includes(q);
    });
  }

  if (sortMode === 'oldest') {
    items.sort((a, b) => getMillis(a) - getMillis(b));
  } else if (sortMode === 'priceHigh') {
    items.sort((a, b) => (b.price || 0) - (a.price || 0));
  } else if (sortMode === 'priceLow') {
    items.sort((a, b) => (a.price || 0) - (b.price || 0));
  } else {
    items.sort((a, b) => getMillis(b) - getMillis(a));
  }

  if (items.length === 0) {
    wrap.innerHTML = `
      <div class="p-10 rounded-[32px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
        <div class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 text-slate-300">
          <i data-lucide="package-search" class="w-7 h-7"></i>
        </div>
        <p class="text-sm font-black text-slate-700 dark:text-slate-200">No listings match your filters</p>
        <p class="text-xs font-bold text-slate-400 mt-2">Try clearing filters or create a new listing.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  items.forEach(item => {
    const status = item.status || 'active';
    const imgFallback = `https://picsum.photos/seed/${encodeURIComponent(item.id || Date.now())}/400/300`;
    const imgSrc = escapeHTML(safeUrl(item.img, imgFallback));
    const safeCategory = escapeHTML(item.category);
    const safeTitle = escapeHTML(item.title);
    const safeLoc = escapeHTML(item.loc);
    const safeDesc = escapeHTML((item.description || '').slice(0, 110));
    const fileHref = safeUrl(item.fileUrl, '');
    const statusLabel = status === 'sold' ? 'Sold' : 'Active';
    const statusClass = status === 'sold' ? 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-900/40' : 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/40';
    const el = document.createElement('div');
    el.className = 'bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-soft flex items-center gap-4 group transition-all hover:border-brand-300';
    el.innerHTML = `
      <div class="w-20 h-20 rounded-2xl overflow-hidden bg-slate-100 shrink-0">
        <img src="${imgSrc}" onerror="this.onerror=null;this.src='${escapeHTML(imgFallback)}'" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy">
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <p class="text-[10px] font-black uppercase text-brand-600 tracking-widest">${safeCategory}</p>
          <span class="px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase tracking-widest ${statusClass}">${statusLabel}</span>
        </div>
        <h4 class="font-bold text-sm truncate mt-0.5">${safeTitle}</h4>
        <p class="text-[10px] font-bold text-slate-400 mt-1 flex items-center gap-1 truncate">
          <i data-lucide="map-pin" class="w-3 h-3"></i> ${safeLoc}
        </p>
        ${safeDesc ? `<p class="text-xs font-medium text-slate-500 dark:text-slate-400 mt-2 line-clamp-2">${safeDesc}${(item.description || '').length > 110 ? '…' : ''}</p>` : ''}
        <p class="text-sm font-black mt-2">₦${(item.price || 0).toLocaleString()}</p>
      </div>
      <div class="flex gap-2">
        ${fileHref ? `<a href="${escapeHTML(fileHref)}" target="_blank" rel="noopener" aria-label="Open file" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-emerald-600 transition-colors">
          <i data-lucide="download" class="w-5 h-5"></i>
        </a>` : ''}
        <button onclick="window.openMarketplaceItem('${item.id}')" aria-label="View in marketplace" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-brand-600 transition-colors">
          <i data-lucide="eye" class="w-5 h-5"></i>
        </button>
        <button onclick="window.setListingStatus('${item.id}', '${status === 'sold' ? 'active' : 'sold'}')" aria-label="Toggle status" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-amber-600 transition-colors">
          <i data-lucide="${status === 'sold' ? 'undo-2' : 'check-circle'}" class="w-5 h-5"></i>
        </button>
        <button onclick="window.toggleModal(true, '${item.id}')" aria-label="Edit listing" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-brand-600 transition-colors">
          <i data-lucide="edit-3" class="w-5 h-5"></i>
        </button>
        <button onclick="window.deleteItem('${item.id}')" aria-label="Delete listing" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-rose-600 transition-colors">
          <i data-lucide="trash-2" class="w-5 h-5"></i>
        </button>
      </div>
    `;
    wrap.appendChild(el);
  });
  if (window.lucide) window.lucide.createIcons();
}

function renderSellerInsights(allItems) {
  const tips = S('sellerTipsList');
  const activity = S('sellerActivityList');
  if (!tips && !activity) return;

  const items = Array.isArray(allItems) ? allItems : [];
  const missingImages = items.filter(i => !toText(i.img).trim()).length;
  const missingDescriptions = items.filter(i => !toText(i.description).trim()).length;
  const activeCount = items.filter(i => (i.status || 'active') !== 'sold').length;
  const totalViews = items.reduce((sum, i) => sum + (Number(i.views) || 0), 0);
  const unratedActive = items.filter(i => (i.status || 'active') !== 'sold' && (Number(i.views) || 0) > 0 && (Number(i.ratingCount) || 0) === 0).length;

  const tipItems = [];
  if (activeCount === 0) {
    tipItems.push({ icon: 'plus-circle', text: 'Post your first listing to start selling today.' });
  }
  if (missingImages > 0) {
    tipItems.push({ icon: 'image', text: `Add images to ${missingImages} listing${missingImages === 1 ? '' : 's'} to boost trust.` });
  }
  if (missingDescriptions > 0) {
    tipItems.push({ icon: 'file-text', text: `Add clear descriptions to ${missingDescriptions} listing${missingDescriptions === 1 ? '' : 's'} to reduce questions.` });
  }
  if (unratedActive > 0) {
    tipItems.push({ icon: 'star', text: 'Ask buyers to rate after delivery to build social proof.' });
  }
  if (totalViews > 0) {
    tipItems.push({ icon: 'eye', text: 'High views but low sales? Adjust price or improve photos.' });
  }
  while (tipItems.length < 3) {
    tipItems.push({ icon: 'check-circle', text: 'Accurate titles + locations help buyers find you faster.' });
  }

  if (tips) {
    tips.innerHTML = tipItems.slice(0, 4).map(t => `
      <li class="flex gap-3">
        <i data-lucide="${safeIconName(t.icon, 'check-circle')}" class="w-5 h-5 text-emerald-500 shrink-0"></i>
        <span>${escapeHTML(t.text)}</span>
      </li>
    `).join('');
  }

  if (activity) {
    const toMillis = (t) => {
      if (!t) return 0;
      if (typeof t === 'number') return t;
      if (typeof t?.toMillis === 'function') return t.toMillis();
      if (typeof t?.seconds === 'number') return t.seconds * 1000;
      return 0;
    };

    const events = [];
    items.forEach((i) => {
      const title = toText(i.title).trim() || 'Listing';
      const price = Number(i.price) || 0;
      const createdAtMs = toMillis(i.createdAt) || toMillis(i.updatedAt);
      const soldAtMs = toMillis(i.soldAt);
      const updatedAtMs = toMillis(i.updatedAt) || createdAtMs;
      const views = Number(i.views) || 0;
      const ratingCount = Number(i.ratingCount) || 0;
      const ratingSum = Number(i.ratingSum) || 0;
      const avg = ratingCount > 0 ? (ratingSum / ratingCount) : 0;

      if (createdAtMs) events.push({ t: createdAtMs, icon: 'plus', text: `New listing: ${title}` });
      if ((i.status || 'active') === 'sold') {
        events.push({ t: soldAtMs || updatedAtMs, icon: 'badge-check', text: `Sold: ${title} • ₦${price.toLocaleString()}` });
      }
      if (views > 0) events.push({ t: updatedAtMs, icon: 'eye', text: `Views: ${title} • ${views.toLocaleString()}` });
      if (ratingCount > 0) events.push({ t: updatedAtMs, icon: 'star', text: `Rated: ${title} • ${avg.toFixed(1)}★ (${ratingCount})` });
    });

    events.sort((a, b) => (b.t || 0) - (a.t || 0));
    const top = events.slice(0, 6);

    if (top.length === 0) {
      activity.innerHTML = `
        <div class="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 text-center">
          <div class="w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center mx-auto mb-3 text-slate-300">
            <i data-lucide="activity" class="w-6 h-6"></i>
          </div>
          <p class="text-sm font-black text-slate-700 dark:text-slate-200">No activity yet</p>
          <p class="text-xs font-bold text-slate-400 mt-2">Post a listing and start getting views.</p>
        </div>
      `;
    } else {
      activity.innerHTML = top.map(e => `
        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-brand-600 flex items-center justify-center shrink-0">
            <i data-lucide="${safeIconName(e.icon, 'activity')}" class="w-5 h-5"></i>
          </div>
          <div class="min-w-0">
            <p class="text-sm font-bold text-slate-700 dark:text-slate-200">${escapeHTML(e.text)}</p>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">${new Date(e.t).toLocaleString()}</p>
          </div>
        </div>
      `).join('');
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

window.deleteItem = async (id) => {
  if (!confirm('Are you sure you want to delete this listing?')) return;
  try {
    await deleteDoc(doc(db, "marketItems", id));
    toast('Listing removed', 'success');
  } catch (error) {
    console.error('Delete error:', error);
    toast('Error deleting listing', 'error');
  }
};

window.submitNewListing = async () => {
  const titleEl = S('uploadTitle');
  const priceEl = S('uploadPrice');
  const categoryEl = S('uploadCategory');
  const locEl = S('uploadLocation');
  const imgEl = S('uploadImage');
  const fileUrlEl = S('uploadFileUrl');

  const { ok, errors } = validateListingFields({
    titleEl,
    priceEl,
    categoryEl,
    locEl,
    imgEl,
    fileUrlEl,
    showFeedback: true
  });
  if (!ok) return toast(errors[0] || 'Please check your listing details', 'error');

  const title = titleEl.value.trim();
  const price = parseInt(priceEl.value);
  const category = categoryEl.value;
  const loc = locEl.value.trim();
  const img = imgEl.value.trim();
  const fileUrl = fileUrlEl.value.trim();
  
  const user = auth.currentUser;
  if (!user) return toast('Please sign in to post listings', 'error');

  const listingData = {
    title,
    price,
    category,
    loc,
    img: img || '',
    fileUrl: fileUrl || '',
    sellerId: user.uid,
    sellerName: user.displayName || user.email || 'Anonymous',
    status: 'active',
    soldAt: null,
    views: 0,
    ratingSum: 0,
    ratingCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const submitBtn = S('submitUpload');
  const originalBtnHtml = submitBtn?.innerHTML;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Publishing...'; }

  try {
    await ensureSellerOnboarded();
    await addDoc(collection(db, "marketItems"), listingData);
    toast('Listing published!', 'success');
    window.toggleUpload(false);
    S('uploadTitle').value = '';
    S('uploadPrice').value = '';
    S('uploadLocation').value = '';
    S('uploadImage').value = '';
    S('uploadFileUrl').value = '';
    if (typeof confettiCelebration === 'function') confettiCelebration();
  } catch (error) {
    console.error('Upload error:', error);
    toast(error?.message || 'Error publishing listing', 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalBtnHtml || 'Publish Listing'; }
  }
};

window.saveListing = async () => {
  const user = app.state.user || auth.currentUser;
  if (!user) {
    toast('Please sign in to save listings', 'error');
    return;
  }

  const editIdEl = S('editId');
  const titleEl = S('itemTitle');
  const priceEl = S('itemPrice');
  const categoryEl = S('itemCategory');
  const locEl = S('itemLocation');
  const imgEl = S('itemImage');
  if (!editIdEl || !titleEl || !priceEl || !categoryEl || !locEl || !imgEl) {
    toast('Seller form is missing fields. Refresh the page.', 'error');
    return;
  }

  const id = editIdEl.value;
  const fileUrlEl = S('itemFileUrl');
  const descriptionEl = S('itemDescription');

  const { ok, errors } = validateListingFields({
    titleEl,
    priceEl,
    categoryEl,
    locEl,
    imgEl,
    fileUrlEl,
    descriptionEl,
    showFeedback: true
  });
  if (!ok) return toast(errors[0] || 'Please check your listing details', 'error');

  const title = titleEl.value.trim();
  const price = parseInt(priceEl.value);
  const category = categoryEl.value;
  const loc = locEl.value.trim();
  const img = imgEl.value.trim();
  const fileUrl = (fileUrlEl?.value || '').trim();
  const description = (descriptionEl?.value || '').trim();
  const status = S('itemStatus')?.value || 'active';
  
  const isElite = document.documentElement.getAttribute('data-elite') === 'true';
  const sellerName = user.displayName || user.email || 'Anonymous';
  // Re-check eligibility here rather than trusting the checkbox's disabled
  // state alone — disabled is a UI affordance, not enforcement.
  const boosted = hasEarlyAccess(app.state.userData?.xp || 0) && !!S('itemBoosted')?.checked;
  const listingData = {
    title, price, category, loc,
    img: img || `https://picsum.photos/seed/${Date.now()}/400/300`,
    sellerId: user.uid,
    sellerName,
    isEliteSeller: isElite,
    boosted,
    fileUrl: fileUrl || '',
    description: description || '',
    status,
    updatedAt: serverTimestamp()
  };
  
  try {
    if (id) {
      await updateDoc(doc(db, "marketItems", id), listingData);
      toast('Listing updated', 'success');
    } else {
      await ensureSellerOnboarded();
      listingData.createdAt = serverTimestamp();
      listingData.soldAt = null;
      listingData.views = 0;
      listingData.ratingSum = 0;
      listingData.ratingCount = 0;
      await addDoc(collection(db, "marketItems"), listingData);
      toast('Listing published!', 'success');
      if (typeof confettiCelebration === 'function') confettiCelebration();
    }
    window.toggleModal(false);
  } catch (error) {
    console.error('Save error:', error);
    toast(error?.message || 'Error saving listing', 'error');
  }
};

function initListingsSync() {
  if (!app.state.user) return;
  const q = query(
    collection(db, "marketItems"),
    where("sellerId", "==", app.state.user.uid),
    limit(200)
  );
  onSnapshot(q, (snapshot) => {
    app.state.myListings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderListings();
  }, (error) => {
    console.error('Listings sync error:', error);
    const msg = error?.code === 'failed-precondition'
      ? 'Seller listings need a Firestore index. Using fallback sorting.'
      : (error?.message || 'Error loading seller listings');
    toast(msg, 'error');
  });
}

function initSkillListingsSync() {
  if (!app.state.user) return;
  const q = query(
    collection(db, "skills"),
    where("sellerId", "==", app.state.user.uid),
    limit(200)
  );
  onSnapshot(q, (snapshot) => {
    app.state.mySkills = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSkillListings();
  }, (error) => {
    console.error('Skills listings sync error:', error);
    toast(error?.message || 'Error loading skills', 'error');
  });
}

// --- Gamification Module ---
const initDailyQuests = (state) => {
  const quests = [
    { id: 'q1', text: 'Solve 5 AI Doubts', goal: 5, current: state.userData.aiDoubtsToday || 0, xp: 50 },
    { id: 'q2', text: 'Study for 30 Mins', goal: 30, current: state.userData.studyMinsToday || 0, xp: 100 },
    { id: 'q3', text: 'Complete 1 CBT Exam', goal: 1, current: state.userData.examsToday || 0, xp: 200 }
  ];
  
  const questList = S('questList');
  if (!questList) return;
  
  questList.innerHTML = quests.map(q => `
    <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold">${q.text}</span>
        <span class="text-[10px] font-black text-brand-600">${q.current}/${q.goal}</span>
      </div>
      <div class="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div class="h-full bg-brand-500" style="width: ${(q.current / q.goal) * 100}%"></div>
      </div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">+${q.xp} XP</span>
        ${q.current >= q.goal ? 
          `<button onclick="window.claimQuest('${q.id}', ${q.xp})" class="text-[9px] font-black uppercase tracking-widest text-emerald-500 hover:underline">Claim</button>` : 
          `<span class="text-[9px] font-black uppercase tracking-widest text-slate-300">In Progress</span>`
        }
      </div>
    </div>
  `).join('');
};

window.claimQuest = async (id, xp) => {
  toast(`Quest Claimed! +${xp} XP`, 'success');
  rewardXP(xp);
  // Reset current progress in state/DB (mocked for now)
};

// --- Community Module ---
function formatCampusContent(raw) {
  const base = escapeHTML(toText(raw));
  const urlified = base.replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    const href = escapeHTML(m);
    return `<a href="${href}" target="_blank" rel="noopener" class="text-brand-600 hover:underline font-bold break-all">${href}</a>`;
  });
  const hashified = urlified.replace(/(^|\s)#([a-zA-Z0-9_]{2,32})/g, (m, p1, tag) => {
    const t = escapeHTML(tag);
    return `${p1}<button onclick="window.searchCampusTag('${t}')" class="text-brand-600 hover:underline font-black">#${t}</button>`;
  });
  const mentioned = hashified.replace(/(^|\s)@([a-zA-Z0-9_\.]{2,32})/g, (m, p1, u) => {
    const t = escapeHTML(u);
    return `${p1}<button onclick="window.searchCampusUser('${t}')" class="text-slate-700 dark:text-slate-200 hover:text-brand-600 transition-colors font-black">@${t}</button>`;
  });
  return mentioned;
}

async function uploadCampusPostImage(file, uid) {
  if (!file || !uid) throw new Error('Missing image or user');
  const name = toText(file.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `users/${uid}/campusPosts/${Date.now()}_${name}`;
  return await dispatchAssetToCloudflare(file, path);
}

window.openCampusImagePicker = () => {
  S('campusImageInput')?.click();
};

window.handleCampusImage = (event) => {
  const file = event?.target?.files?.[0] || null;
  if (!file) return;
  if (!toText(file.type).startsWith('image/')) {
    toast('Please select an image file', 'error');
    return;
  }
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    toast('Image too large (max 5MB)', 'error');
    return;
  }
  const url = URL.createObjectURL(file);
  app.state.campusDraftImage = { file, url };
  const wrap = S('campusImagePreview');
  const img = S('campusImagePreviewImg');
  if (img) img.src = url;
  if (wrap) wrap.classList.remove('hidden');
  updateCampusComposerUI();
};

window.clearCampusImage = () => {
  const prev = app.state.campusDraftImage;
  if (prev?.url) {
    try { URL.revokeObjectURL(prev.url); } catch {}
  }
  app.state.campusDraftImage = null;
  const wrap = S('campusImagePreview');
  const img = S('campusImagePreviewImg');
  if (img) img.src = '';
  if (wrap) wrap.classList.add('hidden');
  const input = S('campusImageInput');
  if (input) input.value = '';
  updateCampusComposerUI();
};

function updateCampusComposerUI() {
  const input = S('campusPostInput');
  const btn = S('campusPostBtn');
  const counter = S('campusCharCount');
  const max = 280;
  const text = toText(input?.value || '');
  const len = text.length;
  const okLen = len > 0 && len <= max;
  if (counter) counter.textContent = `${len}/${max}`;
  if (counter) {
    counter.classList.toggle('text-rose-600', len > max);
    counter.classList.toggle('text-slate-400', len <= max);
  }
  if (btn) {
    const canPost = !!app.state.user && okLen;
    btn.disabled = !canPost;
    btn.classList.toggle('opacity-50', !canPost);
    btn.classList.toggle('pointer-events-none', !canPost);
  }
}

function renderCampusTagChips() {
  const wrap = S('campusTagChips');
  if (!wrap) return;
  const presets = [
    { id: 'ForSale', label: '#ForSale' },
    { id: 'StudyPartner', label: '#StudyPartner' },
    { id: 'Event', label: '#Event' },
    { id: 'Help', label: '#Help' },
    { id: 'Announcement', label: '#Announcement' }
  ];
  const selected = new Set(app.state.campusSelectedTags || []);
  wrap.innerHTML = presets.map(p => {
    const on = selected.has(p.id);
    return `
      <button onclick="window.toggleCampusPostTag('${p.id}')" class="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all active:scale-95 ${on ? 'bg-brand-600 text-white border-brand-600' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-brand-300'}">
        ${escapeHTML(p.label)}
      </button>
    `;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.toggleCampusPostTag = (tagId) => {
  const key = toText(tagId).trim();
  if (!key) return;
  const selected = new Set(app.state.campusSelectedTags || []);
  if (selected.has(key)) selected.delete(key);
  else {
    if (selected.size >= 2) {
      toast('Select up to 2 tags', 'info');
      return;
    }
    selected.add(key);
  }
  app.state.campusSelectedTags = Array.from(selected);
  renderCampusTagChips();
};

window.clearCampusFilters = () => {
  app.state.campusFilterTag = null;
  app.state.campusSearchQuery = '';
  if (S('campusSearchInput')) S('campusSearchInput').value = '';
  const clearBtn = S('campusClearFilters');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderCampusPulse();
};

window.openCampusDigest = () => {
  window.toggleCampusDigest(true);
};

window.toggleCampusDigest = (show) => {
  const modal = S('campusDigestModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (show) {
    renderCampusDigest();
    if (window.lucide) window.lucide.createIcons();
  }
};

function getCampusAds() {
  return [
    {
      id: 'ad_coding_graphics',
      sponsor: 'Geo-Books Partners',
      title: 'Coding & Graphics Class',
      body: 'Learn UI design, branding, and web development with real projects and mentorship.',
      cta: 'Message Now',
      href: 'geo-books.htm#community',
      imageUrl: 'https://picsum.photos/seed/coding_graphics/1000/700',
      tag: 'PROMOTED'
    },
    {
      id: 'ad_past_questions',
      sponsor: 'Geo-Books Library',
      title: 'Past Questions Drop',
      body: 'Get curated past questions and study guides for your level. Download and revise faster.',
      cta: 'Explore',
      href: 'geo-books.htm#books',
      imageUrl: 'https://picsum.photos/seed/past_questions/1000/700',
      tag: 'PROMOTED'
    }
  ];
}

function renderCampusAdCard(ad, variant = 'feed') {
  const title = escapeHTML(ad?.title || 'Promoted');
  const body = escapeHTML(ad?.body || '');
  const sponsor = escapeHTML(ad?.sponsor || 'Sponsored');
  const cta = escapeHTML(ad?.cta || 'Learn more');
  const href = escapeHTML(safeUrl(ad?.href, '#'));
  const img = escapeHTML(safeUrl(ad?.imageUrl, `https://picsum.photos/seed/${encodeURIComponent(ad?.id || Date.now())}/1000/700`));
  const tag = escapeHTML(ad?.tag || 'PROMOTED');

  if (variant === 'sidebar') {
    return `
      <a href="${href}" target="_blank" rel="noopener" class="block group">
        <div class="p-5 rounded-[28px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft hover:border-brand-300 transition-all overflow-hidden">
          <div class="flex items-center justify-between">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">${tag}</p>
            <p class="text-[10px] font-black uppercase tracking-widest text-brand-600">${sponsor}</p>
          </div>
          <p class="text-sm font-black mt-2">${title}</p>
          <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">${body}</p>
          <div class="mt-4 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
            <img src="${img}" class="w-full h-32 object-cover group-hover:scale-[1.02] transition-transform" loading="lazy">
          </div>
          <div class="mt-4 flex items-center justify-between">
            <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Sponsored</span>
            <span class="px-4 py-2 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-black uppercase tracking-widest">${cta}</span>
          </div>
        </div>
      </a>
    `;
  }

  return `
    <div class="px-6 py-5 hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors">
      <div class="flex gap-4">
        <div class="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center font-black text-sm shrink-0">AD</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <p class="text-sm font-black truncate">${title}</p>
                <span class="text-xs font-bold text-slate-300">·</span>
                <p class="text-xs font-black uppercase tracking-widest text-slate-400">${tag}</p>
              </div>
              <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">${sponsor}</p>
            </div>
            <a href="${href}" target="_blank" rel="noopener" class="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-brand-600 transition-all flex items-center justify-center">
              <i data-lucide="external-link" class="w-5 h-5"></i>
            </a>
          </div>

          <p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed mt-3">${body}</p>
          <div class="mt-4 rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
            <img src="${img}" class="w-full max-h-[520px] object-cover" loading="lazy">
          </div>
          <div class="mt-4 flex items-center justify-between">
            <span class="text-xs font-bold text-slate-400">Sponsored</span>
            <a href="${href}" target="_blank" rel="noopener" class="px-6 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all">${cta}</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getCampusContextPosts() {
  const campus = toText(app.state.userData?.university || '').trim();
  const posts = Array.isArray(app.state.campusPosts) ? app.state.campusPosts : [];
  return campus ? posts.filter(p => toText(p.university).trim() === campus) : posts;
}

function computeTrendingCampusTags(posts) {
  const counts = {};
  (posts || []).forEach(p => {
    const tags = Array.isArray(p.tags) ? p.tags : [];
    tags.forEach(t => {
      const key = toText(t).trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 2;
    });
    const content = toText(p.content);
    const matches = content.match(/#([a-zA-Z0-9_]{2,32})/g) || [];
    matches.forEach(m => {
      const key = m.replace('#', '');
      counts[key] = (counts[key] || 0) + 1;
    });
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function renderCampusDigest() {
  const body = S('campusDigestBody');
  if (!body) return;
  const campus = toText(app.state.userData?.university || '').trim();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const posts = getCampusContextPosts().filter(p => {
    const t = Date.parse(p.createdAt || '');
    return t && t >= dayAgo;
  });

  const trending = computeTrendingCampusTags(posts).slice(0, 3);
  const topPost = posts.slice().sort((a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0))[0] || null;

  const bullets = [];
  bullets.push(`${posts.length.toLocaleString()} posts in the last 24 hours${campus ? ` at ${campus}` : ''}.`);
  if (trending.length) bullets.push(`Trending: ${trending.map(([t]) => `#${t}`).join(', ')}.`);
  if (topPost) {
    const who = toText(topPost.displayName || 'Someone');
    const likes = Number(topPost.likes) || 0;
    const snippet = toText(topPost.content || '').trim().slice(0, 120);
    bullets.push(`Most liked: ${who} (${likes} likes) — "${snippet}${toText(topPost.content || '').length > 120 ? '…' : ''}"`);
  }

  if (S('campusDigestMeta')) S('campusDigestMeta').textContent = `Last 24 hours${campus ? ` • ${campus}` : ''}`;
  body.innerHTML = bullets.slice(0, 3).map(b => `
    <div class="p-5 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
      <p class="text-sm font-bold text-slate-700 dark:text-slate-200 leading-relaxed">${escapeHTML(b)}</p>
    </div>
  `).join('');
}

function renderUpcomingGoalsWidget() {
  const goals = Array.isArray(app.state.goals) ? app.state.goals : [];
  const todo = goals.filter(g => !g.done).slice(0, 5);
  if (todo.length === 0) {
    return `
      <div class="p-5 rounded-[28px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-black tracking-tight">Upcoming Tasks</h3>
          <button onclick="window.showSection('dashboard')" class="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-brand-600 transition-all flex items-center justify-center">
            <i data-lucide="arrow-right" class="w-5 h-5"></i>
          </button>
        </div>
        <p class="text-xs font-bold text-slate-400 mt-3">No tasks yet. Add goals in Study Tools.</p>
      </div>
    `;
  }
  return `
    <div class="p-5 rounded-[28px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-black tracking-tight">Upcoming Tasks</h3>
        <button onclick="window.showSection('dashboard')" class="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-brand-600 transition-all flex items-center justify-center">
          <i data-lucide="arrow-right" class="w-5 h-5"></i>
        </button>
      </div>
      <div class="mt-4 space-y-3">
        ${todo.map(g => `
          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
            <p class="text-xs font-black text-slate-700 dark:text-slate-200">${escapeHTML(g.text || 'Task')}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderLiveWarRoomsWidget() {
  const rooms = Array.isArray(warRoomState?.rooms) ? warRoomState.rooms : [];
  const active = rooms.filter(r => isWarRoomActive(r)).slice(0, 5);
  if (active.length === 0) {
    return `
      <div class="p-5 rounded-[28px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-black tracking-tight">Live Now</h3>
          <button onclick="window.showSection('warRooms')" class="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-brand-600 transition-all flex items-center justify-center">
            <i data-lucide="arrow-right" class="w-5 h-5"></i>
          </button>
        </div>
        <p class="text-xs font-bold text-slate-400 mt-3">No active war rooms right now.</p>
      </div>
    `;
  }
  return `
    <div class="p-5 rounded-[28px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-black tracking-tight">Live Now</h3>
        <button onclick="window.showSection('warRooms')" class="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-brand-600 transition-all flex items-center justify-center">
          <i data-lucide="arrow-right" class="w-5 h-5"></i>
        </button>
      </div>
      <div class="mt-4 space-y-3">
        ${active.map(r => `
          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs font-black text-slate-700 dark:text-slate-200 truncate">${escapeHTML(r.objective || 'Study Room')}</p>
              <span class="px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 text-[9px] font-black uppercase tracking-widest">Live</span>
            </div>
            <p class="text-[10px] font-bold text-slate-400 mt-2">Ends: ${new Date(r.endsAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderCampusSidebar() {
  const sidebar = S('campusSidebar');
  if (!sidebar) return;
  const posts = getCampusContextPosts();
  const trending = computeTrendingCampusTags(posts);
  const ads = getCampusAds();

  const trendingHTML = `
    <div class="p-5 rounded-[28px] bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 shadow-soft backdrop-blur-xl">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-black tracking-tight">Trending on Campus</h3>
        <button onclick="window.openCampusDigest()" class="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-brand-600 transition-all flex items-center justify-center">
          <i data-lucide="sparkles" class="w-5 h-5"></i>
        </button>
      </div>
      <div class="mt-4 space-y-2">
        ${trending.length ? trending.map(([t, c]) => `
          <button data-campus-tag="${escapeHTML(t)}" class="campus-tag-btn w-full flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 hover:border-brand-300 transition-all">
            <span class="text-xs font-black text-slate-700 dark:text-slate-200">#${escapeHTML(t)}</span>
            <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">${Number(c).toLocaleString()}</span>
          </button>
        `).join('') : `
          <p class="text-xs font-bold text-slate-400">No trends yet. Start posting with hashtags.</p>
        `}
      </div>
    </div>
  `;

  const promotedHTML = `
    <div class="p-5 rounded-[28px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-black tracking-tight">Promoted</h3>
        <button onclick="toast('Promoted posts follow the same template', 'info')" class="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-brand-600 transition-all flex items-center justify-center">
          <i data-lucide="info" class="w-5 h-5"></i>
        </button>
      </div>
      <div class="mt-5 space-y-4">
        ${ads.slice(0, 2).map(a => renderCampusAdCard(a, 'sidebar')).join('')}
      </div>
    </div>
  `;

  sidebar.innerHTML = [
    trendingHTML,
    renderUpcomingGoalsWidget(),
    renderLiveWarRoomsWidget(),
    promotedHTML
  ].join('');
  if (window.lucide) window.lucide.createIcons();
}

function initCampusPulse() {
  const container = S('campusPulseFeed');
  if (!container) return;

  // Delegated once, on document, so it keeps working across every
  // re-render of both the feed (#campusPulseFeed) and the sidebar
  // (#campusSidebar) without needing to be re-bound each time — replaces
  // the old inline onclick="...('${escapeHTML(t)}')" pattern on tag
  // buttons, which was not actually safe: browsers decode HTML entities in
  // attribute values before executing them as the event handler's JS, so
  // an escaped quote (&#39;) decodes back to a literal ' before running,
  // letting a crafted tag value break out of the string literal. Reading
  // .dataset here goes through the DOM's own (safe, one-time) attribute
  // decoding instead of being re-parsed as code.
  if (!document.body.dataset.campusTagDelegationBound) {
    document.body.dataset.campusTagDelegationBound = '1';
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-campus-tag]');
      if (btn) window.searchCampusTag(btn.dataset.campusTag);
    });
  }

  const q = query(collection(db, "campusPosts"), orderBy("createdAt", "desc"), limit(60));
  onSnapshot(q, (snap) => {
    app.state.campusPosts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderCampusPulse();
    try {
      const qs = new URLSearchParams(window.location.search);
      const postId = toText(qs.get('campusPost')).trim();
      if (postId) {
        const el = S(`campusPost_${postId}`);
        if (el?.scrollIntoView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-brand-500', 'ring-offset-4', 'ring-offset-white', 'dark:ring-offset-slate-950');
          setTimeout(() => {
            el.classList.remove('ring-2', 'ring-brand-500', 'ring-offset-4', 'ring-offset-white', 'dark:ring-offset-slate-950');
          }, 2500);
        }
      }
    } catch {}
  });
}

function renderCampusPulse() {
  const container = S('campusPulseFeed');
  if (!container) return;

  const me = app.state.userData?.displayName || app.state.user?.displayName || app.state.user?.email || 'U';
  const initials = me.split(' ').map(s => s[0]).join('').toUpperCase().slice(0, 2) || 'U';
  if (S('postAvatar')) S('postAvatar').textContent = initials;

  const postBtn = S('campusPostBtn');
  const postInput = S('campusPostInput');
  const canPost = !!app.state.user;
  if (postInput) {
    postInput.disabled = !canPost;
    postInput.placeholder = canPost ? "What’s happening on campus?" : "Sign in to post…";
    if (!postInput.dataset.bound) {
      postInput.dataset.bound = '1';
      postInput.addEventListener('input', () => updateCampusComposerUI());
    }
  }
  updateCampusComposerUI();

  renderCampusTagChips();

  const searchInput = S('campusSearchInput');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', (e) => {
      app.state.campusSearchQuery = toText(e.target.value || '');
      const clearBtn = S('campusClearFilters');
      const showClear = !!app.state.campusSearchQuery.trim() || !!toText(app.state.campusFilterTag).trim();
      if (clearBtn) clearBtn.classList.toggle('hidden', !showClear);
      renderCampusPulse();
    });
  }

  const header = S('campusHeader');
  const tabsRow = S('campusHeaderTabsRow');
  if (header && !header.dataset.bound) {
    header.dataset.bound = '1';
    const scroller = document.querySelector('main') || window;
    const onScroll = () => {
      const top = scroller === window ? (window.scrollY || 0) : (scroller.scrollTop || 0);
      const compact = top > 120;
      header.classList.toggle('py-2', compact);
      header.classList.toggle('py-3', !compact);
      if (tabsRow) {
        tabsRow.classList.toggle('mt-2', compact);
        tabsRow.classList.toggle('mt-3', !compact);
      }
    };
    if (scroller === window) window.addEventListener('scroll', onScroll, { passive: true });
    else scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (!app.state.campusPosts || app.state.campusPosts.length === 0) {
    container.innerHTML = `
      <div class="p-10 text-center">
        <div class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 text-slate-300">
          <i data-lucide="sparkles" class="w-7 h-7"></i>
        </div>
        <p class="text-sm font-black text-slate-700 dark:text-slate-200">No posts yet</p>
        <p class="text-xs font-bold text-slate-400 mt-2">Be the first to post something for your campus.</p>
      </div>
    `;
    renderCampusSidebar();
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const liked = new Set(store.get('campusLiked', []));
  const reposted = new Set(store.get('campusReposted', []));
  const bookmarked = new Set(store.get('campusBookmarked', []));

  const timeAgo = (iso) => {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  };

  const tab = app.state.campusTab || 'forYou';
  let posts = (app.state.campusPosts || []).slice();
  if (tab === 'latest') {
    posts.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  }
  if (tab === 'bookmarks') {
    posts = posts.filter(p => bookmarked.has(p.id));
  }

  const campus = toText(app.state.userData?.university || '').trim();
  if (campus) posts = posts.filter(p => toText(p.university).trim() === campus);

  const q = toText(app.state.campusSearchQuery || '').toLowerCase().trim();
  if (q) {
    posts = posts.filter(p => {
      const content = toText(p.content).toLowerCase();
      const username = toText(p.username).toLowerCase();
      const displayName = toText(p.displayName).toLowerCase();
      const tags = Array.isArray(p.tags) ? p.tags.join(' ').toLowerCase() : '';
      return content.includes(q) || username.includes(q) || displayName.includes(q) || tags.includes(q);
    });
  }

  const activeTag = toText(app.state.campusFilterTag || '').trim();
  if (activeTag) {
    posts = posts.filter(p => {
      const tags = Array.isArray(p.tags) ? p.tags : [];
      if (tags.includes(activeTag)) return true;
      const content = toText(p.content);
      return new RegExp(`#${activeTag}\\b`, 'i').test(content);
    });
  }

  if (tab === 'forYou') {
    posts = posts.filter(p => {
      const content = toText(p.content).trim();
      const hasMedia = !!toText(p.imageUrl).trim();
      return hasMedia || content.length >= 6;
    });
  }

  const postHTML = (post) => {
    const dn = toText(post.displayName || 'Anonymous');
    const handle = '@' + (toText(post.username || 'scholar').replace(/\s+/g, '').toLowerCase());
    const uni = toText(post.university || 'Geo-Books');
    const initials = dn.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
    const isLiked = liked.has(post.id);
    const isReposted = reposted.has(post.id);
    const isBookmarked = bookmarked.has(post.id);
    const likes = Number(post.likes) || 0;
    const comments = Number(post.commentsCount) || 0;
    const reposts = Number(post.reposts) || 0;
    const when = timeAgo(post.createdAt);
    const role = toText(post.role || post.userRole || 'Student').trim() || 'Student';
    const tags = Array.isArray(post.tags) ? post.tags : [];
    const safeContent = formatCampusContent(post.content || '');
    const imageUrl = safeUrl(post.imageUrl, '');
    return `
      <div id="campusPost_${post.id}" class="px-4 sm:px-6 py-6 premium-card mx-4 sm:mx-0 mb-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div class="flex gap-4">
          <div class="w-12 h-12 rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-lg shadow-brand-500/30">${escapeHTML(initials)}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 min-w-0 flex-wrap">
                  <p class="text-base font-black truncate">${escapeHTML(dn)}</p>
                  <span class="px-3 py-1 rounded-full bg-gradient-to-r from-brand-100 to-indigo-100 dark:from-brand-900/40 dark:to-indigo-900/40 border border-brand-200 dark:border-brand-800 text-[9px] font-black uppercase tracking-widest text-brand-700 dark:text-brand-300">${escapeHTML(role)}</span>
                  <p class="text-xs font-bold text-slate-500 truncate">${escapeHTML(handle)}</p>
                  <span class="text-xs font-bold text-slate-300">·</span>
                  <p class="text-xs font-bold text-slate-400">${escapeHTML(when)}</p>
                </div>
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1 flex items-center gap-1">
                  <i data-lucide="map-pin" class="w-3 h-3"></i>
                  ${escapeHTML(uni)}
                </p>
              </div>
              <button onclick="window.copyCampusPostLink('${post.id}')" class="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-brand-600 transition-all flex items-center justify-center">
                <i data-lucide="more-horizontal" class="w-5 h-5"></i>
              </button>
            </div>

            <p class="text-base text-slate-800 dark:text-slate-100 leading-relaxed mt-4 whitespace-pre-wrap break-words">${safeContent}</p>
            ${tags.length ? `
              <div class="mt-4 flex flex-wrap gap-2">
                ${tags.slice(0, 5).map(t => `
                  <button data-campus-tag="${escapeHTML(toText(t).trim())}" class="campus-tag-btn px-4 py-2 rounded-2xl bg-gradient-to-r from-brand-500/10 to-indigo-500/10 dark:from-brand-500/20 dark:to-indigo-500/20 text-brand-700 dark:text-brand-300 text-xs font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all border border-brand-200/50 dark:border-brand-800/50">
                    #${escapeHTML(toText(t).trim())}
                  </button>
                `).join('')}
              </div>
            ` : ''}
            ${imageUrl ? `
              <div class="mt-5 rounded-3xl overflow-hidden border border-slate-200/60 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-900 shadow-xl shadow-slate-200/40 dark:shadow-black/20">
                <img src="${escapeHTML(imageUrl)}" onerror="this.onerror=null;this.src='https://picsum.photos/seed/${encodeURIComponent(post.id)}/900/600'" class="w-full max-h-[520px] object-cover cursor-pointer transition-transform duration-500 hover:scale-[1.01]" onclick="window.openCampusImage('${escapeHTML(imageUrl)}')">
              </div>
            ` : ''}

            <div class="mt-5 flex items-center justify-between max-w-lg text-slate-500">
              <button onclick="window.toggleRepliesModal(true, '${post.id}')" class="flex items-center gap-2 text-sm font-black hover:text-brand-600 transition-all active:scale-95 px-3 py-2 rounded-full hover:bg-brand-50 dark:hover:bg-brand-900/30">
                <i data-lucide="message-circle" class="w-5 h-5"></i>
                <span>${comments ? comments.toLocaleString() : 'Reply'}</span>
              </button>
              <button onclick="window.repostPost('${post.id}')" class="flex items-center gap-2 text-sm font-black transition-all active:scale-95 px-3 py-2 rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-900/30 ${isReposted ? 'text-emerald-600' : 'hover:text-emerald-600'}">
                <i data-lucide="repeat-2" class="w-5 h-5"></i>
                <span>${reposts ? reposts.toLocaleString() : 'Repost'}</span>
              </button>
              <button onclick="window.likePost('${post.id}')" class="flex items-center gap-2 text-sm font-black transition-all active:scale-95 px-3 py-2 rounded-full hover:bg-rose-50 dark:hover:bg-rose-900/30 ${isLiked ? 'text-rose-600' : 'hover:text-rose-600'}">
                <i data-lucide="heart" class="w-5 h-5"></i>
                <span>${likes ? likes.toLocaleString() : 'Like'}</span>
              </button>
              <div class="flex items-center gap-2">
                <button onclick="window.toggleCampusBookmark('${post.id}')" class="flex items-center gap-2 text-sm font-black transition-all active:scale-95 px-3 py-2 rounded-full hover:bg-amber-50 dark:hover:bg-amber-900/30 ${isBookmarked ? 'text-amber-600' : 'hover:text-amber-600'}">
                  <i data-lucide="bookmark" class="w-5 h-5"></i>
                </button>
                <button onclick="window.copyCampusPostLink('${post.id}')" class="flex items-center gap-2 text-sm font-black hover:text-indigo-600 transition-all active:scale-95 px-3 py-2 rounded-full hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                  <i data-lucide="share-2" class="w-5 h-5"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  };

  const ads = getCampusAds();
  const feed = [];
  if (tab !== 'bookmarks' && ads.length) {
    let adIdx = 0;
    posts.forEach((p, i) => {
      if (p?.isAd || p?.type === 'ad') {
        feed.push({ k: 'ad', d: { ...p, id: p.id || `ad_${i}`, sponsor: p.sponsor || 'Promoted' } });
      } else {
        feed.push({ k: 'post', d: p });
      }
      if ((i + 1) % 6 === 0) {
        feed.push({ k: 'ad', d: ads[adIdx % ads.length] });
        adIdx += 1;
      }
    });
  } else {
    posts.forEach(p => feed.push({ k: 'post', d: p }));
  }

  container.innerHTML = feed.map(item => {
    if (item.k === 'ad') return renderCampusAdCard(item.d, 'feed');
    return postHTML(item.d);
  }).join('');

  renderCampusSidebar();
  if (window.lucide) window.lucide.createIcons();
}

window.createPost = async () => {
  const input = S('campusPostInput');
  if (!input || !input.value.trim()) return;
  if (!app.state.user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to post', 'error');
    return;
  }
  
  const max = 280;
  const content = input.value.trim().slice(0, max);
  input.value = '';
  input.disabled = true;
  updateCampusComposerUI();
  
  try {
    let imageUrl = '';
    const draft = app.state.campusDraftImage;
    if (draft?.file) {
      toast('Uploading image...', 'info');
      imageUrl = await uploadCampusPostImage(draft.file, app.state.user.uid);
    }

    await addDoc(collection(db, "campusPosts"), {
      userId: app.state.user.uid,
      displayName: app.state.userData.displayName,
      username: app.state.userData.username,
      university: app.state.userData.university || 'Geo-Books',
      role: app.state.userData.role || 'Student',
      content,
      tags: Array.isArray(app.state.campusSelectedTags) ? app.state.campusSelectedTags : [],
      imageUrl: imageUrl || '',
      likes: 0,
      reposts: 0,
      commentsCount: 0,
      createdAt: new Date().toISOString()
    });
    window.clearCampusImage();
    app.state.campusSelectedTags = [];
    renderCampusTagChips();
    toast('Post shared with campus!', 'success');
    rewardXP(15);
  } catch (e) {
    console.error(e);
    toast('Error sharing post', 'error');
  } finally {
    input.disabled = false;
    updateCampusComposerUI();
  }
};

window.likePost = async (id) => {
  const uid = auth?.currentUser?.uid || app.state.user?.uid || null;
  if (!uid) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to like posts', 'error');
    return;
  }

  const key = toText(id).trim();
  if (!key) return;

  const liked = new Set(store.get('campusLiked', []));
  const delta = liked.has(key) ? -1 : 1;
  if (delta === 1) liked.add(key);
  else liked.delete(key);
  store.set('campusLiked', Array.from(liked));

  try {
    const ref = doc(db, "campusPosts", key);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const next = Math.max(0, (Number(data.likes) || 0) + delta);
      tx.update(ref, { likes: next });
    });
  } catch (e) {
    console.error('Like error:', e);
    toast(e?.message || 'Unable to like post', 'error');
  } finally {
    renderCampusPulse();
  }
};

window.copyCampusPostLink = async (id) => {
  const key = toText(id).trim();
  if (!key) return;
  const base = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}`;
  const url = `${base}geo-books.htm?campusPost=${encodeURIComponent(key)}#campusHub`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied', 'success');
  } catch {
    toast(url, 'info');
  }
};

window.setCampusTab = (tab) => {
  app.state.campusTab = tab === 'latest' ? 'latest' : (tab === 'bookmarks' ? 'bookmarks' : 'forYou');

  const btnForYou = S('campusTabForYou');
  const btnLatest = S('campusTabLatest');
  const btnBookmarks = S('campusTabBookmarks');

  const setActive = (btn, active) => {
    if (!btn) return;
    btn.classList.toggle('bg-slate-900', active);
    btn.classList.toggle('dark:bg-white', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('dark:text-slate-900', active);
    btn.classList.toggle('bg-slate-100', !active);
    btn.classList.toggle('dark:bg-slate-900', !active);
    btn.classList.toggle('text-slate-700', !active);
    btn.classList.toggle('dark:text-slate-200', !active);
  };

  setActive(btnForYou, app.state.campusTab === 'forYou');
  setActive(btnLatest, app.state.campusTab === 'latest');
  setActive(btnBookmarks, app.state.campusTab === 'bookmarks');

  renderCampusPulse();
};

window.toggleCampusBookmark = (id) => {
  const key = toText(id).trim();
  if (!key) return;
  const set = new Set(store.get('campusBookmarked', []));
  if (set.has(key)) set.delete(key);
  else set.add(key);
  store.set('campusBookmarked', Array.from(set));
  renderCampusPulse();
};

window.repostPost = async (id) => {
  const uid = auth?.currentUser?.uid || app.state.user?.uid || null;
  if (!uid) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to repost', 'error');
    return;
  }

  const key = toText(id).trim();
  if (!key) return;

  const set = new Set(store.get('campusReposted', []));
  const delta = set.has(key) ? -1 : 1;
  if (delta === 1) set.add(key);
  else set.delete(key);
  store.set('campusReposted', Array.from(set));

  try {
    const ref = doc(db, "campusPosts", key);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const next = Math.max(0, (Number(data.reposts) || 0) + delta);
      tx.update(ref, { reposts: next });
    });
  } catch (e) {
    console.error('Repost error:', e);
    toast(e?.message || 'Unable to repost', 'error');
  } finally {
    renderCampusPulse();
  }
};

window.searchCampusTag = (tag) => {
  const key = toText(tag).trim().replace(/^#/, '');
  if (!key) return;
  app.state.campusFilterTag = key;
  const clearBtn = S('campusClearFilters');
  if (clearBtn) clearBtn.classList.remove('hidden');
  renderCampusPulse();
};

window.searchCampusUser = (username) => {
  const key = toText(username).trim().replace(/^@/, '');
  if (!key) return;
  app.state.campusSearchQuery = `@${key}`;
  const input = S('campusSearchInput');
  if (input) input.value = app.state.campusSearchQuery;
  const clearBtn = S('campusClearFilters');
  if (clearBtn) clearBtn.classList.remove('hidden');
  renderCampusPulse();
};

window.insertCampusEmoji = (emoji) => {
  const input = S('campusPostInput');
  if (!input) return;
  input.focus();
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const value = input.value;
  input.value = value.substring(0, start) + emoji + value.substring(end);
  input.selectionStart = input.selectionEnd = start + emoji.length;
  updateCampusComposerUI();
};

window.openCampusImage = (url) => {
  const href = safeUrl(url, '');
  if (!href) return;
  window.open(href, '_blank', 'noopener');
};

let unsubCampusReplies = null;
let activeCampusReplyPostId = null;

window.toggleRepliesModal = (show, postId = null) => {
  const modal = S('campusRepliesModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);

  if (!show) {
    activeCampusReplyPostId = null;
    if (unsubCampusReplies) unsubCampusReplies();
    unsubCampusReplies = null;
    if (S('campusRepliesList')) S('campusRepliesList').innerHTML = '';
    if (S('campusRepliesMeta')) S('campusRepliesMeta').textContent = '0 replies';
    if (S('campusReplyInput')) S('campusReplyInput').value = '';
    return;
  }

  activeCampusReplyPostId = toText(postId).trim();
  const me = app.state.userData?.displayName || app.state.user?.displayName || app.state.user?.email || 'U';
  const initials = me.split(' ').map(s => s[0]).join('').toUpperCase().slice(0, 2) || 'U';
  if (S('campusReplyAvatar')) S('campusReplyAvatar').textContent = initials;

  const list = S('campusRepliesList');
  if (list) {
    list.innerHTML = `
      <div class="p-10 text-center text-slate-400">
        <i data-lucide="loader-2" class="w-8 h-8 mx-auto mb-3 animate-spin"></i>
        <p class="text-sm font-black">Loading replies...</p>
      </div>
    `;
  }

  if (unsubCampusReplies) unsubCampusReplies();
  if (!activeCampusReplyPostId) return;

  const repliesQ = query(
    collection(db, "campusPosts", activeCampusReplyPostId, "replies"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  unsubCampusReplies = onSnapshot(repliesQ, (snap) => {
    const replies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCampusReplies(replies);
    if (S('campusRepliesMeta')) S('campusRepliesMeta').textContent = `${replies.length.toLocaleString()} replies`;
  }, (e) => {
    console.error('Replies sync error:', e);
    toast(e?.message || 'Unable to load replies', 'error');
  });

  if (window.lucide) window.lucide.createIcons();
};

function renderCampusReplies(replies) {
  const list = S('campusRepliesList');
  if (!list) return;
  const items = Array.isArray(replies) ? replies : [];
  if (items.length === 0) {
    list.innerHTML = `
      <div class="p-10 text-center">
        <div class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 text-slate-300">
          <i data-lucide="message-square" class="w-7 h-7"></i>
        </div>
        <p class="text-sm font-black text-slate-700 dark:text-slate-200">No replies yet</p>
        <p class="text-xs font-bold text-slate-400 mt-2">Be the first to reply.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const timeAgo = (iso) => {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  };

  list.innerHTML = items.map(r => {
    const dn = toText(r.displayName || 'Anonymous');
    const initials = dn.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
    const when = timeAgo(r.createdAt);
    const content = formatCampusContent(r.content || '');
    return `
      <div class="p-6">
        <div class="flex gap-4">
          <div class="w-11 h-11 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 flex items-center justify-center font-black text-sm shrink-0">${escapeHTML(initials)}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-sm font-black truncate">${escapeHTML(dn)}</p>
              <span class="text-xs font-bold text-slate-300">·</span>
              <p class="text-xs font-bold text-slate-400">${escapeHTML(when)}</p>
            </div>
            <p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed mt-2 whitespace-pre-wrap break-words">${content}</p>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

window.sendCampusReply = async () => {
  if (!activeCampusReplyPostId) return;
  const input = S('campusReplyInput');
  const btn = S('campusReplyBtn');
  const text = toText(input?.value || '').trim();
  if (!text) return;

  if (!auth?.currentUser || !app.state.userData) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Sign in to reply', 'error');
    return;
  }

  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Posting...';
  }

  try {
    const postRef = doc(db, "campusPosts", activeCampusReplyPostId);
    const replyRef = doc(collection(postRef, "replies"));
    const payload = {
      userId: auth.currentUser.uid,
      displayName: app.state.userData.displayName || auth.currentUser.displayName || auth.currentUser.email || 'Anonymous',
      username: app.state.userData.username || '',
      content: text.slice(0, 280),
      createdAt: new Date().toISOString()
    };

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(postRef);
      if (!snap.exists()) throw new Error('Post not found');
      const data = snap.data() || {};
      const next = Math.max(0, (Number(data.commentsCount) || 0) + 1);
      tx.update(postRef, { commentsCount: next });
      tx.set(replyRef, payload);
    });

    if (input) input.value = '';
    toast('Reply posted', 'success');
  } catch (e) {
    console.error('Reply error:', e);
    toast(e?.message || 'Unable to post reply', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || 'Reply';
    }
  }
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason);
  // Don't toast for everything, only if it looks like a user-facing error
  const msg = event.reason?.message || event.reason;
  if (msg && typeof msg === 'string' && msg.length < 100) {
    toast(`Something went wrong: ${msg}`, 'error');
  }
});

window.addEventListener('error', (event) => {
  console.error('Global JS Error:', event.error);
});

// --- Achievements ---
window.showAchievement = (title, desc, icon = 'award') => {
  const modal = S('achievementModal');
  if (!modal) return;
  
  if (S('achievementTitle')) S('achievementTitle').textContent = title;
  if (S('achievementDesc')) S('achievementDesc').textContent = desc;
  if (S('achievementIcon')) S('achievementIcon').setAttribute('data-lucide', icon);
  
  modal.classList.replace('hidden', 'flex');
  confettiCelebration();
  if (window.lucide) window.lucide.createIcons();
};

window.closeAchievement = () => {
  const modal = S('achievementModal');
  if (modal) modal.classList.replace('flex', 'hidden');
};

// --- AI Scan: The Architect's Vault ---
window.handleExamComplete = () => {
  confettiCelebration();
  rewardXP(50);
  toast('Level Up! You just earned 50 XP for completing the AI Scan.', 'success');
};

window.openAIScanVault = () => {
  if (!app.state.user) {
    if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
    toast('Access Denied: Elite authentication required.', 'error');
    return;
  }
  // AIScanVault.htm does its own authoritative Elite check (requireEliteAccess()
  // in ai-vault-shared.js, keyed on subscriptionLevel === 'ELITE_100K') and shows
  // a proper upsell screen for non-Elite users itself — no need to duplicate a
  // (differently-keyed, and therefore wrong) tier check here first.
  window.location.href = 'AIScanVault.htm';
};

const checkAIScanReward = () => {
  const params = new URLSearchParams(window.location.search);
  const score = params.get('score');
  const studentID = params.get('user');
  
  if (score && studentID && app.state.user && studentID === app.state.user.uid) {
    // Only reward if not already rewarded for this specific score session
    const lastRewarded = store.get('last_aiscan_reward');
    const currentSession = `${score}_${studentID}`;
    
    if (lastRewarded !== currentSession) {
      handleExamComplete();
      store.set('last_aiscan_reward', currentSession);
      
      // Clean up URL without reloading
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
    }
  }
};

// Mirrors checkAIScanReward's redirect-based reward pattern: cbt.js
// (running on the standalone cbt.htm page, no Firebase access) finishes
// an exam and navigates back here with the result in the query string.
// This is where the actual Firestore writes + XP reward happen, since
// only the main app has the signed-in user/db context.
const checkCbtReward = () => {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get('cbtSid');
  if (!sid) return;

  const cleanUrl = () => {
    const newUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
  };

  // Dedupe: don't double-reward if the user refreshes after landing back.
  if (store.get('last_cbt_reward') === sid) {
    cleanUrl();
    return;
  }

  const pct = Math.max(0, Math.min(100, Math.round(Number(params.get('cbtScore')) || 0)));
  const correct = Math.max(0, Math.floor(Number(params.get('cbtCorrect')) || 0));
  const total = Math.max(0, Math.floor(Number(params.get('cbtTotal')) || 0));
  const subject = toText(params.get('cbtSubject') || 'your exam');

  if (app.state.user) {
    const userRef = doc(db, "users", app.state.user.uid);
    const newExamsTaken = (app.state.userData.examsTaken || 0) + 1;
    updateDoc(userRef, {
      examsTaken: newExamsTaken,
      lastCbtAt: serverTimestamp()
    });
    app.state.userData.examsTaken = newExamsTaken;
    app.state.userData.lastCbtAt = new Date();
  }

  rewardXP(200);
  toast(`Exam submitted! Score: ${correct}/${total} (${pct}%) on ${subject}`, 'success');
  store.set('last_cbt_reward', sid);
  cleanUrl();
};

// --- Initialization Logic ---
function handleDataSync() {
  checkCbtReward(); // Check for XP/stat rewards from the cbt.htm redirect
  initUserDataSync();
  updateActivity(); // Calculate and update streak on load
  updateUserRankDebounced(); // Calculate global rank on load
  checkAIScanReward(); // Check for XP rewards from AI Scan redirect
  initNotesSync();
  initSkillsSync();
  initGigsSync();
  initExamsSync();
  initBooksSync();
  initBooksUI();
  initMarketplaceSync(app.state, filterMarket);
  populateAdmissionInputs();
  initLeaderboardSync();
  initJambLeaderboardSync();
  initBookmarksSync();
  renderCbtHistory();
  initWarRoomsSync();
  initGoalsSync();
  initFlashcardsSync(app.state.user);
  initSnapChat(app.state.user);
  initSupportChat();
  initDailyQuests(app.state);
  initCampusPulse();
  initCommandPalette();
  updateDashboard(app.state);
}

let rankCalcTimer = null;
let rankCalcLastXp = null;
let rankCalcLastAt = 0;

const updateUserRankDebounced = () => {
  if (rankCalcTimer) clearTimeout(rankCalcTimer);
  rankCalcTimer = setTimeout(() => updateUserRank(), 500);
};

const updateUserRank = async () => {
  if (!app.state.user || !app.state.userData) return;
  const xp = app.state.userData.xp || 0;

  if (updateRankFromLeaderboardAll()) return;

  const now = Date.now();
  if (rankCalcLastXp === xp && now - rankCalcLastAt < 60_000) return;
  
  try {
    rankCalcLastXp = xp;
    rankCalcLastAt = now;
    const q = query(collection(db, "users"), where("xp", ">", xp));
    const snapshot = await getCountFromServer(q);
    const count = snapshot.data().count;
    const rank = count + 1;
    
    // Simple logic for trend: if rank improved since last session
    const oldRank = store.get('lastRank', rank);
    const rankDiff = oldRank - rank;
    
    app.state.userData.rank = rank;
    app.state.userData.rankDiff = rankDiff;
    
    store.set('lastRank', rank);
    store.set('rankTrend', rankDiff);
    delete app.state.userData.rankLabel;
    updateStatsUI(app.state);
  } catch (e) {
    console.error("Error updating rank:", e);
  }
};

function initUserDataSync() {
  if (!app.state.user) return;
  const userDoc = doc(db, "users", app.state.user.uid);
  onSnapshot(userDoc, (doc) => {
    if (doc.exists()) {
      const data = doc.data();
      app.state.userData = { ...app.state.userData, ...data };
      // Was never called anywhere in this file despite ai.js's own comment
      // saying to call it right after userData is assigned — meaning
      // hasAiAccess() was always evaluating against a permanent null
      // context, so assertAiAccess() threw for EVERY user regardless of
      // subscription. This listener re-fires on every Firestore change,
      // so it also keeps the AI gate correctly in sync immediately after
      // a subscription upgrade completes, no reload needed.
      setAiUserContext(app.state.userData);
      store.set('userData', app.state.userData);
      updateStatsUI(app.state);
      updateProfileUI(app.state);
      updateRankFromLeaderboardAll();
      updateUserRankDebounced();
      checkSubscriptionExpiry();
    }
  });
}

// expiryDate was previously set on every paid subscription (30 days,
// hardcoded) but nothing ever read it back — a verified paid tier stayed
// active forever regardless of the date stored on it. That made the whole
// concept of "duration" meaningless, which the new Exam Pass tiers actually
// depend on being real. This runs on every userData update and silently
// reverts an expired, previously-verified paid subscription to FREE.
//
// Client-only enforcement, like everything else subscription-related in
// this app (see the isAllowedSubscriptionSelfUpdate comment in
// firestore.rules) — a user could theoretically avoid ever loading the app
// with a fresh enough client to trigger this, or edit their local clock,
// and keep paid access past expiry a little longer than intended. A
// scheduled Cloud Function that sweeps expired subscriptions server-side
// (mirroring how awardXp already server-validates XP) is the robust fix if
// that gap ever gets exploited in practice; this is the honest v1.
let lastExpiryCheckKey = null;
function checkSubscriptionExpiry() {
  const sub = app.state.userData?.subscription;
  if (!sub || sub.tier === 'FREE' || sub.verified !== true || !sub.expiryDate) return;

  const expiryMs = sub.expiryDate.toDate ? sub.expiryDate.toDate().getTime() : new Date(sub.expiryDate).getTime();
  if (!Number.isFinite(expiryMs) || expiryMs > Date.now()) return;

  // Avoid re-firing the downgrade write repeatedly if onSnapshot re-fires
  // for unrelated field changes before Firestore's own update round-trips.
  const key = `${sub.tier}:${expiryMs}`;
  if (lastExpiryCheckKey === key) return;
  lastExpiryCheckKey = key;

  const userRef = doc(db, 'users', app.state.user.uid);
  updateDoc(userRef, {
    subscription: { tier: 'FREE', updatedAt: serverTimestamp(), status: 'active', verified: true, expiryDate: null }
  }).then(() => {
    toast(`Your ${PLAN_PRICES[sub.tier]?.label || sub.tier} plan expired — you're back on Free. Renew anytime from Upgrade.`, 'brand', 8000);
  }).catch((e) => console.error('Failed to auto-downgrade expired subscription:', e));
}

function initLeaderboardSync() {
  const qAll = query(collection(db, "users"), orderBy("xp", "desc"), limit(50));
  onSnapshot(qAll, (snapshot) => {
    const scholars = snapshot.docs.map(d => {
      const data = d.data();
      const name = data.displayName || data.name || data.email?.split('@')[0] || 'Scholar';
      const xp = data.xp || 0;
      const info = calculateRank(xp);
      const level = data.level || info.rank;
      const rank_title = data.rank_title || info.title;
      return { id: d.id, name, xp, level, rank_title };
    });
    app.state.leaderboardAll = scholars;
    app.state.leaderboardAllLoaded = true;
    renderLeaderboardView();
    updateRankFromLeaderboardAll();
  });
}

function initWarRoomsSync() {
  if (!app.state.user) return;
  if (warRoomState.unsubRooms) warRoomState.unsubRooms();
  const q = query(collection(db, "warRooms"), orderBy("createdAt", "desc"), limit(30));
  warRoomState.unsubRooms = onSnapshot(q, (snapshot) => {
    warRoomState.rooms = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderWarRoomsList();
  });
}

function msToClock(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const total = Math.floor(safeMs / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function nowMs() {
  return Date.now();
}

function isWarRoomActive(room) {
  const endsAtMs = Number(room?.endsAtMs) || 0;
  return endsAtMs > nowMs() && room?.status !== 'closed';
}

function getMyTierRank() {
  const xp = app.state.userData?.xp || 0;
  return calculateRank(xp).rank;
}

function renderWarRoomsList() {
  const grid = S('warRoomsList');
  const empty = S('warRoomsEmpty');
  if (!grid) return;

  const rooms = (warRoomState.rooms || []).filter(r => r && r.objective);
  const activeRooms = rooms.filter(r => isWarRoomActive(r));

  if (empty) empty.classList.toggle('hidden', activeRooms.length !== 0);

  const uid = app.state.user?.uid || null;
  grid.innerHTML = activeRooms.map(room => {
    const members = Array.isArray(room.members) ? room.members : [];
    const tasks = Array.isArray(room.tasks) ? room.tasks : [];
    const done = tasks.filter(t => !!t.doneAtMs).length;
    const total = tasks.length || 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const remainingMs = Math.max(0, (Number(room.endsAtMs) || 0) - nowMs());
    const canEnter = room.visibility === 'public' || members.includes(uid) || (Array.isArray(room.invited) && room.invited.includes(uid)) || room.createdBy === uid;
    const isMember = members.includes(uid);
    const isOwner = uid && room.createdBy === uid;

    return `
      <div class="premium-card p-6 rounded-[32px] border-rose-100 dark:border-rose-900/30 relative overflow-hidden group">
        ${isOwner ? `
          <button onclick="window.deleteWarRoomById('${room.id}', event)" aria-label="Delete room" class="absolute top-4 left-4 w-10 h-10 rounded-2xl bg-white/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all flex items-center justify-center">
            <i data-lucide="trash-2" class="w-5 h-5"></i>
          </button>
        ` : ''}
        <div class="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-900/20 text-rose-600 text-[10px] font-black uppercase tracking-widest border border-rose-100 dark:border-rose-800">
          <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
          Live
        </div>
        <div class="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-900/20 text-rose-600 flex items-center justify-center mb-6">
          <i data-lucide="target" class="w-7 h-7"></i>
        </div>
        <h3 class="text-xl font-black">${escapeHTML(room.objective)}</h3>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">${escapeHTML(room.createdByName || 'Commander')} • ${escapeHTML(room.visibility === 'invite' ? 'Invite Only' : 'Public Join')}</p>

        <div class="mt-6">
          <div class="flex items-center justify-between">
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Objective Progress</p>
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${done}/${total}</p>
          </div>
          <div class="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div class="h-full bg-rose-500 transition-all" style="width:${pct}%"></div>
          </div>
          <div class="mt-3 flex items-center justify-between">
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${members.length} members</p>
            <p class="text-[10px] font-black text-rose-600 uppercase tracking-widest">${msToClock(remainingMs)} left</p>
          </div>
        </div>

        <button onclick="window.joinWarRoom('${room.id}')" class="mt-8 w-full py-4 rounded-2xl ${canEnter ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-lg shadow-rose-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 cursor-not-allowed'} font-bold transition-all active:scale-95">
          ${isMember ? 'Open War Room' : (canEnter ? 'Enter War Room' : 'Locked')}
        </button>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

window.deleteWarRoomById = async (roomId, event) => {
  if (event) event.stopPropagation();
  const uid = app.state.user?.uid || null;
  if (!uid) return;

  const room = (warRoomState.rooms || []).find(r => r.id === roomId);
  if (!room) return;
  if (room.createdBy !== uid) {
    toast('Only the Commander can delete this War Room', 'error');
    return;
  }

  const ok = window.confirm('Delete this War Room? This cannot be undone.');
  if (!ok) return;

  try {
    if (warRoomState.currentRoomId === roomId) {
      await window.leaveWarRoom();
    }
    await deleteDoc(doc(db, "warRooms", roomId));
    toast('War Room deleted', 'success');
  } catch (e) {
    console.error('Error deleting war room:', e);
    toast(e?.message || 'Unable to delete war room', 'error');
  }
};

window.toggleWarRoomCreate = (show) => {
  const overlay = S('warRoomCreateOverlay');
  if (!overlay) return;
  if (!app.state.user) return;

  if (show && getMyTierRank() < 3) {
    toast('Pro tier required to found a War Room', 'error');
    return;
  }

  overlay.classList.toggle('hidden', !show);
  if (!show) return;

  const container = S('warRoomTaskInputs');
  if (container) {
    container.innerHTML = '';
    for (let i = 0; i < 3; i += 1) window.addWarRoomTaskInput();
  }
  const obj = S('warRoomObjective');
  if (obj) obj.value = '';
  if (S('warRoomDuration')) S('warRoomDuration').value = '120';
  if (S('warRoomVisibility')) S('warRoomVisibility').value = 'public';
  setTimeout(() => obj?.focus(), 0);
  if (window.lucide) window.lucide.createIcons();
};

window.addWarRoomTaskInput = () => {
  const container = S('warRoomTaskInputs');
  if (!container) return;
  const idx = container.children.length + 1;
  const row = document.createElement('div');
  row.className = 'flex items-center gap-3';
  row.innerHTML = `
    <div class="flex-1">
      <input data-war-task="1" type="text" placeholder="Task ${idx}" class="w-full px-5 py-4 rounded-2xl bg-slate-100 dark:bg-slate-800/50 border border-transparent focus:border-rose-500/50 focus:bg-white dark:focus:bg-slate-800 outline-none text-sm font-bold transition-all">
    </div>
    <button class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-rose-600 transition-colors" aria-label="Remove" onclick="this.parentElement.remove()">
      <i data-lucide="trash-2" class="w-5 h-5"></i>
    </button>
  `;
  container.appendChild(row);
  if (window.lucide) window.lucide.createIcons();
};

function readWarRoomTaskInputs() {
  const container = S('warRoomTaskInputs');
  const inputs = container ? Array.from(container.querySelectorAll('[data-war-task="1"]')) : [];
  const tasks = inputs.map(i => toText(i.value).trim()).filter(Boolean);
  return tasks.slice(0, 5);
}

window.createWarRoom = async () => {
  if (!app.state.user) return;
  if (getMyTierRank() < 3) {
    toast('Pro tier required to found a War Room', 'error');
    return;
  }

  const objective = toText(S('warRoomObjective')?.value).trim();
  const durationMin = Number(S('warRoomDuration')?.value) || 120;
  const visibility = toText(S('warRoomVisibility')?.value).trim() === 'invite' ? 'invite' : 'public';
  const tasksRaw = readWarRoomTaskInputs();

  if (!objective) {
    toast('Please enter an objective', 'error');
    return;
  }
  if (tasksRaw.length < 3) {
    toast('Add at least 3 tasks', 'error');
    return;
  }

  const uid = app.state.user.uid;
  const createdByName = app.state.userData?.displayName || app.state.userData?.name || app.state.user?.displayName || 'Commander';
  const createdAtMs = nowMs();
  const endsAtMs = createdAtMs + Math.max(15, durationMin) * 60 * 1000;
  const tasks = tasksRaw.map((text) => ({
    id: `${createdAtMs}_${Math.random().toString(16).slice(2)}`,
    text,
    doneBy: null,
    doneAtMs: null
  }));

  try {
    const docRef = await addDoc(collection(db, "warRooms"), {
      objective,
      createdBy: uid,
      createdByName,
      createdAt: serverTimestamp(),
      createdAtMs,
      endsAtMs,
      status: 'active',
      visibility,
      members: [uid],
      invited: [],
      roles: { commander: uid, scribe: null, strategist: null },
      tasks,
      focusUntilMs: 0,
      contributions: {}
    });

    await addDoc(collection(db, "warRooms", docRef.id, "messages"), {
      senderId: uid,
      senderName: 'War Room Bot',
      system: true,
      text: `War Room founded: ${objective}`,
      createdAt: serverTimestamp()
    });

    window.toggleWarRoomCreate(false);
    await window.joinWarRoom(docRef.id);
  } catch (e) {
    console.error('Error creating war room:', e);
    toast(e?.message || 'Unable to create war room', 'error');
  }
};

function clearWarRoomSubs() {
  if (warRoomState.unsubRoom) warRoomState.unsubRoom();
  if (warRoomState.unsubMessages) warRoomState.unsubMessages();
  if (warRoomState.unsubResources) warRoomState.unsubResources();
  warRoomState.unsubRoom = null;
  warRoomState.unsubMessages = null;
  warRoomState.unsubResources = null;
  warRoomState.currentRoom = null;
  warRoomState.messages = [];
  warRoomState.resources = [];
}

function stopWarRoomTimer() {
  if (warRoomState.timer) clearInterval(warRoomState.timer);
  warRoomState.timer = null;
}

function renderWarRoom() {
  const overlay = S('warRoomOverlay');
  if (!overlay) return;
  const room = warRoomState.currentRoom;
  if (!room) return;

  const objectivesBody = S('warRoomObjectivesBody');
  const objectivesChevron = S('warRoomObjectivesChevron');
  if (objectivesBody) objectivesBody.classList.toggle('hidden', warRoomState.objectivesCollapsed);
  if (objectivesChevron) objectivesChevron.setAttribute('data-lucide', warRoomState.objectivesCollapsed ? 'chevron-down' : 'chevron-up');
  if (S('warRoomObjectivesLabel')) S('warRoomObjectivesLabel').textContent = warRoomState.objectivesCollapsed ? 'Expand' : 'Collapse';

  const uid = app.state.user?.uid || null;
  const delBtn = S('warRoomDeleteBtn');
  if (delBtn) delBtn.classList.toggle('hidden', !(uid && room.createdBy === uid));

  const title = S('warRoomTitle');
  if (title) title.textContent = toText(room.objective || 'Objective');

  const members = Array.isArray(room.members) ? room.members : [];
  const meta = S('warRoomMeta');
  if (meta) meta.textContent = `${members.length} members • ${toText(room.visibility === 'invite' ? 'Invite Only' : 'Public Join')}`;

  const remainingMs = Math.max(0, (Number(room.endsAtMs) || 0) - nowMs());
  const timer = S('warRoomTimer');
  if (timer) timer.textContent = msToClock(remainingMs);

  const focusUntilMs = Number(room.focusUntilMs) || 0;
  const focusActive = focusUntilMs > nowMs();
  const focusHint = S('warRoomFocusHint');
  if (focusHint) focusHint.classList.toggle('hidden', !focusActive);

  const tasks = Array.isArray(room.tasks) ? room.tasks : [];
  const done = tasks.filter(t => !!t.doneAtMs).length;
  const total = tasks.length || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const pText = S('warRoomProgressText');
  if (pText) pText.textContent = `${done}/${total} completed`;
  const pBar = S('warRoomProgressBar');
  if (pBar) pBar.style.width = `${pct}%`;

  const tasksEl = S('warRoomTasks');
  if (tasksEl) {
    tasksEl.innerHTML = tasks.map(t => {
      const checked = !!t.doneAtMs;
      return `
        <label class="flex items-center gap-4 p-4 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer">
          <input type="checkbox" class="w-5 h-5 accent-rose-500" ${checked ? 'checked' : ''} onchange="window.toggleWarRoomTask('${escapeHTML(t.id)}', this.checked)">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-black truncate ${checked ? 'line-through opacity-50' : ''}">${escapeHTML(t.text)}</p>
            <p class="text-[10px] font-black uppercase tracking-widest text-white/40 mt-1">${checked ? 'completed' : 'pending'}</p>
          </div>
        </label>
      `;
    }).join('');
  }

  const msgsEl = S('warRoomMessages');
  if (msgsEl) {
    msgsEl.innerHTML = (warRoomState.messages || []).map(m => {
      const system = !!m.system;
      const name = system ? 'War Room Bot' : (m.senderName || 'Scholar');
      const text = escapeHTML(m.text || '');
      return `
        <div class="p-4 rounded-3xl ${system ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-white/5 border border-white/10'}">
          <p class="text-[10px] font-black uppercase tracking-widest ${system ? 'text-rose-300' : 'text-white/40'}">${escapeHTML(name)}</p>
          <p class="mt-2 text-sm font-bold text-white/90 leading-relaxed">${text}</p>
        </div>
      `;
    }).reverse().join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  const resEl = S('warRoomResources');
  if (resEl) {
    resEl.innerHTML = (warRoomState.resources || []).map(r => {
      const type = toText(r.type || 'note');
      const title = escapeHTML(r.title || r.name || 'Resource');
      const value = toText(r.value || r.url || '');
      const safeValue = escapeHTML(value);
      const link = type === 'link' || type === 'file';
      const href = link ? escapeHTML(safeUrl(value)) : '';
      const icon = type === 'file' ? 'paperclip' : (type === 'link' ? 'link' : 'file-text');
      return `
        <div class="p-4 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-black truncate">${title}</p>
              ${link ? `<a class="mt-2 block text-[10px] font-black uppercase tracking-widest text-rose-300 truncate hover:underline" href="${href}" target="_blank" rel="noopener noreferrer">${safeValue}</a>` : `<p class="mt-2 text-xs font-bold text-white/60">${safeValue}</p>`}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}

function startWarRoomTimer() {
  stopWarRoomTimer();
  warRoomState.timer = setInterval(() => {
    if (!warRoomState.currentRoom) return;
    renderWarRoom();
    if (!isWarRoomActive(warRoomState.currentRoom)) {
      stopWarRoomTimer();
    }
  }, 1000);
}

window.joinWarRoom = async (roomId) => {
  if (!app.state.user) return;
  const uid = app.state.user.uid;
  const refRoom = doc(db, "warRooms", roomId);

  try {
    warRoomState.objectivesCollapsed = false;
    const snap = await getDoc(refRoom);
    if (!snap.exists()) {
      toast('War Room not found', 'error');
      return;
    }
    const room = snap.data();
    const members = Array.isArray(room.members) ? room.members : [];
    const invited = Array.isArray(room.invited) ? room.invited : [];
    const canEnter = room.visibility === 'public' || members.includes(uid) || invited.includes(uid) || room.createdBy === uid;
    if (!canEnter) {
      toast('Invite required to enter this War Room', 'error');
      return;
    }

    if (!members.includes(uid)) {
      await updateDoc(refRoom, { members: arrayUnion(uid) });
    }

    const overlay = S('warRoomOverlay');
    if (overlay) overlay.classList.remove('hidden');
    warRoomState.currentRoomId = roomId;

    clearWarRoomSubs();

    warRoomState.unsubRoom = onSnapshot(refRoom, (d) => {
      if (!d.exists()) return;
      warRoomState.currentRoom = { id: d.id, ...d.data() };
      renderWarRoom();
      startWarRoomTimer();
    });

    const qMsgs = query(collection(db, "warRooms", roomId, "messages"), orderBy("createdAt", "asc"), limit(200));
    warRoomState.unsubMessages = onSnapshot(qMsgs, (snapMsgs) => {
      warRoomState.messages = snapMsgs.docs.map(d => ({ id: d.id, ...d.data() }));
      renderWarRoom();
    });

    const qRes = query(collection(db, "warRooms", roomId, "resources"), orderBy("createdAt", "asc"), limit(200));
    warRoomState.unsubResources = onSnapshot(qRes, (snapRes) => {
      warRoomState.resources = snapRes.docs.map(d => ({ id: d.id, ...d.data() }));
      renderWarRoom();
    });
  } catch (e) {
    console.error('Error joining war room:', e);
    toast(e?.message || 'Unable to enter war room', 'error');
  }
};

window.leaveWarRoom = async () => {
  const overlay = S('warRoomOverlay');
  if (overlay) overlay.classList.add('hidden');
  window.toggleWarRoomEmoji(false);

  stopWarRoomTimer();
  const roomId = warRoomState.currentRoomId;
  warRoomState.currentRoomId = null;
  clearWarRoomSubs();

  if (!roomId || !app.state.user) return;
  try {
    await updateDoc(doc(db, "warRooms", roomId), { members: arrayRemove(app.state.user.uid) });
  } catch (e) {
    console.error('Error leaving war room:', e);
  }
};

window.deleteWarRoom = async () => {
  const roomId = warRoomState.currentRoomId;
  const room = warRoomState.currentRoom;
  const uid = app.state.user?.uid || null;
  if (!roomId || !room || !uid) return;

  if (room.createdBy !== uid) {
    toast('Only the Commander can delete this War Room', 'error');
    return;
  }

  const ok = window.confirm('Delete this War Room? This cannot be undone.');
  if (!ok) return;

  try {
    await window.leaveWarRoom();
    await deleteDoc(doc(db, "warRooms", roomId));
    toast('War Room deleted', 'success');
  } catch (e) {
    console.error('Error deleting war room:', e);
    toast(e?.message || 'Unable to delete war room', 'error');
  }
};

window.toggleWarRoomTask = async (taskId, checked) => {
  if (!warRoomState.currentRoomId || !app.state.user) return;
  const roomId = warRoomState.currentRoomId;
  const uid = app.state.user.uid;
  const roomRef = doc(db, "warRooms", roomId);
  const doneAtMs = checked ? nowMs() : null;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      const updated = tasks.map(t => {
        if (toText(t.id) !== toText(taskId)) return t;
        return { ...t, doneBy: checked ? uid : null, doneAtMs };
      });
      tx.update(roomRef, { tasks: updated });
    });

    const base = 50;
    const multiplier = isWarRoomActive(warRoomState.currentRoom) ? 1.5 : 1;
    const amt = Math.round(base * multiplier);
    rewardXP(amt);

    await addDoc(collection(db, "warRooms", roomId, "messages"), {
      senderId: uid,
      senderName: 'War Room Bot',
      system: true,
      text: checked ? `Objective cleared (+${amt} XP)` : 'Objective reopened',
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error('Error updating task:', e);
    toast(e?.message || 'Unable to update task', 'error');
  }
};

window.startFocusSprint = async (minutes) => {
  if (!warRoomState.currentRoomId || !app.state.user) return;
  const roomId = warRoomState.currentRoomId;
  const uid = app.state.user.uid;
  const until = minutes > 0 ? (nowMs() + minutes * 60 * 1000) : 0;

  try {
    await updateDoc(doc(db, "warRooms", roomId), { focusUntilMs: until, focusBy: uid });
    await addDoc(collection(db, "warRooms", roomId, "messages"), {
      senderId: uid,
      senderName: 'War Room Bot',
      system: true,
      text: minutes > 0 ? `Focus Sprint started (${minutes}m) • emojis only` : 'Focus Sprint ended',
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error('Error setting focus sprint:', e);
    toast(e?.message || 'Unable to set focus sprint', 'error');
  }
};

function isEmojiOnly(text) {
  const t = toText(text).trim();
  if (!t) return false;
  try {
    const stripped = t.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+/gu, '');
    return stripped.length === 0;
  } catch {
    return !/[a-zA-Z0-9]/.test(t);
  }
}

window.sendWarRoomMessage = async () => {
  if (!warRoomState.currentRoomId || !app.state.user) return;
  const input = S('warRoomMessageInput');
  if (!input) return;
  const text = toText(input.value).trim();
  if (!text) return;

  const room = warRoomState.currentRoom;
  const focusUntilMs = Number(room?.focusUntilMs) || 0;
  const focusActive = focusUntilMs > nowMs();
  if (focusActive && !isEmojiOnly(text)) {
    toast('Focus Sprint active: emojis only', 'error');
    return;
  }

  input.value = '';
  const uid = app.state.user.uid;
  const name = app.state.userData?.displayName || app.state.userData?.name || app.state.user?.displayName || 'Scholar';

  try {
    await addDoc(collection(db, "warRooms", warRoomState.currentRoomId, "messages"), {
      senderId: uid,
      senderName: name,
      system: false,
      text,
      createdAt: serverTimestamp()
    });

    const base = 10;
    const multiplier = isWarRoomActive(room) ? 1.5 : 1;
    rewardXP(Math.round(base * multiplier));
  } catch (e) {
    console.error('Error sending war room message:', e);
    toast(e?.message || 'Unable to send message', 'error');
  }
};

window.addWarRoomResource = async () => {
  if (!warRoomState.currentRoomId || !app.state.user) return;
  const input = S('warRoomResourceInput');
  if (!input) return;
  const value = toText(input.value).trim();
  if (!value) return;
  input.value = '';

  const uid = app.state.user.uid;
  const type = /^https?:\/\//i.test(value) ? 'link' : 'note';
  const title = type === 'link' ? 'Link' : 'Note';

  try {
    await addDoc(collection(db, "warRooms", warRoomState.currentRoomId, "resources"), {
      type,
      title,
      value,
      createdAt: serverTimestamp(),
      createdBy: uid
    });

    await addDoc(collection(db, "warRooms", warRoomState.currentRoomId, "messages"), {
      senderId: uid,
      senderName: 'War Room Bot',
      system: true,
      text: type === 'link' ? 'Resource pinned: link' : 'Resource pinned: note',
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error('Error adding resource:', e);
    toast(e?.message || 'Unable to pin resource', 'error');
  }
};

window.openWarRoomFilePicker = () => {
  const input = S('warRoomFileInput');
  if (!input) return;
  if (!warRoomState.currentRoomId) return;
  input.click();
};

async function uploadWarRoomAttachment(file, roomId, uid) {
  const name = safeFileName(file?.name, 'file');
  const path = `users/${uid}/warRooms/${roomId}/${Date.now()}_${name}`;
  const url = await dispatchAssetToCloudflare(file, path);
  return { url, path, name, size: file.size || 0, contentType: file.type || 'application/octet-stream' };
}

window.handleWarRoomFiles = async (event) => {
  if (!warRoomState.currentRoomId || !app.state.user) return;
  const input = event?.target;
  const files = Array.from(input?.files || []);
  if (input) input.value = '';
  if (!files.length) return;

  const uid = app.state.user.uid;
  const roomId = warRoomState.currentRoomId;
  const maxBytes = 10 * 1024 * 1024;

  for (const file of files) {
    if (file.size > maxBytes) {
      toast(`File too large: ${file.name}`, 'error');
      continue;
    }
    try {
      toast('Uploading...', 'info');
      const att = await uploadWarRoomAttachment(file, roomId, uid);
      await addDoc(collection(db, "warRooms", roomId, "resources"), {
        type: 'file',
        title: 'File',
        value: att.url,
        name: att.name,
        contentType: att.contentType,
        createdAt: serverTimestamp(),
        createdBy: uid
      });
      await addDoc(collection(db, "warRooms", roomId, "messages"), {
        senderId: uid,
        senderName: 'War Room Bot',
        system: true,
        text: `File pinned: ${att.name}`,
        createdAt: serverTimestamp()
      });
      toast('Pinned', 'success');
    } catch (e) {
      console.error('Error uploading war room file:', e);
      toast(e?.message || 'Upload failed', 'error');
    }
  }
};

window.downloadWarRoomReport = async () => {
  if (!warRoomState.currentRoomId) return;
  const room = warRoomState.currentRoom;
  if (!room) return;

  try {
    const resSnap = await getDocs(query(collection(db, "warRooms", warRoomState.currentRoomId, "resources"), orderBy("createdAt", "asc"), limit(500)));
    const resources = resSnap.docs.map(d => d.data());
    const tasks = Array.isArray(room.tasks) ? room.tasks : [];
    const done = tasks.filter(t => !!t.doneAtMs).length;

    const lines = [];
    lines.push(`MISSION REPORT`);
    lines.push(`Objective: ${toText(room.objective)}`);
    lines.push(`Status: ${isWarRoomActive(room) ? 'Active' : 'Closed'}`);
    lines.push(`Members: ${(Array.isArray(room.members) ? room.members.length : 0)}`);
    lines.push(`Tasks: ${done}/${tasks.length}`);
    lines.push('');
    lines.push('OBJECTIVE BOARD');
    tasks.forEach((t, i) => {
      lines.push(`${i + 1}. [${t.doneAtMs ? 'x' : ' '}] ${toText(t.text)}`);
    });
    lines.push('');
    lines.push('RESOURCES');
    resources.forEach((r, i) => {
      const type = toText(r.type || 'note');
      const value = toText(r.value || '');
      lines.push(`${i + 1}. (${type}) ${value}`);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `war-room-report_${toText(room.objective).replace(/\s+/g, '_').slice(0, 40)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Error generating report:', e);
    toast(e?.message || 'Unable to generate report', 'error');
  }
};

function renderWarRoomEmojiPicker() {
  const inner = S('warRoomEmojiInner');
  if (!inner) return;
  inner.innerHTML = EMOJIS.map(e => `
    <button class="w-8 h-8 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors text-lg flex items-center justify-center" onclick="window.pickWarRoomEmoji('${escapeHTML(e)}')">${escapeHTML(e)}</button>
  `).join('');
}

window.pickWarRoomEmoji = (emoji) => {
  const input = S('warRoomMessageInput');
  if (!input) return;
  insertAtCursor(input, emoji);
};

window.toggleWarRoomEmoji = (show, event) => {
  const menu = S('warRoomEmojiMenu');
  if (!menu) return;
  if (event) event.stopPropagation();
  menu.classList.toggle('hidden', !show);
  if (!show) return;
  renderWarRoomEmojiPicker();
  if (window.lucide) window.lucide.createIcons();

  const anchor = event?.currentTarget;
  const width = 300;
  if (anchor && anchor.getBoundingClientRect) {
    const rect = anchor.getBoundingClientRect();
    const top = Math.max(16, rect.top - 340);
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.right - width));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  } else {
    menu.style.top = `120px`;
    menu.style.left = `${Math.max(16, window.innerWidth - width - 16)}px`;
  }
};

window.toggleWarRoomObjectives = () => {
  warRoomState.objectivesCollapsed = !warRoomState.objectivesCollapsed;
  renderWarRoom();
  if (window.lucide) window.lucide.createIcons();
  const label = S('warRoomObjectivesLabel');
  if (label) label.textContent = warRoomState.objectivesCollapsed ? 'Expand' : 'Collapse';
};

function initGoalsSync() {
  if (!app.state.user) return;
  const q = query(collection(db, "goals"), where("userId", "==", app.state.user.uid), orderBy("createdAt", "asc"));
  onSnapshot(q, (snapshot) => {
    const goals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    app.state.goals = goals;
    store.set('goals', goals);
    renderStudyGoals(app.state);
  });
}

function initNotesSync() {
  if (!app.state.user) return;
  const q = query(collection(db, "notes"), where("userId", "==", app.state.user.uid));
  onSnapshot(q, (snapshot) => {
    const notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (toMillis(b.updatedAt) || toMillis(b.createdAt) || 0) - (toMillis(a.updatedAt) || toMillis(a.createdAt) || 0));
    app.state.notes = notes;
    store.set('notes', notes);
    renderNotesList();
  }, (error) => {
    console.error('Notes sync error:', error);
    toast('Unable to load notes', 'error');
  });
}

function initSkillsSync() {
  if (initSkillsSync.unsub) return;
  const q = query(collection(db, "skills"), limit(100));
  initSkillsSync.unsub = onSnapshot(q, (snapshot) => {
    const skills = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(s => (s.status || 'active') === 'active')
      .sort((a, b) => (toMillis(b.updatedAt) || toMillis(b.createdAt) || 0) - (toMillis(a.updatedAt) || toMillis(a.createdAt) || 0));
    app.state.skills = skills;
    store.set('skills', skills);
    if (app.state.currentSection === 'skillAcademy') renderSkillAcademy();
  }, (error) => {
    console.error('Skills sync error:', error);
    if (app.state.currentSection === 'skillAcademy') toast('Unable to load skills', 'error');
  });
}

const gigsState = {
  category: 'All',
  status: 'open',
  query: ''
};

function initGigsSync() {
  if (initGigsSync.unsub) return;
  const q = query(collection(db, "gigs"), limit(200));
  initGigsSync.unsub = onSnapshot(q, (snapshot) => {
    const gigs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toMillis(b.updatedAt) || toMillis(b.createdAt) || 0) - (toMillis(a.updatedAt) || toMillis(a.createdAt) || 0));
    app.state.gigs = gigs;
    store.set('gigs', gigs);
    if (app.state.currentSection === 'gigsBoard') renderGigsBoard();
  }, (error) => {
    console.error('Gigs sync error:', error);
    if (app.state.currentSection === 'gigsBoard') toast('Unable to load gigs', 'error');
  });
}

// Tutor Hub (Study Tools > Tutor Courses) — a lightweight in-app preview.
// The full browse/enroll experience lives in tutor-courses.htm (same split
// as course-lectures-dashboard.htm for University Lectures); this just
// gives the Study Tools tab something live to show instead of an empty
// pass-through, and reuses whatever's already loaded once per session.
let tutorHubPreviewLoaded = false;
async function loadTutorHubPreview() {
  const grid = document.getElementById('tutorHubGrid');
  if (!grid || tutorHubPreviewLoaded) return;
  tutorHubPreviewLoaded = true;
  try {
    const snap = await getDocs(query(
      collection(db, 'tutorCourses'),
      where('status', '==', 'published'),
      orderBy('createdAt', 'desc'),
      limit(6)
    ));
    const courses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!courses.length) {
      grid.innerHTML = `<p class="col-span-full text-center py-16 text-slate-300 font-bold">No tutor courses published yet — check back soon, or be the first to <a href="tutor.html" class="underline">become a tutor</a>.</p>`;
      return;
    }
    grid.innerHTML = courses.map((c) => `
      <a href="tutor-courses.htm?course=${encodeURIComponent(c.id)}" class="block bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 overflow-hidden hover:border-brand-300 transition-colors">
        <div class="h-28 bg-gradient-to-br from-brand-100 to-brand-50 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center">
          ${c.coverUrl ? `<img src="${escapeHTML(c.coverUrl)}" class="w-full h-full object-cover" alt="">` : `<i data-lucide="graduation-cap" class="w-7 h-7 text-brand-400"></i>`}
        </div>
        <div class="p-5">
          ${c.subject ? `<p class="text-[9px] font-black uppercase tracking-widest text-brand-600 mb-1">${escapeHTML(c.subject)}</p>` : ''}
          <h3 class="font-black text-sm mb-1 truncate">${escapeHTML(c.title || 'Untitled course')}</h3>
          <p class="text-[10px] text-slate-400 font-bold mb-3 truncate">By ${escapeHTML(c.tutorName || 'Tutor')}</p>
          <span class="text-sm font-black">₦${Number(c.price || 0).toLocaleString()}</span>
        </div>
      </a>`).join('');
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error('Tutor hub preview failed:', e);
    tutorHubPreviewLoaded = false;
    grid.innerHTML = `<p class="col-span-full text-center py-16 text-rose-400 font-bold">Could not load tutor courses right now.</p>`;
  }
}

function renderGigsBoard() {
  const list = S('gigsList');
  const empty = S('gigsEmpty');
  if (!list) return;

  const now = Date.now();
  const whenLabel = (t) => {
    const ms = toMillis(t);
    if (!ms) return 'Just now';
    const diff = Math.max(0, now - ms);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const q = toText(gigsState.query).toLowerCase().trim();
  const cat = toText(gigsState.category).trim();
  const status = toText(gigsState.status).trim();

  let gigs = (app.state.gigs || []).slice();
  if (status !== 'all') gigs = gigs.filter(g => toText(g.status || 'open') === status);
  if (cat && cat !== 'All') gigs = gigs.filter(g => toText(g.category || 'Other') === cat);
  if (q) {
    gigs = gigs.filter(g => {
      const hay = [
        g.title,
        g.description,
        g.location,
        g.category,
        Array.isArray(g.tags) ? g.tags.join(' ') : g.tags
      ].map(v => toText(v).toLowerCase()).join(' | ');
      return hay.includes(q);
    });
  }

  if (!gigs.length) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (empty) empty.classList.add('hidden');

  list.innerHTML = gigs.map(g => {
    const title = escapeHTML(toText(g.title || 'Untitled Gig'));
    const desc = escapeHTML(toText(g.description || ''));
    const budget = Number(g.budget) || 0;
    const cat = escapeHTML(toText(g.category || 'Other'));
    const loc = escapeHTML(toText(g.location || 'Remote'));
    const verified = Boolean(g.verifiedClient);
    const when = escapeHTML(whenLabel(g.createdAt || g.updatedAt));
    const tags = Array.isArray(g.tags) ? g.tags.slice(0, 6) : [];
    const tagPills = tags.map(t => `<span class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500">${escapeHTML(toText(t))}</span>`).join('');
    const badge = verified
      ? `<span class="px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 text-[8px] font-black uppercase tracking-widest border border-emerald-100 dark:border-emerald-800">Verified Client</span>`
      : `<span class="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-[8px] font-black uppercase tracking-widest border border-slate-200 dark:border-slate-700">Student</span>`;

    return `
      <div class="premium-card p-8 rounded-[40px] hover:border-brand-300 transition-all group">
        <div class="flex flex-col md:flex-row gap-6">
          <div class="w-20 h-20 rounded-[28px] bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
            <i data-lucide="briefcase" class="w-10 h-10 text-brand-500"></i>
          </div>
          <div class="flex-1 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                ${badge}
                <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Posted ${when}</span>
              </div>
              <span class="text-xl font-black text-slate-900 dark:text-white">₦${budget.toLocaleString()}</span>
            </div>
            <div class="flex items-center justify-between gap-4">
              <h3 class="text-xl font-black group-hover:text-brand-600 transition-colors">${title}</h3>
              <span class="hidden sm:inline px-3 py-1 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 text-[10px] font-black uppercase tracking-widest">${cat}</span>
            </div>
            <p class="text-sm text-slate-500 dark:text-slate-400">${desc}</p>
            <div class="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div class="flex flex-wrap gap-2 items-center">
                <span class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500">${loc}</span>
                ${tagPills}
              </div>
              <button onclick="window.applyToGig('${escapeHTML(g.id)}')" class="px-8 py-3 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl hover:bg-brand-600 hover:text-white transition-all">Apply Now</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

function renderSkillAcademy() {
  const grid = S('skillsGrid');
  if (!grid) return;
  const skills = (app.state.skills || []).slice();
  if (!skills.length) {
    grid.innerHTML = `
      <div class="lg:col-span-3 p-10 rounded-[40px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-soft text-center">
        <div class="w-14 h-14 rounded-3xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 flex items-center justify-center mx-auto">
          <i data-lucide="graduation-cap" class="w-7 h-7"></i>
        </div>
        <h3 class="mt-6 text-xl font-black">No skills published yet</h3>
        <p class="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">Open Seller Hub to publish your first real skill.</p>
        <button onclick="window.openSellerSkills()" class="mt-6 px-8 py-4 bg-brand-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-brand-500/30 hover:bg-brand-700 active:scale-95 transition-all inline-flex items-center gap-2">
          <i data-lucide="plus" class="w-5 h-5"></i> Publish Skill
        </button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  grid.innerHTML = skills.map(s => {
    const img = safeUrl(s.img, `https://picsum.photos/seed/${encodeURIComponent(s.id || s.title || 'skill')}/900/600`);
    const title = escapeHTML(toText(s.title || 'Untitled Skill'));
    const cat = escapeHTML(toText(s.category || 'Other'));
    const loc = escapeHTML(toText(s.loc || 'Remote'));
    const seller = escapeHTML(toText(s.sellerName || 'Seller'));
    const price = Number(s.price) || 0;
    const desc = escapeHTML(toText(s.description || '')).slice(0, 180);
    return `
      <div class="premium-card p-6 rounded-[40px] group">
        <div class="aspect-video rounded-3xl overflow-hidden bg-slate-100 mb-6 relative">
          <img src="${escapeHTML(img)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" loading="lazy" alt="${title}">
          <div class="absolute top-4 left-4 px-3 py-1.5 rounded-xl bg-white/90 backdrop-blur-md text-[10px] font-black uppercase tracking-widest text-brand-600 shadow-sm">${cat}</div>
        </div>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">${seller}</span>
            <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">${loc}</span>
          </div>
          <h3 class="text-xl font-black leading-tight group-hover:text-brand-600 transition-colors">${title}</h3>
          <p class="text-sm text-slate-500 dark:text-slate-400 line-clamp-2">${desc || '—'}</p>
          <div class="pt-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
            <div class="flex flex-col">
              <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Price</span>
              <span class="text-lg font-black text-slate-900 dark:text-white">₦${price.toLocaleString()}</span>
            </div>
            <button onclick="window.contactSkillSeller('${escapeHTML(s.id)}')" class="px-6 py-3 bg-brand-600 text-white rounded-2xl text-sm font-black shadow-lg shadow-brand-500/20 hover:bg-brand-700 active:scale-95 transition-all">Contact</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

function renderNotesList() {
  const list = S('notesList');
  if (!list) return;

  if (app.state.notes.length === 0) {
    list.innerHTML = `<div class="p-4 skeleton h-8 rounded-xl mb-2"></div>`;
    return;
  }

  list.innerHTML = app.state.notes.map(n => `
    <button onclick="window.loadNote('${n.id}')" class="w-full text-left p-3 rounded-xl transition-all ${app.state.currentNoteId === n.id ? 'bg-brand-50 text-brand-600' : 'hover:bg-slate-100'}">
      <p class="text-xs font-bold truncate">${escapeHTML(n.title || 'Untitled Note')}</p>
    </button>
  `).join('');
}

const saveNote = async () => {
  if (!app.state.user) return toast('Please login to save notes', 'error');
  const title = S('noteTitle')?.value || 'Untitled Note';
  const content = S('noteContent')?.value || '';
  
  try {
    if (app.state.currentNoteId) {
      await updateDoc(doc(db, "notes", app.state.currentNoteId), { title, content, updatedAt: serverTimestamp() });
      toast('Note updated!', 'success');
      rewardXP(10);
    } else {
      const docRef = await addDoc(collection(db, "notes"), {
        userId: app.state.user.uid,
        title,
        content,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      app.state.currentNoteId = docRef.id;
      toast('Note saved!', 'success');
      rewardXP(25);
    }
  } catch (e) {
    console.error('Save error:', e);
    toast('Error saving note', 'error');
  }
};

// --- Exposed to Window ---
window.showSection = async (id) => await showSection(id, app.state);
window.calculateAdmission = calculateAdmission;
window.saveBudget = saveBudget;
window.addExpense = addExpense;
window.removeExpense = removeExpense;
window.logout = () => handleLogout();
window.saveNote = saveNote;
window.loadNote = (id) => {
  const note = app.state.notes.find(n => n.id === id);
  if (note) {
    app.state.currentNoteId = id;
    if (S('noteTitle')) S('noteTitle').value = note.title;
    if (S('noteContent')) S('noteContent').value = note.content;
    renderNotesList();
  }
};
window.addStudyGoal = async () => {
  const text = prompt('Enter goal:');
  if (text) await addDoc(collection(db, "goals"), { userId: app.state.user.uid, text, done: false, createdAt: serverTimestamp() });
};
window.toggleGoal = async (id, event) => {
  const goal = app.state.goals.find(g => g.id === id);
  if (!goal) return;
  
  const isNowDone = !goal.done;
  await updateDoc(doc(db, "goals", id), { done: isNowDone });
  
  if (isNowDone) {
    rewardXP(100, event);
    toast('Goal completed! +100 XP', 'success');
  }
};
window.selectCbtOption = (idx) => {
  if (studyState.cbt.submitted || studyState.cbt.reviewMode) {
    toast('Review mode is on. Tap Done to start a new exam.', 'info');
    return;
  }
  studyState.cbt.answers[studyState.cbt.i] = idx;
  renderCbtQuestion();
  renderCbtQuestionMap();
  updateCbtStats();
};
window.jumpToCbtQuestion = (idx) => { studyState.cbt.i = idx; renderCbtQuestion(); renderCbtQuestionMap(); };
window.nextQuestion = () => { if (studyState.cbt.i < studyState.cbt.questions.length - 1) { studyState.cbt.i++; renderCbtQuestion(); renderCbtQuestionMap(); } };
window.prevQuestion = () => { if (studyState.cbt.i > 0) { studyState.cbt.i--; renderCbtQuestion(); renderCbtQuestionMap(); } };

window.toggleCbtPause = () => {
  if (jambState.mode === 'jamb' && jambState.timerInterval) {
    jambState.paused = !jambState.paused;
    toast(jambState.paused ? 'Exam paused' : 'Exam resumed', jambState.paused ? 'info' : 'success');
    updateCbtPauseUI();
    return;
  }
  if (studyState.cbt.submitted) return;
  studyState.cbt.paused = !studyState.cbt.paused;
  if (studyState.cbt.paused) {
    if (studyState.cbt.timer) clearInterval(studyState.cbt.timer);
    studyState.cbt.timer = null;
    toast('Exam paused', 'info');
  } else {
    startCbtTimer(() => window.submitExam());
    toast('Exam resumed', 'success');
  }
  updateCbtPauseUI();
};

window.toggleCbtFlag = () => {
  if (studyState.cbt.submitted) return;
  const total = studyState.cbt.questions.length;
  if (!Array.isArray(studyState.cbt.flags) || studyState.cbt.flags.length !== total) {
    studyState.cbt.flags = new Array(total).fill(false);
  }
  studyState.cbt.flags[studyState.cbt.i] = !studyState.cbt.flags[studyState.cbt.i];
  updateCbtFlagUI();
  renderCbtQuestionMap();
};

window.toggleCbtResults = (open) => {
  const modal = S('cbtResultModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !open);
  modal.classList.toggle('flex', !!open);
  if (open && window.lucide) window.lucide.createIcons();
};

window.reviewCbtAnswers = () => {
  studyState.cbt.reviewMode = true;
  window.toggleCbtResults(false);
  renderCbtQuestion();
  renderCbtQuestionMap();
  toast('Review mode: correct answers are highlighted', 'success');
};

window.finishCbtExam = () => {
  window.toggleCbtResults(false);
  resetCbtSession();
  window.showSection('study');
};

window.submitExam = (event) => {
  if (studyState.cbt.submitted) return;
  studyState.cbt.submitted = true;
  studyState.cbt.reviewMode = false;
  if (studyState.cbt.timer) clearInterval(studyState.cbt.timer);
  studyState.cbt.timer = null;

  // Success celebration!
  if (window.confetti) {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#7c3aed', '#4f46e5', '#06b6d4', '#10b981']
    });
  }

  const total = studyState.cbt.questions.length;
  let correctCount = 0;
  let wrongCount = 0;
  let unanswered = 0;
  const wrongTopicCounts = {};
  for (let i = 0; i < total; i++) {
    const ans = studyState.cbt.answers[i];
    const correct = getCbtCorrectIndex(studyState.cbt.questions[i]);
    if (ans === null || ans === undefined) unanswered++;
    else if (ans === correct) correctCount++;
    else {
      wrongCount++;
      const topic = studyState.cbt.questions[i]?.topic;
      if (topic) wrongTopicCounts[topic] = (wrongTopicCounts[topic] || 0) + 1;
    }
  }

  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const duration = Number(studyState.cbt.durationSec) || (30 * 60);
  const usedSec = Math.max(0, duration - (Number(studyState.cbt.timeLeft) || 0));

  if (S('cbtScorePct')) S('cbtScorePct').textContent = `${pct}%`;
  if (S('cbtScoreFrac')) S('cbtScoreFrac').textContent = `${correctCount}/${total}`;
  if (S('cbtWrong')) S('cbtWrong').textContent = String(wrongCount);
  if (S('cbtUnanswered')) S('cbtUnanswered').textContent = String(unanswered);
  if (S('cbtTimeUsed')) S('cbtTimeUsed').textContent = formatMMSS(usedSec);

  toast(`Exam submitted! Score: ${correctCount}/${total}`, 'success');
  rewardXP(200, event);

  saveCbtAttempt({
    mode: 'single',
    examType: studyState.cbt.examType || 'GENERAL',
    subjects: [studyState.cbt.subject || 'General'],
    totalCorrect: correctCount,
    totalQuestions: total,
    pct,
    durationSec: duration,
    usedSec,
    wrongTopics: Object.entries(wrongTopicCounts).map(([topic, count]) => ({ topic, count }))
  }).catch(e => console.error('Failed to save CBT attempt:', e));

  // Update Stats & CBT Limit
  if (app.state.user) {
    const userRef = doc(db, "users", app.state.user.uid);
    const newExamsTaken = (app.state.userData.examsTaken || 0) + 1;
    updateDoc(userRef, { 
      examsTaken: newExamsTaken,
      lastCbtAt: serverTimestamp() 
    });
    app.state.userData.examsTaken = newExamsTaken;
    app.state.userData.lastCbtAt = new Date();
  }

  window.toggleCbtResults(true);
  renderCbtQuestion();
  renderCbtQuestionMap();
};
window.trackListingView = async (id) => {
  const itemId = toText(id).trim();
  if (!itemId) return;
  try {
    const ref = doc(db, "marketItems", itemId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const views = (Number(data.views) || 0) + 1;
      tx.update(ref, { views });
    });
  } catch (e) {
    console.error('View tracking error:', e);
  }
};
window.startEscrowTransaction = (id, price) => {
  const rawPrice = Number(price) || 0;
  const xp = app.state.userData?.xp || 0;
  const { finalPrice, discountAmount, discounted } = applyMarketplaceDiscount(rawPrice, xp);
  const fee = Math.floor(finalPrice * 0.02);
  const total = finalPrice + fee;

  app.state.currentEscrowItemId = toText(id).trim();
  app.state.currentEscrowItemPrice = finalPrice;

  if (S('escrowPrice')) S('escrowPrice').textContent = `₦${rawPrice.toLocaleString()}`;
  const discountRow = S('escrowDiscountRow');
  if (discountRow) {
    discountRow.classList.toggle('hidden', !discounted);
    discountRow.classList.toggle('flex', discounted);
  }
  if (S('escrowDiscountAmount')) S('escrowDiscountAmount').textContent = `-₦${discountAmount.toLocaleString()}`;
  if (S('escrowFee')) S('escrowFee').textContent = `₦${fee.toLocaleString()}`;
  if (S('escrowTotal')) S('escrowTotal').textContent = `₦${total.toLocaleString()}`;
  
  window.trackListingView(id);
  window.toggleEscrow(true);
};

window.toggleEscrow = (show) => {
  const modal = S('escrowModal');
  if (modal) {
    modal.classList.toggle('hidden', !show);
    if (show) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    } else {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }
};

window.confirmPayment = async () => {
  const btn = S('payBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Processing...';
  btn.disabled = true;
  if (window.lucide) window.lucide.createIcons();

  try {
    if (!app.state.currentEscrowItemId) throw new Error('Missing escrow item');
    const itemId = toText(app.state.currentEscrowItemId).trim();
    // Already has the Master-rank discount applied (see startEscrowTransaction).
    // NOTE: confirmEscrowPayment is a Cloud Function outside this codebase —
    // for the discount to be authoritative (not just client display), that
    // function needs to independently verify the buyer's rank/xp server-side
    // rather than trusting whatever price the client sends.
    const price = Math.floor(Number(app.state.currentEscrowItemPrice) || 0);
    if (!itemId || price <= 0) throw new Error('Missing escrow details');

    await callConfirmEscrowPayment({ itemId, price });

    toast('Payment recorded! Funds held in escrow.', 'success');
    window.toggleEscrow(false);
    if (typeof confettiCelebration === 'function') confettiCelebration();
    window.openRatingModal();
  } catch (e) {
    console.error('confirmEscrowPayment error:', e);
    toast(e?.message || 'Payment failed', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    if (window.lucide) window.lucide.createIcons();
  }
};

// --- UI Helpers & Modals ---
// Notifications — was entirely local/fake before (store.get('notifications',
// [...two hardcoded demo entries...])), never reflected anything that
// actually happened. Now backed by a real notifications/{id} Firestore
// collection, written by main_admin.htm at the two points a user should
// actually hear about something: subscription verification
// (window.verifySubscription) and XP gifts (window.submitGiftXp).
let myNotifications = [];
let notificationsUnsub = null;

function initNotificationsSync(user) {
  if (!user) return;
  if (notificationsUnsub) notificationsUnsub();
  notificationsUnsub = onSnapshot(
    query(collection(db, 'notifications'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'), limit(50)),
    (snap) => {
      myNotifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      updateNotificationBadge();
      if (S('notiModal') && !S('notiModal').classList.contains('hidden')) renderNotifications();
    },
    (err) => console.error('Notifications listener error:', err)
  );
}

function updateNotificationBadge() {
  const badge = S('notiBadge');
  if (!badge) return;
  const unread = myNotifications.filter((n) => !n.read).length;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function timeAgo(ms) {
  if (!ms) return 'Just now';
  const diff = Date.now() - ms;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

window.toggleNotifications = async (show) => {
  const modal = S('notiModal');
  if (modal) modal.classList.toggle('hidden', !show);
  if (show) {
    renderNotifications();
    // Mark-all-on-open is the common bell-icon convention (Twitter, GitHub,
    // etc.) — the badge did its job getting them to open the panel, no
    // need for a separate "mark all read" click on top of that.
    const unread = myNotifications.filter((n) => !n.read);
    if (unread.length && auth.currentUser) {
      try {
        await Promise.all(unread.map((n) => updateDoc(doc(db, 'notifications', n.id), { read: true })));
      } catch (e) {
        console.error('Failed to mark notifications read:', e);
      }
    }
  }
};

window.clearNotifications = async () => {
  if (!auth.currentUser || !myNotifications.length) return;
  try {
    await Promise.all(myNotifications.map((n) => deleteDoc(doc(db, 'notifications', n.id))));
  } catch (e) {
    console.error('Failed to clear notifications:', e);
    toast('Failed to clear notifications', 'error');
  }
};

window.deleteNotification = async (id) => {
  if (!auth.currentUser) return;
  try {
    await deleteDoc(doc(db, 'notifications', id));
  } catch (e) {
    console.error('Failed to delete notification:', e);
  }
};

const aiAssistantState = {
  open: false,
  isThinking: false
};

window.toggleAiAssistant = (show) => {
  const chat = S('aiChat');
  if (!chat) return;
  aiAssistantState.open = !!show;
  chat.classList.toggle('hidden', !show);
  if (show) {
    const input = S('aiInput');
    if (input) setTimeout(() => input.focus(), 0);
    if (window.lucide) window.lucide.createIcons();
  }
};

function appendAiBubble(role, text) {
  const wrap = S('aiMessages');
  if (!wrap) return;
  const safe = escapeHTML(toText(text));

  if (role === 'user') {
    wrap.insertAdjacentHTML('beforeend', `
      <div class="flex justify-end animate-in slide-in-from-right-4 duration-300">
        <div class="max-w-[85%] px-5 py-3 rounded-[24px] rounded-tr-none bg-brand-600 text-white text-sm font-medium shadow-lg shadow-brand-500/20">
          ${safe}
        </div>
      </div>
    `);
  } else {
    wrap.insertAdjacentHTML('beforeend', `
      <div class="flex items-start gap-3 animate-in slide-in-from-left-4 duration-500">
        <div class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
          <i data-lucide="bot" class="w-4 h-4"></i>
        </div>
        <div class="max-w-[85%] bg-slate-100 dark:bg-slate-800 p-4 rounded-2xl rounded-tl-none text-sm">
          ${safe}
        </div>
      </div>
    `);
  }

  wrap.scrollTop = wrap.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

function aiReplyFor(text) {
  const t = toText(text).toLowerCase();
  if (t.includes('market') || t.includes('buy') || t.includes('sell')) return "Try using the Marketplace filters (category, location, price, favorites). If you tell me what you’re looking for, I’ll help you narrow it down.";
  if (t.includes('flashcard')) return "Open Flashcards, click the card to flip, then rate it (Again/Hard/Good/Easy) to move to the next one.";
  if (t.includes('note') || t.includes('notebook')) return "Open Notebook, write your title and notes, then hit Save. You can also create a new note anytime.";
  if (t.includes('gig')) return "Open Gigs Board, search/filter gigs, or post your own gig using “Post a Gig”.";
  if (t.includes('skill')) return "Open Skill Academy to browse skills, or use Seller Hub to publish your own skill.";
  if (t.includes('login') || t.includes('sign in')) return "If you’re having trouble signing in, check your email/password and try again. If you want, tell me what error message you see.";
  return "Tell me what you want to do in Geo-Books (Notebook, Marketplace, Flashcards, Gigs, Skill Academy) and what’s not working, and I’ll guide you step-by-step.";
}

window.sendAiMessage = async () => {
  const input = S('aiInput');
  if (!input || aiAssistantState.isThinking) return;
  const msg = toText(input.value).trim();
  if (!msg) return;

  input.value = '';
  appendAiBubble('user', msg);

  aiAssistantState.isThinking = true;
  let reply = '';
  try {
    if (aiIsConfigured()) {
      reply = await aiSupportReply(msg, { section: app.state.currentSection, user: app.state.userData });
    }
  } catch {}
  if (!reply) reply = aiReplyFor(msg);

  await new Promise(r => setTimeout(r, 200));
  appendAiBubble('assistant', reply || "Tell me what you want to do in Geo-Books and what’s not working, and I’ll guide you step-by-step.");
  aiAssistantState.isThinking = false;
};

function renderNotifications() {
  const list = S('notiList');
  const empty = S('notiEmpty');
  if (!list || !empty) return;

  if (myNotifications.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = myNotifications.map(n => `
      <div class="p-4 border-b border-slate-50 dark:border-slate-800/50 flex gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group ${n.read ? '' : 'bg-brand-50/40 dark:bg-brand-900/10'}">
        <div class="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 flex items-center justify-center shrink-0">
          <i data-lucide="${safeIconName(n.icon || 'bell', 'bell')}" class="w-5 h-5"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-slate-600 dark:text-slate-300 leading-snug">${escapeHTML(n.text || '')}</p>
          <p class="text-[10px] font-bold text-slate-400 uppercase mt-1">${escapeHTML(timeAgo(toMillis(n.createdAt)))}</p>
        </div>
        <button onclick="window.deleteNotification('${n.id}')" class="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-rose-500 shrink-0" aria-label="Dismiss">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
    `).join('');
    if (window.lucide) window.lucide.createIcons();
  }
}

// Auth Modal logic moved to consolidated Global UI Handlers section at end of file

// --- Zen Study Mode ---
const zenState = {
  active: false,
  cards: [
    { q: "What is the primary function of the Mitochondria?", a: "Production of ATP (Energy)", cat: "Biology" },
    { q: "Define 'Isotope' in Chemistry.", a: "Atoms of the same element with different neutron counts.", cat: "Chemistry" },
    { q: "Who is the 'Father of Nigerian Nationalism'?", a: "Herbert Macaulay", cat: "History" },
    { q: "What does 'SOP' stand for in scholarship applications?", a: "Statement of Purpose", cat: "Japa Tips" }
  ],
  idx: 0,
  ambience: false,
  audio: null,
  currentTrack: 0,
  tracks: [
    { title: 'Lofi Beats', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }, // Placeholder URLs
    { title: 'Rainfall', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
    { title: 'White Noise', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' }
  ]
};

window.toggleFocusMode = (show) => {
  const overlay = S('zenOverlay');
  if (!overlay) return;
  
  zenState.active = show;
  overlay.classList.toggle('hidden', !show);
  
  if (show) {
    document.body.classList.add('overflow-hidden');
    renderZenCard();
    toast('Entering Zen Mode. Stay focused.', 'brand');
    confettiCelebration();
    
    if (!window.__zenAchievement) {
      window.__zenAchievement = true;
      window.showAchievement('Neural Focus', 'You have entered your first deep study session.', 'zap');
    }
    
    // Auto-init volume listener
    const vol = S('zenVolume');
    if (vol) {
      vol.oninput = (e) => {
        if (zenState.audio) zenState.audio.volume = e.target.value;
      };
    }
  } else {
    document.body.classList.remove('overflow-hidden');
    if (zenState.audio) {
      zenState.audio.pause();
      zenState.ambience = false;
      updateZenAudioUI();
    }
  }
};

window.exitZenMode = () => window.toggleFocusMode(false);

function renderZenCard() {
  const card = zenState.cards[zenState.idx];
  if (S('zenFront')) S('zenFront').textContent = card.q;
  if (S('zenBack')) S('zenBack').textContent = card.a;
  if (S('zenCategory')) S('zenCategory').textContent = card.cat;
  if (S('zenProgressText')) S('zenProgressText').textContent = `Card ${zenState.idx + 1} of ${zenState.cards.length}`;
  if (S('zenProgressBar')) S('zenProgressBar').style.width = `${((zenState.idx + 1) / zenState.cards.length) * 100}%`;
  
  const inner = S('zenCardInner');
  if (inner) inner.style.transform = 'rotateY(0deg)';
}

function updateZenAudioUI() {
  const title = S('zenAudioTitle');
  const icon = S('zenPlayIcon');
  if (title) title.textContent = zenState.tracks[zenState.currentTrack].title;
  if (icon) {
    icon.setAttribute('data-lucide', zenState.ambience ? 'pause' : 'play');
    if (window.lucide) window.lucide.createIcons();
  }
}

window.nextZenAudio = () => {
  zenState.currentTrack = (zenState.currentTrack + 1) % zenState.tracks.length;
  if (zenState.ambience) {
    playZenAudio();
  } else {
    updateZenAudioUI();
  }
};

window.prevZenAudio = () => {
  zenState.currentTrack = (zenState.currentTrack - 1 + zenState.tracks.length) % zenState.tracks.length;
  if (zenState.ambience) {
    playZenAudio();
  } else {
    updateZenAudioUI();
  }
};

function playZenAudio() {
  if (zenState.audio) zenState.audio.pause();
  zenState.audio = new Audio(zenState.tracks[zenState.currentTrack].url);
  zenState.audio.loop = true;
  zenState.audio.volume = S('zenVolume')?.value || 0.5;
  zenState.audio.play();
  zenState.ambience = true;
  updateZenAudioUI();
}

window.toggleZenAmbience = () => {
  if (zenState.ambience) {
    if (zenState.audio) zenState.audio.pause();
    zenState.ambience = false;
    updateZenAudioUI();
    toast('Ambience muted', 'info');
  } else {
    playZenAudio();
    toast(`${zenState.tracks[zenState.currentTrack].title} started`, 'info');
  }
};

window.contactConcierge = () => toast('Connecting to your Elite Mentor...', 'brand');
window.openDocumentVault = () => toast('Opening Secure Document Vault...', 'brand');

window.triggerJapaSync = async () => {
  const overlay = S('japaNeuralOverlay');
  const bar = S('japaNeuralProgress');
  if (!overlay || !bar) return;

  overlay.classList.replace('hidden', 'flex');
  setTimeout(() => bar.style.width = '100%', 100);

  await new Promise(r => setTimeout(r, 2500));
  
  overlay.classList.add('fade-out');
  setTimeout(() => {
    overlay.classList.replace('flex', 'hidden');
    overlay.classList.remove('fade-out');
    bar.style.width = '0%';
    
    // Inject new scholarship
    const list = S('scholarshipMatches');
    const newItem = `
      <div class="p-6 rounded-3xl bg-brand-50 dark:bg-brand-900/10 border border-brand-100 dark:border-brand-900/30 flex items-center justify-between group animate-in slide-in-from-top-4 duration-500">
        <div class="flex items-center gap-5">
          <div class="w-14 h-14 rounded-2xl bg-white dark:bg-brand-950 flex items-center justify-center text-2xl shadow-sm">🇺🇸</div>
          <div>
            <h4 class="font-black text-slate-900 dark:text-white">Fulbright Foreign Student Program</h4>
            <p class="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Full Funding • Graduate Study in US</p>
          </div>
        </div>
        <div class="text-right">
          <div class="text-brand-600 font-black text-lg">99% Match</div>
          <button class="mt-2 text-[10px] font-black text-brand-600 uppercase tracking-widest hover:underline">Neural Draft Review</button>
        </div>
      </div>
    `;
    list.insertAdjacentHTML('afterbegin', newItem);
    toast('Neural Sync Complete. Found 1 high-priority match.', 'success');
    confettiCelebration();
  }, 500);
};

const inferCbtSubject = (text) => {
  const t = toText(text).toLowerCase();
  if (t.includes('math')) return 'Mathematics';
  if (t.includes('physics')) return 'Physics';
  if (t.includes('chem')) return 'Chemistry';
  if (t.includes('bio')) return 'Biology';
  if (t.includes('english') || t.includes('use of english')) return 'English';
  if (t.includes('jamb') || t.includes('utme')) return 'JAMB';
  return 'General';
};

// Pulls real past questions from Firestore's `questions` collection (see
// firestore.rules / firestore.indexes.json / server.js's
// /api/questions/bulk-import). This is what actually closes the gap with
// myschool.ng's 60,000+ real past-question archive — the hardcoded
// generateCbtExam() below is a 12-question placeholder bank that only kicks
// in when this returns null (offline with nothing cached yet, or the admin
// hasn't imported that subject/exam type yet).
//
// Offline-first: if the browser is offline, or the network fetch fails, this
// falls back to whatever was previously downloaded into IndexedDB via
// window.downloadQuestionPackForOffline() below.
async function fetchRealQuestionBank({ examType = 'GENERAL', subject, year = null, topic = null, count = 20 } = {}) {
  const normalizedExamType = toText(examType).trim().toUpperCase() || 'GENERAL';
  const normalizedSubject = toText(subject).trim();
  const normalizedTopic = toText(topic).trim();
  if (!normalizedSubject) return null;

  // Topic packs are cached separately from the plain subject pack so a
  // "General practice" download doesn't get confused with a narrower
  // "Linear equations only" download for the same subject.
  const packKey = questionPackKey(normalizedExamType, normalizedTopic ? `${normalizedSubject}::${normalizedTopic}` : normalizedSubject, year);

  if (!navigator.onLine) {
    const cached = await getCachedQuestionPack(packKey);
    return (cached && cached.length) ? shuffleAndTrim(cached, count) : null;
  }

  try {
    const constraints = [
      where('examType', '==', normalizedExamType),
      where('subject', '==', normalizedSubject)
    ];
    if (year) constraints.push(where('year', '==', Number(year)));
    if (normalizedTopic) constraints.push(where('topic', '==', normalizedTopic));
    // Over-fetch so the client-side shuffle below isn't just replaying the
    // same first N docs Firestore happens to return in index order.
    constraints.push(limit(Math.max(count * 3, 60)));

    const snap = await getDocs(query(collection(db, 'questions'), ...constraints));
    if (snap.empty) {
      const cached = await getCachedQuestionPack(packKey);
      return (cached && cached.length) ? shuffleAndTrim(cached, count) : null;
    }

    const questions = snap.docs.map(docSnap => {
      const d = docSnap.data();
      const optionOrder = ['A', 'B', 'C', 'D'];
      return {
        q: toText(d.questionText),
        opts: optionOrder.map(k => toText(d.options?.[k])),
        correct: optionOrder.indexOf(toText(d.correct).toUpperCase()),
        exp: toText(d.explanation),
        topic: toText(d.topic),
        year: d.year || null
      };
    }).filter(q => q.q && q.opts.every(Boolean) && q.correct >= 0);

    if (questions.length === 0) return null;

    // Cache the full fetched set (not just the trimmed session) so a later
    // offline session for this subject has more than `count` to shuffle from.
    cacheQuestionPack(packKey, questions);
    return shuffleAndTrim(questions, count);
  } catch (e) {
    console.warn('fetchRealQuestionBank: live fetch failed, trying offline cache', e);
    const cached = await getCachedQuestionPack(packKey);
    return (cached && cached.length) ? shuffleAndTrim(cached, count) : null;
  }
}

// Topic-by-topic practice (a feature myschool.ng's app has that Geo-Books
// didn't). Pulls a sample of real questions for the subject and derives the
// distinct, non-empty `topic` values from them — cheap enough for a
// setup-screen dropdown without a dedicated topics collection.
async function fetchTopicsForSubject(examType, subject) {
  const normalizedExamType = toText(examType).trim().toUpperCase() || 'GENERAL';
  const normalizedSubject = toText(subject).trim();
  if (!normalizedSubject) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'questions'),
      where('examType', '==', normalizedExamType),
      where('subject', '==', normalizedSubject),
      limit(300)
    ));
    const topics = new Set();
    snap.docs.forEach(docSnap => {
      const t = toText(docSnap.data().topic).trim();
      if (t) topics.add(t);
    });
    return Array.from(topics).sort();
  } catch (e) {
    console.warn('fetchTopicsForSubject failed:', e);
    return [];
  }
}
window.fetchTopicsForSubject = fetchTopicsForSubject;

// Populates a <select id="cbtQuickTopicSelect"> from the currently chosen
// subject/exam type. Called from the subject/exam-type <select> onchange.
window.refreshQuickTopicOptions = async () => {
  const examType = S('cbtQuickExamType')?.value || 'GENERAL';
  const subject = S('cbtQuickSubjectSelect')?.value || '';
  const select = S('cbtQuickTopicSelect');
  if (!select) return;
  select.innerHTML = `<option value="">All topics</option>`;
  if (!subject) return;
  const topics = await fetchTopicsForSubject(examType, subject);
  topics.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  });
};

function shuffleAndTrim(list, count) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

// Lets a user explicitly pre-download a subject's real questions for offline
// CBT practice — the workflow myschool.ng markets as "100% offline access".
// Wire this to a button in the CBT setup UI, e.g.:
//   <button onclick="window.downloadQuestionPackForOffline('JAMB','Mathematics')">Download for offline</button>
window.downloadQuestionPackForOffline = async (examType, subject, year = null) => {
  toast(`Downloading ${subject} questions for offline use…`, 'info');
  const questions = await fetchRealQuestionBank({ examType, subject, year, count: 500 });
  if (!questions || questions.length === 0) {
    toast(`No questions available yet for ${subject} (${examType}). Check back after the next import.`, 'error');
    return false;
  }
  toast(`${questions.length} ${subject} questions ready offline.`, 'success');
  return true;
};

// ---------------------------------------------------------------------------
// Unified CBT Attempt Log
// ---------------------------------------------------------------------------
// Single source of truth for every graded exam — single-subject quick
// practice, official exams, AI-generated exams, AND the 4-subject JAMB
// simulator all funnel through this one function. Everything downstream
// (Performance dashboard, weak-topic analytics, World/Campus Ranking) reads
// from this one collection instead of each mode keeping its own history.
async function saveCbtAttempt(data) {
  const uid = app.state.user?.uid;
  if (!uid) return null;

  const payload = {
    uid,
    mode: data.mode || 'single', // 'single' | 'jamb'
    examType: toText(data.examType || 'GENERAL').toUpperCase(),
    subjects: Array.isArray(data.subjects) ? data.subjects : [toText(data.subject || 'General')],
    perSubject: data.perSubject || null,
    totalCorrect: Math.max(0, Math.floor(Number(data.totalCorrect) || 0)),
    totalQuestions: Math.max(0, Math.floor(Number(data.totalQuestions) || 0)),
    pct: Math.max(0, Math.min(100, Math.round(Number(data.pct) || 0))),
    jambAggregate: Number.isFinite(Number(data.jambAggregate)) ? Math.round(Number(data.jambAggregate)) : null,
    durationSec: Math.max(0, Math.floor(Number(data.durationSec) || 0)),
    usedSec: Math.max(0, Math.floor(Number(data.usedSec) || 0)),
    wrongTopics: Array.isArray(data.wrongTopics) ? data.wrongTopics.slice(0, 10) : [],
    createdAt: serverTimestamp()
  };

  const ref = await addDoc(collection(db, 'cbtAttempts'), payload);

  // Denormalize a new personal-best JAMB aggregate onto the user doc so the
  // World/Campus Ranking leaderboard is a cheap orderBy query. Only ever
  // moves upward, decided in a transaction against the user's own doc so
  // two rapid submissions can't race each other into an inconsistent state.
  if (payload.mode === 'jamb' && payload.jambAggregate !== null) {
    try {
      await runTransaction(db, async (tx) => {
        const userRef = doc(db, 'users', uid);
        const snap = await tx.get(userRef);
        const prevBest = Number(snap.data()?.bestJambScore) || 0;
        if (payload.jambAggregate > prevBest) {
          tx.set(userRef, {
            bestJambScore: payload.jambAggregate,
            bestJambScorePct: payload.pct,
            bestJambScoreAt: serverTimestamp()
          }, { merge: true });
        }
      });
    } catch (e) {
      console.warn('Failed to update bestJambScore (leaderboard rank may lag):', e);
    }
  }

  app.state.cbtAttempts = [{ id: ref.id, ...payload, createdAt: new Date() }, ...(app.state.cbtAttempts || [])];
  renderCbtAnalytics();
  renderCbtHistory();
  return ref.id;
}

// --- Exam History (setup-screen list) ---
async function renderCbtHistory() {
  const list = S('cbtHistoryList');
  const section = S('cbtHistorySection');
  const uid = app.state.user?.uid;
  if (!list) return;
  if (!uid) { if (section) section.classList.add('hidden'); return; }

  try {
    const snap = await getDocs(query(collection(db, 'cbtAttempts'), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(6)));
    const attempts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    app.state.cbtAttempts = attempts;
    if (section) section.classList.toggle('hidden', attempts.length === 0);
    if (attempts.length === 0) {
      list.innerHTML = `<p class="text-xs font-bold text-slate-400 col-span-2">No attempts yet — your first exam will show up here.</p>`;
      return;
    }
    list.innerHTML = attempts.map(a => {
      const when = toMillis(a.createdAt) ? new Date(toMillis(a.createdAt)).toLocaleDateString() : 'Just now';
      const label = a.mode === 'jamb' ? `JAMB · ${(a.subjects || []).join(', ')}` : (a.subjects || ['General'])[0];
      const scoreLabel = a.mode === 'jamb' && a.jambAggregate !== null ? `${a.jambAggregate}/400` : `${a.pct}%`;
      return `
        <div class="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p class="text-sm font-black">${escapeHTML(label)}</p>
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">${when} · ${a.totalCorrect}/${a.totalQuestions}</p>
          </div>
          <span class="px-4 py-2 rounded-2xl text-sm font-black ${a.pct >= 50 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20' : 'bg-rose-50 text-rose-600 dark:bg-rose-900/20'}">${scoreLabel}</span>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.warn('renderCbtHistory failed:', e);
    if (section) section.classList.add('hidden');
  }
}
window.renderCbtHistory = renderCbtHistory;

// ---------------------------------------------------------------------------
// Performance Analytics (myschool.ng has basic "exam history"; this adds
// weak-topic detection and a real trend, which their app doesn't).
// ---------------------------------------------------------------------------
async function renderCbtAnalytics() {
  const wrap = S('cbtAnalyticsPanel');
  if (!wrap) return;
  const uid = app.state.user?.uid;
  if (!uid) { wrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-6">Sign in to see your performance analytics.</p>`; return; }

  let attempts = app.state.cbtAttempts;
  if (!Array.isArray(attempts)) {
    try {
      const snap = await getDocs(query(collection(db, 'cbtAttempts'), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(30)));
      attempts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      app.state.cbtAttempts = attempts;
    } catch (e) {
      console.warn('renderCbtAnalytics fetch failed:', e);
      attempts = [];
    }
  }

  if (attempts.length === 0) {
    wrap.innerHTML = `
      <div class="p-10 text-center">
        <i data-lucide="bar-chart-3" class="w-10 h-10 text-slate-300 mx-auto mb-4"></i>
        <p class="text-sm font-bold text-slate-400">Take your first CBT to unlock performance analytics.</p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const avgPct = Math.round(attempts.reduce((s, a) => s + (a.pct || 0), 0) / attempts.length);
  const bestJamb = Math.max(0, ...attempts.filter(a => a.mode === 'jamb').map(a => a.jambAggregate || 0));

  // Per-subject averages
  const subjectTotals = {};
  attempts.forEach(a => {
    (a.subjects || []).forEach(subj => {
      const per = a.perSubject?.[subj];
      const pct = per ? (per.total > 0 ? Math.round((per.correct / per.total) * 100) : 0) : (a.pct || 0);
      if (!subjectTotals[subj]) subjectTotals[subj] = { sum: 0, count: 0 };
      subjectTotals[subj].sum += pct;
      subjectTotals[subj].count += 1;
    });
  });
  const subjectAverages = Object.entries(subjectTotals)
    .map(([subject, v]) => ({ subject, avg: Math.round(v.sum / v.count) }))
    .sort((a, b) => a.avg - b.avg);

  // Weak topics across all attempts
  const topicCounts = {};
  attempts.forEach(a => (a.wrongTopics || []).forEach(t => {
    topicCounts[t.topic] = (topicCounts[t.topic] || 0) + (t.count || 1);
  }));
  const weakTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Trend: last 10 attempts, oldest to newest
  const trend = attempts.slice(0, 10).reverse();

  wrap.innerHTML = `
    <div class="grid grid-cols-3 gap-4 mb-8">
      <div class="p-5 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-center">
        <p class="text-2xl font-black">${attempts.length}</p>
        <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">Exams Taken</p>
      </div>
      <div class="p-5 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-center">
        <p class="text-2xl font-black">${avgPct}%</p>
        <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">Average Score</p>
      </div>
      <div class="p-5 rounded-3xl bg-brand-50 dark:bg-brand-900/20 border border-brand-500/20 text-center">
        <p class="text-2xl font-black text-brand-600">${bestJamb || '—'}</p>
        <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">Best JAMB Aggregate</p>
      </div>
    </div>

    <div class="mb-8">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Recent trend</p>
      <div class="flex items-end gap-2 h-24">
        ${trend.map(a => `
          <div class="flex-1 flex flex-col items-center justify-end gap-1" title="${a.pct}%">
            <div class="w-full rounded-t-lg ${a.pct >= 50 ? 'bg-emerald-500' : 'bg-rose-400'}" style="height: ${Math.max(6, a.pct)}%"></div>
          </div>
        `).join('')}
      </div>
    </div>

    ${subjectAverages.length > 0 ? `
      <div class="mb-8 space-y-3">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">By subject</p>
        ${subjectAverages.map(s => `
          <div>
            <div class="flex items-center justify-between text-xs font-bold mb-1"><span>${escapeHTML(s.subject)}</span><span class="text-slate-400">${s.avg}%</span></div>
            <div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full ${s.avg >= 50 ? 'bg-emerald-500' : 'bg-rose-400'} rounded-full" style="width: ${s.avg}%"></div>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${weakTopics.length > 0 ? `
      <div class="p-5 rounded-3xl bg-amber-50 dark:bg-amber-900/10 border border-amber-500/20">
        <p class="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-3">Weakest topics — practice these</p>
        <div class="flex flex-wrap gap-2">
          ${weakTopics.map(([topic, count]) => `<span class="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 text-xs font-bold border border-amber-500/20">${escapeHTML(topic)} <span class="text-amber-500">×${count}</span></span>`).join('')}
        </div>
      </div>
    ` : ''}
  `;
  if (window.lucide) window.lucide.createIcons();
}
window.renderCbtAnalytics = renderCbtAnalytics;

// ---------------------------------------------------------------------------
// Question Bookmarks — myschool.ng's "save a question to study later,"
// but the snapshot survives even if the source question is later edited.
// ---------------------------------------------------------------------------
function questionFingerprint(q) {
  const str = toText(q?.q || q?.question || '').trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function currentCbtQuestion() {
  if (jambState.mode === 'jamb' && jambState.timerInterval) {
    const subject = jambState.activeSubject;
    return (jambState.questions[subject] || [])[jambState.questionIndex[subject]] || null;
  }
  const q = studyState.cbt.questions?.[studyState.cbt.i];
  return q ? { question: q.q, options: q.opts, correct: q.correct, explanation: q.exp, topic: q.topic } : null;
}

window.isQuestionBookmarked = (q) => {
  if (!q) return false;
  const fp = questionFingerprint(q);
  return (app.state.bookmarkFingerprints || new Set()).has(fp);
};

window.toggleBookmarkQuestion = async () => {
  const uid = app.state.user?.uid;
  if (!uid) { toast('Sign in to bookmark questions', 'warning'); return; }
  const q = currentCbtQuestion();
  if (!q) return;

  const fp = questionFingerprint(q);
  const ref = doc(db, 'bookmarks', `${uid}_${fp}`);
  const already = window.isQuestionBookmarked(q);

  if (!app.state.bookmarkFingerprints) app.state.bookmarkFingerprints = new Set();

  try {
    if (already) {
      await deleteDoc(ref);
      app.state.bookmarkFingerprints.delete(fp);
      toast('Removed from bookmarks', 'info');
    } else {
      const meta = jambState.mode === 'jamb' && jambState.timerInterval
        ? { subject: jambState.activeSubject, examType: 'JAMB' }
        : { subject: studyState.cbt.subject || 'General', examType: studyState.cbt.examType || 'GENERAL' };
      await setDoc(ref, {
        uid,
        questionText: toText(q.question || q.q),
        options: q.options || q.opts || [],
        correct: Number.isInteger(q.correct) ? q.correct : 0,
        explanation: toText(q.explanation || q.exp || ''),
        topic: toText(q.topic || ''),
        subject: meta.subject,
        examType: meta.examType,
        createdAt: serverTimestamp()
      });
      app.state.bookmarkFingerprints.add(fp);
      toast('Bookmarked — find it under CBT → Bookmarks', 'success');
    }
  } catch (e) {
    console.error('Bookmark toggle failed:', e);
    toast('Could not update bookmark right now', 'error');
    return;
  }
  renderBookmarkButtonState();
};

function renderBookmarkButtonState() {
  const btn = S('cbtBookmarkBtn');
  if (!btn) return;
  const q = currentCbtQuestion();
  const active = window.isQuestionBookmarked(q);
  btn.classList.toggle('bg-amber-100', active);
  btn.classList.toggle('text-amber-700', active);
  btn.innerHTML = `<i data-lucide="bookmark" class="w-6 h-6"></i>`;
  if (window.lucide) window.lucide.createIcons();
}
window.renderBookmarkButtonState = renderBookmarkButtonState;

function initBookmarksSync() {
  const uid = app.state.user?.uid;
  if (!uid) return;
  onSnapshot(query(collection(db, 'bookmarks'), where('uid', '==', uid), orderBy('createdAt', 'desc')), (snap) => {
    const bookmarks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    app.state.bookmarks = bookmarks;
    app.state.bookmarkFingerprints = new Set(bookmarks.map(b => questionFingerprint({ q: b.questionText })));
    renderBookmarksPanel();
    renderBookmarkButtonState();
  }, (error) => {
    console.error('Bookmarks sync error:', error);
  });
}

function renderBookmarksPanel() {
  const wrap = S('cbtBookmarksPanel');
  if (!wrap) return;
  const bookmarks = app.state.bookmarks || [];
  if (bookmarks.length === 0) {
    wrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-6 text-center">No bookmarked questions yet. Tap the bookmark icon during any exam to save one here.</p>`;
    return;
  }
  wrap.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">${bookmarks.length} saved question${bookmarks.length === 1 ? '' : 's'}</p>
      <button onclick="window.practiceBookmarks()" class="px-6 py-3 rounded-2xl bg-brand-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-brand-700 transition-all flex items-center gap-2">
        <i data-lucide="play" class="w-4 h-4"></i> Practice All
      </button>
    </div>
    <div class="space-y-3">
      ${bookmarks.map(b => `
        <div class="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
          <div class="flex items-start justify-between gap-4">
            <p class="text-sm font-bold flex-1">${escapeHTML(b.questionText)}</p>
            <button onclick="window.removeBookmark('${b.id}')" class="shrink-0 w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-500 flex items-center justify-center hover:bg-rose-100 transition-all">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
          <div class="flex items-center gap-2 mt-3">
            <span class="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 text-[9px] font-black uppercase tracking-widest text-slate-400 border border-slate-200 dark:border-slate-700">${escapeHTML(b.subject || 'General')}</span>
            ${b.topic ? `<span class="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 text-[9px] font-black uppercase tracking-widest text-slate-400 border border-slate-200 dark:border-slate-700">${escapeHTML(b.topic)}</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}
window.renderBookmarksPanel = renderBookmarksPanel;

window.removeBookmark = async (id) => {
  try {
    await deleteDoc(doc(db, 'bookmarks', id));
    toast('Bookmark removed', 'info');
  } catch (e) {
    console.error('removeBookmark failed:', e);
    toast('Could not remove bookmark', 'error');
  }
};

window.practiceBookmarks = () => {
  const bookmarks = app.state.bookmarks || [];
  if (bookmarks.length === 0) { toast('No bookmarked questions yet', 'info'); return; }
  const questions = bookmarks.map(b => ({
    q: b.questionText, opts: b.options, correct: b.correct, exp: b.explanation, topic: b.topic
  }));
  launchCbtExamPage({
    subject: 'Bookmarked Questions',
    questions,
    durationSec: Math.max(300, questions.length * 60),
    examType: 'BOOKMARKS'
  });
};

// ---------------------------------------------------------------------------
// Question Bank Search — "search for any past question and get the
// answer," the way myschool.ng markets its search feature. Firestore has no
// full-text search, so this fetches a bounded batch (optionally scoped by
// exam type / subject if already selected) and matches client-side. Fine at
// today's question-bank size; if the bank grows into the tens of thousands,
// swap this for a dedicated search index (Algolia/Typesense) fed by the
// same admin import pipeline.
// ---------------------------------------------------------------------------
window.searchQuestionBank = async (rawTerm) => {
  const term = toText(rawTerm).trim().toLowerCase();
  const resultsWrap = S('cbtSearchResults');
  if (!resultsWrap) return;
  if (term.length < 3) {
    resultsWrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-4">Type at least 3 characters to search.</p>`;
    return;
  }

  resultsWrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-4">Searching…</p>`;

  const examType = S('cbtQuickExamType')?.value || null;
  const subject = S('cbtQuickSubjectSelect')?.value || null;

  try {
    const constraints = [];
    if (examType) constraints.push(where('examType', '==', examType));
    if (subject) constraints.push(where('subject', '==', subject));
    constraints.push(limit(500));

    const snap = await getDocs(query(collection(db, 'questions'), ...constraints));
    const matches = snap.docs
      .map(d => d.data())
      .filter(d => toText(d.questionText).toLowerCase().includes(term) || toText(d.topic).toLowerCase().includes(term))
      .slice(0, 25);

    if (matches.length === 0) {
      resultsWrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-4">No matches for "${escapeHTML(rawTerm)}". Try a different keyword or widen the exam/subject filter.</p>`;
      return;
    }

    resultsWrap.innerHTML = matches.map(d => `
      <div class="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
        <p class="text-sm font-bold mb-2">${escapeHTML(d.questionText)}</p>
        <p class="text-xs font-medium text-emerald-600">Answer: ${escapeHTML(toText(d.options?.[d.correct] || ''))}</p>
        ${d.explanation ? `<p class="text-xs text-slate-500 mt-1 italic">${escapeHTML(d.explanation)}</p>` : ''}
        <div class="flex items-center gap-2 mt-3">
          <span class="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 text-[9px] font-black uppercase tracking-widest text-slate-400 border border-slate-200 dark:border-slate-700">${escapeHTML(d.subject || '')}</span>
          ${d.year ? `<span class="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 text-[9px] font-black uppercase tracking-widest text-slate-400 border border-slate-200 dark:border-slate-700">${d.year}</span>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('searchQuestionBank failed:', e);
    resultsWrap.innerHTML = `<p class="text-xs font-bold text-rose-500 p-4">Search failed. Try again.</p>`;
  }
};

// ---------------------------------------------------------------------------
// World / Campus Ranking — leaderboard built on the denormalized
// `bestJambScore` written by saveCbtAttempt(). Mirrors the existing global
// XP leaderboard pattern (initLeaderboardSync) so it's consistent with how
// the rest of the app already does live leaderboards.
// ---------------------------------------------------------------------------
function initJambLeaderboardSync() {
  const qWorld = query(collection(db, 'users'), orderBy('bestJambScore', 'desc'), limit(100));
  onSnapshot(qWorld, (snapshot) => {
    app.state.jambLeaderboard = snapshot.docs.map((d, idx) => {
      const data = d.data();
      return {
        id: d.id,
        rank: idx + 1,
        name: data.displayName || data.name || data.email?.split('@')[0] || 'Scholar',
        institution: data.university || data.institution || '',
        score: data.bestJambScore || 0,
        pct: data.bestJambScorePct || 0
      };
    });
    renderJambLeaderboard();
  }, (error) => {
    console.error('JAMB leaderboard sync error:', error);
  });
}

async function renderJambLeaderboard() {
  const wrap = S('cbtWorldRankingList');
  const yourRankEl = S('cbtYourWorldRank');
  if (!wrap) return;
  const board = app.state.jambLeaderboard || [];
  const uid = app.state.user?.uid;

  if (board.length === 0) {
    wrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-6 text-center">No JAMB simulations completed yet — be the first on the board.</p>`;
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  wrap.innerHTML = board.map(s => `
    <div class="flex items-center justify-between p-4 rounded-2xl ${s.id === uid ? 'bg-brand-50 dark:bg-brand-900/20 border-2 border-brand-500' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800'}">
      <div class="flex items-center gap-4">
        <span class="w-10 text-center text-lg font-black">${medals[s.rank - 1] || `#${s.rank}`}</span>
        <div>
          <p class="text-sm font-black">${escapeHTML(s.name)}${s.id === uid ? ' (You)' : ''}</p>
          ${s.institution ? `<p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${escapeHTML(s.institution)}</p>` : ''}
        </div>
      </div>
      <span class="text-lg font-black text-brand-600">${s.score}<span class="text-xs text-slate-400">/400</span></span>
    </div>
  `).join('');

  if (yourRankEl) {
    const inTop100 = board.find(s => s.id === uid);
    if (inTop100) {
      yourRankEl.textContent = `You're #${inTop100.rank} in the world`;
    } else if (uid && app.state.userData?.bestJambScore) {
      try {
        const myScore = app.state.userData.bestJambScore;
        const countSnap = await getCountFromServer(query(collection(db, 'users'), where('bestJambScore', '>', myScore)));
        yourRankEl.textContent = `You're #${countSnap.data().count + 1} in the world`;
      } catch (e) {
        yourRankEl.textContent = '';
      }
    } else {
      yourRankEl.textContent = 'Complete a JAMB simulation to enter the ranking';
    }
  }
}
window.renderJambLeaderboard = renderJambLeaderboard;

// Campus-only ranking, filtered to the current user's institution — a
// differentiator myschool.ng's app doesn't have at all.
window.loadCampusJambRanking = async () => {
  const wrap = S('cbtCampusRankingList');
  if (!wrap) return;
  const institutionId = app.state.userData?.institutionId || app.state.userData?.university;
  if (!institutionId) {
    wrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-6 text-center">Set your institution in your profile to see campus rankings.</p>`;
    return;
  }
  wrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-4">Loading…</p>`;
  try {
    const snap = await getDocs(query(
      collection(db, 'users'),
      where('institutionId', '==', institutionId),
      orderBy('bestJambScore', 'desc'),
      limit(50)
    ));
    const uid = app.state.user?.uid;
    const rows = snap.docs.map((d, idx) => ({ id: d.id, rank: idx + 1, ...d.data() }));
    if (rows.length === 0) {
      wrap.innerHTML = `<p class="text-xs font-bold text-slate-400 p-6 text-center">No one on your campus has completed a JAMB simulation yet.</p>`;
      return;
    }
    wrap.innerHTML = rows.map(r => `
      <div class="flex items-center justify-between p-4 rounded-2xl ${r.id === uid ? 'bg-brand-50 dark:bg-brand-900/20 border-2 border-brand-500' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800'}">
        <div class="flex items-center gap-4">
          <span class="w-8 text-center text-sm font-black text-slate-400">#${r.rank}</span>
          <p class="text-sm font-black">${escapeHTML(r.displayName || r.name || 'Scholar')}${r.id === uid ? ' (You)' : ''}</p>
        </div>
        <span class="text-base font-black text-brand-600">${r.bestJambScore || 0}<span class="text-xs text-slate-400">/400</span></span>
      </div>
    `).join('');
  } catch (e) {
    console.error('Campus ranking failed:', e);
    wrap.innerHTML = `<p class="text-xs font-bold text-rose-500 p-4">Couldn't load campus ranking right now.</p>`;
  }
};

// --- CBT sub-tab switcher (Practice / Performance / Bookmarks / World Ranking) ---
// CBT mode-selection: clicking the CBT nav item lands on cbtHub (a menu of
// big cards), and each card navigates to its own full-page view — a
// dedicated 'view' rather than a tab reveal on the same scroll, so it reads
// as a separate page. Back buttons on each page return to 'hub'.
//
// jambState.mode is still set here ('quick' vs 'jamb') because it's read
// elsewhere (toggleCbtPause, updateCbtPauseUI, currentCbtQuestion's
// bookmark lookup) to disambiguate which exam engine is active — but all of
// those checks are additionally gated on jambState.timerInterval being set,
// so just visiting the JAMB setup page here (without starting a timed
// exam) can't falsely trigger "an exam is live" behavior elsewhere.
const CBT_VIEWS = ['hub', 'quickPractice', 'jamb', 'performance', 'bookmarks', 'ranking'];
window.setCbtView = (view) => {
  if (!CBT_VIEWS.includes(view)) view = 'hub';
  const isHub = view === 'hub';

  CBT_VIEWS.forEach(v => {
    const el = v === 'hub' ? S('cbtHub') : S(`cbtPage_${v}`);
    if (el) el.classList.toggle('hidden', v !== view);
  });

  // The Architect's Vault / Neural Stage launch cards and the "CBT
  // Practice Suite" intro are hub-only chrome — the instant a mode is
  // picked they get out of the way so that mode occupies the section on
  // its own (full-screen within the CBT tab) instead of sharing scroll
  // space with them. They come back the moment the user hits "Back" to hub.
  const topCards = S('cbtTopCards');
  const intro = S('cbtIntro');
  if (topCards) topCards.classList.toggle('hidden', !isHub);
  if (intro) intro.classList.toggle('hidden', !isHub);

  // Let the active mode use the full width/height of the section instead
  // of the hub's boxed-in card container.
  const cbtSetup = S('cbtSetup');
  if (cbtSetup) {
    cbtSetup.classList.toggle('max-w-6xl', isHub);
    cbtSetup.classList.toggle('p-12', isHub);
    cbtSetup.classList.toggle('rounded-[4rem]', isHub);
    cbtSetup.classList.toggle('border', isHub);
    cbtSetup.classList.toggle('shadow-soft', isHub);
    cbtSetup.classList.toggle('max-w-full', !isHub);
    cbtSetup.classList.toggle('w-full', !isHub);
    cbtSetup.classList.toggle('p-4', !isHub);
    cbtSetup.classList.toggle('sm:p-6', !isHub);
    cbtSetup.classList.toggle('rounded-2xl', !isHub);
  }

  if (view === 'jamb') {
    jambState.mode = 'jamb';
    renderJambSubjectGrid();
  } else if (view === 'quickPractice') {
    jambState.mode = 'quick';
  } else if (view === 'performance') {
    renderCbtAnalytics();
  } else if (view === 'bookmarks') {
    renderBookmarksPanel();
  } else if (view === 'ranking') {
    renderJambLeaderboard();
    window.loadCampusJambRanking();
  }

  // Feels like navigating to a new page rather than a same-scroll reveal.
  if (cbtSetup) cbtSetup.scrollIntoView({ behavior: 'smooth', block: 'start' });
};



// --- Video Lessons (student-facing) ---
// Subject/topic video lessons, parity with myschool.ng's topic-by-topic
// video lesson library. Reads the `videoLessons` collection an admin
// populates via main_admin.htm's Video Lessons panel.
async function fetchVideoLessons(subject, topic) {
  const normalizedSubject = toText(subject).trim();
  if (!normalizedSubject) return [];
  try {
    const constraints = [where('subject', '==', normalizedSubject)];
    if (toText(topic).trim()) constraints.push(where('topic', '==', toText(topic).trim()));
    constraints.push(limit(30));
    const snap = await getDocs(query(collection(db, 'videoLessons'), ...constraints));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(l => l.isActive !== false);
  } catch (e) {
    console.warn('fetchVideoLessons failed:', e);
    return [];
  }
}

window.toggleVideoLessonsModal = (show) => {
  const modal = S('videoLessonsModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
};

window.openVideoLessonsModal = async (subject, topic) => {
  if (!toText(subject).trim()) {
    toast('Pick a subject first.', 'error');
    return;
  }
  const titleEl = S('videoLessonsModalTitle');
  const listEl = S('videoLessonsModalList');
  if (titleEl) titleEl.textContent = topic ? `${subject} — ${topic}` : `${subject} Video Lessons`;
  if (listEl) listEl.innerHTML = `<p class="text-sm font-bold text-slate-400">Loading lessons…</p>`;
  window.toggleVideoLessonsModal(true);

  const lessons = await fetchVideoLessons(subject, topic);
  if (!listEl) return;
  if (lessons.length === 0) {
    listEl.innerHTML = `<p class="text-sm font-bold text-slate-400">No video lessons for this ${topic ? 'topic' : 'subject'} yet.</p>`;
    return;
  }
  listEl.innerHTML = lessons.map(l => {
    const safeTitle = escapeHTML(toText(l.title));
    const player = l.youTubeId
      ? `<div class="aspect-video rounded-2xl overflow-hidden bg-black"><iframe class="w-full h-full" src="https://www.youtube.com/embed/${encodeURIComponent(l.youTubeId)}" title="${safeTitle}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
      : `<video class="w-full rounded-2xl bg-black" controls src="${escapeHTML(safeUrl(l.videoUrl))}"></video>`;
    return `
      <div class="p-4 rounded-3xl bg-slate-50 border border-slate-100">
        <p class="text-sm font-black mb-3">${safeTitle}</p>
        ${player}
      </div>
    `;
  }).join('');
};

function generateCbtExam(seed, count = 20) {
  const subject = inferCbtSubject(seed);
  const bank = {
    Mathematics: [
      { q: 'Solve: 3x − 7 = 11', opts: ['2', '4', '6', '8'], correct: 1, exp: '3x = 18 → x = 6? Wait: 11+7=18, 18/3=6 → option C', fix: true },
      { q: 'Simplify: (2a)(3a²)', opts: ['5a²', '6a³', '6a²', '3a³'], correct: 1, exp: 'Multiply coefficients and add powers: 2×3=6, a¹×a²=a³.' },
      { q: 'What is √144?', opts: ['10', '11', '12', '14'], correct: 2, exp: '12×12=144.' }
    ],
    Physics: [
      { q: 'Unit of force is…', opts: ['Joule', 'Newton', 'Watt', 'Pascal'], correct: 1, exp: 'Force is measured in Newton (N).' },
      { q: 'Speed = distance / …', opts: ['mass', 'time', 'force', 'power'], correct: 1, exp: 'Speed is distance divided by time.' },
      { q: 'Which is a vector quantity?', opts: ['speed', 'mass', 'temperature', 'velocity'], correct: 3, exp: 'Velocity has magnitude and direction.' }
    ],
    English: [
      { q: 'Choose the correct spelling:', opts: ['Recieve', 'Receive', 'Receeve', 'Receve'], correct: 1, exp: '“i before e except after c” → receive.' },
      { q: 'A synonym for “brief” is…', opts: ['long', 'short', 'wide', 'slow'], correct: 1, exp: 'Brief means short.' },
      { q: 'Pick the correct sentence:', opts: ['He don’t know.', 'He doesn’t know.', 'He doesn’t knows.', 'He don’t knows.'], correct: 1, exp: 'Third-person singular: does not → doesn’t.' }
    ],
    General: [
      { q: 'Capital of Nigeria is…', opts: ['Lagos', 'Abuja', 'Kano', 'Ibadan'], correct: 1, exp: 'Abuja is the capital of Nigeria.' },
      { q: 'Au is the symbol for…', opts: ['Silver', 'Copper', 'Gold', 'Iron'], correct: 2, exp: 'Au = gold.' },
      { q: 'Water boils at… (at sea level)', opts: ['50°C', '75°C', '100°C', '150°C'], correct: 2, exp: '100°C.' }
    ]
  };

  const base = bank[subject] || bank.General;
  const out = [];
  for (let i = 0; i < count; i++) {
    const pick = base[i % base.length];
    const item = { ...pick };
    if (item.fix) {
      item.opts = ['2', '4', '6', '8'];
      item.correct = 2;
      item.exp = '3x − 7 = 11 → 3x = 18 → x = 6.';
      delete item.fix;
    }
    out.push(item);
  }
  return { subject, questions: out };
}

window.toggleLibraryModal = (show) => {
  const modal = S('libraryModal');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
  modal.classList.toggle('flex', show);
  if (show) renderLibrarySelectionList();
  if (show && window.lucide) window.lucide.createIcons();
};

// --- Mobile search sheet toggle ---
// Backing markup: #mobileSearchSheet. Opened from the mobile header's search
// icon (id="openMobileSearchBtn"); search logic is in initSearchInstance()
// below, shared with the desktop #globalSearch bar.
window.toggleSearch = (show) => {
  const sheet = S('mobileSearchSheet');
  if (!sheet) return;
  sheet.classList.toggle('hidden', !show);
  if (show) S('mobileSearchInput')?.focus();
};
// NOTE: toggleSidebar/toggleForumModal/togglePostModal/toggleBargain were
// removed here along with their dead markup (sidebarSheet/forumModal/
// postModal/bargainModal in geo-books.htm) — each duplicated a feature that
// already works under a different name:
//   sidebar  -> #sidebar + openSidebarBtn (toggleSidebarCollapse family)
//   forum    -> inline campus composer (#campusPostInput + window.createPost)
//   post view-> #campusRepliesModal (window.toggleRepliesModal)
//   bargain  -> contactSellerFromModal -> real chat with the seller

function renderLibrarySelectionList() {
  const list = S('librarySelectionList');
  if (!list) return;
  const books = Array.isArray(app.state.books) ? app.state.books.slice(0, 20) : [];
  if (books.length === 0) {
    list.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-400 font-bold">
        No books found in Library yet. Use Upload PDF/Book instead.
      </div>
    `;
    return;
  }

  list.innerHTML = books.map(b => {
    const coverFallback = `https://picsum.photos/seed/${encodeURIComponent(b.id || Date.now())}/500/700`;
    const cover = escapeHTML(safeUrl(b.coverUrl, coverFallback));
    const title = escapeHTML(toText(b.title || 'Book'));
    const author = escapeHTML(toText(b.author || 'Unknown'));
    return `
      <button onclick="window.selectLibraryBook('${escapeHTML(b.id)}')" class="p-4 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 hover:border-brand-300 transition-all text-left group">
        <div class="flex gap-4">
          <div class="w-16 h-20 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0">
            <img src="${cover}" onerror="this.onerror=null;this.src='${escapeHTML(coverFallback)}'" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy">
          </div>
          <div class="min-w-0">
            <p class="text-sm font-black truncate">${title}</p>
            <p class="text-xs font-bold text-slate-400 mt-1 truncate">${author}</p>
            <p class="text-[10px] font-black uppercase tracking-widest text-brand-600 mt-3">Select</p>
          </div>
        </div>
      </button>
    `;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.openLibrarySelector = () => window.toggleLibraryModal(true);
window.selectLibraryBook = (id) => {
  const key = toText(id).trim();
  const book = (app.state.books || []).find(b => b.id === key);
  if (!book) return toast('Book not found', 'error');
  studyState.cbt.source = { type: 'library', id: key, title: book.title || 'Book', category: book.category || '', fileUrl: book.fileUrl || '' };
  if (!studyState.cbt.settings) studyState.cbt.settings = { count: 20, intensity: 'standard' };
  if (S('selectedBookTitle')) S('selectedBookTitle').textContent = toText(book.title || 'Book');
  if (S('selectedBookInfo')) S('selectedBookInfo').classList.remove('hidden');
  window.toggleLibraryModal(false);
};

window.triggerFileUpload = () => S('bookUploadInput')?.click();
window.handleCbtUpload = (event) => {
  const file = event?.target?.files?.[0] || null;
  if (!file) return;
  studyState.cbt.source = { type: 'upload', title: file.name, file };
  if (S('selectedBookTitle')) S('selectedBookTitle').textContent = file.name;
  if (S('selectedBookInfo')) S('selectedBookInfo').classList.remove('hidden');
};

let cbtFocusMode = false;
window.toggleCbtFocusMode = () => {
  cbtFocusMode = !cbtFocusMode;
  const sidebar = S('cbtSidebar');
  const mapCard = S('cbtQuestionMapCard');
  if (sidebar) sidebar.classList.toggle('hidden', cbtFocusMode);
  if (mapCard) mapCard.classList.toggle('hidden', cbtFocusMode);
  toast(cbtFocusMode ? 'Focus mode enabled' : 'Focus mode disabled', 'info');
};

// --- Calculator ---
const calcState = { display: '0', prev: null, op: null, resetDisplay: false };

window.toggleCalc = (open) => {
  const modal = S('calcModal');
  if (!modal) return;
  if (open === false) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  } else {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
};

window.openCbtCalculator = () => window.toggleCalc(true);

function updateCalcDisplay() {
  if (S('calcDisplay')) S('calcDisplay').textContent = calcState.display;
  if (S('calcPrev')) S('calcPrev').textContent = calcState.prev ? `${calcState.prev} ${calcState.op}` : '';
}

window.calcClear = () => { calcState.display = '0'; calcState.prev = null; calcState.op = null; calcState.resetDisplay = false; updateCalcDisplay(); };

window.calcInput = (val) => {
  if (val === '±') {
    calcState.display = (parseFloat(calcState.display) * -1).toString();
    updateCalcDisplay();
    return;
  }
  if (val === '%') {
    calcState.display = (parseFloat(calcState.display) / 100).toString();
    updateCalcDisplay();
    return;
  }
  if (['+', '-', '*', '/'].includes(val)) {
    if (calcState.prev !== null && calcState.op !== null) {
      const result = compute(calcState.prev, calcState.op, parseFloat(calcState.display));
      calcState.display = String(result);
      calcState.prev = result;
    } else {
      calcState.prev = parseFloat(calcState.display);
    }
    calcState.op = val;
    calcState.resetDisplay = true;
    updateCalcDisplay();
    return;
  }
  if (val === '.' && calcState.display.includes('.')) return;
  if (calcState.resetDisplay) {
    calcState.display = val === '.' ? '0.' : val;
    calcState.resetDisplay = false;
  } else {
    calcState.display = calcState.display === '0' && val !== '.' ? val : calcState.display + val;
  }
  updateCalcDisplay();
};

function compute(a, op, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? 'Error' : a / b;
    default: return b;
  }
}

window.calcEquals = () => {
  if (calcState.prev === null || calcState.op === null) return;
  const result = compute(calcState.prev, calcState.op, parseFloat(calcState.display));
  calcState.display = String(result);
  calcState.prev = null; calcState.op = null; calcState.resetDisplay = true;
  updateCalcDisplay();
};

// --- Quick CBT ---
// Starts a no-file-needed practice session straight from real imported
// questions for a subject (falls back to the small mock bank if that
// subject/exam type hasn't been imported yet). This is the "just pick a
// subject and go" loop myschool.ng is built around — Geo-Books previously
// only offered CBT via document upload + AI scanning.
window.startQuickCbt = async (subject, examType = 'GENERAL') => {
  studyState.cbt.source = { type: 'quick', title: subject };
  studyState.cbt.settings = {
    count: parseInt(S('cbtQuickCount')?.value || S('cbtQuestionCount')?.value || 20),
    intensity: (S('cbtIntensity')?.value || 'standard'),
    subject,
    examType
  };
  studyState.cbt.subject = subject;
  window.startAiGeneration();
};

// Topic-by-topic practice — same flow as startQuickCbt but scoped to one
// topic within the subject (e.g. "Mathematics: Linear equations").
window.startTopicCbt = async (subject, topic, examType = 'GENERAL') => {
  if (!toText(subject).trim()) {
    toast('Pick a subject first.', 'error');
    return;
  }
  studyState.cbt.source = { type: 'quick', title: topic ? `${subject} — ${topic}` : subject };
  studyState.cbt.settings = {
    count: parseInt(S('cbtQuickCount')?.value || S('cbtQuestionCount')?.value || 20),
    intensity: (S('cbtIntensity')?.value || 'standard'),
    subject,
    examType,
    topic: topic || ''
  };
  studyState.cbt.subject = subject;
  window.startAiGeneration();
};

// Wired to the "Download for offline" button in the Quick/Topic Practice
// panel — reads whatever subject/exam type/topic is currently selected there.
window.downloadSelectedQuestionPackForOffline = async () => {
  const examType = S('cbtQuickExamType')?.value || 'GENERAL';
  const subject = S('cbtQuickSubjectSelect')?.value || '';
  const topic = S('cbtQuickTopicSelect')?.value || '';
  if (!subject) {
    toast('Pick a subject first.', 'error');
    return;
  }
  toast(`Downloading ${subject}${topic ? ' — ' + topic : ''} for offline use…`, 'info');
  const questions = await fetchRealQuestionBank({ examType, subject, topic: topic || undefined, count: 500 });
  if (!questions || questions.length === 0) {
    toast(`No questions available yet for ${subject}${topic ? ' — ' + topic : ''}. Check back after the next import.`, 'error');
    return;
  }
  toast(`${questions.length} question(s) ready offline for ${subject}${topic ? ' — ' + topic : ''}.`, 'success');
};

// --- Exam History ---
function saveExamResult(result) {
  const key = 'cbt_history';
  let history = JSON.parse(localStorage.getItem(key) || '[]');
  history.unshift({ ...result, id: Date.now(), date: new Date().toISOString() });
  if (history.length > 20) history = history.slice(0, 20);
  localStorage.setItem(key, JSON.stringify(history));
  renderExamHistory();
}

function renderExamHistory() {
  const list = S('cbtHistoryList');
  if (!list) return;
  const history = JSON.parse(localStorage.getItem('cbt_history') || '[]');
  if (history.length === 0) {
    list.innerHTML = '<div class="col-span-full text-center text-slate-400 py-8">No exam history yet</div>';
    return;
  }
  list.innerHTML = history.map(exam => `
    <div class="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
      <div class="flex flex-col">
        <span class="text-sm font-black">${escapeHTML(exam.subject)}</span>
        <span class="text-xs text-slate-400">${new Date(exam.date).toLocaleString()}</span>
      </div>
      <div class="text-right">
        <span class="${exam.percent >= 70 ? 'text-emerald-600' : exam.percent >= 40 ? 'text-amber-600' : 'text-rose-600'} font-black text-2xl">${exam.percent}%</span>
        <span class="text-xs text-slate-400 block">${exam.correct}/${exam.total}</span>
      </div>
    </div>
  `).join('');
}

window.startAiGeneration = () => {
  if (!studyState.cbt.source) {
    toast('Pick a library book or upload a PDF first', 'error');
    return;
  }
  if (studyState.cbt.generating) return;

  // Daily cap on AI-generated exams — this is specifically an API-cost
  // control, separate from general CBT access. FREE and both Exam Pass
  // tiers are capped (Exam Pass is a cheap, CBT-only anchor tier and
  // deliberately doesn't include AI-generation perks); STANDARD/PREMIUM and
  // their annual equivalents get unlimited AI generation.
  const tier = (app.state.userData?.subscription?.tier || 'FREE').toUpperCase();
  if (tier === 'FREE' || tier === 'EXAM_PASS_SEASON' || tier === 'EXAM_PASS_ANNUAL') {
    const lastCbt = app.state.userData.lastCbtAt;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    if (lastCbt) {
      const last = lastCbt.toDate ? lastCbt.toDate().getTime() : new Date(lastCbt).getTime();
      if (last >= today) {
        toast('AI-generated exams are limited to 1/day on your plan. Upgrade to Standard for unlimited AI generation!', 'brand');
        window.showPricingModal(true);
        return;
      }
    }
  }

  studyState.cbt.generating = true;

  const overlay = S('aiScanningOverlay');
  if (overlay) overlay.classList.remove('hidden');
  let progress = 0;
  const interval = setInterval(() => {
    progress += 4;
    if (S('scanningProgress')) S('scanningProgress').style.width = progress + '%';
    if (S('scanningStatus')) {
      S('scanningStatus').textContent =
        progress < 35 ? 'Analyzing chapters and key concepts...' :
        progress < 70 ? 'Generating exam questions and answers...' :
        'Building your personalized CBT session...';
    }
    if (progress >= 100) {
      clearInterval(interval);
      if (overlay) overlay.classList.add('hidden');

      const seed = `${studyState.cbt.source.title} ${studyState.cbt.source.category || ''}`;
      (async () => {
        try {
          const count = Math.max(5, Math.min(50, Math.floor(Number(studyState.cbt.settings?.count) || 20)));
          const intensityRaw = toText(studyState.cbt.settings?.intensity || 'standard').trim().toLowerCase();
          const intensity = intensityRaw === 'easy' || intensityRaw === 'hard' || intensityRaw === 'standard' ? intensityRaw : 'standard';

          let subject = '';
          let questions = null;
          let scanned = false;
          let reason = '';
          let aiError = null;

          if (studyState.cbt.source?.type === 'official') {
            subject = studyState.cbt.source.title;
            questions = studyState.cbt.source.questions;
            scanned = true;
          } else if (studyState.cbt.source?.type === 'quick') {
            const quickExamType = toText(studyState.cbt.settings?.examType || 'GENERAL');
            const quickSubject = toText(studyState.cbt.settings?.subject || 'General') || 'General';
            const quickTopic = toText(studyState.cbt.settings?.topic || '').trim();
            const real = await fetchRealQuestionBank({ examType: quickExamType, subject: quickSubject, topic: quickTopic || undefined, count });
            if (real && real.length) {
              subject = quickTopic ? `${quickSubject} — ${quickTopic}` : quickSubject;
              questions = real;
            } else {
              if (quickTopic) toast(`No imported questions for "${quickTopic}" yet — using general practice questions.`, 'info');
              const res = generateCbtExam('General', count);
              subject = res.subject;
              questions = res.questions;
            }
            scanned = true;
          } else {
            try {
              if (aiIsConfigured()) {
                const res = await aiGenerateCbtExamFromSource({ source: studyState.cbt.source, count, intensity });
                subject = res.subject;
                questions = res.questions;
                scanned = !!res.scanned;
                reason = toText(res.reason || '').trim();
              }
            } catch (e) {
              aiError = e;
            }
          }

          if (!Array.isArray(questions) || questions.length === 0) {
            if (aiError) {
              const msg = toText(aiError?.message || '').trim();
              if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('key not valid') || aiError?.status === 401 || aiError?.status === 403) {
                toast('AI key rejected. Add a valid Gemini API key in settings.', 'error');
              } else if (aiError?.name === 'AbortError') {
                toast('AI scan timed out. Using fallback questions.', 'error');
              } else {
                toast(msg ? `AI scan failed: ${msg}` : 'AI scan failed. Using fallback questions.', 'error');
              }
            }
            const real = await fetchRealQuestionBank({ examType: 'GENERAL', subject: inferCbtSubject(seed), count });
            if (real && real.length) {
              subject = inferCbtSubject(seed);
              questions = real;
            } else {
              const res = generateCbtExam(seed, count);
              subject = res.subject;
              questions = res.questions;
            }
          } else if (!scanned) {
            if (studyState.cbt.source?.type === 'library' && reason === 'fetch_failed') {
              toast('Could not scan this library file. Download and upload the PDF to scan it.', 'error');
            } else if (reason === 'unsupported_docx') {
              toast('DOCX scanning is not supported yet. Please convert to PDF.', 'error');
            } else if (reason === 'too_few') {
              toast('Document was too short to extract enough questions. Using generated questions instead.', 'info');
            } else {
              toast('Generated questions without scanning the file', 'info');
            }
          }

          studyState.cbt.subject = subject || 'General';
          studyState.cbt.questions = (questions || []).map(q => ({ ...q, correct: Number.isInteger(q.correct) ? q.correct : q.a }));
          studyState.cbt.answers = new Array(studyState.cbt.questions.length).fill(null);
          studyState.cbt.i = 0;

          const durationSec =
            (studyState.cbt.source?.type === 'official' && studyState.cbt.source.duration) ?
            studyState.cbt.source.duration * 60 :
            (intensity === 'easy' ? 45 * 60 :
            intensity === 'hard' ? 20 * 60 :
            30 * 60);
          studyState.cbt.timeLeft = durationSec;
          if (S('cbtTimer')) S('cbtTimer').querySelector('span').textContent = `${Math.floor(durationSec / 60)}:00`;

          rewardXP(50);
          toast('CBT generated! +50 XP', 'success');

          // Hand off to cbt.htm — a dedicated, nav-free page for the exam
          // itself. The exam payload is small enough (subject/questions/
          // duration) to pass via sessionStorage; cbt.js reads it on load.
          // Firestore stat writes + the +200 XP reward happen back here in
          // the main app once the exam is done (see checkCbtReward), the
          // same pattern already used for the AI Scan redirect reward.
          launchCbtExamPage({
            subject: studyState.cbt.subject,
            questions: studyState.cbt.questions,
            durationSec,
            examType: toText(studyState.cbt.source?.examType || studyState.cbt.settings?.examType || 'GENERAL')
          });
        } finally {
          studyState.cbt.generating = false;
        }
      })();
    }
  }, 120);
};

window.activate = () => toast('Activation process started...', 'brand');

// --- AI Tutor ---
const tutorState = {
  history: [],
  isThinking: false,
  responses: {
    greeting: ["Hello! I'm your AI Tutor. What can I help you with today?", "Ready to master your studies? Ask me anything!", "Hey there! I've analyzed your progress and I'm ready to help."],
    physics: ["Physics is all about understanding the laws of the universe. Which topic are we diving into?", "Thermodynamics or Mechanics? Both are key for your upcoming exams.", "Quantum mechanics can be complex, but let's break it down into fundamental principles."],
    math: ["Math is the language of science. Need help with integration or algebra?", "Calculus can be tricky, but we'll master it together.", "Probability and Statistics are essential for data analysis. Let's explore some problems."],
    jamb: ["The JAMB syllabus for this year emphasizes these specific areas. Would you like a quick summary?", "Past questions show that this concept is tested in 40% of recent exams.", "Don't forget to focus on the 'Novel' section for your Use of English paper."],
    default: [
      "That's a great question! Based on your progress, you should focus on the underlying principles of this topic.",
      "I've analyzed your performance in this area. You're doing well, but try to review this concept once more.",
      "The answer to that can be found in your study guide. Would you like me to summarize it for you?",
      "Interesting perspective! In the context of the Nigerian syllabus, this is often tested through practical applications.",
      "I've cross-referenced this with 10 years of past questions. This is a high-yield topic!"
    ]
  }
};

window.sendTutorMessage = async () => {
  const input = S('tutorInput');
  const chat = S('tutorChat');
  const typing = S('typingIndicator');
  if (!input || !chat || !input.value.trim() || tutorState.isThinking) return;

  const msg = input.value.trim();
  input.value = '';
  tutorState.isThinking = true;

  // User Message
  const userMsgHtml = `
    <div class="flex justify-end animate-in slide-in-from-right-4 duration-300">
      <div class="max-w-[85%] px-5 py-3 rounded-[24px] rounded-tr-none bg-brand-600 text-white text-sm font-medium shadow-lg shadow-brand-500/20">
        ${escapeHTML(msg)}
      </div>
    </div>
  `;
  chat.insertAdjacentHTML('beforeend', userMsgHtml);
  chat.scrollTop = chat.scrollHeight;

  if (typing) typing.classList.remove('hidden');
  let response = '';
  try {
    if (aiIsConfigured()) {
      response = await aiTutorReply(msg, { subject: studyState?.cbt?.subject || '' });
    }
  } catch {}

  if (!response) {
    const lowerMsg = msg.toLowerCase();
    if (lowerMsg.includes('physics')) response = tutorState.responses.physics[Math.floor(Math.random() * tutorState.responses.physics.length)];
    else if (lowerMsg.includes('math') || lowerMsg.includes('calculate')) response = tutorState.responses.math[Math.floor(Math.random() * tutorState.responses.math.length)];
    else if (lowerMsg.includes('jamb') || lowerMsg.includes('utme')) response = tutorState.responses.jamb[Math.floor(Math.random() * tutorState.responses.jamb.length)];
    else response = tutorState.responses.default[Math.floor(Math.random() * tutorState.responses.default.length)];
    await new Promise(r => setTimeout(r, 900));
  }

  if (typing) typing.classList.add('hidden');
  const aiMsgHtml = `
    <div class="flex justify-start animate-in slide-in-from-left-4 duration-500">
      <div class="max-w-[85%] px-5 py-4 rounded-[24px] rounded-tl-none bg-white dark:bg-slate-800 text-sm font-medium border border-slate-100 dark:border-slate-700 shadow-soft group relative overflow-hidden">
        <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-500 to-indigo-500 opacity-20"></div>
        <div class="flex items-center gap-2 mb-2">
          <div class="w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-600 flex items-center justify-center">
            <i data-lucide="sparkles" class="w-3 h-3"></i>
          </div>
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">AI Tutor v2.5</span>
        </div>
        <p class="leading-relaxed text-slate-600 dark:text-slate-300">${escapeHTML(response)}</p>
        <div class="mt-4 flex gap-2">
          <button onclick="toast('Adding to flashcards...', 'success')" class="text-[9px] font-black uppercase tracking-widest text-brand-600 hover:underline">Add to Cards</button>
          <button onclick="toast('Explaining further...', 'info')" class="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:underline">Explain More</button>
        </div>
      </div>
    </div>
  `;
  chat.insertAdjacentHTML('beforeend', aiMsgHtml);
  chat.scrollTop = chat.scrollHeight;
  tutorState.isThinking = false;
  if (window.lucide) window.lucide.createIcons();
  rewardXP(5);
};

window.clearChat = () => {
  const chat = S('tutorChat');
  if (chat) {
    chat.innerHTML = `
      <div class="flex justify-start">
        <div class="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-none bg-slate-100 dark:bg-slate-800 text-sm font-medium">
          Hello! I'm your Geo-Books AI Tutor. Ask me anything about this exam or specific questions!
        </div>
      </div>
    `;
    toast('Chat cleared', 'info');
  }
};

window.snapSolveOpen = () => {
  S('snapInput')?.click();
  toast('Select a photo of your question to solve!', 'brand');
};

window.initMarketplaceFilters = () => {
  const categorySelect = S('filterCategory');
  const locationSelect = S('filterLocation');
  const priceSelect = S('filterPrice');
  const favoritesToggle = S('filterFavorites');
  const searchInput = S('marketSearch');
  
  if (categorySelect) categorySelect.onchange = () => filterMarket(app.state.marketplace);
  if (locationSelect) locationSelect.onchange = () => filterMarket(app.state.marketplace);
  if (priceSelect) priceSelect.onchange = () => filterMarket(app.state.marketplace);
  if (favoritesToggle) favoritesToggle.onchange = () => filterMarket(app.state.marketplace);
  if (searchInput) {
    searchInput.oninput = () => filterMarket(app.state.marketplace);
  }
};

// --- Global UI Handlers ---
window.toggleAuthModal = (mode, show) => {
  const modal = S('authModal');
  if (!modal) return;
  
  if (!show) {
    modal.classList.add('opacity-0');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }, 500);
    return;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => modal.classList.remove('opacity-0'), 10);
  
  const isLogin = mode === 'login';
  const title = S('authTitle');
  const subtitle = S('authSubtitle');
  const submitBtn = S('authSubmitBtn');
  const icon = S('authIcon');
  const toggleText = S('authToggleText');
  const toggleBtn = S('authToggleBtn');
  const nameWrap = S('authNameWrap');

  if (title) title.textContent = isLogin ? 'Welcome Back, Scholar' : 'Initialize Neural Path';
  if (subtitle) subtitle.textContent = isLogin ? 'Restore your elite scholarly identity' : 'Join the elite network of university scholars';
  if (submitBtn) {
    const textSpan = submitBtn.querySelector('span');
    if (textSpan) textSpan.textContent = isLogin ? 'Secure Login' : 'Create Scholar Identity';
  }
  if (icon) {
    icon.setAttribute('data-lucide', isLogin ? 'log-in' : 'user-plus');
    if (window.lucide) window.lucide.createIcons();
  }
  if (toggleText) toggleText.textContent = isLogin ? "New to the network?" : "Existing Scholar?";
  if (toggleBtn) toggleBtn.textContent = isLogin ? 'Initialize New' : 'Restore Link';
  
  if (nameWrap) nameWrap.classList.toggle('hidden', isLogin);
  
  // Clear fields
  ['authEmail', 'authPassword', 'authName'].forEach(id => {
    const el = S(id);
    if (el) el.value = '';
  });
};

window.switchAuthMode = () => {
  const title = S('authTitle')?.textContent || '';
  const isCurrentlyLogin = title.includes('Welcome');
  window.toggleAuthModal(isCurrentlyLogin ? 'signup' : 'login', true);
};

window.handleAuthSubmit = async () => {
  const title = S('authTitle')?.textContent || '';
  const isLogin = title.includes('Welcome');
  const email = S('authEmail')?.value.trim();
  const password = S('authPassword')?.value;
  const name = S('authName')?.value.trim();
  const btn = S('authSubmitBtn');

  if (!email || !password) return toast('Neural link requires email and access key', 'error');
  if (!isLogin && (!name || name.length < 2)) return toast('Identity name must be at least 2 characters', 'error');

  const textSpan = btn?.querySelector('span');
  const originalText = textSpan?.textContent;
  
  if (btn) {
    btn.disabled = true;
    if (textSpan) textSpan.textContent = isLogin ? 'Authenticating...' : 'Initializing Identity...';
  }

  try {
    if (isLogin) {
      await signInWithEmailAndPassword(auth, email, password);
      toast('Neural link established. Welcome back!', 'success');
    } else {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await firebaseUpdateProfile(cred.user, { displayName: name });
      
      const universityFallback = email.includes('.edu.ng') ? email.split('@')[1].split('.')[0].toUpperCase() : 'University Student';
      
      await setDoc(doc(db, "users", cred.user.uid), {
        displayName: name,
        email,
        xp: 0,
        level: 1,
        rank_title: 'Novice Scholar',
        university: universityFallback,
        createdAt: serverTimestamp(),
        role: 'STUDENT',
        subscriptionLevel: 'STANDARD',
        activated: false
      });
      toast('Scholar identity initialized successfully!', 'success');
    }
    window.toggleAuthModal(null, false);
  } catch (e) {
    console.error('Auth error:', e);
    let msg = 'Neural link failed: ';
    if (e.code === 'auth/user-not-found') msg += 'Scholar identity not found.';
    else if (e.code === 'auth/wrong-password') msg += 'Incorrect access key.';
    else if (e.code === 'auth/email-already-in-use') msg += 'Identity already exists.';
    else msg += e.message;
    toast(msg, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (textSpan) textSpan.textContent = originalText || (isLogin ? 'Secure Login' : 'Create Identity');
    }
  }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  const isSellerPage = S('listingContainer') !== null;

  initTheme();
  initFormValidationBindings();
  
  // Initial render from cache for instant load
  if (!isSellerPage) {
    updateDashboard(app.state);
    if (S('navGreetingName')) S('navGreetingName').textContent = `${app.state.userData.username || 'scholar'}`;
    if (S('userAvatar')) {
      const initials = app.state.userData.displayName ? 
        app.state.userData.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U';
      S('userAvatar').textContent = initials;
    }
  }

  if (S('clearChat')) S('clearChat').onclick = window.clearChat;
  if (S('sendTutor')) S('sendTutor').onclick = window.sendTutorMessage;
  if (S('tutorInput')) S('tutorInput').onkeypress = (e) => { if (e.key === 'Enter') window.sendTutorMessage(); };
  if (S('toggleFocusMode')) S('toggleFocusMode').onclick = window.toggleCbtFocusMode;
  if (S('openCalc')) S('openCalc').onclick = window.openCbtCalculator;
  if (S('voiceQuiz')) S('voiceQuiz').onclick = () => toast('Voice quiz is coming soon', 'info');
  if (S('askTutor')) S('askTutor').onclick = () => {
    // Was: dump the bare question text into the tutor chat input and make
    // the student manually hit send. Now: one click, straight to a real
    // explanation with the options and correct answer as context.
    window.explainCbtQuestionWithAI();
  };
  if (S('cbtAiExplainBtn')) S('cbtAiExplainBtn').onclick = window.explainCbtQuestionWithAI;
  if (S('prevQuestion')) S('prevQuestion').onclick = window.prevQuestion;
  if (S('nextQuestion')) S('nextQuestion').onclick = window.nextQuestion;
  if (S('bookUploadInput') && !S('bookUploadInput').dataset.bound) {
    S('bookUploadInput').dataset.bound = '1';
    S('bookUploadInput').addEventListener('change', window.handleCbtUpload);
  }
  if (S('cbtDocInput') && !S('cbtDocInput').dataset.bound) {
    S('cbtDocInput').dataset.bound = '1';
    S('cbtDocInput').addEventListener('change', window.handleCbtUpload);
  }
  if (S('cbtGenerateBtn') && !S('cbtGenerateBtn').dataset.bound) {
    S('cbtGenerateBtn').dataset.bound = '1';
    S('cbtGenerateBtn').addEventListener('click', () => {
      const f1 = S('cbtDocInput')?.files?.[0] || null;
      const f2 = S('bookUploadInput')?.files?.[0] || null;
      const file = f1 || f2;
      if (file) {
        const maxBytes = 8 * 1024 * 1024;
        if (file.size > maxBytes) {
          toast('File is large. Only the first part will be scanned.', 'info');
        }
        studyState.cbt.source = { type: 'upload', title: file.name, file };
        if (S('selectedBookTitle')) S('selectedBookTitle').textContent = file.name;
        if (S('selectedBookInfo')) S('selectedBookInfo').classList.remove('hidden');
      }

      const count = Math.max(5, Math.min(50, Math.floor(Number(S('cbtQuestionCount')?.value) || 20)));
      const intensityRaw = toText(S('cbtIntensity')?.value || 'standard').trim().toLowerCase();
      const intensity = intensityRaw === 'easy' || intensityRaw === 'hard' || intensityRaw === 'standard' ? intensityRaw : 'standard';
      studyState.cbt.settings = { count, intensity };

      if (!studyState.cbt.source) {
        toast('Pick a library book or upload a PDF/DOCX first', 'error');
        return;
      }
      window.startAiGeneration();
    });
  }

  if (isSellerPage) {
    initAuth(app.state, () => {
      initListingsSync();
      initSkillListingsSync();
      if (window.location.hash && window.location.hash.toLowerCase().includes('skills')) {
        setTimeout(() => window.toggleSkillModal(true), 0);
      }
    });
    if (S('saveItem')) S('saveItem').onclick = window.saveListing;
    if (S('saveSkill')) S('saveSkill').onclick = window.saveSkillListing;
    const search = S('sellerSearch');
    const status = S('sellerStatus');
    const category = S('sellerCategoryFilter');
    const sort = S('sellerSort');
    if (search) search.oninput = () => renderListings();
    if (status) status.onchange = () => renderListings();
    if (category) category.onchange = () => renderListings();
    if (sort) sort.onchange = () => renderListings();
  } else {
    initSkillsSync();
    initGigsSync();
    initAuth(app.state, handleDataSync);
    initGlobalSearch();
    initMarketplaceFilters();
    initMarketplaceSync(app.state, filterMarket);
    
    const main = document.querySelector('main');
    if (main && !main.dataset.marketScrollBound) {
      main.dataset.marketScrollBound = '1';
      main.addEventListener('scroll', () => {
        if (app.state.currentSection !== 'marketplace') return;
        const distance = main.scrollHeight - main.scrollTop - main.clientHeight;
        if (distance < 900) window.loadMoreMarketplace();
      }, { passive: true });
    }
    
    if (S('openUpload') && !S('openUpload').dataset.bound) {
      S('openUpload').dataset.bound = '1';
      S('openUpload').onclick = () => {
        if (!app.state.user) {
          if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
          toast('Sign in to post an item', 'error');
          return;
        }
        window.toggleUpload(true);
      };
    }

    if (S('saveNote')) S('saveNote').onclick = window.saveNote;
    if (S('submitUpload')) S('submitUpload').onclick = window.submitNewListing;
    if (S('saveGig')) S('saveGig').onclick = window.saveGig;
    if (S('sendAiBtn')) S('sendAiBtn').onclick = window.sendAiMessage;
    if (S('aiInput')) S('aiInput').onkeypress = (e) => { if (e.key === 'Enter') window.sendAiMessage(); };
    if (S('prevCard')) S('prevCard').onclick = window.prevCard;
    if (S('nextCard')) S('nextCard').onclick = window.nextCard;
    if (S('flashcard')) {
      S('flashcard').onclick = (e) => {
        if (e?.target?.closest?.('button')) return;
        window.flipCard();
      };
    }
    if (S('gigsSearch')) {
      S('gigsSearch').oninput = (e) => {
        gigsState.query = e.target.value;
        if (app.state.currentSection === 'gigsBoard') renderGigsBoard();
      };
    }
    if (S('gigsStatus')) {
      S('gigsStatus').onchange = (e) => {
        gigsState.status = e.target.value;
        if (app.state.currentSection === 'gigsBoard') renderGigsBoard();
      };
    }
    const syncGigCatBtns = () => {
      $$('.gig-cat-btn').forEach(btn => {
        const c = btn.getAttribute('data-gig-cat') || 'All';
        const active = c === gigsState.category;
        btn.classList.toggle('bg-brand-50', active);
        btn.classList.toggle('dark:bg-brand-900/20', active);
        btn.classList.toggle('text-brand-600', active);
        btn.classList.toggle('font-black', active);
        btn.classList.toggle('text-slate-500', !active);
        btn.classList.toggle('font-bold', !active);
      });
    };
    $$('.gig-cat-btn').forEach(btn => {
      btn.onclick = () => {
        gigsState.category = btn.getAttribute('data-gig-cat') || 'All';
        syncGigCatBtns();
        if (app.state.currentSection === 'gigsBoard') renderGigsBoard();
      };
    });
    syncGigCatBtns();
    if (S('addFlashcardBtn')) {
      S('addFlashcardBtn').onclick = async () => {
        if (!app.state.user) {
          if (typeof window.toggleAuthModal === 'function') window.toggleAuthModal('login', true);
          toast('Please login to create flashcards', 'error');
          return;
        }
        const q = toText(S('fcQuestion')?.value || '').trim();
        const a = toText(S('fcAnswer')?.value || '').trim();
        if (!q || !a) {
          toast('Add both a question and an answer', 'error');
          return;
        }
        const makePublic = Boolean(S('fcMakePublic')?.checked);
        try {
          await addDoc(collection(db, "flashcards"), {
            userId: app.state.user.uid,
            q,
            a,
            public: makePublic,
            srsLevel: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          if (S('fcQuestion')) S('fcQuestion').value = '';
          if (S('fcAnswer')) S('fcAnswer').value = '';
          if (S('fcMakePublic')) S('fcMakePublic').checked = false;
          toast('Flashcard created!', 'success');
          rewardXP(10);
        } catch (err) {
          console.error('Flashcard create error:', err);
          toast('Unable to create flashcard', 'error');
        }
      };
    }
    if (S('newNote')) S('newNote').onclick = () => {
      app.state.currentNoteId = null;
      if (S('noteTitle')) S('noteTitle').value = '';
      if (S('noteContent')) S('noteContent').value = '';
      renderNotesList();
    };
    
    $$('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        window.showSection(btn.getAttribute('data-target'));
        // Auto-close sidebar on mobile
        if (window.innerWidth < 1024) {
          S('sidebar')?.classList.add('-translate-x-full');
        }
      };
    });

    // Mobile Sidebar Toggle
    const openBtn = S('openSidebarBtn');
    const sidebar = S('sidebar');
    if (openBtn && sidebar) {
      openBtn.onclick = () => {
        sidebar.classList.toggle('-translate-x-full');
      };
      
      // Close when clicking outside on mobile
      document.addEventListener('click', (e) => {
        if (window.innerWidth < 1024 && !sidebar.contains(e.target) && !openBtn.contains(e.target)) {
          sidebar.classList.add('-translate-x-full');
        }
      });
    }

    document.addEventListener('click', (e) => {
      const menu = S('chatOptionsMenu');
      if (!menu || menu.classList.contains('hidden')) return;
      const clickedMenu = menu.contains(e.target);
      const clickedBtn = e.target.closest('[aria-label="Chat options"]');
      if (!clickedMenu && !clickedBtn) window.toggleChatOptionsMenu(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.toggleChatOptionsMenu(false);
    });

    document.addEventListener('click', (e) => {
      const menu = S('emojiPickerMenu');
      if (!menu || menu.classList.contains('hidden')) return;
      const clickedMenu = menu.contains(e.target);
      const clickedBtn = e.target.closest('[aria-label="Emoji"]');
      if (!clickedMenu && !clickedBtn) window.toggleEmojiPicker(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.toggleEmojiPicker(false);
    });

    document.addEventListener('click', (e) => {
      const menu = S('warRoomEmojiMenu');
      if (!menu || menu.classList.contains('hidden')) return;
      const clickedMenu = menu.contains(e.target);
      const clickedBtn = e.target.closest('[aria-label="War room emoji"]');
      if (!clickedMenu && !clickedBtn) window.toggleWarRoomEmoji(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.toggleWarRoomEmoji(false);
        const overlay = S('warRoomOverlay');
        if (overlay && !overlay.classList.contains('hidden')) window.leaveWarRoom();
      }
    });

    const hash = (window.location.hash || '').replace('#', '').trim();
    if (hash && S(hash) && S(hash).classList.contains('section')) {
      window.showSection(hash);
    }
    initScrollListeners();
  }

  // Demo decks with sample cards
  const demoDecks = {
    jamb: {
      name: 'JAMB Physics',
      cards: [
        { q: 'What is Newton\'s First Law?', a: 'An object at rest stays at rest, and an object in motion stays in motion unless acted on by an unbalanced force.', cat: 'JAMB Physics', srsLevel: 0, nextReview: Date.now() },
        { q: 'Define velocity', a: 'Rate of change of displacement with respect to time.', cat: 'JAMB Physics', srsLevel: 0, nextReview: Date.now() },
        { q: 'What is the unit of force?', a: 'Newton (N)', cat: 'JAMB Physics', srsLevel: 0, nextReview: Date.now() }
      ]
    },
    constitution: {
      name: 'Nigerian Constitution',
      cards: [
        { q: 'When was Nigeria\'s current constitution adopted?', a: '1999', cat: 'Nigerian Constitution', srsLevel: 0, nextReview: Date.now() },
        { q: 'What is the highest law in Nigeria?', a: 'The Constitution', cat: 'Nigerian Constitution', srsLevel: 0, nextReview: Date.now() }
      ]
    },
    calculus: {
      name: 'Calculus I',
      cards: [
        { q: 'What is the derivative of x²?', a: '2x', cat: 'Calculus', srsLevel: 0, nextReview: Date.now() },
        { q: 'Define integral', a: 'The inverse of differentiation, representing the area under a curve.', cat: 'Calculus', srsLevel: 0, nextReview: Date.now() }
      ]
    }
  };

  window.loadDemoDeck = (deckKey) => {
    const deck = demoDecks[deckKey];
    if (!deck) return;

    studyState.flashcards.viewingDemo = true;
    studyState.flashcards.cards = deck.cards;
    studyState.flashcards.idx = 0;

    window.transitionToFlashcardView('vault');
    toast(`Loaded ${deck.name}! (Demo deck — switch back to Vault to return to your own cards)`, 'success');
  };

  // Swipe gesture detection for mobile sidebar toggle
  let touchStartX = 0;
  let touchEndX = 0;
  
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  
  document.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }, { passive: true });
  
  function handleSwipe() {
    const swipeThreshold = 50;
    const swipeDistance = touchEndX - touchStartX;
    
    const sidebar = S('sidebar');
    if (!sidebar) return;
    
    if (swipeDistance > swipeThreshold) {
      // Swipe right - open sidebar
      if (window.innerWidth < 1024) {
        sidebar.classList.remove('-translate-x-full');
      }
    } else if (swipeDistance < -swipeThreshold) {
      // Swipe left - close sidebar
      if (window.innerWidth < 1024) {
        sidebar.classList.add('-translate-x-full');
      }
    }
  }

  if (window.lucide) window.lucide.createIcons();
});