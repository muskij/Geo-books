import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3007; // Railway assigns PORT at runtime; 3007 stays as local fallback
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Fail closed, not open: a misconfigured production deploy should refuse to
// start rather than silently run with permissive CORS / no bootstrap admin.
// (Dev/staging still gets the convenience fallbacks below.)
function requireProductionEnv(varName, description) {
  if (IS_PRODUCTION && !process.env[varName]) {
    console.error(
      `[fatal] ${varName} is required when NODE_ENV=production (${description}). ` +
      'Refusing to start with an insecure default.'
    );
    process.exit(1);
  }
}
requireProductionEnv('ALLOWED_ORIGINS', 'without it CORS reflects any origin');
if (IS_PRODUCTION && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    '[fatal] One of FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS is required ' +
    'when NODE_ENV=production. Refusing to start with auth-gated routes disabled.'
  );
  process.exit(1);
}

// If running behind a reverse proxy (Cloudflare, nginx, a PaaS load balancer),
// req.ip otherwise resolves to the proxy's IP for every request, which would
// make the rate limiter below treat all users as one client. Set
// TRUST_PROXY=1 in .env when deployed behind a proxy.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY));
}

// ---------------------------------------------------------------------------
// Firebase Admin init
// ---------------------------------------------------------------------------
// Provide credentials via ONE of:
//   1. GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json (env var, points at a file)
//   2. FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' (whole JSON inline in .env)
// Get this file from: Firebase Console -> Project Settings -> Service Accounts -> Generate new private key.
// NEVER commit this file or paste its contents into a public repo.
let firebaseReady = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    initializeApp({ credential: cert(serviceAccount) });
    firebaseReady = true;
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
    firebaseReady = true;
  } else {
    console.warn(
      '[firebase-admin] No credentials found (set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON). ' +
      'Auth-gated routes (/api/upload, /api/reports) will reject all requests until this is configured.'
    );
  }
} catch (e) {
  console.error('[firebase-admin] Failed to initialize:', e.message);
}

const db = firebaseReady ? getFirestore() : null;

// ---------------------------------------------------------------------------
// Admin identity
// ---------------------------------------------------------------------------
// Bootstrap-only fallback. This list previously had to be hand-synced with an
// identical copy in firestore.rules, which is a recipe for privilege drift —
// update one, forget the other, and admin access silently disagrees between
// the API and the database rules.
//
// The durable fix is Firebase custom claims (`admin: true` on the user's ID
// token): both server.js and firestore.rules can read the SAME claim from
// the SAME token, with no duplicated list anywhere. Use
// `scripts/set-admin-claim.js` to grant/revoke it.
//
// This hardcoded list is now sourced from an env var so it can be rotated
// without a code deploy, and only exists to bootstrap the very first admins
// before any custom claims are set. Once custom claims are in place for an
// account, this list can be emptied.
const HARDCODED_ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (HARDCODED_ADMIN_EMAILS.length === 0) {
  // Not fatal in production — an operator may have already migrated fully to
  // custom claims (scripts/set-admin-claim.js) and intentionally emptied
  // this list, which is the desired end state. Warn either way so an empty
  // list is always a deliberate choice, not an oversight.
  console.warn(
    '[admin] No ADMIN_EMAILS env var set. Bootstrap admin access via hardcoded ' +
    'email is disabled — grant access with scripts/set-admin-claim.js instead.'
  );
}

console.log(`Server initialized (Firebase Admin ${firebaseReady ? 'ENABLED' : 'DISABLED — see warning above'})`);

