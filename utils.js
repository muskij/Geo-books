/**
 * Geo-Books Shared Utilities
 */

// --- DOM Utilities ---
export const $ = (q, ctx = document) => ctx.querySelector(q);
export const $$ = (q, ctx = document) => Array.from(ctx.querySelectorAll(q));
export const S = (id) => document.getElementById(id);

// --- Type & Conversion Utilities ---
export const toText = (value) => (value === null || value === undefined ? '' : String(value));

export const toMillis = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  if (typeof t === 'string') {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
};

// --- Security & Validation Utilities ---
export const escapeHTML = (value) =>
  toText(value).replace(/[&<>"'`]/g, (ch) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '`': '&#96;'
    };
    return map[ch] || ch;
  });

export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toText(value).trim());

export const isValidHttpUrl = (value) => {
  const raw = toText(value).trim();
  if (!raw) return false;
  try {
    const u = new URL(raw, window.location.href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

// --- Storage Utilities ---
export const store = {
  get(k, v = null) {
    try {
      const x = localStorage.getItem(k);
      return x ? JSON.parse(x) : v;
    } catch (e) {
      console.error(`Error reading key "${k}" from localStorage:`, e);
      return v;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      console.error(`Error writing key "${k}" to localStorage:`, e);
    }
  }
};

export const readJson = store.get;
export const writeJson = store.set;

// --- Formatting Utilities ---
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0
  }).format(amount);
};

export const normalizeUsername = (value, fallback = 'scholar') => {
  const raw = toText(value).trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
};

// --- Premium / AI Access Gate ---
// Single source of truth for "is this user allowed to use paid AI features".
// Exists because the codebase currently has TWO independent, inconsistent
// tier fields in the wild:
//   - userData.subscriptionLevel === 'ELITE_100K'  (used by the isElite /
//     data-premium-only tab check)
//   - userData.subscription.tier === 'PREMIUM' | 'ELITE' (used by
//     window.openAIScanVault()'s ad-hoc check)
// Rather than picking one and silently breaking whichever users are
// currently tagged with the other shape, this checks both. New code should
// standardize on whichever one Firestore actually writes going forward, but
// until that migration happens this keeps both existing populations working.
export function hasAiAccess(userDataOrClaims) {
  const u = userDataOrClaims && typeof userDataOrClaims === 'object' ? userDataOrClaims : {};
  const legacyLevel = toText(u.subscriptionLevel).trim().toUpperCase();
  const tier = toText(u.subscription?.tier).trim().toUpperCase();
  return legacyLevel === 'ELITE_100K' || tier === 'PREMIUM' || tier === 'ELITE';
}

// Deliberately broader than hasAiAccess() above — that one gates the
// humanizer/support-chat/tutor features to Premium+Elite only. AI CBT
// exam generation (AIScanVault.htm, ExamVault.htm, generateQuizFromNeuralCore)
// is meant to be available on ANY paid plan, so this checks the full set
// of real purchasable tiers rather than just the top two.
const PAID_TIERS = [
  'STANDARD', 'STANDARD_ANNUAL', 'PREMIUM', 'PREMIUM_ANNUAL', 'ELITE',
  'EXAM_PASS_SEASON', 'EXAM_PASS_ANNUAL', 'UNIVERSITY_PASS_30', 'UNIVERSITY_PASS_70'
];
export function hasAnyPaidPlan(userDataOrClaims) {
  const u = userDataOrClaims && typeof userDataOrClaims === 'object' ? userDataOrClaims : {};
  const legacyLevel = toText(u.subscriptionLevel).trim().toUpperCase();
  const tier = toText(u.subscription?.tier).trim().toUpperCase();
  return legacyLevel === 'ELITE_100K' || PAID_TIERS.includes(tier);
}

// --- App Specific Utilities ---
export const RANK_TIERS = [
  { rank: 1, title: 'Scholar', minXp: 0, reward: 'Starter Badge' },
  { rank: 2, title: 'Expert', minXp: 1000, reward: 'Custom Profile Colors' },
  { rank: 3, title: 'Pro', minXp: 3500, reward: 'Verified Checkmark' },
  { rank: 4, title: 'Master', minXp: 8500, reward: '10% Marketplace Discount' },
  { rank: 5, title: 'Elite', minXp: 18000, reward: 'Early Access to New Features' },
  { rank: 6, title: 'Legend', minXp: 40000, reward: 'Monthly Data Bundle / Leaderboard' }
];

