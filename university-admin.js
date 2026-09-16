/**
 * Geo-Books Admin — University Section (Hostel Finder CRUD)
 *
 * Loaded as its own <script type="module"> in main_admin.htm, same
 * pattern as main_admin.htm's existing inline <script type="module">
 * blocks and as student-facing university.js. Firebase is re-initialized
 * via getApps() dedupe (same trick ai-vault-shared.js and university.js
 * already use), so this stays fully decoupled from main_admin.htm's own
 * inline script variables (db, auth, escapeHTML, etc. there are
 * block-scoped and not accessible from an external module).
 *
 * Writes are gated by firestore.rules' `match /hostels/{hostelId} {
 * allow write: if isAdmin(); }` — this file is a UI convenience only,
 * exactly like every other admin panel screen in this project.
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  getFirestore, collection, query, orderBy, onSnapshot,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

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

const escapeHTML = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same R2-via-server pipeline as main_admin.htm's own dispatchAssetToCloudflare
// and university.js's uploadAsset — duplicated here rather than imported
// because main_admin.htm defines its copy inside a non-module-scoped inline
// <script>, not as an importable export.
const ADMIN_API_BASE_URL = window.GEO_BOOKS_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3007'
    : '');

async function uploadAsset(file, destinationKey) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in as an admin to upload files.');
  const idToken = await user.getIdToken();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('destinationKey', destinationKey);
  const response = await fetch(`${ADMIN_API_BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: formData
  });
  if (!response.ok) {
    let msg = `Upload failed (${response.status})`;
    try { msg = (await response.json()).error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return (await response.json()).url;
}

let hostelsUnsub = null;
let allHostels = [];
let editingHostelId = null;

function csvToArray(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderHostelsAdminList() {
  const container = document.getElementById('adminHostelsList');
  if (!container) return;
  if (!allHostels.length) {
    container.innerHTML = `<p class="p-20 text-center text-slate-400 font-bold col-span-full">No hostels listed yet.</p>`;
    return;
  }
  container.innerHTML = allHostels.map((h) => `
    <div class="premium-card p-6">
      <div class="aspect-[4/3] rounded-2xl bg-slate-100 mb-4 overflow-hidden relative">
        <img src="${escapeHTML(h.images?.[0] || `https://picsum.photos/seed/${h.id}/500/375`)}" class="w-full h-full object-cover">
        ${h.verified ? `<span class="absolute top-3 right-3 px-3 py-1 rounded-full bg-emerald-500 text-white text-[9px] font-black uppercase">Verified</span>` : ''}
      </div>
      <p class="text-[10px] font-black uppercase text-brand-600 mb-1">${escapeHTML(h.institutionName || 'No institution')}</p>
      <h4 class="text-sm font-black truncate mb-1">${escapeHTML(h.name)}</h4>
      <p class="text-[10px] text-slate-400 font-bold truncate mb-6">₦${Number(h.priceMin || 0).toLocaleString()}${h.priceMax ? ' – ₦' + Number(h.priceMax).toLocaleString() : ''}</p>
      <div class="flex gap-2">
        <button onclick="window.openHostelAdminModal('${h.id}')" class="flex-1 py-3 rounded-xl bg-slate-50 text-slate-900 text-center font-black uppercase text-[9px] hover:bg-slate-100">Edit</button>
        <button onclick="window.toggleHostelVerified('${h.id}', ${!h.verified})" class="flex-1 py-3 rounded-xl bg-brand-50 text-brand-600 text-center font-black uppercase text-[9px] hover:bg-brand-100">${h.verified ? 'Unverify' : 'Verify'}</button>
        <button onclick="window.deleteHostelAdmin('${h.id}')" class="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div>
    </div>`).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.initHostelsAdmin = () => {
  if (hostelsUnsub) return;
  hostelsUnsub = onSnapshot(query(collection(db, 'hostels'), orderBy('createdAt', 'desc')), (snap) => {
    allHostels = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderHostelsAdminList();
  }, (err) => {
    console.error('Hostels admin listener error:', err);
    const container = document.getElementById('adminHostelsList');
    if (container) container.innerHTML = `<p class="p-20 text-center text-rose-500 font-bold col-span-full">Failed to load hostels.</p>`;
  });
};

window.openHostelAdminModal = (id) => {
  editingHostelId = id || null;
  const h = id ? allHostels.find((x) => x.id === id) : null;
  document.getElementById('hostelNameInput').value = h?.name || '';
  document.getElementById('hostelInstitutionNameInput').value = h?.institutionName || '';
  document.getElementById('hostelInstitutionIdInput').value = h?.institutionId || '';
  document.getElementById('hostelAddressInput').value = h?.address || '';
  document.getElementById('hostelPriceMinInput').value = h?.priceMin ?? '';
  document.getElementById('hostelPriceMaxInput').value = h?.priceMax ?? '';
  document.getElementById('hostelGenderInput').value = h?.gender || 'mixed';
  document.getElementById('hostelRoomTypesInput').value = (h?.roomTypes || []).join(', ');
  document.getElementById('hostelAmenitiesInput').value = (h?.amenities || []).join(', ');
  document.getElementById('hostelDistanceInput').value = h?.distanceFromCampus || '';
  document.getElementById('hostelPhoneInput').value = h?.contactPhone || '';
  document.getElementById('hostelWhatsappInput').value = h?.contactWhatsapp || '';
  document.getElementById('hostelVerifiedInput').checked = Boolean(h?.verified);
  document.getElementById('hostelImagesInput').value = '';
  document.getElementById('hostelAdminStatus').textContent = '';
  document.getElementById('hostelAdminModal').classList.replace('hidden', 'flex');
};

window.closeHostelAdminModal = () => {
  document.getElementById('hostelAdminModal').classList.replace('flex', 'hidden');
  editingHostelId = null;
};

window.toggleHostelVerified = async (id, verified) => {
  try {
    await updateDoc(doc(db, 'hostels', id), { verified, updatedAt: serverTimestamp() });
  } catch (e) {
    alert(`Failed to update: ${e.message}`);
  }
};

window.deleteHostelAdmin = async (id) => {
  if (!confirm('Delete this hostel listing?')) return;
  try {
    await deleteDoc(doc(db, 'hostels', id));
  } catch (e) {
    alert(`Failed to delete: ${e.message}`);
  }
};

window.saveHostelAdmin = async () => {
  const status = document.getElementById('hostelAdminStatus');
  const name = document.getElementById('hostelNameInput').value.trim();
  const institutionName = document.getElementById('hostelInstitutionNameInput').value.trim();
  const institutionId = document.getElementById('hostelInstitutionIdInput').value.trim();
  const address = document.getElementById('hostelAddressInput').value.trim();
  const priceMin = Number(document.getElementById('hostelPriceMinInput').value) || 0;
  const priceMax = Number(document.getElementById('hostelPriceMaxInput').value) || null;
  const gender = document.getElementById('hostelGenderInput').value;
  const roomTypes = csvToArray(document.getElementById('hostelRoomTypesInput').value);
  const amenities = csvToArray(document.getElementById('hostelAmenitiesInput').value);
  const distanceFromCampus = document.getElementById('hostelDistanceInput').value.trim();
  const contactPhone = document.getElementById('hostelPhoneInput').value.trim();
  const contactWhatsapp = document.getElementById('hostelWhatsappInput').value.trim();
  const verified = document.getElementById('hostelVerifiedInput').checked;
  const files = Array.from(document.getElementById('hostelImagesInput').files || []);

  if (!name || !institutionName) {
    status.textContent = 'Hostel name and institution name are required.';
    return;
  }

  status.textContent = editingHostelId ? 'Saving changes...' : 'Creating listing...';
  try {
    const hostelId = editingHostelId || crypto.randomUUID();
    let images = editingHostelId ? (allHostels.find((h) => h.id === editingHostelId)?.images || []) : [];

    if (files.length) {
      status.textContent = `Uploading ${files.length} image(s)...`;
      const uploaded = await Promise.all(
        files.map((f, i) => uploadAsset(f, `hostels/${hostelId}/${Date.now()}-${i}-${f.name}`))
      );
      images = [...images, ...uploaded];
    }

    const payload = {
      name, institutionName, institutionId: institutionId || null, address,
      priceMin, priceMax, gender, roomTypes, amenities, distanceFromCampus,
      contactPhone, contactWhatsapp, verified, images,
      updatedAt: serverTimestamp()
    };

    if (editingHostelId) {
      await updateDoc(doc(db, 'hostels', editingHostelId), payload);
    } else {
      await addDoc(collection(db, 'hostels'), {
        ...payload,
        createdBy: auth.currentUser?.uid || null,
        createdAt: serverTimestamp()
      });
    }

    status.textContent = 'Saved.';
    window.closeHostelAdminModal();
  } catch (e) {
    console.error('Save hostel failed:', e);
    status.textContent = e.message || 'Failed to save. Please try again.';
  }
};