// ---------------------------------------------------------------------------
// Security headers (helmet)
// ---------------------------------------------------------------------------
// Sets a baseline of protective headers: X-Content-Type-Options: nosniff,
// X-Frame-Options / frame-ancestors (clickjacking), Strict-Transport-Security,
// Referrer-Policy, X-DNS-Prefetch-Control, and a few others.
//
// Content-Security-Policy, built from an actual audit of every
// index.htm/geo-books.htm/geo-books-phone.htm/main_admin.htm/seller.htm/
// AIScanVault.htm/ExamVault.htm script src=, link href=, iframe src=, and
// firebase-firestore/-auth/-functions/-analytics import target in this repo
// (grep -ohE '(src|href)="https?://[^"]+"' *.htm, plus the `from "https://
// www.gstatic.com/..."` imports in app.js/ai.js). Two known gaps, called out
// rather than silently worked around:
//
//   1. `script-src`/`style-src` need 'unsafe-inline'. This app binds nearly
//      every button with an inline onclick="..." attribute (hundreds of call
//      sites across geo-books.htm/geo-books-phone.htm) and a few inline
//      style="width: 0%"-style attributes get updated at runtime. A strict
//      nonce-based CSP would require migrating those onclick handlers to
//      addEventListener() first — that's a real follow-up, not done here.
//      'unsafe-inline' still leaves the rest of this policy doing real work:
//      it blocks loading a *script or stylesheet from an attacker-controlled
//      domain* (the #1 payload for a stored-XSS-to-account-takeover chain),
//      restricts where the page can send data (connect-src), and blocks
//      framing/plugins/base-uri tricks outright.
//   2. index.htm, main_admin.htm, AIScanVault.htm, and ExamVault.htm load
//      Tailwind's CDN runtime (`cdn.tailwindcss.com`) instead of the
//      compiled styles.css that geo-books.htm/geo-books-phone.htm already
//      use via `npm run build` (see package.json). Tailwind's own docs say
//      this script isn't meant for production — it recompiles CSS in the
//      browser on every load and injects the result via a runtime <style>
//      tag. It's allow-listed below so those four pages don't break, but
//      the actual fix is switching them to the same compiled styles.css
//      link tag the other two shells use, which would let this CSP drop
//      cdn.tailwindcss.com entirely.
//
// CLOUDFLARE_R2_PUBLIC_URL is read the same way ALLOWED_ORIGINS is above —
// pulled from env rather than hardcoded, since the actual bucket domain is
// deployment-specific and isn't (and shouldn't be) checked into this repo.
const r2PublicOrigin = (() => {
  try {
    return process.env.CLOUDFLARE_R2_PUBLIC_URL ? new URL(process.env.CLOUDFLARE_R2_PUBLIC_URL).origin : null;
  } catch {
    return null;
  }
})();
if (!r2PublicOrigin) {
  console.warn(
    '[csp] CLOUDFLARE_R2_PUBLIC_URL not set or invalid — uploaded images/files ' +
    'served from R2 will be blocked by img-src until this is set.'
  );
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Firebase SDK (ES module imports), Lucide icons, canvas-confetti,
      // Chart.js, GSAP, the Tailwind CDN runtime (see gap #2 above), and
      // Firebase Analytics' gtag shim, which it loads dynamically on first use.
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // see gap #1 above — inline onclick="" handlers
        'https://www.gstatic.com',
        'https://unpkg.com',
        'https://cdn.jsdelivr.net',
        'https://cdnjs.cloudflare.com',
        'https://cdn.tailwindcss.com', // see gap #2 above
        'https://www.googletagmanager.com',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // inline style="" attributes + Tailwind CDN runtime's injected <style>
        'https://fonts.googleapis.com',
        'https://cdn.tailwindcss.com',
      ],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: [
        "'self'",
        'data:', // inline SVG icons (manifest.json, some UI art)
        'blob:', // client-side image previews before upload
        'https://images.unsplash.com', // placeholder/demo listing images
        ...(r2PublicOrigin ? [r2PublicOrigin] : []),
      ],
      mediaSrc: ["'self'", 'https://assets.mixkit.co'], // UI sound effects
      connectSrc: [
        "'self'",
        'https://*.googleapis.com', // Firestore/Auth/Installations/etc.
        'https://*.cloudfunctions.net', // callable Cloud Functions (awardXp, aiChatCompletion, generateQuiz, ...)
        'https://www.google-analytics.com',
        'https://*.analytics.google.com',
        'https://region1.google-analytics.com',
        'https://www.jotform.com',
        'https://form.jotform.com', // AI quiz generator iframe's own connections
        ...(r2PublicOrigin ? [r2PublicOrigin] : []),
      ],
      frameSrc: ['https://www.jotform.com'], // AI quiz generator embed (see #jotformIframe in geo-books.htm/AIScanVault.htm)
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));


// origin: '*' is fine for read-only/public GETs, but this server accepts
// authenticated POST/PUT with bearer tokens, so it's worth scoping to known
// frontends. Set ALLOWED_ORIGINS="https://geo-books.app,https://www.geo-books.app"
// in .env. Falls back to reflecting any origin (with a startup warning) so
// local dev / preview deploys aren't broken if it's left unset.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn(
    '[cors] No ALLOWED_ORIGINS env var set — accepting requests from any origin. ' +
    'Set ALLOWED_ORIGINS in .env before deploying to production.'
  );
}

app.use(cors({
  origin: allowedOrigins.length === 0
    ? true // dev fallback: reflect request origin
    : (origin, cb) => {
        // Allow non-browser requests (no Origin header, e.g. curl/server-to-server)
        if (!origin) return cb(null, true);
        cb(null, allowedOrigins.includes(origin));
      }
}));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
// Sliding-window limiter. Two backends behind the same rateLimit({...}) call
// so uploadLimiter/reportLimiter below don't change either way:
//
//   - REDIS_URL set: uses Redis sorted sets (ZADD/ZREMRANGEBYSCORE/ZCARD in
//     an atomic pipeline) so the limit is shared correctly across every
//     server instance behind a load balancer — this is the fix for the
//     "in-memory only works for one instance" gap.
//   - REDIS_URL unset: falls back to the original in-memory Map. Still
//     correct for a single instance (and for local dev), just doesn't
//     survive a restart or coordinate across instances. A warning is
//     logged once so this is a deliberate choice, not a silent gap.
let redisClient = null;
if (process.env.REDIS_URL) {
  try {
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    redisClient.on('error', (err) => {
      // Log and keep going — requests fall through to "allow" below rather
      // than taking the whole API down because Redis hiccuped. A rate
      // limiter that's briefly too permissive during a Redis outage is a
      // much smaller problem than a rate limiter that 500s every request.
      console.error('[rate-limit] Redis error (requests will be allowed through until it recovers):', err.message);
    });
    console.log('[rate-limit] Using Redis-backed distributed rate limiting.');
  } catch (e) {
    console.error('[rate-limit] REDIS_URL is set but ioredis failed to load/connect — falling back to in-memory (single-instance only):', e.message);
    redisClient = null;
  }
} else {
  console.warn(
    '[rate-limit] No REDIS_URL set — using in-memory rate limiting. Fine for a ' +
    'single server instance; set REDIS_URL before running multiple instances ' +
    'behind a load balancer, or limits can be bypassed by hitting a different instance.'
  );
}