export function calculateRank(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  let current = RANK_TIERS[0];
  for (const tier of RANK_TIERS) {
    if (safeXp >= tier.minXp) current = tier;
  }
  const currentIndex = RANK_TIERS.findIndex(t => t.rank === current.rank);
  const next = currentIndex >= 0 ? RANK_TIERS[currentIndex + 1] : null;

  const currentThreshold = current.minXp;
  const nextThreshold = next ? next.minXp : null;
  const progressPct = nextThreshold === null ? 100 : Math.max(0, Math.min(100, ((safeXp - currentThreshold) / Math.max(1, nextThreshold - currentThreshold)) * 100));
  const xpToNext = nextThreshold === null ? 0 : Math.max(0, nextThreshold - safeXp);

  return {
    xp: safeXp,
    rank: current.rank,
    title: current.title,
    reward: current.reward,
    nextRank: next?.rank || null,
    nextTitle: next?.title || null,
    nextThreshold,
    currentThreshold,
    xpToNext,
    progressPct
  };
}

// --- Rank Perks ---
// Turns each RANK_TIERS reward into something the rest of the app can
// actually check and enforce, instead of just displaying the label.
// Everything here takes either a raw xp number or an object with an `xp`
// field (userData works directly), so callers don't need to pre-compute
// a rank first.
function rankOf(xpOrUserData) {
  const xp = typeof xpOrUserData === 'number' ? xpOrUserData : Number(xpOrUserData?.xp) || 0;
  return calculateRank(xp).rank;
}

// Rank 2 (Expert)+: can set a custom accent color on their profile.
export const PROFILE_COLOR_PRESETS = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];
export const canCustomizeProfileColor = (xpOrUserData) => rankOf(xpOrUserData) >= 2;
export const isValidProfileColor = (value) => /^#[0-9a-f]{6}$/i.test(toText(value).trim());

// Rank 3 (Pro)+: earned verified checkmark. Deliberately separate from
// subscription-tier verification (a paid perk) — this one is XP-earned and
// free, so it's checked independently wherever a name/avatar is rendered.
export const hasVerifiedRank = (xpOrUserData) => rankOf(xpOrUserData) >= 3;

// Rank 4 (Master)+: 10% off marketplace purchases (as a buyer).
export const MARKETPLACE_DISCOUNT_MIN_RANK = 4;
export const MARKETPLACE_DISCOUNT_PCT = 10;
export const hasMarketplaceDiscount = (xpOrUserData) => rankOf(xpOrUserData) >= MARKETPLACE_DISCOUNT_MIN_RANK;
export const applyMarketplaceDiscount = (price, xpOrUserData) => {
  const p = Math.max(0, Number(price) || 0);
  if (!hasMarketplaceDiscount(xpOrUserData)) return { finalPrice: p, discountAmount: 0, discounted: false };
  const discountAmount = Math.round(p * (MARKETPLACE_DISCOUNT_PCT / 100));
  return { finalPrice: Math.max(0, p - discountAmount), discountAmount, discounted: true };
};

// Rank 5 (Elite)+: early access — right now this unlocks "Boosted"
// placement for your own marketplace listings (surfaced first within
// their category). More early-access features can key off the same flag
// as they ship.
export const hasEarlyAccess = (xpOrUserData) => rankOf(xpOrUserData) >= 5;

// Rank 6 (Legend): highest tier — used to highlight leaderboard rows and
// to gate the monthly data-bundle reward claim (see rewardClaims in
// firestore.rules; claim creation lives in app.js).
export const isLegendRank = (xpOrUserData) => rankOf(xpOrUserData) >= 6;


