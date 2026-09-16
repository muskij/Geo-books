/**
 * Geo-Books — University Section (Hostel Finder + Lectures)
 *
 * Loaded as its own <script type="module"> in geo-books.htm /
 * geo-books-phone.htm, same way ai-vault-shared.js is loaded independently
 * of app.js. It does NOT import app.js (app.js does not export its
 * internal `app` state object or `db`/`auth`), so this file re-initializes
 * the same Firebase app the way ai-vault-shared.js already does — Firebase
 * dedupes via getApps(), so this is safe and is the established pattern
 * in this codebase for auxiliary modules.
 *
 * Wiring into the existing section system: geo-books.htm's nav uses
 * `data-target="<sectionId>"` buttons + `<section id="<sectionId}">`
 * blocks, toggled by app.js's window.showSection(). This file only needs
 * two such section ids to exist in the HTML — #hostelFinder and
 * #universityLectures — and fills their content containers itself.
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, limit, onSnapshot,
  doc, getDoc, addDoc, setDoc, deleteDoc, serverTimestamp, runTransaction, increment
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { $, S, escapeHTML, toast, safeUrl } from "./utils.js";
import { generateExamFromText, launchCbtSession } from "./ai-vault-shared.js";

const firebaseConfig = {
  apiKey: "AIzaSyA1nVLSPFs30wG-PLaEyFqm_PEVhZdzISU",
  authDomain: "geo-books-8411e.firebaseapp.com",
  projectId: "geo-books-8411e",
  storageBucket: "geo-books-8411e.firebasestorage.app",
  messagingSenderId: "972887107793",
  appId: "1:972887107793:web:7e0374bf81e6713fd0fdf0",
  measurementId: "G-RY84V5DXPN"
};

function getFirebaseApp() {
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

const auth = getAuth(getFirebaseApp());
const db = getFirestore(getFirebaseApp());

// Same R2-via-server upload pipeline every other upload in this app uses
// (see app.js's dispatchAssetToCloudflare / main_admin.htm's copy of it).
// destinationKey convention here: 'hostels/<hostelId>/<n>-<filename>' and
// 'lectures/<uid>/<filename>' so files land in per-record/per-user folders,
// same spirit as server.js's own 'uploads/<uid>/...' default.
const API_BASE_URL = window.GEO_BOOKS_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3007'
    : '');

// Parallel multipart upload — for lecture videos specifically. Splits the
// file into 10MB chunks and uploads several in parallel directly to R2
// (server only issues signed URLs, never touches the file bytes). Roughly
// halves-to-thirds real-world upload time vs the old single-request
// /api/upload proxy, since that route buffers the whole file into server
// RAM before re-uploading it to R2 — a real double-hop for large files.
const CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_CONCURRENT_PARTS = 5;

async function uploadAsset(file, destinationKey, onProgress) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to upload files.');
  const idToken = await user.getIdToken();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` };

  async function postJson(path, body) {
    const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }

  // Small files: skip multipart overhead entirely, single signed PUT is simpler.
  if (file.size <= CHUNK_SIZE) {
    const { uploadUrl, fileUrl } = await postJson('/api/upload/signed-url', {
      destinationKey, contentType: file.type
    });
    const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
    if (onProgress) onProgress(100);
    return fileUrl;
  }

  const { uploadId, key } = await postJson('/api/upload/multipart/init', {
    destinationKey, contentType: file.type
  });

  const totalParts = Math.ceil(file.size / CHUNK_SIZE);
  const chunks = Array.from({ length: totalParts }, (_, i) =>
    file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size)));
  const parts = new Array(totalParts);
  let uploadedBytes = 0;

  async function uploadOnePart(partNumber) {
    const chunk = chunks[partNumber - 1];
    const { url } = await postJson('/api/upload/multipart/part-url', { key, uploadId, partNumber });
    const putRes = await fetch(url, { method: 'PUT', body: chunk });
    if (!putRes.ok) throw new Error(`Part ${partNumber} failed (${putRes.status})`);
    parts[partNumber - 1] = { PartNumber: partNumber, ETag: putRes.headers.get('ETag') };
    uploadedBytes += chunk.size;
    if (onProgress) onProgress(Math.round((uploadedBytes / file.size) * 100));
  }

  let nextPart = 1;
  async function worker() {
    while (nextPart <= totalParts) {
      const partNumber = nextPart++;
      await uploadOnePart(partNumber);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_PARTS, totalParts) }, worker));
  } catch (err) {
    postJson('/api/upload/multipart/abort', { key, uploadId }).catch(() => {});
    throw err;
  }

  const { url: fileUrl } = await postJson('/api/upload/multipart/complete', { key, uploadId, parts });
  return fileUrl;
}

// --- Shared state ---
let currentUser = null;
let currentUserData = null;
let hostelsUnsub = null;
let lecturesUnsub = null;
let lecturerGrantUnsub = null;
let myLecturerGrant = null; // { accessGranted, courses, institutionId } or null
let allHostels = [];
let hostelFilters = { q: '', gender: '', roomType: '', maxPrice: null };
let hostelSort = 'newest'; // 'newest' | 'price_asc' | 'price_desc' | 'distance'
let hostelViewMode = 'grid'; // 'grid' | 'map'
let userGeo = null; // { lat, lng } once geolocation resolves
let hostelReviewsUnsub = null;
let leafletLoadPromise = null;
let hostelLeafletMap = null;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    currentUserData = null;
    myLecturerGrant = null;
    renderUniversityGate(); // no user yet — show sign-in/paywall state
    return;
  }
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    currentUserData = snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('University: failed to load user doc:', e);
  }
  watchMyLecturerGrant(user.uid);
  // currentUserData (and therefore subscription status) only exists from
  // this point on — initUniversitySection() may have already run once at
  // DOMContentLoaded with no user, so re-run the gate check now that we
  // actually know whether this user has an active University Pass.
  renderUniversityGate();
});

// Mirrors requireEliteAccess() in ai-vault-shared.js: a client-side UX gate
// only. The real enforcement is hasUniversityAccess() in firestore.rules —
// this just decides whether to render the real section or an upgrade
// prompt, same principle as functions-premium-gate-EXAMPLE.js's warning
// about client checks never being the actual security boundary.
function hasUniversityAccess() {
  if (isPlatformAdmin()) return true;
  const sub = currentUserData?.subscription;
  return !!sub && ['UNIVERSITY_PASS_30', 'UNIVERSITY_PASS_70'].includes(sub.tier) && sub.verified === true && sub.status === 'active';
}

function renderUniversityGate() {
  renderCgpaShell(); // free for everyone — render unconditionally, before any access check
  const lockBadges = [$('#hostelFinderLockBadge'), $('#universityLecturesLockBadge'), $('#universityAssessmentsLockBadge'), $('#universityTimetableLockBadge'), $('#universityAnnouncementsLockBadge')];
  if (hasUniversityAccess()) {
    lockBadges.forEach((el) => el && el.classList.add('hidden'));
    initUniversitySectionContent();
    return;
  }
  lockBadges.forEach((el) => el && el.classList.remove('hidden'));
  const hostelEl = $('#hostelFinder');
  const lecturesEl = $('#universityLectures');
  const assessmentsEl = $('#universityAssessments');
  const timetableEl = $('#universityTimetable');
  const announcementsEl = $('#universityAnnouncements');
  const paywallHtml = `
    <div class="flex flex-col items-center justify-center text-center py-20 px-6">
      <i data-lucide="graduation-cap" class="w-12 h-12 text-violet-500 mb-4"></i>
      <h3 class="text-xl font-black mb-2">University Pass Required</h3>
      <p class="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
        Hostel Finder and Lecture Recordings are part of University Pass —
        from ₦5,000/month (30 lectures) or ₦10,000/month (70 lectures).
        Unlock verified hostel listings and lecture access for your
        institution.
      </p>
      <button onclick="window.showSection && window.showSection('pricing')"
        class="px-8 py-4 rounded-xl bg-violet-600 text-white font-black uppercase tracking-widest text-[10px] hover:scale-105 transition-all">
        Get University Pass
      </button>
    </div>`;
  if (hostelEl) hostelEl.innerHTML = paywallHtml;
  if (lecturesEl) lecturesEl.innerHTML = paywallHtml;
  if (assessmentsEl) assessmentsEl.innerHTML = paywallHtml;
  if (timetableEl) timetableEl.innerHTML = paywallHtml;
  if (announcementsEl) announcementsEl.innerHTML = paywallHtml;
  if (window.lucide) window.lucide.createIcons();
}

function myInstitutionId() {
  return currentUserData?.institutionId || currentUserData?.university || null;
}

function isPlatformAdmin() {
  // Mirrors firestore.rules' isAdmin(): custom claim (not readable client
  // side without a token refresh check) OR users/{uid}.role === 'admin'.
  // The Firestore rules are the real enforcement; this only toggles UI.
  return (currentUserData?.role || '').toLowerCase() === 'admin';
}

// =====================================================================
// HOSTEL FINDER
// =====================================================================

// Haversine distance in km — used for both the "Distance" sort and to
// decide which hostels get a marker on the map.
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function requestUserGeo() {
  if (userGeo || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userGeo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      renderHostelGrid();
      if (hostelViewMode === 'map') renderHostelMap();
    },
    () => { toast("Couldn't get your location — showing hostels without distance sort.", 'error'); },
    { timeout: 8000 }
  );
}

function starRow(avgRating, size = 'w-3.5 h-3.5') {
  const rounded = Math.round(Number(avgRating) || 0);
  return Array.from({ length: 5 }, (_, i) => `
    <i data-lucide="star" class="${size} ${i < rounded ? 'text-amber-400 fill-amber-400' : 'text-slate-200 dark:text-slate-700'}"></i>
  `).join('');
}

function renderHostelFinderShell() {
  const root = S('hostelFinder');
  if (!root || root.dataset.uniInit) return;
  root.dataset.uniInit = '1';
  root.innerHTML = `
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8 p-4 sm:p-6 lg:p-8 pb-0">
      <div>
        <h2 class="text-3xl font-black tracking-tight">Hostel <span class="text-brand-600">Finder</span></h2>
        <p class="text-slate-500 dark:text-slate-400 mt-1">Off-campus and on-campus hostels near your institution.</p>
      </div>
      <div class="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl p-1">
        <button id="hostelViewGridBtn" onclick="window.setHostelViewMode('grid')" class="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-900 shadow-sm flex items-center gap-1.5"><i data-lucide="grid-3x3" class="w-3.5 h-3.5"></i> Grid</button>
        <button id="hostelViewMapBtn" onclick="window.setHostelViewMode('map')" class="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5"><i data-lucide="map" class="w-3.5 h-3.5"></i> Map</button>
      </div>
    </div>
    <div class="p-4 sm:p-6 lg:p-8 pt-0 space-y-6">
      <div class="premium-card p-4 flex flex-wrap gap-3 items-center">
        <div class="relative flex-1 min-w-[200px]">
          <i data-lucide="search" class="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input id="hostelSearchInput" type="text" placeholder="Search by name or institution..."
            class="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold focus:ring-2 focus:ring-brand-500 outline-none">
        </div>
        <select id="hostelGenderFilter" class="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
          <option value="">Any gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="mixed">Mixed</option>
        </select>
        <select id="hostelRoomFilter" class="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
          <option value="">Any room type</option>
          <option value="self-contain">Self-contain</option>
          <option value="shared">Shared</option>
          <option value="1-bedroom">1-bedroom</option>
        </select>
        <input id="hostelMaxPriceInput" type="number" min="0" placeholder="Max price (₦)"
          class="w-40 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
        <select id="hostelSortInput" class="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
          <option value="newest">Newest</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
          <option value="distance">Distance: Nearest to me</option>
        </select>
      </div>
      <div id="hostelGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <p class="col-span-full text-center text-slate-400 font-bold py-12">Loading hostels...</p>
      </div>
      <div id="hostelMapWrap" class="hidden">
        <div id="hostelMapEl" class="w-full h-[520px] rounded-3xl overflow-hidden border border-slate-100 dark:border-slate-800"></div>
        <p class="text-[10px] text-slate-400 font-bold mt-2">Only hostels with a saved location appear on the map.</p>
      </div>
    </div>
    <div id="hostelDetailModal" class="fixed inset-0 z-[500] hidden items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div class="bg-white dark:bg-slate-900 rounded-[2rem] max-w-lg w-full max-h-[85vh] overflow-y-auto custom-scrollbar p-8 relative">
        <button onclick="window.closeHostelDetail()" class="absolute top-6 right-6 w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center"><i data-lucide="x" class="w-4 h-4"></i></button>
        <div id="hostelDetailContent"></div>
      </div>
    </div>
  `;

  ['hostelSearchInput', 'hostelGenderFilter', 'hostelRoomFilter', 'hostelMaxPriceInput'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const handler = () => {
      hostelFilters = {
        q: document.getElementById('hostelSearchInput').value.trim().toLowerCase(),
        gender: document.getElementById('hostelGenderFilter').value,
        roomType: document.getElementById('hostelRoomFilter').value,
        maxPrice: document.getElementById('hostelMaxPriceInput').value
          ? Number(document.getElementById('hostelMaxPriceInput').value) : null
      };
      renderHostelGrid();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  document.getElementById('hostelSortInput').addEventListener('change', (e) => {
    hostelSort = e.target.value;
    if (hostelSort === 'distance') requestUserGeo();
    renderHostelGrid();
    if (hostelViewMode === 'map') renderHostelMap();
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.setHostelViewMode = (mode) => {
  hostelViewMode = mode;
  const gridBtn = S('hostelViewGridBtn'), mapBtn = S('hostelViewMapBtn');
  const gridWrap = S('hostelGrid'), mapWrap = S('hostelMapWrap');
  if (mode === 'map') {
    gridBtn.className = 'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5';
    mapBtn.className = 'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-900 shadow-sm flex items-center gap-1.5';
    gridWrap.classList.add('hidden');
    mapWrap.classList.remove('hidden');
    renderHostelMap();
  } else {
    mapBtn.className = 'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5';
    gridBtn.className = 'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-900 shadow-sm flex items-center gap-1.5';
    mapWrap.classList.add('hidden');
    gridWrap.classList.remove('hidden');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

function watchHostels() {
  if (hostelsUnsub) return;
  const institutionId = myInstitutionId();
  // Scope to the student's own institution when known; otherwise show the
  // full public list (a student who hasn't set an institution yet still
  // gets to browse). Both paths are covered by firestore.rules' public read.
  const q = institutionId
    ? query(collection(db, 'hostels'), where('institutionId', '==', institutionId), orderBy('createdAt', 'desc'), limit(100))
    : query(collection(db, 'hostels'), orderBy('createdAt', 'desc'), limit(100));

  hostelsUnsub = onSnapshot(q, (snap) => {
    allHostels = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderHostelGrid();
    if (hostelViewMode === 'map') renderHostelMap();
  }, (err) => {
    console.error('Hostel listener error:', err);
    const grid = S('hostelGrid');
    if (grid) grid.innerHTML = `<p class="col-span-full text-center text-rose-500 font-bold py-12">Couldn't load hostels. Please try again.</p>`;
  });
}

function filteredSortedHostels() {
  let list = allHostels;
  if (hostelFilters.q) {
    list = list.filter((h) =>
      String(h.name || '').toLowerCase().includes(hostelFilters.q) ||
      String(h.institutionName || '').toLowerCase().includes(hostelFilters.q));
  }
  if (hostelFilters.gender) list = list.filter((h) => h.gender === hostelFilters.gender);
  if (hostelFilters.roomType) list = list.filter((h) => Array.isArray(h.roomTypes) && h.roomTypes.includes(hostelFilters.roomType));
  if (hostelFilters.maxPrice != null) list = list.filter((h) => (h.priceMin ?? 0) <= hostelFilters.maxPrice);

  list = [...list];
  if (hostelSort === 'price_asc') {
    list.sort((a, b) => (a.priceMin ?? 0) - (b.priceMin ?? 0));
  } else if (hostelSort === 'price_desc') {
    list.sort((a, b) => (b.priceMin ?? 0) - (a.priceMin ?? 0));
  } else if (hostelSort === 'distance' && userGeo) {
    list.sort((a, b) => {
      const da = (a.lat != null && a.lng != null) ? distanceKm(userGeo.lat, userGeo.lng, a.lat, a.lng) : Infinity;
      const db_ = (b.lat != null && b.lng != null) ? distanceKm(userGeo.lat, userGeo.lng, b.lat, b.lng) : Infinity;
      return da - db_;
    });
  }
  // 'newest' — the Firestore query is already ordered by createdAt desc,
  // so no client-side re-sort is needed there.
  return list;
}

function renderHostelGrid() {
  const grid = S('hostelGrid');
  if (!grid) return;

  const list = filteredSortedHostels();

  if (!list.length) {
    grid.innerHTML = `<p class="col-span-full text-center text-slate-400 font-bold py-12">No hostels listed yet${myInstitutionId() ? ' for your institution' : ''}.</p>`;
    return;
  }

  grid.innerHTML = list.map((h) => {
    const dist = (hostelSort === 'distance' && userGeo && h.lat != null && h.lng != null)
      ? `${distanceKm(userGeo.lat, userGeo.lng, h.lat, h.lng).toFixed(1)} km away`
      : h.distanceFromCampus;
    return `
    <div class="premium-card overflow-hidden cursor-pointer" onclick="window.openHostelDetail('${h.id}')">
      <div class="aspect-[4/3] bg-slate-100 dark:bg-slate-800 overflow-hidden relative">
        <img src="${escapeHTML(safeUrl(h.images?.[0], `https://picsum.photos/seed/${h.id}/600/450`))}" class="w-full h-full object-cover" loading="lazy">
        ${h.verified ? `<span class="absolute top-3 right-3 px-3 py-1 rounded-full bg-emerald-500 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1"><i data-lucide="badge-check" class="w-3 h-3"></i> Verified</span>` : ''}
      </div>
      <div class="p-5">
        <h4 class="font-black text-sm truncate">${escapeHTML(h.name)}</h4>
        <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 truncate">${escapeHTML(h.institutionName || '')}</p>
        ${h.reviewCount ? `<div class="flex items-center gap-1 mt-2">${starRow(h.avgRating)}<span class="text-[10px] text-slate-400 font-bold ml-1">(${h.reviewCount})</span></div>` : `<p class="text-[10px] text-slate-300 font-bold mt-2">No reviews yet</p>`}
        <div class="flex items-center justify-between mt-4">
          <span class="text-brand-600 font-black text-sm">₦${Number(h.priceMin || 0).toLocaleString()}${h.priceMax ? ' – ₦' + Number(h.priceMax).toLocaleString() : ''}</span>
          ${dist ? `<span class="text-[10px] text-slate-400 font-bold">${escapeHTML(dist)}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- Map view (Leaflet, lazy-loaded from CDN — same unpkg CDN already
// used in this project for lucide, so no new registrar to trust) ---
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(cssLink);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load map library.'));
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

async function renderHostelMap() {
  const wrap = S('hostelMapEl');
  if (!wrap) return;
  try {
    await loadLeaflet();
  } catch (e) {
    wrap.innerHTML = `<p class="p-12 text-center text-rose-500 font-bold">Couldn't load the map. Please check your connection.</p>`;
    return;
  }

  const withLocation = filteredSortedHostels().filter((h) => h.lat != null && h.lng != null);

  if (!hostelLeafletMap) {
    hostelLeafletMap = window.L.map('hostelMapEl');
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(hostelLeafletMap);
  }

  // Clear previous markers before redrawing.
  hostelLeafletMap.eachLayer((layer) => {
    if (layer instanceof window.L.Marker) hostelLeafletMap.removeLayer(layer);
  });

  if (!withLocation.length) {
    hostelLeafletMap.setView([9.0820, 8.6753], 6); // Nigeria-wide default
    return;
  }

  const bounds = [];
  withLocation.forEach((h) => {
    const marker = window.L.marker([h.lat, h.lng]).addTo(hostelLeafletMap);
    marker.bindPopup(`
      <strong>${escapeHTML(h.name)}</strong><br>
      ₦${Number(h.priceMin || 0).toLocaleString()}${h.priceMax ? ' – ₦' + Number(h.priceMax).toLocaleString() : ''}<br>
      <a href="#" onclick="window.openHostelDetail('${h.id}'); return false;">View details</a>
    `);
    bounds.push([h.lat, h.lng]);
  });
  if (userGeo) bounds.push([userGeo.lat, userGeo.lng]);
  hostelLeafletMap.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => hostelLeafletMap.invalidateSize(), 200);
}

// --- Hostel detail + reviews ---
window.openHostelDetail = (id) => {
  const h = allHostels.find((x) => x.id === id);
  if (!h) return;
  const content = S('hostelDetailContent');
  const images = Array.isArray(h.images) && h.images.length ? h.images : [`https://picsum.photos/seed/${h.id}/600/450`];
  const waNumber = String(h.contactWhatsapp || '').replace(/[^\d+]/g, '');
  content.innerHTML = `
    <div class="aspect-video rounded-2xl bg-slate-100 dark:bg-slate-800 overflow-hidden mb-6">
      <img src="${escapeHTML(safeUrl(images[0]))}" class="w-full h-full object-cover">
    </div>
    ${images.length > 1 ? `<div class="flex gap-2 mb-6 overflow-x-auto">${images.slice(1, 6).map((u) => `<img src="${escapeHTML(safeUrl(u))}" class="w-20 h-20 rounded-xl object-cover shrink-0">`).join('')}</div>` : ''}
    <div class="flex items-center gap-2 mb-2">
      <h3 class="text-xl font-black">${escapeHTML(h.name)}</h3>
      ${h.verified ? `<i data-lucide="badge-check" class="w-5 h-5 text-emerald-500"></i>` : ''}
    </div>
    <p class="text-sm text-slate-400 font-bold mb-2">${escapeHTML(h.institutionName || '')} • ${escapeHTML(h.address || '')}</p>
    <div class="flex items-center gap-1 mb-4">
      ${starRow(h.avgRating, 'w-4 h-4')}
      <span class="text-xs text-slate-400 font-bold ml-1">${h.reviewCount ? `${Number(h.avgRating || 0).toFixed(1)} (${h.reviewCount} review${h.reviewCount === 1 ? '' : 's'})` : 'No reviews yet'}</span>
    </div>
    <p class="text-brand-600 font-black text-lg mb-4">₦${Number(h.priceMin || 0).toLocaleString()}${h.priceMax ? ' – ₦' + Number(h.priceMax).toLocaleString() : ''}</p>
    <div class="flex flex-wrap gap-2 mb-6">
      ${(h.roomTypes || []).map((t) => `<span class="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase">${escapeHTML(t)}</span>`).join('')}
      ${(h.amenities || []).map((a) => `<span class="px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/20 text-brand-600 text-[10px] font-black uppercase">${escapeHTML(a)}</span>`).join('')}
    </div>
    <div class="flex gap-3 mb-8">
      ${waNumber ? `<a href="https://wa.me/${encodeURIComponent(waNumber)}?text=${encodeURIComponent('Hi, I found ' + h.name + ' on Geo-Books and I\'m interested.')}" target="_blank" rel="noopener" class="flex-1 py-4 rounded-2xl bg-emerald-500 text-white font-black text-xs uppercase tracking-widest text-center flex items-center justify-center gap-2"><i data-lucide="message-circle" class="w-4 h-4"></i> WhatsApp</a>` : ''}
      ${h.contactPhone ? `<a href="tel:${escapeHTML(h.contactPhone)}" class="flex-1 py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 font-black text-xs uppercase tracking-widest text-center flex items-center justify-center gap-2"><i data-lucide="phone" class="w-4 h-4"></i> Call</a>` : ''}
    </div>

    <div class="border-t border-slate-100 dark:border-slate-800 pt-6">
      <h4 class="font-black text-sm mb-4">Reviews</h4>
      ${currentUser ? `
        <div class="mb-6 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
          <p class="text-[10px] font-black uppercase text-slate-400 mb-2">Your rating</p>
          <div id="hostelReviewStarPicker" class="flex items-center gap-1 mb-3"></div>
          <textarea id="hostelReviewComment" placeholder="What was it like staying there? (optional)" rows="2" class="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-900 text-xs font-bold outline-none mb-3"></textarea>
          <button onclick="window.submitHostelReview('${h.id}')" class="px-5 py-2.5 rounded-xl bg-brand-600 text-white text-[10px] font-black uppercase tracking-widest">Submit Review</button>
          <p id="hostelReviewStatus" class="text-[10px] font-bold text-slate-400 mt-2"></p>
        </div>` : `<p class="text-xs text-slate-400 font-bold mb-6">Sign in to leave a review.</p>`}
      <div id="hostelReviewsList" class="space-y-4">
        <p class="text-xs text-slate-400 font-bold">Loading reviews...</p>
      </div>
    </div>
  `;
  S('hostelDetailModal').classList.remove('hidden');
  S('hostelDetailModal').classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();

  if (currentUser) renderStarPicker(5);
  watchHostelReviews(h.id);
};

let selectedReviewRating = 5;
function renderStarPicker(selected) {
  selectedReviewRating = selected;
  const picker = S('hostelReviewStarPicker');
  if (!picker) return;
  picker.innerHTML = Array.from({ length: 5 }, (_, i) => `
    <button onclick="window.pickReviewStar(${i + 1})" class="p-0.5">
      <i data-lucide="star" class="w-6 h-6 ${i < selected ? 'text-amber-400 fill-amber-400' : 'text-slate-200 dark:text-slate-700'}"></i>
    </button>`).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.pickReviewStar = (n) => renderStarPicker(n);

function watchHostelReviews(hostelId) {
  if (hostelReviewsUnsub) { hostelReviewsUnsub(); hostelReviewsUnsub = null; }
  const list = S('hostelReviewsList');
  hostelReviewsUnsub = onSnapshot(
    query(collection(db, 'hostels', hostelId, 'reviews'), orderBy('createdAt', 'desc'), limit(20)),
    (snap) => {
      if (!list) return;
      const reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!reviews.length) {
        list.innerHTML = `<p class="text-xs text-slate-400 font-bold">No reviews yet — be the first to share your experience.</p>`;
        return;
      }
      list.innerHTML = reviews.map((r) => `
        <div class="border-b border-slate-100 dark:border-slate-800 pb-4 last:border-0">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-black">${escapeHTML(r.name || 'Student')}</span>
            <div class="flex items-center gap-0.5">${starRow(r.rating, 'w-3 h-3')}</div>
          </div>
          ${r.comment ? `<p class="text-xs text-slate-500 dark:text-slate-400 font-medium">${escapeHTML(r.comment)}</p>` : ''}
        </div>`).join('');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    },
    (err) => {
      console.error('Reviews listener error:', err);
      if (list) list.innerHTML = `<p class="text-xs text-rose-500 font-bold">Couldn't load reviews.</p>`;
    }
  );
}

window.submitHostelReview = async (hostelId) => {
  const status = S('hostelReviewStatus');
  if (!currentUser) { toast('Please sign in first.', 'error'); return; }
  const comment = S('hostelReviewComment').value.trim().slice(0, 500);
  const rating = selectedReviewRating;

  status.textContent = 'Saving...';
  try {
    const hostelRef = doc(db, 'hostels', hostelId);
    const reviewRef = doc(db, 'hostels', hostelId, 'reviews', currentUser.uid);
    await runTransaction(db, async (tx) => {
      const hostelSnap = await tx.get(hostelRef);
      const reviewSnap = await tx.get(reviewRef);
      if (!hostelSnap.exists()) throw new Error('This hostel listing no longer exists.');

      const prevRating = reviewSnap.exists() ? (reviewSnap.data().rating || 0) : 0;
      const prevCount = hostelSnap.data().reviewCount || 0;
      const prevSum = hostelSnap.data().totalRatingSum || 0;
      const newCount = reviewSnap.exists() ? prevCount : prevCount + 1;
      const newSum = prevSum - prevRating + rating;
      const avgRating = newCount ? newSum / newCount : 0;

      tx.set(reviewRef, {
        uid: currentUser.uid,
        name: currentUserData?.displayName || currentUserData?.name || 'Student',
        rating,
        comment,
        createdAt: reviewSnap.exists() ? (reviewSnap.data().createdAt || serverTimestamp()) : serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      tx.update(hostelRef, { totalRatingSum: newSum, reviewCount: newCount, avgRating, updatedAt: serverTimestamp() });
    });
    status.textContent = 'Thanks for your review!';
  } catch (e) {
    console.error('Review submit failed:', e);
    status.textContent = e.message || 'Failed to save your review.';
  }
};

window.closeHostelDetail = () => {
  S('hostelDetailModal').classList.add('hidden');
  S('hostelDetailModal').classList.remove('flex');
  if (hostelReviewsUnsub) { hostelReviewsUnsub(); hostelReviewsUnsub = null; }
};

// =====================================================================
// LECTURES
// =====================================================================

let allLectures = [];
let courseDesignMap = {}; // courseId -> template ('' | 'dashboard' | 'classic'), from courseSettings/{courseId}
let courseDesignsUnsub = null;
let lectureFilters = { course: '', institutionId: '', uploaderRole: '' };
let lectureSearchQ = '';
let lectureSort = 'newest'; // 'newest' | 'most_watched' | 'bookmarked'
let myBookmarks = new Set(); // lectureIds, kept in sync by watchMyBookmarks()
let watchedLectureIds = new Set();
let watchProgressUnsub = null;
let lectureCommentsUnsub = null;

function watchMyLecturerGrant(uid) {
  if (lecturerGrantUnsub) lecturerGrantUnsub();
  lecturerGrantUnsub = onSnapshot(doc(db, 'lecturers', uid), (snap) => {
    myLecturerGrant = snap.exists() ? snap.data() : null;
    renderLectureUploadControls();
    renderLectureList(allLectures);
  }, () => { myLecturerGrant = null; });

  // Track which lectures this student has already marked watched, so the
  // "most watched" sort and the per-card checkmark both reflect reality
  // rather than resetting every reload.
  if (watchProgressUnsub) watchProgressUnsub();
  watchProgressUnsub = onSnapshot(
    query(collection(db, 'lectureProgress'), where('uid', '==', uid)),
    (snap) => {
      watchedLectureIds = new Set(snap.docs.map((d) => d.data().lectureId));
      renderLectureList(allLectures);
    },
    (err) => console.warn('Watch progress listener error:', err)
  );
}

function canUploadLectures() {
  return isPlatformAdmin() || (myLecturerGrant?.accessGranted === true);
}

// True for a revoked/never-approved lecturer account — used to show a
// disabled upload button with an explanation, rather than nothing at all
// (nothing at all reads as "this student has no idea uploading exists"
// when in fact they used to have access, or applied and are waiting).
function isKnownButUngrantedLecturer() {
  return !isPlatformAdmin() && myLecturerGrant && myLecturerGrant.accessGranted !== true;
}

const PICKER_COLORS = [
  'from-emerald-500 to-teal-600', 'from-rose-500 to-pink-600', 'from-blue-500 to-indigo-600',
  'from-purple-500 to-violet-600', 'from-amber-500 to-orange-600', 'from-cyan-500 to-blue-600'
];

function renderUniversityLecturesShell() {
  const root = S('universityLectures');
  if (!root || root.dataset.uniInit) return;
  root.dataset.uniInit = '1';
  root.innerHTML = `
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-2 p-4 sm:p-6 lg:p-8 pb-0">
      <div>
        <h2 class="text-3xl font-black tracking-tight">Who's <span class="text-brand-600">Watching?</span></h2>
        <p class="text-slate-500 dark:text-slate-400 mt-1">Pick a course to see its lectures.</p>
      </div>
      <div id="lectureUploadControls" class="flex items-center gap-3"></div>
    </div>
    <div id="lectureQuotaBar" class="hidden mx-4 sm:mx-6 lg:mx-8 mb-6"></div>
    <div class="p-4 sm:p-6 lg:p-8 pt-4">
      <div id="coursePickerGrid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
        <p class="col-span-full text-center text-slate-400 font-bold py-12">Loading courses...</p>
      </div>
    </div>
    <div id="lectureUploadModal" class="fixed inset-0 z-[500] hidden items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div class="bg-white dark:bg-slate-900 rounded-[2rem] max-w-md w-full p-8 relative">
        <button onclick="window.closeLectureUploadModal()" class="absolute top-6 right-6 w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center"><i data-lucide="x" class="w-4 h-4"></i></button>
        <h3 class="text-xl font-black mb-6">Upload Lecture</h3>
        <div class="space-y-4">
          <input id="lectureTitleInput" type="text" placeholder="Lecture title" class="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
          <select id="lectureCourseInput" class="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none"></select>
          <input id="lectureDurationInput" type="text" placeholder="Duration (e.g. 45 min) — optional" class="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
          <input id="lectureFileInput" type="file" accept="video/*,.pdf" class="w-full text-xs font-bold">
          <p id="lectureUploadStatus" class="text-xs font-bold text-slate-400"></p>
          <button onclick="window.submitLectureUpload()" class="w-full py-4 rounded-2xl bg-brand-600 text-white font-black text-xs uppercase tracking-widest">Upload</button>
        </div>
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function courseDesignSuffix(courseId) {
  const template = courseDesignMap[courseId];
  return (template === 'dashboard' || template === 'classic') ? `-${template}` : '';
}

function renderCoursePicker() {
  const grid = $('#coursePickerGrid');
  if (!grid) return;
  const courseMap = new Map(); // courseId -> { count, uploadedByName, uploadedByLogoUrl, uploadedByRole, topicCount }
  allLectures.forEach((l) => {
    if (!l.courseId) return;
    const existing = courseMap.get(l.courseId);
    if (existing) {
      existing.count += 1;
    } else {
      // allLectures is already ordered by createdAt desc (see watchLectures'
      // query), so the first lecture we see for a courseId is the most
      // recent one — use its uploader as this course card's "face". Good
      // enough for the common single-lecturer-per-course case in the
      // mockup; a course with several lecturers just shows whoever
      // uploaded most recently, which self-corrects as more lectures land.
      courseMap.set(l.courseId, {
        count: 1,
        uploadedByName: l.uploadedByName || null,
        uploadedByLogoUrl: l.uploadedByLogoUrl || null,
        uploadedByRole: l.uploadedByRole || null
      });
    }
  });
  // Courses that only have topics (no lecture video yet) still need a
  // tile — otherwise their content is saved in Firestore but has no path
  // to be viewed. If the course already has a lecture, the lecture
  // uploader's face wins (unchanged); a topics-only course now shows its
  // topic uploader's face instead of always falling back to the generic
  // book icon.
  allTopicCourseIds.forEach((topicInfo, courseId) => {
    const existing = courseMap.get(courseId);
    if (existing) {
      existing.topicCount = topicInfo.count;
    } else {
      courseMap.set(courseId, {
        count: 0,
        topicCount: topicInfo.count,
        uploadedByName: topicInfo.uploadedByName,
        uploadedByLogoUrl: topicInfo.uploadedByLogoUrl,
        uploadedByRole: topicInfo.uploadedByRole
      });
    }
  });
  const courses = [...courseMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (!courses.length) {
    grid.innerHTML = `
      <div class="col-span-full text-center py-16">
        <i data-lucide="graduation-cap" class="w-10 h-10 mx-auto mb-3 text-slate-200"></i>
        <p class="text-slate-400 font-bold">No lectures uploaded for any course yet.</p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  grid.innerHTML = courses.map(([courseId, info], i) => {
    // Only show a lecturer's identity for lecturer-uploaded courses with a
    // name on file — head-admin uploads and lecturers who haven't set a
    // name yet (pre-onboarding) fall back to the generic book icon so the
    // card never shows a blank/broken avatar.
    const showLecturerFace = info.uploadedByRole === 'lecturer' && info.uploadedByName;
    const initial = showLecturerFace ? info.uploadedByName.trim().charAt(0).toUpperCase() : '';
    const faceHTML = showLecturerFace
      ? (info.uploadedByLogoUrl
          ? `<img src="${escapeHTML(info.uploadedByLogoUrl)}" alt="${escapeHTML(info.uploadedByName)}" class="w-full h-full object-cover">`
          : `<span class="text-3xl font-black">${escapeHTML(initial)}</span>`)
      : `<i data-lucide="book-open" class="w-10 h-10"></i>`;

    // "X lectures", "X topics", or both, depending on what actually exists
    // for this course — a topics-only course shouldn't claim "0 lectures"
    // as if that's the interesting fact about it.
    const metaParts = [];
    if (info.count > 0) metaParts.push(`${info.count} lecture${info.count === 1 ? '' : 's'}`);
    if (info.topicCount > 0) metaParts.push(`${info.topicCount} topic${info.topicCount === 1 ? '' : 's'}`);
    const metaText = metaParts.join(' • ');
    const isTopicsOnly = info.count === 0 && info.topicCount > 0;

    return `
    <a href="course-lectures${courseDesignSuffix(courseId)}.htm?course=${encodeURIComponent(courseId)}" class="group flex flex-col items-center gap-3">
      <div class="w-full aspect-square rounded-2xl bg-gradient-to-br ${PICKER_COLORS[i % PICKER_COLORS.length]} flex items-center justify-center text-white shadow-lg group-hover:scale-105 group-hover:ring-4 group-hover:ring-white dark:group-hover:ring-slate-700 transition-all overflow-hidden ${isTopicsOnly ? 'opacity-80' : ''}">
        ${faceHTML}
      </div>
      <div class="text-center">
        <p class="font-black text-sm truncate max-w-[120px]">${escapeHTML(courseId)}</p>
        <p class="text-[10px] text-slate-400 font-bold">${metaText}</p>
        ${showLecturerFace ? `<p class="text-[10px] text-slate-400 font-bold truncate max-w-[120px]">by ${escapeHTML(info.uploadedByName)}</p>` : ''}
      </div>
    </a>`;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

function renderLectureUploadControls() {
  const el = S('lectureUploadControls');
  if (!el) return;

  // IMPORTANT: lecturer.html's own onAuthStateChanged gate checks
  // `lecturers/{uid}.accessGranted === true` with NO admin bypass — a
  // platform admin who doesn't also hold a granted lecturer doc would be
  // bounced straight back to geo-books.htm with "You don't have lecturer
  // access." So this link can only safely go to users who actually pass
  // that gate; it is not simply "isPlatformAdmin() OR granted" like
  // canUploadLectures() elsewhere on this page.
  const hasLecturerAccess = myLecturerGrant?.accessGranted === true;

  let controlsHTML = '';
  if (hasLecturerAccess) {
    controlsHTML = `
      <a href="lecturer.html" class="px-6 py-3 rounded-2xl bg-brand-600 text-white font-black uppercase tracking-widest text-[10px] flex items-center gap-2">
        <i data-lucide="layout-dashboard" class="w-4 h-4"></i> Go to Lecturer Dashboard
      </a>`;
  } else if (isKnownButUngrantedLecturer()) {
    controlsHTML = `
      <button disabled title="Your lecturer access was revoked or hasn't been approved yet — contact an admin." class="px-6 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 font-black uppercase tracking-widest text-[10px] flex items-center gap-2 cursor-not-allowed">
        <i data-lucide="lock" class="w-4 h-4"></i> Upload Lecture
      </button>`;
  } else if (isPlatformAdmin()) {
    // Admins with no personal lecturers/{uid} grant can't use lecturer.html
    // (see note above) — grant management and admin-side lecture upload
    // both live in main_admin.htm instead, so point there rather than a
    // link that would just dead-end.
    controlsHTML = `
      <a href="main_admin.htm" class="px-6 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-black uppercase tracking-widest text-[10px] flex items-center gap-2" title="Grant lecturer access or upload as admin">
        <i data-lucide="user-cog" class="w-4 h-4"></i> Manage in Admin Panel
      </a>`;
  }
  // Regular students with no lecturers/{uid} doc at all see nothing here —
  // there's no actionable link for them.

  el.innerHTML = controlsHTML;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.openLectureUploadModal = () => {
  const courseSelect = S('lectureCourseInput');
  const courses = isPlatformAdmin() ? null : (myLecturerGrant?.courses || []);
  courseSelect.innerHTML = courses === null
    ? `<option value="">General / Any course</option>`
    : courses.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('') || `<option value="">No courses assigned</option>`;
  S('lectureDurationInput').value = '';
  S('lectureUploadModal').classList.remove('hidden');
  S('lectureUploadModal').classList.add('flex');
};

window.closeLectureUploadModal = () => {
  S('lectureUploadModal').classList.add('hidden');
  S('lectureUploadModal').classList.remove('flex');
  S('lectureTitleInput').value = '';
  S('lectureFileInput').value = '';
  S('lectureUploadStatus').textContent = '';
};

window.submitLectureUpload = async () => {
  const status = S('lectureUploadStatus');
  const title = S('lectureTitleInput').value.trim();
  const courseId = S('lectureCourseInput').value;
  const durationLabel = S('lectureDurationInput').value.trim();
  const file = S('lectureFileInput').files[0];
  if (!currentUser) { toast('Please sign in first.', 'error'); return; }
  if (!canUploadLectures()) { status.textContent = "You don't have upload access."; return; }
  if (!title || !file) { status.textContent = 'Title and a file are required.'; return; }
  if (!isPlatformAdmin() && !courseId) { status.textContent = 'Select a course.'; return; }

  status.textContent = 'Uploading... 0%';
  try {
    const key = `lectures/${currentUser.uid}/${Date.now()}-${file.name}`;
    const fileUrl = await uploadAsset(file, key, (percent) => {
      status.textContent = `Uploading... ${percent}%`;
    });
    const uploaderName = isPlatformAdmin()
      ? (currentUserData?.displayName || currentUserData?.name || 'Geo-Books Admin')
      : (myLecturerGrant?.name || currentUserData?.displayName || currentUserData?.name || 'Lecturer');
    const uploaderLogoUrl = isPlatformAdmin() ? null : (myLecturerGrant?.logoUrl || null);
    await addDoc(collection(db, 'lectures'), {
      title,
      fileUrl,
      courseId: courseId || null,
      durationLabel: durationLabel || null,
      institutionId: isPlatformAdmin() ? (myInstitutionId() || null) : (myLecturerGrant?.institutionId || null),
      uploadedBy: currentUser.uid,
      uploadedByRole: isPlatformAdmin() ? 'head_admin' : 'lecturer',
      uploadedByName: uploaderName,
      uploadedByLogoUrl: uploaderLogoUrl,
      watchCount: 0,
      createdAt: serverTimestamp()
    });
    toast('Lecture uploaded.', 'success');
    window.closeLectureUploadModal();
  } catch (e) {
    console.error('Lecture upload failed:', e);
    status.textContent = e.message || 'Upload failed. Please try again.';
  }
};

function watchCourseDesigns() {
  if (courseDesignsUnsub) return;
  courseDesignsUnsub = onSnapshot(collection(db, 'courseSettings'), (snap) => {
    courseDesignMap = {};
    snap.docs.forEach((d) => { courseDesignMap[d.id] = d.data().template || ''; });
    renderCoursePicker();
  }, (err) => console.error('Course design listener error:', err));
}

let allTopicCourseIds = new Map(); // courseId -> { count, uploadedByName, uploadedByLogoUrl, uploadedByRole }
let courseTopicsUnsub = null;
let lecturerProfileCache = new Map(); // uid -> { name, logoUrl } | null (null = looked up, nothing found)

// Cached so a course with several topics from the same lecturer only ever
// costs one extra read total, not one per topic.
async function getLecturerProfile(uid) {
  if (lecturerProfileCache.has(uid)) return lecturerProfileCache.get(uid);
  let profile = null;
  try {
    const snap = await getDoc(doc(db, 'lecturers', uid));
    if (snap.exists()) profile = { name: snap.data().name || null, logoUrl: snap.data().logoUrl || null };
  } catch (e) {
    console.warn('Lecturer profile lookup failed for', uid, e);
  }
  lecturerProfileCache.set(uid, profile);
  return profile;
}

function watchLectures() {
  if (lecturesUnsub) return;
  const institutionId = myInstitutionId();
  const q = institutionId
    ? query(collection(db, 'lectures'), where('institutionId', '==', institutionId), orderBy('createdAt', 'desc'), limit(100))
    : query(collection(db, 'lectures'), orderBy('createdAt', 'desc'), limit(100));

  lecturesUnsub = onSnapshot(q, (snap) => {
    allLectures = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCoursePicker();
    refreshAiTestCourseOptions();
  }, (err) => {
    console.error('Lecture listener error:', err);
    const grid = S('coursePickerGrid');
    if (grid) grid.innerHTML = `<p class="col-span-full text-center text-rose-500 font-bold py-12">Couldn't load courses. Please try again.</p>`;
  });
}

// Course tiles on "Who's Watching?" used to be built purely from
// allLectures, so a course with topics uploaded (courseTopics) but no
// lecture video yet had no tile at all — the content existed in Firestore
// but there was no path in the UI to click into course-lectures.htm and
// see it. This mirrors watchLectures()'s institutionId scoping so a
// topics-only course now gets a tile too, complete with the lecturer's
// face where available.
function watchCourseTopicsForPicker() {
  if (courseTopicsUnsub) return;
  const institutionId = myInstitutionId();
  const q = institutionId
    ? query(collection(db, 'courseTopics'), where('institutionId', '==', institutionId), orderBy('createdAt', 'desc'), limit(300))
    : query(collection(db, 'courseTopics'), orderBy('createdAt', 'desc'), limit(300));

  courseTopicsUnsub = onSnapshot(q, async (snap) => {
    const info = new Map();
    snap.docs.forEach((d) => {
      const data = d.data();
      const courseId = data.courseId;
      if (!courseId) return;
      const existing = info.get(courseId);
      if (existing) {
        existing.count += 1;
      } else {
        // Docs are already ordered by createdAt desc, so the first one we
        // see per courseId is the most recent topic — same "most recent
        // uploader is the tile's face" convention allLectures uses below.
        info.set(courseId, {
          count: 1,
          uploadedByName: data.uploadedByName || null,
          uploadedByLogoUrl: data.uploadedByLogoUrl || null,
          uploadedByRole: data.uploadedByRole || null,
          createdBy: data.createdBy || null
        });
      }
    });

    // Backfill identity for topics created before uploadedByName/
    // uploadedByLogoUrl existed on this collection — one lookup per
    // distinct lecturer (via the cache above), not per topic.
    const needsBackfill = [...info.values()].filter((v) => v.uploadedByRole === 'lecturer' && !v.uploadedByName && v.createdBy);
    if (needsBackfill.length) {
      await Promise.all(needsBackfill.map(async (v) => {
        const profile = await getLecturerProfile(v.createdBy);
        if (profile) {
          v.uploadedByName = profile.name;
          v.uploadedByLogoUrl = profile.logoUrl;
        }
      }));
    }

    allTopicCourseIds = info;
    renderCoursePicker();
  }, (err) => {
    // Non-fatal: lecture-backed courses still render fine without this,
    // just silently missing any topics-only courses until it recovers.
    console.warn('Course topics listener error (picker will still show lecture-backed courses):', err);
  });
}

// Chip row is built from what's actually in the current result set (plus
// the always-relevant uploader-role split), so it never shows a filter
// with zero matches, and stays useful whether there are 3 lectures or 300.
function renderLectureFilterRow() {
  const row = S('lectureFilterRow');
  if (!row) return;

  if (allLectures.length <= 4) {
    // Not worth a filter rail for a handful of cards — keep the page calm.
    row.classList.add('hidden');
    row.classList.remove('flex');
    return;
  }

  const courses = [...new Set(allLectures.map((l) => l.courseId).filter(Boolean))].sort();
  const institutions = [...new Set(allLectures.map((l) => l.institutionId).filter(Boolean))].sort();

  const chip = (label, active, onclick) => `
    <button onclick="${onclick}" class="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${active ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'}">${escapeHTML(label)}</button>`;

  let html = '';
  if (courses.length > 1) {
    html += chip('All courses', !lectureFilters.course, `window.setLectureFilter('course','')`);
    html += courses.map((c) => chip(c, lectureFilters.course === c, `window.setLectureFilter('course','${c.replace(/'/g, "\\'")}')`)).join('');
    html += `<span class="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1"></span>`;
  }
  if (institutions.length > 1) {
    html += chip('All institutions', !lectureFilters.institutionId, `window.setLectureFilter('institutionId','')`);
    html += institutions.map((i) => chip(i, lectureFilters.institutionId === i, `window.setLectureFilter('institutionId','${i.replace(/'/g, "\\'")}')`)).join('');
    html += `<span class="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1"></span>`;
  }
  html += chip('All uploaders', !lectureFilters.uploaderRole, `window.setLectureFilter('uploaderRole','')`);
  html += chip('Admin', lectureFilters.uploaderRole === 'head_admin', `window.setLectureFilter('uploaderRole','head_admin')`);
  html += chip('Lecturers', lectureFilters.uploaderRole === 'lecturer', `window.setLectureFilter('uploaderRole','lecturer')`);

  row.innerHTML = html;
  row.classList.remove('hidden');
  row.classList.add('flex');
}

window.setLectureFilter = (key, value) => {
  lectureFilters[key] = value;
  renderLectureFilterRow();
  renderLectureList(allLectures);
};

function emptyLectureState() {
  if (canUploadLectures()) {
    return `
      <div class="col-span-full flex flex-col items-center text-center py-16 px-6">
        <div class="w-16 h-16 rounded-3xl bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center mb-5">
          <i data-lucide="clapperboard" class="w-8 h-8 text-brand-600"></i>
        </div>
        <h4 class="font-black text-lg mb-2">Be the first to upload</h4>
        <p class="text-sm text-slate-400 font-bold max-w-sm mb-6">Once you or another lecturer/admin uploads a recording, it'll show up here — organized by course so students can find it fast.</p>
        <button onclick="window.openLectureUploadModal()" class="px-6 py-3 rounded-2xl bg-brand-600 text-white font-black uppercase tracking-widest text-[10px] flex items-center gap-2">
          <i data-lucide="upload" class="w-4 h-4"></i> Upload Your First Lecture
        </button>
      </div>`;
  }
  return `
    <div class="col-span-full flex flex-col items-center text-center py-16 px-6">
      <div class="w-16 h-16 rounded-3xl bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center mb-5">
        <i data-lucide="clapperboard" class="w-8 h-8 text-brand-600"></i>
      </div>
      <h4 class="font-black text-lg mb-2">No lectures yet</h4>
      <p class="text-sm text-slate-400 font-bold max-w-sm">Once lecturers or admins upload recordings, they'll appear here — organized by course, with the uploader clearly marked.</p>
    </div>`;
}

function uploaderBadge(l) {
  const isLecturer = l.uploadedByRole === 'lecturer';
  return `
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${isLecturer ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600' : 'bg-violet-50 dark:bg-violet-900/20 text-violet-600'}">
      <i data-lucide="${isLecturer ? 'graduation-cap' : 'shield-check'}" class="w-3 h-3"></i>
      ${escapeHTML(l.uploadedByName || (isLecturer ? 'Lecturer' : 'Geo-Books Admin'))}
    </span>`;
}

function filteredSortedLectures(lectures) {
  let filtered = lectures;
  if (lectureFilters.course) filtered = filtered.filter((l) => l.courseId === lectureFilters.course);
  if (lectureFilters.institutionId) filtered = filtered.filter((l) => l.institutionId === lectureFilters.institutionId);
  if (lectureFilters.uploaderRole) filtered = filtered.filter((l) => l.uploadedByRole === lectureFilters.uploaderRole);
  if (lectureSearchQ) filtered = filtered.filter((l) => String(l.title || '').toLowerCase().includes(lectureSearchQ));
  if (lectureSort === 'bookmarked') filtered = filtered.filter((l) => myBookmarks.has(l.id));

  filtered = [...filtered];
  if (lectureSort === 'most_watched') {
    filtered.sort((a, b) => (b.watchCount || 0) - (a.watchCount || 0));
  }
  // 'newest' — Firestore query is already ordered by createdAt desc.
  return filtered;
}

function renderLectureList(lectures) {
  const list = S('lectureList');
  if (!list) return;

  const filtered = filteredSortedLectures(lectures);

  if (!lectures.length) {
    list.innerHTML = emptyLectureState();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  if (!filtered.length) {
    list.innerHTML = `<p class="col-span-full text-center text-slate-400 font-bold py-12">No lectures match your search/filters.</p>`;
    return;
  }

  list.innerHTML = filtered.map((l) => {
    const watched = watchedLectureIds.has(l.id);
    const bookmarked = myBookmarks.has(l.id);
    return `
    <div class="premium-card overflow-hidden">
      <div class="aspect-video bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center relative">
        <i data-lucide="play-circle" class="w-12 h-12 text-white/90"></i>
        <button onclick="window.toggleBookmark('${l.id}')" class="absolute top-3 right-3 w-8 h-8 rounded-lg bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors" title="${bookmarked ? 'Remove from Watch Later' : 'Save to Watch Later'}">
          <i data-lucide="bookmark" class="w-4 h-4 ${bookmarked ? 'text-amber-400 fill-amber-400' : 'text-white/80'}"></i>
        </button>
        ${l.durationLabel ? `<span class="absolute bottom-3 right-3 px-2 py-1 rounded-lg bg-black/50 text-white text-[9px] font-black">${escapeHTML(l.durationLabel)}</span>` : ''}
        ${watched ? `<span class="absolute top-3 left-3 px-2 py-1 rounded-lg bg-emerald-500 text-white text-[9px] font-black flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i> Watched</span>` : ''}
      </div>
      <div class="p-6">
        <div class="flex items-center justify-between gap-2 mb-3">
          ${l.courseId ? `<span class="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[9px] font-black uppercase tracking-widest">${escapeHTML(l.courseId)}</span>` : '<span></span>'}
          <span class="text-[9px] text-slate-400 font-bold flex items-center gap-1"><i data-lucide="eye" class="w-3 h-3"></i> ${l.watchCount || 0}</span>
        </div>
        <h4 class="font-black text-sm mb-3 line-clamp-2">${escapeHTML(l.title)}</h4>
        <div class="mb-4">${uploaderBadge(l)}</div>
        <div class="flex items-center justify-between text-[9px] text-slate-400 font-bold mb-4">
          <span>${l.createdAt?.toDate ? l.createdAt.toDate().toLocaleDateString() : ''}</span>
          ${l.institutionId ? `<span class="truncate max-w-[50%]">${escapeHTML(l.institutionId)}</span>` : ''}
        </div>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <button onclick="window.openLecture('${l.id}', '${escapeHTML(safeUrl(l.fileUrl))}')" class="block py-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-center font-black uppercase text-[9px]">Watch / Open</button>
          <button onclick="window.openLectureComments('${l.id}')" class="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-center font-black uppercase text-[9px] flex items-center justify-center gap-1">
            <i data-lucide="message-square" class="w-3.5 h-3.5"></i> Comments
          </button>
        </div>
        <button onclick="window.markLectureWatched('${l.id}', ${!watched})" class="w-full py-2 rounded-xl text-[9px] font-black uppercase tracking-widest ${watched ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'}">
          ${watched ? '✓ Marked as watched' : 'Mark as watched'}
        </button>
      </div>
    </div>`;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Runs the server-side monthly view-quota check (see server.js's
// /api/lectures/:id/view) BEFORE actually opening the file. Deliberately
// not a plain <a href> anymore — that would navigate synchronously on
// click regardless of what an async onclick handler decides, so quota
// enforcement would be purely cosmetic. This function controls the open.
window.openLecture = async (lectureId, fileUrl) => {
  if (!currentUser) {
    toast('Sign in to watch lectures.', 'brand');
    return;
  }
  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/lectures/${lectureId}/view`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // 429 = quota exceeded this month, 403 = no active University Pass
      toast(data.error || 'Could not open this lecture right now.', 'error');
      return;
    }

    window.open(fileUrl, '_blank', 'noopener');
    window.markLectureWatched(lectureId, true);
    fetchLectureQuota(); // keep the persistent bar in sync with the view we just consumed

    if (typeof data.remaining === 'number' && data.remaining <= 5) {
      toast(`${data.remaining} lecture${data.remaining === 1 ? '' : 's'} left this month on your plan.`, 'brand');
    }
  } catch (e) {
    console.error('openLecture failed:', e);
    toast('Could not open this lecture. Check your connection and try again.', 'error');
  }
};


// watchCount in sync, in one transaction so the two never drift apart.
// Doc id is '<uid>_<lectureId>', which is also what firestore.rules checks
// ownership against.
window.markLectureWatched = async (lectureId, watched) => {
  if (!currentUser) return; // "Watch / Open" still opens the file for guests; just no tracking.
  const progressRef = doc(db, 'lectureProgress', `${currentUser.uid}_${lectureId}`);
  const lectureRef = doc(db, 'lectures', lectureId);
  try {
    await runTransaction(db, async (tx) => {
      const progressSnap = await tx.get(progressRef);
      const alreadyWatched = progressSnap.exists();
      if (watched && !alreadyWatched) {
        tx.set(progressRef, { uid: currentUser.uid, lectureId, watched: true, watchedAt: serverTimestamp() });
        tx.update(lectureRef, { watchCount: increment(1), updatedAt: serverTimestamp() });
      } else if (!watched && alreadyWatched) {
        tx.delete(progressRef);
        tx.update(lectureRef, { watchCount: increment(-1), updatedAt: serverTimestamp() });
      }
    });
  } catch (e) {
    console.warn('Failed to update watch progress:', e);
  }
};

// --- Comments / Q&A ---
window.openLectureComments = (lectureId) => {
  const l = allLectures.find((x) => x.id === lectureId);
  if (!l) return;
  const content = S('lectureCommentsContent');
  content.innerHTML = `
    <h3 class="text-lg font-black mb-1">${escapeHTML(l.title)}</h3>
    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">Comments &amp; Q&amp;A</p>
    ${currentUser ? `
      <div class="flex gap-2 mb-6">
        <input id="lectureCommentInput" type="text" placeholder="Ask a question or leave a comment..." class="flex-1 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none">
        <button onclick="window.submitLectureComment('${lectureId}')" class="px-5 py-3 rounded-2xl bg-brand-600 text-white text-[10px] font-black uppercase">Post</button>
      </div>` : `<p class="text-xs text-slate-400 font-bold mb-6">Sign in to join the discussion.</p>`}
    <div id="lectureCommentsList" class="space-y-4">
      <p class="text-xs text-slate-400 font-bold">Loading comments...</p>
    </div>
  `;
  S('lectureCommentsModal').classList.remove('hidden');
  S('lectureCommentsModal').classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
  watchLectureComments(lectureId);
};

window.closeLectureComments = () => {
  S('lectureCommentsModal').classList.add('hidden');
  S('lectureCommentsModal').classList.remove('flex');
  if (lectureCommentsUnsub) { lectureCommentsUnsub(); lectureCommentsUnsub = null; }
};

function watchLectureComments(lectureId) {
  if (lectureCommentsUnsub) { lectureCommentsUnsub(); lectureCommentsUnsub = null; }
  const list = S('lectureCommentsList');
  lectureCommentsUnsub = onSnapshot(
    query(collection(db, 'lectures', lectureId, 'comments'), orderBy('createdAt', 'asc'), limit(200)),
    (snap) => {
      if (!list) return;
      const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!comments.length) {
        list.innerHTML = `<p class="text-xs text-slate-400 font-bold">No comments yet — ask the first question.</p>`;
        return;
      }
      list.innerHTML = comments.map((c) => `
        <div class="flex gap-3">
          <div class="w-8 h-8 rounded-full bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center shrink-0 text-brand-600 font-black text-[10px]">
            ${escapeHTML((c.name || 'S')[0].toUpperCase())}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-black">${escapeHTML(c.name || 'Student')}</span>
              <span class="text-[9px] text-slate-400 font-bold">${c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : ''}</span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 font-medium break-words">${escapeHTML(c.text)}</p>
          </div>
        </div>`).join('');
    },
    (err) => {
      console.error('Comments listener error:', err);
      if (list) list.innerHTML = `<p class="text-xs text-rose-500 font-bold">Couldn't load comments.</p>`;
    }
  );
}

window.submitLectureComment = async (lectureId) => {
  if (!currentUser) { toast('Please sign in first.', 'error'); return; }
  const input = S('lectureCommentInput');
  const text = input.value.trim().slice(0, 500);
  if (!text) return;
  try {
    await addDoc(collection(db, 'lectures', lectureId, 'comments'), {
      uid: currentUser.uid,
      name: currentUserData?.displayName || currentUserData?.name || 'Student',
      text,
      createdAt: serverTimestamp()
    });
    input.value = '';
  } catch (e) {
    console.error('Comment failed:', e);
    toast(e.message || 'Failed to post comment.', 'error');
  }
};

// =====================================================================
// Public init — call once sections exist in the DOM (after app.js has
// rendered the page shell). Safe to call multiple times.
// =====================================================================
function initUniversitySectionContent() {
  renderHostelFinderShell();
  watchHostels();
  renderUniversityLecturesShell();
  renderLectureUploadControls();
  watchLectures();
  watchCourseTopicsForPicker();
  watchCourseDesigns();
  watchMyBookmarks();
  fetchLectureQuota();
  renderAssessmentsShell();
  watchAssessments();
  renderTimetableShell();
  watchTimetable();
  renderAnnouncementsShell();
  watchAnnouncements();
}

// ============ ASSESSMENTS (AI + manual) ============
// AI tests are generated fresh each time via the SAME pipeline ExamVault.htm
// already uses (aiChatCompletion Cloud Function) — nothing new to deploy on
// that front. Manual tests are pre-authored by lecturers/admin and stored
// in the `assessments` collection. Both hand off to cbt.htm using the exact
// same session contract, so the actual test-taking experience is identical
// either way — one shared player, two ways to populate it.
let allAssessments = [];

function refreshAiTestCourseOptions() {
  const select = $('#aiTestCourseSelect');
  if (!select) return; // Assessments tab hasn't been rendered/visited yet — fine, it'll pick up allLectures fresh next time renderAssessmentsShell runs
  const courses = [...new Set(allLectures.map((l) => l.courseId).filter(Boolean))].sort();
  if (!courses.length) return; // keep the 'General' fallback rather than emptying the select
  const current = select.value;
  select.innerHTML = courses.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if (courses.includes(current)) select.value = current;
}

function renderAssessmentsShell() {
  const el = $('#universityAssessments');
  if (!el) return;
  const courses = [...new Set(allLectures.map((l) => l.courseId).filter(Boolean))].sort();
  el.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8">
      <div class="mb-8">
        <h2 class="text-2xl font-black mb-1">Assessments</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">Test yourself with an AI-generated practice quiz, or take a test your lecturer built.</p>
      </div>

      <div class="premium-card p-6 mb-8">
        <h3 class="text-sm font-black uppercase tracking-widest text-violet-600 mb-4 flex items-center gap-2">
          <i data-lucide="sparkles" class="w-4 h-4"></i> AI Practice Test
        </h3>
        <div class="flex flex-wrap gap-3">
          <select id="aiTestCourseSelect" class="flex-1 min-w-[180px] px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
            ${courses.length ? courses.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('') : `<option value="General">General</option>`}
          </select>
          <select id="aiTestCountSelect" class="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
            <option value="10">10 Questions</option>
            <option value="20">20 Questions</option>
            <option value="30">30 Questions</option>
          </select>
          <button id="startAiTestBtn" onclick="window.startAiPracticeTest()" class="px-6 py-3 rounded-2xl elite-gradient text-white font-black uppercase tracking-widest text-xs flex items-center gap-2">
            <i data-lucide="zap" class="w-4 h-4"></i> Start AI Test
          </button>
        </div>
      </div>

      <div class="premium-card overflow-hidden">
        <div class="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-3">
          <h3 class="text-sm font-black uppercase tracking-widest text-slate-500">Lecturer & Admin Assessments</h3>
          <select id="assessmentTypeFilterAdmin" onchange="window.renderManualAssessmentsList()" class="px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-black uppercase outline-none">
            <option value="ALL">All Types</option>
            <option value="practice">Practice Tests</option>
            <option value="past_question">Past Questions</option>
          </select>
        </div>
        <div id="manualAssessmentsList" class="divide-y divide-slate-100 dark:divide-slate-800">
          <p class="p-12 text-center text-slate-400 font-bold">Loading...</p>
        </div>
      </div>
    </div>`;
  if (window.lucide) window.lucide.createIcons();
}

function watchAssessments() {
  onSnapshot(
    query(collection(db, 'assessments'), orderBy('createdAt', 'desc'), limit(100)),
    (snap) => {
      allAssessments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderManualAssessmentsList();
    },
    (err) => {
      console.warn('Assessments listener error:', err);
      const list = $('#manualAssessmentsList');
      if (list) list.innerHTML = `<p class="p-12 text-center text-rose-500 font-bold">Failed to load assessments.</p>`;
    }
  );
}

function renderManualAssessmentsList() {
  const list = $('#manualAssessmentsList');
  if (!list) return;
  const typeFilter = $('#assessmentTypeFilterAdmin')?.value || 'ALL';
  const filtered = allAssessments.filter((a) => typeFilter === 'ALL' || (a.contentType || 'practice') === typeFilter);

  if (!allAssessments.length) {
    list.innerHTML = `
      <div class="p-16 text-center">
        <i data-lucide="clipboard-list" class="w-10 h-10 mx-auto mb-3 text-slate-200"></i>
        <p class="text-slate-400 font-bold">No lecturer-made assessments yet.</p>
        <p class="text-xs text-slate-300 font-bold mt-1">Try the AI Practice Test above in the meantime.</p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  if (!filtered.length) {
    list.innerHTML = `<p class="p-12 text-center text-slate-400 font-bold">No matches for this filter.</p>`;
    return;
  }
  list.innerHTML = filtered.map((a) => `
    <div class="p-6 flex items-center justify-between gap-4 flex-wrap hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
      <div class="min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <p class="font-black truncate">${escapeHTML(a.title || 'Untitled assessment')}</p>
          <span class="text-[8px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${a.contentType === 'past_question' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}">${a.contentType === 'past_question' ? 'Past Q' : 'Practice'}</span>
        </div>
        <p class="text-[10px] text-slate-400 font-bold">
          ${escapeHTML(a.courseId || 'No course')} • ${(a.questions || []).length} questions
          • ${a.uploadedByRole === 'lecturer' ? 'By your lecturer' : 'By Head Admin'}
        </p>
      </div>
      <button onclick="window.startManualAssessment('${a.id}')" class="px-6 py-3 rounded-2xl bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-black uppercase tracking-widest text-[10px] shrink-0">Start Test</button>
    </div>`).join('');
  if (window.lucide) window.lucide.createIcons();
}
window.renderManualAssessmentsList = renderManualAssessmentsList;

window.startAiPracticeTest = async () => {
  if (!currentUser) { toast('Sign in to take a practice test.', 'brand'); return; }
  const course = $('#aiTestCourseSelect')?.value || 'General';
  const count = Number($('#aiTestCountSelect')?.value || 10);
  const btn = $('#startAiTestBtn');
  const originalLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Generating...`; if (window.lucide) window.lucide.createIcons(); }

  try {
    const { subject, questions } = await generateExamFromText({ topic: course, subject: course, count, intensity: 'standard' });
    launchCbtSession({ subject, questions, durationSec: Math.max(600, count * 60), examType: 'UNIVERSITY_AI' });
  } catch (e) {
    console.error('AI practice test generation failed:', e);
    toast(e.message || 'Could not generate a practice test right now.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; if (window.lucide) window.lucide.createIcons(); }
  }
};

window.startManualAssessment = (assessmentId) => {
  const a = allAssessments.find((x) => x.id === assessmentId);
  if (!a || !a.questions?.length) { toast('This assessment has no questions.', 'error'); return; }
  launchCbtSession({
    subject: a.title || a.courseId || 'Assessment',
    questions: a.questions,
    durationSec: a.durationSec || Math.max(600, a.questions.length * 60),
    examType: 'UNIVERSITY_MANUAL'
  });
};

// --- Bookmarks ("Watch Later") ---
let bookmarksUnsub = null;
function watchMyBookmarks() {
  if (!currentUser) return;
  if (bookmarksUnsub) bookmarksUnsub();
  bookmarksUnsub = onSnapshot(
    query(collection(db, 'lectureBookmarks'), where('uid', '==', currentUser.uid)),
    (snap) => {
      myBookmarks = new Set(snap.docs.map((d) => d.data().lectureId));
      renderLectureList(allLectures); // re-render so bookmark icons + the 'Bookmarked Only' filter stay in sync
    },
    (e) => console.warn('Bookmarks listener error:', e)
  );
}

window.toggleBookmark = async (lectureId) => {
  if (!currentUser) return;
  const bookmarkId = `${currentUser.uid}_${lectureId}`;
  const ref = doc(db, 'lectureBookmarks', bookmarkId);
  try {
    if (myBookmarks.has(lectureId)) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { uid: currentUser.uid, lectureId, createdAt: serverTimestamp() });
    }
  } catch (e) {
    console.error('Bookmark toggle failed:', e);
    toast('Could not update bookmark.', 'error');
  }
};

// --- Quota indicator ---
async function fetchLectureQuota() {
  const bar = document.getElementById('lectureQuotaBar');
  if (!bar || !currentUser) return;
  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/lectures/quota`, { headers: { Authorization: `Bearer ${idToken}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.unlimited) { bar.classList.add('hidden'); return; }

    const pct = data.quota ? Math.min(100, Math.round((data.used / data.quota) * 100)) : 0;
    const low = data.remaining <= 5;
    bar.className = 'mx-4 sm:mx-6 lg:mx-8 mb-6 premium-card p-4 flex items-center gap-4';
    bar.innerHTML = `
      <div class="flex-1">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-black ${low ? 'text-rose-500' : 'text-slate-500'}">${data.remaining} of ${data.quota} lecture views left this month</span>
          ${low ? `<span class="text-[9px] font-black uppercase text-rose-500">Running low</span>` : ''}
        </div>
        <div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full ${low ? 'bg-rose-500' : 'bg-brand-500'} rounded-full transition-all" style="width: ${pct}%"></div>
        </div>
      </div>`;
  } catch (e) {
    console.warn('Quota fetch failed:', e);
    bar.classList.add('hidden');
  }
}

// Kept as window.initUniversitySection for backward compatibility with
// anything that calls it directly, but now routes through the paywall
// check instead of rendering real content unconditionally.
window.initUniversitySection = () => {
  renderUniversityGate();
};

// ============ DEPARTMENT FILTER (Timetable + Announcements only) ============
// Deliberately not retrofitted onto Lectures/Assessments — those upload
// forms are already live in lecturer.html/main_admin.htm and adding a
// required field there would break what's already in production. Timetable
// and Announcements are brand-new collections, so `department` is part of
// their data model from the start. Stored in localStorage (device-level,
// not synced across a student's devices) rather than the Firestore user
// profile, to avoid touching the existing user-doc update rule whitelist.
const DEPT_STORAGE_KEY = 'geoBooksMyDepartment';
function getMyDepartment() { return localStorage.getItem(DEPT_STORAGE_KEY) || ''; }
function setMyDepartment(v) { v ? localStorage.setItem(DEPT_STORAGE_KEY, v) : localStorage.removeItem(DEPT_STORAGE_KEY); }

function departmentFilterHtml(selectId, departments) {
  const current = getMyDepartment();
  const opts = departments.length
    ? departments.map((d) => `<option value="${escapeHTML(d)}" ${d === current ? 'selected' : ''}>${escapeHTML(d)}</option>`).join('')
    : '';
  return `
    <select id="${selectId}" class="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none">
      <option value="">All Departments</option>
      ${opts}
    </select>`;
}

// ============ CGPA CALCULATOR (free — no auth, no Firestore) ============
// Nigerian 5-point scale (A=5 ... F=0), matching the standard most Nigerian
// universities use. Multi-semester so it computes a real cumulative CGPA,
// not just a single-semester GPA. Persisted to localStorage only — no
// server round-trip needed for a pure arithmetic tool.
const CGPA_STORAGE_KEY = 'geoBooksCgpaData';
const GRADE_POINTS = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
let cgpaData = loadCgpaData();

function loadCgpaData() {
  try {
    const raw = localStorage.getItem(CGPA_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('CGPA load failed:', e); }
  return { semesters: [{ name: 'Semester 1', courses: [{ name: '', units: 3, grade: 'A' }] }] };
}
function saveCgpaData() {
  try { localStorage.setItem(CGPA_STORAGE_KEY, JSON.stringify(cgpaData)); } catch (e) { console.warn('CGPA save failed:', e); }
}

function computeSemesterGpa(courses) {
  let totalUnits = 0, totalPoints = 0;
  courses.forEach((c) => {
    const units = Number(c.units) || 0;
    totalUnits += units;
    totalPoints += units * (GRADE_POINTS[c.grade] ?? 0);
  });
  return { gpa: totalUnits ? totalPoints / totalUnits : 0, totalUnits, totalPoints };
}

function computeCgpa() {
  let totalUnits = 0, totalPoints = 0;
  cgpaData.semesters.forEach((s) => {
    const { totalUnits: u, totalPoints: p } = computeSemesterGpa(s.courses);
    totalUnits += u; totalPoints += p;
  });
  return totalUnits ? totalPoints / totalUnits : 0;
}

function renderCgpaShell() {
  const el = $('#universityCgpa');
  if (!el) return;
  const cgpa = computeCgpa();
  el.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8">
      <div class="mb-8">
        <h2 class="text-2xl font-black mb-1">CGPA Calculator</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">Nigerian 5-point scale. Add every semester for a real cumulative CGPA.</p>
      </div>

      <div class="premium-card p-6 mb-8 bg-gradient-to-br from-brand-500 to-indigo-600 text-white">
        <p class="text-xs font-black uppercase tracking-widest text-white/70 mb-1">Cumulative CGPA</p>
        <h3 class="text-5xl font-black">${cgpa.toFixed(2)}</h3>
      </div>

      <div id="cgpaSemestersWrap" class="space-y-6"></div>

      <button onclick="window.addCgpaSemester()" class="w-full mt-6 py-4 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-400 font-black uppercase text-xs hover:border-brand-300 hover:text-brand-600 transition-colors flex items-center justify-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Add Semester
      </button>
    </div>`;
  renderCgpaSemesters();
  if (window.lucide) window.lucide.createIcons();
}

function renderCgpaSemesters() {
  const wrap = $('#cgpaSemestersWrap');
  if (!wrap) return;
  wrap.innerHTML = cgpaData.semesters.map((sem, si) => {
    const { gpa } = computeSemesterGpa(sem.courses);
    return `
    <div class="premium-card overflow-hidden">
      <div class="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
        <input value="${escapeHTML(sem.name)}" oninput="window.updateSemesterName(${si}, this.value)" class="font-black text-sm bg-transparent outline-none flex-1 min-w-0">
        <span class="text-xs font-black text-brand-600 shrink-0">GPA: ${gpa.toFixed(2)}</span>
        ${cgpaData.semesters.length > 1 ? `<button onclick="window.removeCgpaSemester(${si})" class="text-rose-400 hover:text-rose-600 shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
      </div>
      <div class="p-5 space-y-2">
        ${sem.courses.map((c, ci) => `
          <div class="flex items-center gap-2">
            <input placeholder="Course (optional)" value="${escapeHTML(c.name)}" oninput="window.updateCgpaCourse(${si},${ci},'name',this.value)" class="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none">
            <input type="number" min="0" max="9" value="${c.units}" oninput="window.updateCgpaCourse(${si},${ci},'units',this.value)" class="w-16 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none text-center" title="Credit units">
            <select onchange="window.updateCgpaCourse(${si},${ci},'grade',this.value)" class="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none">
              ${Object.keys(GRADE_POINTS).map((g) => `<option value="${g}" ${g === c.grade ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
            ${sem.courses.length > 1 ? `<button onclick="window.removeCgpaCourse(${si},${ci})" class="text-slate-300 hover:text-rose-500 shrink-0"><i data-lucide="x" class="w-4 h-4"></i></button>` : ''}
          </div>`).join('')}
        <button onclick="window.addCgpaCourse(${si})" class="text-[10px] font-black uppercase text-brand-600 hover:text-brand-700 mt-2 flex items-center gap-1"><i data-lucide="plus" class="w-3 h-3"></i> Add Course</button>
      </div>
    </div>`;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.addCgpaSemester = () => { cgpaData.semesters.push({ name: `Semester ${cgpaData.semesters.length + 1}`, courses: [{ name: '', units: 3, grade: 'A' }] }); saveCgpaData(); renderCgpaShell(); };
window.removeCgpaSemester = (si) => { cgpaData.semesters.splice(si, 1); saveCgpaData(); renderCgpaShell(); };
window.updateSemesterName = (si, val) => { cgpaData.semesters[si].name = val; saveCgpaData(); };
window.addCgpaCourse = (si) => { cgpaData.semesters[si].courses.push({ name: '', units: 3, grade: 'A' }); saveCgpaData(); renderCgpaSemesters(); };
window.removeCgpaCourse = (si, ci) => { cgpaData.semesters[si].courses.splice(ci, 1); saveCgpaData(); renderCgpaShell(); };
window.updateCgpaCourse = (si, ci, field, val) => {
  cgpaData.semesters[si].courses[ci][field] = field === 'units' ? val : val;
  saveCgpaData();
  // Only re-render the CGPA number + this semester's GPA line, not the whole
  // form, so typing in a course name field doesn't steal focus mid-keystroke.
  const cgpaHeader = $('#universityCgpa h3.text-5xl');
  if (cgpaHeader) cgpaHeader.textContent = computeCgpa().toFixed(2);
  const wrap = $('#cgpaSemestersWrap');
  if (wrap && field !== 'name') {
    const { gpa } = computeSemesterGpa(cgpaData.semesters[si].courses);
    const gpaLabel = wrap.children[si]?.querySelector('span.text-brand-600');
    if (gpaLabel) gpaLabel.textContent = `GPA: ${gpa.toFixed(2)}`;
  }
};

// ============ TIMETABLE + EXAM SCHEDULE ============
let allTimetableEntries = [];
let timetableView = 'class'; // 'class' | 'exam'

function renderTimetableShell() {
  const el = $('#universityTimetable');
  if (!el) return;
  const departments = [...new Set(allTimetableEntries.map((t) => t.department).filter(Boolean))].sort();
  el.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8">
      <div class="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 class="text-2xl font-black mb-1">Timetable & Exams</h2>
          <p class="text-sm text-slate-500 dark:text-slate-400">Weekly class schedule and upcoming exam dates for your courses.</p>
        </div>
        <div class="flex gap-2 items-center">
          ${departmentFilterHtml('timetableDeptFilter', departments)}
          <div class="flex rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
            <button onclick="window.setTimetableView('class')" class="px-4 py-2 rounded-xl text-xs font-black uppercase ${timetableView === 'class' ? 'bg-white dark:bg-slate-700 shadow' : 'text-slate-400'}">Classes</button>
            <button onclick="window.setTimetableView('exam')" class="px-4 py-2 rounded-xl text-xs font-black uppercase ${timetableView === 'exam' ? 'bg-white dark:bg-slate-700 shadow' : 'text-slate-400'}">Exams</button>
          </div>
        </div>
      </div>
      <div id="timetableList" class="space-y-3"></div>
    </div>`;
  $('#timetableDeptFilter')?.addEventListener('change', (e) => { setMyDepartment(e.target.value); renderTimetableList(); });
  renderTimetableList();
  if (window.lucide) window.lucide.createIcons();
}

window.setTimetableView = (v) => { timetableView = v; renderTimetableShell(); };

function watchTimetable() {
  onSnapshot(
    query(collection(db, 'timetableEntries'), orderBy('createdAt', 'desc'), limit(300)),
    (snap) => { allTimetableEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderTimetableShell(); },
    (err) => { console.warn('Timetable listener error:', err); const l = $('#timetableList'); if (l) l.innerHTML = `<p class="p-12 text-center text-rose-500 font-bold">Failed to load timetable.</p>`; }
  );
}

const DAY_ORDER = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
function renderTimetableList() {
  const list = $('#timetableList');
  if (!list) return;
  const dept = getMyDepartment();
  let filtered = allTimetableEntries.filter((t) => t.kind === timetableView && (!dept || t.department === dept));

  if (timetableView === 'class') {
    filtered = [...filtered].sort((a, b) => (DAY_ORDER[a.day] ?? 9) - (DAY_ORDER[b.day] ?? 9) || (a.startTime || '').localeCompare(b.startTime || ''));
  } else {
    filtered = [...filtered].sort((a, b) => (a.examDate || '').localeCompare(b.examDate || ''));
  }

  if (!filtered.length) {
    list.innerHTML = `
      <div class="premium-card p-16 text-center">
        <i data-lucide="calendar-x" class="w-10 h-10 mx-auto mb-3 text-slate-200"></i>
        <p class="text-slate-400 font-bold">No ${timetableView === 'class' ? 'classes' : 'exams'} scheduled${dept ? ` for ${escapeHTML(dept)}` : ''} yet.</p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  list.innerHTML = filtered.map((t) => `
    <div class="premium-card p-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-4 min-w-0">
        <div class="w-12 h-12 rounded-xl ${timetableView === 'exam' ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600'} flex flex-col items-center justify-center shrink-0 font-black text-[10px] uppercase">
          ${timetableView === 'class' ? escapeHTML(t.day || '') : (t.examDate ? new Date(t.examDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')}
        </div>
        <div class="min-w-0">
          <p class="font-black truncate">${escapeHTML(t.courseId || 'Course')}${t.department ? ` <span class="text-slate-300 font-bold">• ${escapeHTML(t.department)}</span>` : ''}</p>
          <p class="text-[10px] text-slate-400 font-bold">${escapeHTML(t.startTime || '')}${t.endTime ? '–' + escapeHTML(t.endTime) : ''} ${t.venue ? '• ' + escapeHTML(t.venue) : ''}</p>
        </div>
      </div>
    </div>`).join('');
  if (window.lucide) window.lucide.createIcons();
}

// ============ ANNOUNCEMENTS ============
let allAnnouncements = [];
const ANNOUNCEMENT_TYPE_STYLES = {
  fee: { label: 'Fees', class: 'bg-amber-50 text-amber-600' },
  registration: { label: 'Registration', class: 'bg-brand-50 text-brand-600' },
  exam: { label: 'Exam', class: 'bg-rose-50 text-rose-600' },
  general: { label: 'General', class: 'bg-slate-100 text-slate-500' }
};

function renderAnnouncementsShell() {
  const el = $('#universityAnnouncements');
  if (!el) return;
  const departments = [...new Set(allAnnouncements.map((a) => a.department).filter(Boolean))].sort();
  el.innerHTML = `
    <div class="p-4 sm:p-6 lg:p-8">
      <div class="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 class="text-2xl font-black mb-1">Announcements</h2>
          <p class="text-sm text-slate-500 dark:text-slate-400">Fee deadlines, registration windows, and other important dates.</p>
        </div>
        ${departmentFilterHtml('announcementsDeptFilter', departments)}
      </div>
      <div id="announcementsList" class="space-y-3"></div>
    </div>`;
  $('#announcementsDeptFilter')?.addEventListener('change', (e) => { setMyDepartment(e.target.value); renderAnnouncementsList(); });
  renderAnnouncementsList();
  if (window.lucide) window.lucide.createIcons();
}

function watchAnnouncements() {
  onSnapshot(
    query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(100)),
    (snap) => { allAnnouncements = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderAnnouncementsShell(); },
    (err) => { console.warn('Announcements listener error:', err); const l = $('#announcementsList'); if (l) l.innerHTML = `<p class="p-12 text-center text-rose-500 font-bold">Failed to load announcements.</p>`; }
  );
}

function renderAnnouncementsList() {
  const list = $('#announcementsList');
  if (!list) return;
  const dept = getMyDepartment();
  const filtered = allAnnouncements
    .filter((a) => !dept || a.department === dept)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  if (!filtered.length) {
    list.innerHTML = `
      <div class="premium-card p-16 text-center">
        <i data-lucide="megaphone" class="w-10 h-10 mx-auto mb-3 text-slate-200"></i>
        <p class="text-slate-400 font-bold">No announcements${dept ? ` for ${escapeHTML(dept)}` : ''} right now.</p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  list.innerHTML = filtered.map((a) => {
    const style = ANNOUNCEMENT_TYPE_STYLES[a.type] || ANNOUNCEMENT_TYPE_STYLES.general;
    const deadlineLabel = a.deadline ? new Date(a.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    return `
    <div class="premium-card p-6 ${a.pinned ? 'ring-2 ring-amber-300' : ''}">
      <div class="flex items-center gap-2 mb-2">
        ${a.pinned ? `<i data-lucide="pin" class="w-3.5 h-3.5 text-amber-500"></i>` : ''}
        <span class="text-[9px] font-black uppercase px-2.5 py-1 rounded-full ${style.class}">${style.label}</span>
        ${deadlineLabel ? `<span class="text-[9px] font-black uppercase text-rose-500 ml-auto">Deadline: ${deadlineLabel}</span>` : ''}
      </div>
      <p class="font-black mb-1">${escapeHTML(a.title || 'Untitled')}</p>
      <p class="text-sm text-slate-500 dark:text-slate-400 whitespace-pre-wrap">${escapeHTML(a.body || '')}</p>
    </div>`;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}


// consumers use — the section markup is static HTML already present in
// geo-books.htm, not injected later, so DOMContentLoaded is sufficient.
// NOTE: at this point auth state usually hasn't resolved yet, so this
// first call typically renders the gate/paywall state; onAuthStateChanged
// above re-runs renderUniversityGate() once currentUserData is known,
// which is what actually reveals the real section for paying users.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.initUniversitySection());
} else {
  window.initUniversitySection();
}