function rateLimit({ windowMs, max, message }) {
  // In-memory fallback (unchanged from before) — used when Redis isn't
  // configured, or per-request if a Redis call unexpectedly throws.
  const hits = new Map(); // key -> array of request timestamps
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((t) => t > cutoff);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }, windowMs).unref();

  function checkInMemory(key) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(key) || []).filter((t) => t > cutoff);
    if (timestamps.length >= max) return false;
    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  }

  async function checkRedis(key) {
    const redisKey = `ratelimit:${key}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    // Atomic pipeline: prune anything outside the window, count what's left,
    // and (optimistically) add this request — all in one round trip so two
    // concurrent requests from the same key can't both slip through a
    // check-then-act race.
    const pipeline = redisClient.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, cutoff);
    pipeline.zcard(redisKey);
    pipeline.zadd(redisKey, now, member);
    pipeline.pexpire(redisKey, windowMs);
    const results = await pipeline.exec();
    const countBeforeThisRequest = results[1][1];
    if (countBeforeThisRequest >= max) {
      // Over the limit — undo the optimistic add so this rejected request
      // doesn't itself count toward the window.
      await redisClient.zrem(redisKey, member).catch(() => {});
      return false;
    }
    return true;
  }

  return async (req, res, next) => {
    const key = req.user?.uid || req.ip;
    try {
      const allowed = redisClient ? await checkRedis(key) : checkInMemory(key);
      if (!allowed) {
        return res.status(429).json({ error: message || 'Too many requests, please try again later.' });
      }
      next();
    } catch (e) {
      // Redis call itself failed (network blip, etc.) — fail open via the
      // in-memory path rather than blocking every request in the meantime.
      console.error('[rate-limit] Redis check failed, falling back to in-memory for this request:', e.message);
      if (checkInMemory(key)) next();
      else res.status(429).json({ error: message || 'Too many requests, please try again later.' });
    }
  };
}

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,
  message: 'Too many uploads. Please wait a few minutes and try again.'
});

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many reports submitted. Please wait before submitting another.'
});

const questionImportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Too many import requests. Please wait before importing more questions.'
});

// Middleware
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files from project root

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
// Verifies the Firebase ID token sent as `Authorization: Bearer <token>`.
// Client side, get this token with: await firebase.auth().currentUser.getIdToken()
async function requireAuth(req, res, next) {
  if (!firebaseReady) {
    return res.status(503).json({ error: 'Server auth not configured. Contact the administrator.' });
  }
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <idToken> header' });
  }
  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    req.user = decoded; // { uid, email, ... }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Checks admin status: custom claim (canonical) -> hardcoded bootstrap email
// -> /admins/{uid} doc -> users/{uid}.role === 'admin'. Mirrors firestore.rules.
async function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    if (req.user.admin === true) return next(); // custom claim, canonical path

    if (req.user.email && HARDCODED_ADMIN_EMAILS.includes(req.user.email.toLowerCase())) return next();

    const adminDoc = await db.collection('admins').doc(req.user.uid).get();
    if (adminDoc.exists) return next();

    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (userDoc.exists && (userDoc.data().role || '').toLowerCase() === 'admin') return next();

    return res.status(403).json({ error: 'Admin privileges required' });
  } catch (e) {
    console.error('Admin check failed:', e);
    return res.status(500).json({ error: 'Admin check failed' });
  }
}

// Configure Cloudflare R2
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

// Configure multer for file uploads — capped size + memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB cap — covers lecture videos; revisit if longer recordings are common
  fileFilter: (req, file, cb) => {
    const allowed = /^image\/(jpeg|png|webp|gif)$|^application\/pdf$|^video\/(mp4|webm|quicktime|x-matroska)$/;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('UNSUPPORTED_FILE_TYPE'));
  }
});

// Strip anything that could be used for path traversal or to overwrite
// arbitrary keys in the bucket, and force every upload under the
// requesting user's own folder so one user can never clobber another's files.
function buildSafeKey(uid, requestedKey) {
  const cleaned = String(requestedKey || '')
    .replace(/\.\./g, '')
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._\-\/]/g, '_')
    .slice(0, 200);
  const filename = cleaned.split('/').pop() || `file-${Date.now()}`;
  const unique = crypto.randomBytes(6).toString('hex');
  return `uploads/${uid}/${Date.now()}-${unique}-${filename}`;
}

// Upload endpoint — now requires a valid Firebase ID token.
// Deliberately NOT behind requireAuth — this runs during signup, before
// the person has an account to authenticate with. Uses the Admin SDK,
// which bypasses firestore.rules entirely (that's fine and intentional
// here: it only ever returns a boolean, never any user's actual data,
// unlike a client-side query against `users` would if that collection
// were opened up for public reads just to support this one check).
app.get('/api/check-username', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Server not configured' });
    const username = String(req.query.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ error: 'username is required' });

    const snap = await db.collection('users').where('username', '==', username).limit(1).get();
    res.json({ available: snap.empty });
  } catch (error) {
    console.error('check-username error:', error);
    res.status(500).json({ error: 'Could not check username availability' });
  }
});


app.post('/api/upload', requireAuth, uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { destinationKey } = req.body;
    if (!destinationKey) {
      return res.status(400).json({ error: 'Missing destinationKey' });
    }

    const safeKey = buildSafeKey(req.user.uid, destinationKey);

    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: safeKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    });

    await r2Client.send(command);

    const fileUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${safeKey}`;
    console.log(`Upload successful by uid=${req.user.uid}: ${fileUrl}`);
    res.json({ url: fileUrl, key: safeKey });
  } catch (error) {
    console.error('Upload error:', error);
    if (error.message === 'UNSUPPORTED_FILE_TYPE') {
      return res.status(400).json({ error: 'Unsupported file type' });
    }
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Signed-upload-url endpoint — for large files (lecture videos) where
// proxying the full file through this server is slow and memory-heavy.
// The browser PUTs the raw file bytes directly to R2 using the returned
// URL; this server's RAM/bandwidth is never touched by the transfer itself.
// Use this for video; the existing /api/upload (server-proxied) route is
// still fine for small files like images/PDFs.
app.post('/api/upload/signed-url', requireAuth, uploadLimiter, async (req, res) => {
  try {
    const { destinationKey, contentType } = req.body;
    if (!destinationKey || !contentType) {
      return res.status(400).json({ error: 'Missing destinationKey or contentType' });
    }

    const safeKey = buildSafeKey(req.user.uid, destinationKey);

    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: safeKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 600 }); // 10 min to complete the PUT
    const fileUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${safeKey}`;

    res.json({ uploadUrl, key: safeKey, fileUrl });
  } catch (error) {
    console.error('Signed URL error:', error);
    res.status(500).json({ error: 'Could not generate upload URL', details: error.message });
  }
});


// --- Multipart upload (parallel chunks) — for larger files (lecture
// videos) where uploading multiple chunks at once is meaningfully faster
// than one serial stream. Flow: init -> get a signed URL per chunk (upload
// chunks in parallel from the browser) -> complete.
// Recommended chunk size: 10MB. Below ~20MB, single-PUT (/api/upload/signed-url)
// is simpler and the parallelism gain isn't worth the extra round trips.

app.post('/api/upload/multipart/init', requireAuth, uploadLimiter, async (req, res) => {
  try {
    const { destinationKey, contentType } = req.body;
    if (!destinationKey || !contentType) {
      return res.status(400).json({ error: 'Missing destinationKey or contentType' });
    }
    const safeKey = buildSafeKey(req.user.uid, destinationKey);

    const create = await r2Client.send(new CreateMultipartUploadCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: safeKey,
      ContentType: contentType,
    }));

    res.json({ uploadId: create.UploadId, key: safeKey });
  } catch (error) {
    console.error('Multipart init error:', error);
    res.status(500).json({ error: 'Could not start multipart upload', details: error.message });
  }
});

// Returns a signed PUT URL for one specific part number (1-indexed).
// Kept for backward compatibility — prefer /part-urls (batch) below for
// new clients, since calling this once per chunk both adds a full round
// trip of dead time before every PUT starts AND burns through
// uploadLimiter's 30-req/15min budget fast (a 500MB file at 10MB chunks is
// already 50 requests just for URLs, before init/complete — guaranteed
// 429s partway through on any file over ~280MB).
app.post('/api/upload/multipart/part-url', requireAuth, uploadLimiter, async (req, res) => {
  try {
    const { key, uploadId, partNumber } = req.body;
    if (!key || !uploadId || !partNumber) {
      return res.status(400).json({ error: 'Missing key, uploadId, or partNumber' });
    }
    if (!key.startsWith(`uploads/${req.user.uid}/`)) {
      return res.status(403).json({ error: 'Not authorized for this upload' });
    }

    const command = new UploadPartCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      PartNumber: Number(partNumber),
    });
    const url = await getSignedUrl(r2Client, command, { expiresIn: 600 });
    res.json({ url });
  } catch (error) {
    console.error('Multipart part-url error:', error);
    res.status(500).json({ error: 'Could not generate part URL', details: error.message });
  }
});

// Batch version — signs every part URL for the upload in one request/one
// rate-limit hit, so the browser can start PUTting chunks back-to-back
// with zero interstitial round trips instead of pausing before each part
// to ask for its URL. partNumbers is capped at 500 (matches the 500MB
// MAX_LECTURE_BYTES ceiling at the client's 10MB chunk size, with headroom).
app.post('/api/upload/multipart/part-urls', requireAuth, uploadLimiter, async (req, res) => {
  try {
    const { key, uploadId, partNumbers } = req.body;
    if (!key || !uploadId || !Array.isArray(partNumbers) || !partNumbers.length) {
      return res.status(400).json({ error: 'Missing key, uploadId, or partNumbers' });
    }
    if (partNumbers.length > 500) {
      return res.status(400).json({ error: 'Too many parts requested in one batch (max 500)' });
    }
    if (!key.startsWith(`uploads/${req.user.uid}/`)) {
      return res.status(403).json({ error: 'Not authorized for this upload' });
    }

    const urls = await Promise.all(partNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: Number(partNumber),
      });
      const url = await getSignedUrl(r2Client, command, { expiresIn: 600 });
      return { partNumber: Number(partNumber), url };
    }));

    res.json({ urls });
  } catch (error) {
    console.error('Multipart batch part-urls error:', error);
    res.status(500).json({ error: 'Could not generate part URLs', details: error.message });
  }
});

// Finalizes the upload once all chunks are in. `parts` = [{ PartNumber, ETag }, ...]
// in ascending PartNumber order — R2 rejects the request if any are missing
// or out of order.
app.post('/api/upload/multipart/complete', requireAuth, uploadLimiter, async (req, res) => {
  try {
    const { key, uploadId, parts } = req.body;
    if (!key || !uploadId || !Array.isArray(parts) || !parts.length) {
      return res.status(400).json({ error: 'Missing key, uploadId, or parts' });
    }
    if (!key.startsWith(`uploads/${req.user.uid}/`)) {
      return res.status(403).json({ error: 'Not authorized for this upload' });
    }

    await r2Client.send(new CompleteMultipartUploadCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));

    const fileUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${key}`;
    console.log(`Multipart upload completed by uid=${req.user.uid}: ${fileUrl}`);
    res.json({ url: fileUrl, key });
  } catch (error) {
    console.error('Multipart complete error:', error);
    res.status(500).json({ error: 'Could not complete upload', details: error.message });
  }
});