// Used by index.htm (and anywhere else that sends a user into the app) to
// decide which shell to load: the desktop-optimized geo-books.htm or the
// phone/tablet-optimized geo-books-phone.htm.
//
// Pure UA sniffing misses iPadOS Safari, which reports a desktop macOS UA by
// default. Pure viewport-width checks misclassify a narrow desktop browser
// window as "mobile". Combining both — UA match OR (coarse pointer AND
// narrow-ish viewport) — covers phones, Android tablets, and iPads
// (touch/coarse pointer even when spoofing a Mac UA) without flagging a
// resized desktop Chrome window.
export const isMobileOrTabletDevice = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || '';
  const uaMatch = /Android|iPhone|iPod|iPad|Windows Phone|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua);
  if (uaMatch) return true;

  const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const narrowViewport = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1024px)').matches;
  return Boolean(coarsePointer && narrowViewport);
};

export const getAppEntryUrl = () => (isMobileOrTabletDevice() ? 'geo-books-phone.htm' : 'geo-books.htm');

export const safeIconName = (value, fallback = 'bell') => {
  const v = toText(value).trim();
  return /^[a-z0-9-]+$/.test(v) ? v : fallback;
};

export const safeUrl = (value, fallback = '') => {
  const raw = toText(value).trim();
  if (!raw) return fallback;
  try {
    const u = new URL(raw, window.location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    return fallback;
  } catch {
    return fallback;
  }
};

// --- Offline Question Pack Cache (IndexedDB) ---
// Backs fetchRealQuestionBank()'s offline fallback and
// window.downloadQuestionPackForOffline() in app.js. Uses the same
// `GeoBooksCBT` database / `packages` object store documented in
// JAMB_WAEC_DB_DESIGN.md's "IndexedDB Schema for Offline Storage" section,
// so a pack cached here is the same one that schema describes.
const QUESTION_PACK_DB_NAME = 'GeoBooksCBT';
const QUESTION_PACK_DB_VERSION = 1;
const QUESTION_PACK_STORE = 'packages';

function openQuestionPackDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const request = indexedDB.open(QUESTION_PACK_DB_NAME, QUESTION_PACK_DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUESTION_PACK_STORE)) {
        const packageStore = db.createObjectStore(QUESTION_PACK_STORE, { keyPath: 'id' });
        packageStore.createIndex('year', 'year', { unique: false });
        packageStore.createIndex('subjects', 'subjects', { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
    };
  });
}

// Builds a stable cache key for a question pack. `subjectOrCompound` may
// already be a "Subject::Topic" compound string (see fetchRealQuestionBank
// in app.js), so this just normalizes and joins — it doesn't need to know
// about topics itself.
export const questionPackKey = (examType, subjectOrCompound, year = null) => {
  const parts = [
    toText(examType).trim().toUpperCase() || 'GENERAL',
    toText(subjectOrCompound).trim(),
    year ? String(year) : 'all'
  ];
  return parts.join('::');
};