// Cleanup for abandoned uploads (user cancels, tab closes mid-upload).
app.post('/api/upload/multipart/abort', requireAuth, uploadLimiter, async (req, res) => {
  try {
    const { key, uploadId } = req.body;
    if (!key || !uploadId) return res.status(400).json({ error: 'Missing key or uploadId' });
    if (!key.startsWith(`uploads/${req.user.uid}/`)) {
      return res.status(403).json({ error: 'Not authorized for this upload' });
    }
    await r2Client.send(new AbortMultipartUploadCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
    }));
    res.json({ success: true });
  } catch (error) {
    console.error('Multipart abort error:', error);
    res.status(500).json({ error: 'Could not abort upload', details: error.message });
  }
});


// University Pass lecture-view quota — call once when a student actually
// opens a lecture (not on page load / list render, only on real open).
// Tracks distinct lecture IDs viewed per calendar month per user; reopening
// an already-counted lecture is always free. Admins are unlimited.
const TIER_LECTURE_QUOTA = { UNIVERSITY_PASS_30: 30, UNIVERSITY_PASS_70: 70 };

app.post('/api/lectures/:lectureId/view', requireAuth, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Server not configured' });
    const { lectureId } = req.params;
    const uid = req.user.uid;

    if (req.user.admin === true) return res.json({ allowed: true, remaining: null });

    const userSnap = await db.collection('users').doc(uid).get();
    const sub = userSnap.exists ? userSnap.data().subscription : null;
    const quota = sub && sub.verified && sub.status === 'active' ? TIER_LECTURE_QUOTA[sub.tier] : undefined;

    if (!quota) {
      return res.status(403).json({ error: 'An active University Pass is required to view lectures.' });
    }

    const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    const usageRef = db.collection('lectureUsage').doc(`${uid}_${period}`);

    const result = await db.runTransaction(async (tx) => {
      const usageSnap = await tx.get(usageRef);
      const data = usageSnap.exists ? usageSnap.data() : { viewedLectureIds: [] };
      const viewed = new Set(data.viewedLectureIds || []);

      if (viewed.has(lectureId)) {
        return { allowed: true, remaining: quota - viewed.size };
      }
      if (viewed.size >= quota) {
        return { allowed: false, remaining: 0 };
      }
      viewed.add(lectureId);
      tx.set(usageRef, {
        uid, period,
        viewedLectureIds: Array.from(viewed),
        count: viewed.size,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return { allowed: true, remaining: quota - viewed.size };
    });

    if (!result.allowed) {
      return res.status(429).json({
        error: `Monthly lecture limit reached (${quota}/mo). Upgrade to watch more this month.`
      });
    }
    res.json(result);
  } catch (error) {
    console.error('Lecture view quota error:', error);
    res.status(500).json({ error: 'Could not verify lecture access', details: error.message });
  }
});