// Fire-and-forget: callers don't await this (see app.js's
// fetchRealQuestionBank), so failures are logged, not thrown.
export const cacheQuestionPack = async (packKey, questions) => {
  try {
    const db = await openQuestionPackDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUESTION_PACK_STORE, 'readwrite');
      const keyParts = packKey.split('::');
      tx.objectStore(QUESTION_PACK_STORE).put({
        id: packKey,
        questions,
        year: (keyParts[2] === 'all' || !keyParts[2]) ? null : (Number(keyParts[2]) || null),
        subjects: [keyParts[1]].filter(Boolean),
        cachedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn(`cacheQuestionPack: failed to cache pack "${packKey}":`, e);
  }
};

export const getCachedQuestionPack = async (packKey) => {
  try {
    const db = await openQuestionPackDB();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(QUESTION_PACK_STORE, 'readonly');
      const req = tx.objectStore(QUESTION_PACK_STORE).get(packKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return record ? record.questions : null;
  } catch (e) {
    console.warn(`getCachedQuestionPack: failed to read pack "${packKey}":`, e);
    return null;
  }
};

// --- Offline Pack Management (list / delete) ---
// Backs the Offline & Low-Data Mode section: a management view over the
// same `packages` IndexedDB store the functions above write to. Unlike
// getCachedQuestionPack (fetch one pack's questions to practice with),
// these are for showing "what do I have downloaded" and letting the user
// remove packs to free up space.
export const listCachedQuestionPacks = async () => {
  try {
    const db = await openQuestionPackDB();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(QUESTION_PACK_STORE, 'readonly');
      const req = tx.objectStore(QUESTION_PACK_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records
      .filter((r) => Array.isArray(r.questions) && r.questions.length)
      .map((r) => {
        const count = r.questions.length;
        // Rough on-device size estimate — exact byte accounting isn't
        // available from IndexedDB itself, so this just stringifies the
        // cached questions. Good enough for a "~340 KB" label, not meant
        // to be precise.
        let approxBytes;
        try {
          approxBytes = new Blob([JSON.stringify(r.questions)]).size;
        } catch {
          approxBytes = count * 300;
        }
        return {
          id: r.id,
          subjects: Array.isArray(r.subjects) ? r.subjects : [],
          year: r.year || null,
          count,
          approxBytes,
          cachedAt: r.cachedAt || 0
        };
      })
      .sort((a, b) => b.cachedAt - a.cachedAt);
  } catch (e) {
    console.warn('listCachedQuestionPacks: failed to list packs:', e);
    return [];
  }
};

export const deleteCachedQuestionPack = async (packKey) => {
  try {
    const db = await openQuestionPackDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUESTION_PACK_STORE, 'readwrite');
      tx.objectStore(QUESTION_PACK_STORE).delete(packKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (e) {
    console.warn(`deleteCachedQuestionPack: failed to delete pack "${packKey}":`, e);
    return false;
  }
};

export const clearAllCachedQuestionPacks = async () => {
  try {
    const db = await openQuestionPackDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUESTION_PACK_STORE, 'readwrite');
      tx.objectStore(QUESTION_PACK_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (e) {
    console.warn('clearAllCachedQuestionPacks: failed to clear packs:', e);
    return false;
  }
};

export const formatApproxSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

// --- Low-Data Mode preference ---
// A single persisted flag other parts of the app can check before doing
// anything data-heavy (default download counts, prefetching, etc). Reading
// it never has side effects; setLowDataMode() is the only writer, called
// from the toggle in the Offline & Low-Data Mode section.
const LOW_DATA_MODE_KEY = 'lowDataMode';
export const isLowDataMode = () => store.get(LOW_DATA_MODE_KEY, false) === true;
export const setLowDataMode = (enabled) => store.set(LOW_DATA_MODE_KEY, Boolean(enabled));

// Reads the browser/OS-level Data Saver signal (Chrome/Android's Network
// Information API). Purely informational — used to *suggest* Low-Data Mode
// in the UI, never to flip the app's own setting on someone's behalf.
export const prefersDataSaver = () => {
  try {
    return Boolean(navigator.connection && navigator.connection.saveData);
  } catch {
    return false;
  }
};

export const toggleSidebarCollapse = () => {
  const sidebar = S('sidebar');
  const icon = S('sidebarCollapseIcon');
  if (sidebar) {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    if (icon) icon.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
    localStorage.setItem('sidebar_collapsed', isCollapsed);
  }
};
export const copyToClipboard = async (text, toastFn) => {
  try {
    await navigator.clipboard.writeText(text);
    if (toastFn) toastFn('Copied to clipboard!', 'success');
  } catch (err) {
    if (toastFn) toastFn('Failed to copy', 'error');
  }
};

export const toast = (msg, type = 'info', duration = 4000) => {
  const container = S('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  const colors = {
    info: 'bg-slate-900',
    success: 'bg-emerald-600',
    error: 'bg-rose-600',
    brand: 'bg-brand-600',
    warning: 'bg-amber-600'
  };
  const icons = {
    info: 'info',
    success: 'check-circle',
    error: 'alert-circle',
    brand: 'zap',
    warning: 'alert-triangle'
  };
  el.className = `${colors[type] || colors.info} text-white px-8 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-2xl animate-in slide-in-from-right-full duration-500 flex items-center gap-4 border border-white/10`;
  
  const icon = document.createElement('i');
  icon.dataset.lucide = icons[type] || 'info';
  icon.className = 'w-5 h-5';
  
  const span = document.createElement('span');
  span.textContent = toText(msg);
  
  el.appendChild(icon);
  el.appendChild(span);
  container.appendChild(el);
  
  if (window.lucide) window.lucide.createIcons();
  
  setTimeout(() => {
    el.classList.add('animate-out', 'fade-out', 'slide-out-to-right-full');
    setTimeout(() => el.remove(), 500);
  }, duration);
};