const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// ---------------------------------------------------------------------------
// DMCA / Copyright Reports
// ---------------------------------------------------------------------------
// Matches the form fields in geo-books.htm's #reportModal:
// reportName, reportEmail, reportRelationship, reportDescription, plus
// the book being reported (bookId / bookTitle).

// 1. Create DMCA Report Endpoint (POST /api/reports)
app.post('/api/reports', requireAuth, reportLimiter, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firebase Admin not configured' });

  const { bookId, bookTitle, reporterName, reporterEmail, relationship, description } = req.body || {};

  if (!bookId || !reporterName || !reporterEmail || !relationship || !description) {
    return res.status(400).json({
      error: 'Missing required fields: bookId, reporterName, reporterEmail, relationship, description'
    });
  }
  if (!isValidEmail(reporterEmail)) {
    return res.status(400).json({ error: 'Invalid reporterEmail' });
  }
  if (String(description).length > 5000) {
    return res.status(400).json({ error: 'Description too long (max 5000 chars)' });
  }

  try {
    const docRef = await db.collection('reports').add({
      bookId: String(bookId),
      bookTitle: String(bookTitle || ''),
      reporterName: String(reporterName).slice(0, 200),
      reporterEmail: String(reporterEmail).slice(0, 200),
      relationship: String(relationship).slice(0, 100),
      description: String(description).slice(0, 5000),
      reporterId: req.user.uid,
      status: 'pending', // pending -> reviewing -> resolved | dismissed
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: docRef.id, status: 'pending' });
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({ error: 'Failed to create report', details: error.message });
  }
});

// 2. Update Report Status Endpoint (PUT /api/reports/:id/status) — admin only
app.put('/api/reports/:id/status', requireAuth, requireAdmin, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firebase Admin not configured' });

  const { status } = req.body || {};
  const allowedStatuses = ['pending', 'reviewing', 'resolved', 'dismissed'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(', ')}` });
  }

  try {
    const ref = db.collection('reports').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Report not found' });
    }
    await ref.update({
      status,
      reviewedBy: req.user.uid,
      updatedAt: FieldValue.serverTimestamp()
    });
    res.json({ id: req.params.id, status });
  } catch (error) {
    console.error('Update report status error:', error);
    res.status(500).json({ error: 'Failed to update report', details: error.message });
  }
});

// ---------------------------------------------------------------------------
// Question Bank Bulk Import — admin only
// ---------------------------------------------------------------------------
// Feeds main_admin.htm's "Question Bank Import" panel
// (window.submitQuestionImport). Writes straight to Firestore's `questions`
// collection via the Admin SDK, bypassing firestore.rules entirely (see the
// comment on `match /questions/{questionId}` in firestore.rules) so one large
// import isn't gated by per-doc rule evaluation against a client session.
//
// Expected shape per row (see main_admin.htm's
// window.downloadQuestionImportTemplate for the reference template):
//   { examType, subject, year, questionText, options: {A,B,C,D}, correct, explanation?, topic? }
const VALID_EXAM_TYPES = ['JAMB', 'WAEC', 'NECO', 'NABTEB', 'GENERAL'];
const VALID_OPTION_KEYS = ['A', 'B', 'C', 'D'];

function validateQuestionRow(row) {
  const errors = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { errors: ['Row is not an object'] };
  }

  const examType = String(row.examType || '').trim().toUpperCase();
  if (!examType) errors.push('examType is required');
  else if (!VALID_EXAM_TYPES.includes(examType)) errors.push(`examType must be one of: ${VALID_EXAM_TYPES.join(', ')}`);

  const subject = String(row.subject || '').trim();
  if (!subject) errors.push('subject is required');
  if (subject.length > 200) errors.push('subject too long (max 200 chars)');

  let year = null;
  if (row.year !== undefined && row.year !== null && row.year !== '') {
    year = Number(row.year);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 1980 || year > currentYear + 1) {
      errors.push('year must be a plausible integer year');
    }
  }

  const questionText = String(row.questionText || '').trim();
  if (!questionText) errors.push('questionText is required');
  if (questionText.length > 5000) errors.push('questionText too long (max 5000 chars)');

  const options = row.options && typeof row.options === 'object' && !Array.isArray(row.options) ? row.options : null;
  if (!options) {
    errors.push('options object ({A,B,C,D}) is required');
  } else {
    for (const key of VALID_OPTION_KEYS) {
      if (!String(options[key] || '').trim()) errors.push(`options.${key} is required`);
    }
  }

  const correct = String(row.correct || '').trim().toUpperCase();
  if (!VALID_OPTION_KEYS.includes(correct)) errors.push('correct must be one of: A, B, C, D');

  const explanation = row.explanation !== undefined && row.explanation !== null ? String(row.explanation) : '';
  if (explanation.length > 5000) errors.push('explanation too long (max 5000 chars)');

  const topic = row.topic !== undefined && row.topic !== null ? String(row.topic).trim() : '';
  if (topic.length > 200) errors.push('topic too long (max 200 chars)');

  // Optional — bulk-imported past questions can reference an already-hosted
  // image (a diagram/graph the question depends on). This is a URL only:
  // the bulk-JSON endpoint has no multipart file upload, so images must be
  // hosted first (e.g. via POST /api/upload, same as the Exam Builder's
  // single-question image button) and their resulting URL pasted in here.
  let questionImage = null;
  if (row.questionImage !== undefined && row.questionImage !== null && row.questionImage !== '') {
    const raw = String(row.questionImage).trim();
    if (raw.length > 2000) {
      errors.push('questionImage too long (max 2000 chars)');
    } else {
      try {
        const parsed = new URL(raw);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.push('questionImage must be an http(s) URL');
        } else {
          questionImage = raw;
        }
      } catch {
        errors.push('questionImage must be a valid URL');
      }
    }
  }

  if (errors.length) return { errors };

  return {
    doc: {
      examType,
      subject,
      year,
      questionText,
      options: {
        A: String(options.A).trim(),
        B: String(options.B).trim(),
        C: String(options.C).trim(),
        D: String(options.D).trim()
      },
      correct,
      explanation: explanation.trim(),
      topic,
      questionImage,
      isActive: true
    }
  };
}

app.post('/api/questions/bulk-import', requireAuth, requireAdmin, questionImportLimiter, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firebase Admin not configured' });

  const { questions } = req.body || {};
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty "questions" array' });
  }
  if (questions.length > 1000) {
    return res.status(400).json({ error: 'Max 1000 questions per import — split into smaller batches' });
  }

  const validationErrors = [];
  const validDocs = [];

  questions.forEach((row, index) => {
    const { doc: docData, errors } = validateQuestionRow(row);
    if (errors) {
      validationErrors.push({ index, errors });
    } else {
      validDocs.push(docData);
    }
  });

  if (validDocs.length === 0) {
    return res.status(400).json({
      error: 'No valid questions to import',
      imported: 0,
      skipped: validationErrors.length,
      validationErrors
    });
  }

  try {
    // Firestore batched writes cap at 500 ops — chunk so imports above that
    // still succeed instead of throwing on the whole request.
    const CHUNK_SIZE = 450;
    let imported = 0;
    for (let i = 0; i < validDocs.length; i += CHUNK_SIZE) {
      const chunk = validDocs.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      chunk.forEach((docData) => {
        const ref = db.collection('questions').doc();
        batch.set(ref, {
          ...docData,
          createdBy: req.user.uid,
          createdAt: FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
      imported += chunk.length;
    }

    console.log(`[questions/bulk-import] uid=${req.user.uid} imported=${imported} skipped=${validationErrors.length}`);
    res.status(201).json({ imported, skipped: validationErrors.length, validationErrors });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({ error: 'Bulk import failed', details: error.message });
  }
});

// ============================================================
// MIGRATED FROM CLOUD FUNCTIONS — moved here so none of this
// requires the Blaze plan / GCP billing. Firestore + Auth work
// fine on Spark; only Cloud Functions itself needed billing.
// Same logic as functions/index.js's aiChatCompletion, generateQuiz,
// awardXp, and confirmEscrowPayment — just Express routes now,
// using the requireAuth middleware already defined above instead
// of onCall()'s context.auth.
// ============================================================

// --- AI: chat completion (was aiChatCompletion) ---
app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service not configured on server' });

  const { messages, temperature, maxTokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: Number(temperature) || 0.7,
        max_tokens: Number(maxTokens) || 2000
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('aiChatCompletion OpenAI error:', response.status, errBody);
      return res.status(502).json({ error: 'AI provider error' });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    res.json({ content });
  } catch (error) {
    console.error('AI Chat Error:', error);
    res.status(500).json({ error: 'AI chat failed' });
  }
});

// --- AI: quiz generation from document text (was generateQuiz) ---
app.post('/api/ai/generate-quiz', requireAuth, async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service not configured on server' });

  const { text, count, intensity, style } = req.body || {};
  const safeCount = Math.max(5, Math.min(50, Math.floor(Number(count) || 20)));
  const safeIntensity = intensity === 'easy' || intensity === 'hard' ? intensity : 'standard';

  const systemPrompt = [
    'You are a world-class exam creator for Nigerian students.',
    `Target: ${safeIntensity} difficulty CBT questions.`,
    'Extract core academic concepts, definitions, and facts from the provided document text.',
    'Return ONLY valid JSON with this exact structure:',
    '{ "subject": string, "questions": [ { "q": string, "opts": [string,string,string,string], "correct": 0|1|2|3, "exp": string } ] }'
  ].join('\n');

  const userPrompt = `Document Text:\n${String(text || '').slice(0, 50000)}\n\nGenerate ${safeCount} questions. Style: ${style || 'balanced'}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2500,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('generateQuiz OpenAI error:', response.status, errBody);
      return res.status(502).json({ error: 'AI provider error' });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'Empty response from AI' });
    res.json(JSON.parse(content));
  } catch (error) {
    console.error('AI Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate quiz content' });
  }
});

// --- XP awarding (was awardXp) ---
const RANK_TIERS = [
  { rank: 1, title: 'Scholar', minXp: 0, reward: 'Starter Badge' },
  { rank: 2, title: 'Expert', minXp: 1000, reward: 'Custom Profile Colors' },
  { rank: 3, title: 'Pro', minXp: 3500, reward: 'Verified Checkmark' },
  { rank: 4, title: 'Master', minXp: 8500, reward: '10% Marketplace Discount' },
  { rank: 5, title: 'Elite', minXp: 18000, reward: 'Early Access to New Features' },
  { rank: 6, title: 'Legend', minXp: 40000, reward: 'Monthly Data Bundle / Leaderboard' }
];

function calculateRank(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  let current = RANK_TIERS[0];
  for (const tier of RANK_TIERS) if (safeXp >= tier.minXp) current = tier;
  const currentIndex = RANK_TIERS.findIndex((t) => t.rank === current.rank);
  const next = currentIndex >= 0 ? RANK_TIERS[currentIndex + 1] : null;
  const currentThreshold = current.minXp;
  const nextThreshold = next ? next.minXp : null;
  const progressPct = nextThreshold === null ? 100 :
    Math.max(0, Math.min(100, ((safeXp - currentThreshold) / Math.max(1, nextThreshold - currentThreshold)) * 100));
  const xpToNext = nextThreshold === null ? 0 : Math.max(0, nextThreshold - safeXp);
  return { xp: safeXp, rank: current.rank, title: current.title, reward: current.reward, nextRank: next ? next.rank : null, nextTitle: next ? next.title : null, nextThreshold, currentThreshold, xpToNext, progressPct };
}

app.post('/api/xp/award', requireAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Server not configured' });
  const uid = req.user.uid;
  const amount = Math.floor(Number(req.body?.amount) || 0);
  const reason = String(req.body?.reason || '').trim();

  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Invalid XP amount' });
  if (amount < 0) return res.status(400).json({ error: 'Negative XP not allowed' });
  if (amount > 500) return res.status(400).json({ error: 'XP amount too large' });

  const userRef = db.collection('users').doc(uid);

  try {
    const res_ = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() || {} : {};
      const oldXp = Number(data.xp) || 0;
      const oldRankTitle = String(data.rank_title || '');
      const newXp = Math.max(0, oldXp + amount);
      const newRank = calculateRank(newXp);

      tx.set(userRef, { xp: newXp, level: newRank.rank, rank_title: newRank.title, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      const eventRef = userRef.collection('xpEvents').doc();
      tx.set(eventRef, { delta: amount, reason: reason || null, createdAt: FieldValue.serverTimestamp() });

      return { oldXp, newXp, oldRankTitle, newRank };
    });

    const rankUp = !!res_.oldRankTitle && res_.newRank.title && res_.oldRankTitle !== res_.newRank.title;
    res.json({ ...res_, rankUp });
  } catch (error) {
    console.error('awardXp error:', error);
    res.status(500).json({ error: 'Could not award XP' });
  }
});

// --- Escrow payment confirmation (was confirmEscrowPayment) ---
app.post('/api/escrow/confirm', requireAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Server not configured' });
  const uid = req.user.uid;
  const itemId = String(req.body?.itemId || '').trim();
  const price = Math.floor(Number(req.body?.price) || 0);

  if (!itemId) return res.status(400).json({ error: 'Missing itemId' });
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Invalid price' });

  const itemRef = db.collection('marketItems').doc(itemId);
  const payRef = db.collection('escrowPayments').doc();

  try {
    const result = await db.runTransaction(async (tx) => {
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists) throw new Error('NOT_FOUND');
      const item = itemSnap.data() || {};
      const expectedPrice = Math.floor(Number(item.price) || 0);
      if (expectedPrice !== price) throw new Error('PRICE_MISMATCH');

      tx.set(payRef, {
        buyerId: uid, itemId, price,
        sellerId: String(item.sellerId || '').trim() || null,
        createdAt: FieldValue.serverTimestamp(),
        status: 'recorded'
      });

      return { ok: true, paymentId: payRef.id };
    });
    res.json(result);
  } catch (error) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ error: 'Item not found' });
    if (error.message === 'PRICE_MISMATCH') return res.status(412).json({ error: 'Price mismatch' });
    console.error('confirmEscrowPayment error:', error);
    res.status(500).json({ error: 'Could not confirm payment' });
  }
});

// --- Tutor course purchase (pay-per-course, 30% platform cut) ---
// Mirrors /api/escrow/confirm's "record now, admin verifies later" shape —
// same as how a University Pass subscription starts unverified until an
// admin confirms payment in main_admin.htm. Purchase doc id is
// `${uid}_${courseId}` so firestore.rules and tutor-course-viewer.html's
// ownership check can do a single direct doc lookup instead of a query.
app.post('/api/tutor-courses/:courseId/purchase', requireAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Server not configured' });
  const uid = req.user.uid;
  const { courseId } = req.params;
  const price = Math.floor(Number(req.body?.price) || 0);
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Invalid price' });

  const courseRef = db.collection('tutorCourses').doc(courseId);
  const purchaseRef = db.collection('tutorPurchases').doc(`${uid}_${courseId}`);

  try {
    const result = await db.runTransaction(async (tx) => {
      const courseSnap = await tx.get(courseRef);
      if (!courseSnap.exists) throw new Error('NOT_FOUND');
      const course = courseSnap.data() || {};
      const expectedPrice = Math.floor(Number(course.price) || 0);
      if (expectedPrice !== price) throw new Error('PRICE_MISMATCH');

      const existing = await tx.get(purchaseRef);
      if (existing.exists && existing.data().status === 'verified') {
        return { ok: true, alreadyOwned: true };
      }

      const platformCut = Math.round(price * 0.3);
      const tutorCut = price - platformCut;

      tx.set(purchaseRef, {
        buyerId: uid,
        tutorCourseId: courseId,
        tutorId: course.tutorId || null,
        price, platformCut, tutorCut,
        status: 'recorded',
        createdAt: FieldValue.serverTimestamp()
      });
      return { ok: true, paymentId: purchaseRef.id };
    });
    res.json(result);
  } catch (error) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ error: 'Course not found' });
    if (error.message === 'PRICE_MISMATCH') return res.status(412).json({ error: 'Price mismatch' });
    console.error('tutor course purchase error:', error);
    res.status(500).json({ error: 'Could not record purchase' });
  }
});

// Error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server');
});

server.on('error', (err) => {
  console.error('Server error:', err);
});