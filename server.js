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
      // pdf.js (renderPdfPagesAsImages in ai.js, used by both the Past Papers
      // section and the older PDF-to-text flow) creates its parsing worker
      // from a blob: URL. Helmet has no default for worker-src, and per spec
      // an unset worker-src falls back to scriptSrc — which doesn't include
      // 'blob:', so the browser silently blocked the worker and pdf.js fell
      // back to parsing on the main thread ("Setting up fake worker" in the
      // console). Not fatal, but slower and worth fixing directly.
      workerSrc: ["'self'", 'blob:'],
      // Helmet's default for this directive is 'none' and does NOT inherit
      // from scriptSrc above — it has to be set separately, or every inline
      // onclick="" handler in the app (hundreds of call sites, see gap #1)
      // gets silently blocked by the browser even though scriptSrc already
      // allows 'unsafe-inline'. Confirmed missing: this broke all button
      // clicks in production until added.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // inline style="" attributes + Tailwind CDN runtime's injected <style>
        'https://fonts.googleapis.com',
        'https://cdn.tailwindcss.com',
        'https://cdn.jsdelivr.net', // KaTeX's stylesheet (math rendering — see ai.js/cbt.js/main_admin.htm)
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
        'https://cdn.jsdelivr.net', // KaTeX ships its own .woff2 math fonts from the same CDN path as its CSS
      ],
      imgSrc: [
        "'self'",
        'data:', // inline SVG icons (manifest.json, some UI art)
        'blob:', // client-side image previews before upload
        'https://images.unsplash.com', // placeholder/demo listing images
        'https://i.ytimg.com', // YouTube thumbnails (AI Subjects video picker)
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
      frameSrc: ['https://www.jotform.com', 'https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://drive.google.com'], // YouTube/Drive = AI Subjects lesson videos & voice notes (subject-lesson.htm); jotform = AI quiz generator embed (see #jotformIframe in geo-books.htm/AIScanVault.htm)
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
// Default express.json() caps request bodies at 100kb — fine for every other
// route here, but /api/ai/parse-past-paper sends 1-4 base64-encoded page
// screenshots per call (renderPdfPagesAsImages in ai.js), each comfortably
// several hundred KB to a couple MB. Every single batch was hitting a 413
// before this fix — a 70-page PDF produced zero extracted questions, not a
// partial result, since 100kb doesn't even fit one page image alone.
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname, { index: 'index.htm' })); // Serve static files from project root; landing page is index.htm, not the express.static default of index.html

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
// ---------------------------------------------------------------------------
// AI generation daily cap — server-enforced
// ---------------------------------------------------------------------------
// Previously the only cap was a client-side check in app.js's
// startAiGeneration() comparing against a Firestore field in the browser —
// trivially bypassed via devtools, and "unlimited" tiers (STANDARD/PREMIUM)
// had no cap of any kind, client or server. Now that this hits paid OpenAI
// usage, every tier gets a real, server-side, per-day ceiling. "Unlimited"
// tiers get a generous ceiling (not literally infinite) purely as an
// anti-abuse/cost-control safety net — the marketing copy can still say
// "Unlimited AI-Generated Exams" since no real user will hit 20/day.
const CBT_GENERATION_DAILY_CAP = {
  FREE: 1,
  EXAM_PASS_SEASON: 1,
  EXAM_PASS_ANNUAL: 1,
  UNIVERSITY_PASS_30: 1,
  UNIVERSITY_PASS_70: 1,
  TUTOR_COURSE_PASS: 1,
  STANDARD: 20,
  STANDARD_ANNUAL: 20,
  PREMIUM: 20,
  PREMIUM_ANNUAL: 20,
};
const DEFAULT_CBT_GENERATION_DAILY_CAP = 1; // no/unrecognized subscription

async function checkAndIncrementCbtGenerationQuota(uid, isAdmin) {
  if (isAdmin) return { allowed: true }; // admins bypass entirely, same as lecture quota

  const userSnap = await db.collection('users').doc(uid).get();
  const sub = userSnap.exists ? userSnap.data()?.subscription : null;
  const tier = sub && sub.verified && sub.status === 'active' ? String(sub.tier || '').toUpperCase() : 'FREE';
  const cap = CBT_GENERATION_DAILY_CAP[tier] ?? DEFAULT_CBT_GENERATION_DAILY_CAP;

  const day = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const usageRef = db.collection('cbtGenerationUsage').doc(`${uid}_${day}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const count = snap.exists ? Number(snap.data().count) || 0 : 0;
    if (count >= cap) {
      return { allowed: false, cap };
    }
    tx.set(usageRef, {
      uid, day, count: count + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { allowed: true, cap, used: count + 1 };
  });
}

app.post('/api/ai/generate-quiz', requireAuth, async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service not configured on server' });
  if (!db) return res.status(503).json({ error: 'Server not configured' });

  try {
    const quota = await checkAndIncrementCbtGenerationQuota(req.user.uid, req.user.admin === true);
    if (!quota.allowed) {
      return res.status(429).json({
        error: `Daily AI-generated exam limit reached (${quota.cap}/day). Try again tomorrow, or upgrade for a higher limit.`
      });
    }
  } catch (e) {
    console.error('CBT generation quota check failed:', e);
    return res.status(500).json({ error: 'Could not verify generation quota' });
  }

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

// --- AI: one-shot topic generation (ported from MedPhysio's AITopicCreator) -
// MedPhysio's admin panel (app/admin/courses/[id]/AITopicCreator.js +
// app/api/topics/generate/route.js) has a single "Generate topic with AI"
// form: title + description + optional video/voice/answer links + optional
// mini-text + a starter quiz count, and it drafts whatever's missing in one
// call. This is that same flow, adapted to Geo-Books' courseTopics/tutorTopics
// schema (main_admin.htm writes the actual Firestore doc after this returns —
// this route only drafts content, matching the read-only-then-admin-commits
// pattern the rest of this file already uses for AI features).
// Admin-only: this drafts lesson content for the question/lecture bank, not a
// per-user consumer feature, same reasoning as /api/ai/parse-past-paper above.
app.post('/api/ai/generate-topic', requireAuth, requireAdmin, async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service not configured on server' });

  const { title, description, hasVideo, hasAnswer, miniText, quizCount } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'A topic title is required.' });

  const needsMiniText = !miniText || !String(miniText).trim();
  const safeQuizCount = Math.max(0, Math.min(10, Math.floor(Number(quizCount) || 0)));

  if (needsMiniText && (!description || String(description).trim().length < 10)) {
    return res.status(400).json({ error: "Add a short description of what this topic should cover — the AI needs a starting point." });
  }

  try {
    let miniTextHtml = needsMiniText ? '' : String(miniText).trim();
    let videoTitle = '', videoDesc = '', answerTitle = '', answerDesc = '';

    if (needsMiniText || hasVideo || hasAnswer) {
      const draftPrompt = [
        'You write concise study-lesson content for a Nigerian JAMB/WAEC/university exam-prep platform.',
        'Return ONLY valid JSON, no markdown fences, in exactly this shape:',
        '{ "miniTextHtml": string, "videoTitle": string, "videoDesc": string, "answerTitle": string, "answerDesc": string }',
        needsMiniText
          ? 'miniTextHtml: write the lesson body as simple HTML (<p> paragraphs, <ul>/<li> where useful) covering the topic from the title+description given. Keep it focused and exam-relevant, roughly 150-350 words.'
          : 'miniTextHtml: leave as an empty string — the admin already supplied lesson text.',
        hasVideo ? 'videoTitle/videoDesc: a short title and one-sentence description for an embedded lecture video on this topic.' : 'videoTitle/videoDesc: leave as empty strings — no video was provided.',
        hasAnswer ? 'answerTitle/answerDesc: a short title and one-sentence description for an embedded worked-answer/solution video on this topic.' : 'answerTitle/answerDesc: leave as empty strings — no answer video was provided.'
      ].join('\n');

      const draftResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: draftPrompt },
            { role: 'user', content: `Topic title: ${title}\nDescription: ${description || '(none — mini-text was supplied manually)'}` }
          ],
          temperature: 0.4,
          max_tokens: 1200,
          response_format: { type: 'json_object' }
        })
      });
      if (!draftResp.ok) {
        console.error('generate-topic draft error:', draftResp.status, await draftResp.text());
        return res.status(502).json({ error: 'AI provider error while drafting lesson content' });
      }
      const draftResult = await draftResp.json();
      const draft = JSON.parse(draftResult.choices?.[0]?.message?.content || '{}');
      if (needsMiniText) miniTextHtml = draft.miniTextHtml || '';
      videoTitle = draft.videoTitle || '';
      videoDesc = draft.videoDesc || '';
      answerTitle = draft.answerTitle || '';
      answerDesc = draft.answerDesc || '';
    }

    let questions = [];
    if (safeQuizCount > 0 && miniTextHtml) {
      const quizPrompt = [
        'You write CBT-style practice questions for a Nigerian exam-prep platform, based on the lesson text given.',
        'Return ONLY valid JSON: { "questions": [ { "q": string, "opts": [string,string,string,string], "correct": 0|1|2|3, "exp": string } ] }'
      ].join('\n');
      const quizResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: quizPrompt },
            { role: 'user', content: `Lesson title: ${title}\nLesson content:\n${miniTextHtml.replace(/<[^>]+>/g, ' ').slice(0, 8000)}\n\nGenerate ${safeQuizCount} question(s).` }
          ],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' }
        })
      });
      if (quizResp.ok) {
        const quizResult = await quizResp.json();
        try {
          const parsed = JSON.parse(quizResult.choices?.[0]?.message?.content || '{}');
          questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        } catch (e) { console.warn('generate-topic quiz JSON parse failed:', e); }
      } else {
        console.warn('generate-topic quiz generation failed, continuing without it:', quizResp.status);
        // Matches MedPhysio's behavior: a failed quiz step doesn't fail the
        // whole request — the topic/lesson content is more important than
        // the starter quiz, and the admin can add questions manually after.
      }
    }

    res.json({ miniTextHtml, videoTitle, videoDesc, answerTitle, answerDesc, questions, usedAi: needsMiniText || !!hasVideo || !!hasAnswer });
  } catch (error) {
    console.error('generate-topic error:', error);
    res.status(500).json({ error: 'Failed to generate topic content' });
  }
});

// ============================================================
// AI SUBJECTS — whole-subject generation (University / Tutor courses)
// ------------------------------------------------------------
// Powers main_admin.htm's "AI Subjects" section and the student-facing
// subject.htm / subject-lesson.htm pages. Modelled on MedPhysio's
// lib/ai.js (generateLessonContent / generateQuizQuestions /
// askAboutLesson): lessons are written with MedPhysio's own pre-styled
// HTML component vocabulary so they render natively in the viewer.
//
// Routes:
//   POST /api/ai/subject-outline   (admin)  title+brief  -> topic list
//   POST /api/ai/subject-lesson    (admin)  one topic    -> full lesson + quiz
//   POST /api/ai/youtube-search    (admin)  query        -> related videos (optional)
//   POST /api/ai/subject-ask       (user)   grounded Q&A on one lesson
//
// YouTube search needs YOUTUBE_API_KEY (YouTube Data API v3). Without it
// the route degrades gracefully: it returns configured:false plus a plain
// youtube.com search URL the admin can open and paste a link from.
// ============================================================
const SUBJECT_AI_MODEL = process.env.SUBJECT_AI_MODEL || 'gpt-4o-mini';

async function subjectLlm({ system, user, messages, maxTokens = 1500, json = false, temperature = 0.4 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, status: 503, message: 'AI service not configured on server' };
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: SUBJECT_AI_MODEL,
        messages: [{ role: 'system', content: system }, ...(messages || [{ role: 'user', content: user }])],
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {})
      })
    });
    if (!resp.ok) {
      console.error('subjectLlm OpenAI error:', resp.status, await resp.text());
      return { ok: false, status: 502, message: 'AI provider error' };
    }
    const data = await resp.json();
    return { ok: true, text: (data.choices?.[0]?.message?.content || '').trim() };
  } catch (e) {
    console.error('subjectLlm request failed:', e);
    return { ok: false, status: 500, message: 'AI request failed' };
  }
}

const clampInt = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const cleanStr = (v, max = 4000) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);

// The generated lesson HTML is rendered with innerHTML in subject-lesson.htm,
// so it is reduced here to a strict allow-list (tags + the exact MedPhysio
// class names) — the viewer sanitises again on render (defence in depth).
const SUBJECT_ALLOWED_TAGS = new Set(['h3', 'h4', 'p', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'div', 'span', 'small', 'br', 'sup', 'sub']);
const SUBJECT_ALLOWED_CLASSES = new Set([
  'mini-section-title', 'requirement-pills', 'cause-grid', 'morph-grid', 'function-list',
  'epo-flow', 'clinical-box', 'mini-summary', 'exam-summary'
]);
function sanitizeLessonHtml(html) {
  let out = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|form|link|meta)[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, tagRaw, attrs) => {
    const tag = tagRaw.toLowerCase();
    if (!SUBJECT_ALLOWED_TAGS.has(tag)) return '';
    if (full.startsWith('</')) return `</${tag}>`;
    const m = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs || '');
    const classes = m ? (m[2] ?? m[3] ?? '').split(/\s+/).filter((c) => SUBJECT_ALLOWED_CLASSES.has(c)) : [];
    return `<${tag}${classes.length ? ` class="${classes.join(' ')}"` : ''}${tag === 'br' ? ' /' : ''}>`;
  });
  return out.trim();
}
const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const SUBJECT_COMPONENT_GUIDE = `You may use ONLY these pre-styled HTML snippets where they genuinely fit the content - never force one that doesn't apply and never invent class names:

- Section heading: <h4 class="mini-section-title">Heading</h4>
- A row of short related terms/pills: <div class="requirement-pills"><span>Term</span><span>Term</span></div>
- A 3-item cause/category grid (exactly 3 children): <div class="cause-grid"><div><span>1</span><h4>Title</h4><p>Description.</p></div><div><span>2</span><h4>Title</h4><p>Description.</p></div><div><span>3</span><h4>Title</h4><p>Description.</p></div></div>
- A 3-item comparison grid, same inner shape as cause-grid, for contrasting categories: <div class="morph-grid">...</div>
- A numbered list of mechanisms/steps/responses: <div class="function-list"><div><span>1</span><p><strong>Point title</strong> Explanation.</p></div><div><span>2</span><p><strong>Point title</strong> Explanation.</p></div></div>
- A left-to-right process flow (2-4 steps): <div class="epo-flow"><div><span>1</span><strong>Step</strong><small>Detail</small></div><b>\u2192</b><div><span>2</span><strong>Step</strong><small>Detail</small></div></div>
- A clinical / real-world relevance box: <div class="clinical-box"><span>Clinical relevance</span><div><p><strong>Point</strong> Detail.</p><p><strong>Point</strong> Detail.</p></div></div>
- An exam-tip summary box (use at the end): <div class="mini-summary exam-summary"><span>Examination tip</span><p>Tip text.</p></div>

Structure: start with <h3>{Lesson title}</h3>, then an introductory <p>, then 2-4 of the components above that best fit this specific content, then optionally the exam-tip box to close.`;

function parseDelimited(text, names) {
  const result = {};
  for (let i = 0; i < names.length; i++) {
    const start = text.indexOf(`===${names[i]}===`);
    if (start === -1) continue;
    const from = start + names[i].length + 6;
    const nextMarker = names[i + 1] ? `===${names[i + 1]}===` : '===END===';
    let end = text.indexOf(nextMarker, from);
    if (end === -1) end = text.length;
    result[names[i]] = text.slice(from, end).trim();
  }
  return result;
}

// --- 1) Outline: subject brief -> ordered topic list -----------------------
app.post('/api/ai/subject-outline', requireAuth, requireAdmin, async (req, res) => {
  const title = cleanStr(req.body?.title, 200);
  const description = cleanStr(req.body?.description, 3000);
  const level = cleanStr(req.body?.level, 120) || 'University undergraduate';
  const audience = req.body?.audience === 'tutor' ? 'tutor' : 'university';
  const topicCount = clampInt(req.body?.topicCount, 2, 20, 8);
  if (!title) return res.status(400).json({ error: 'A subject title is required.' });

  const system = `You design the syllabus for ONE subject on a Nigerian exam-prep / tutoring platform (${audience === 'tutor' ? 'an independent tutor\'s paid course' : 'a university course'}).
Return ONLY JSON: {"topics":[{"title":string,"description":string}]} with exactly ${topicCount} topics, in the order they should be taught (foundations first, progressing logically).
- "title": short and specific (max 8 words), no numbering prefixes.
- "description": 1-2 sentences stating exactly what that lesson covers (key concepts, mechanisms, examples) - it is used later to write the lesson, so be concrete.
- Topics must not overlap; together they should cover the subject sensibly for the stated level.`;
  const user = `Subject: ${title}\nLevel: ${level}\nBrief / syllabus notes: ${description || '(none - use standard syllabus for this subject and level)'}`;

  const r = await subjectLlm({ system, user, maxTokens: 2500, json: true, temperature: 0.5 });
  if (!r.ok) return res.status(r.status).json({ error: r.message });
  try {
    const parsed = JSON.parse(r.text);
    const topics = (Array.isArray(parsed.topics) ? parsed.topics : [])
      .map((t) => ({ title: cleanStr(t?.title, 160), description: cleanStr(t?.description, 600) }))
      .filter((t) => t.title)
      .slice(0, topicCount);
    if (!topics.length) return res.status(502).json({ error: 'The AI returned no topics. Please try again.' });
    res.json({ topics });
  } catch (e) {
    console.error('subject-outline parse failed:', e, r.text);
    res.status(502).json({ error: 'The AI returned an unexpected format. Please try again.' });
  }
});

// --- 2) One full lesson (mini-text + video copy + model answer + quiz) -----
app.post('/api/ai/subject-lesson', requireAuth, requireAdmin, async (req, res) => {
  const subjectTitle = cleanStr(req.body?.subjectTitle, 200);
  const topicTitle = cleanStr(req.body?.topicTitle, 200);
  const topicDescription = cleanStr(req.body?.topicDescription, 1500);
  const level = cleanStr(req.body?.level, 120) || 'University undergraduate';
  const quizCount = clampInt(req.body?.quizCount, 0, 10, 5);
  const siblings = (Array.isArray(req.body?.outlineTitles) ? req.body.outlineTitles : []).slice(0, 25).map((t) => cleanStr(t, 120)).filter(Boolean);
  if (!subjectTitle || !topicTitle) return res.status(400).json({ error: 'subjectTitle and topicTitle are required.' });
  if (topicDescription.length < 10) return res.status(400).json({ error: 'Each topic needs a short description for the AI to work from.' });

  const system = `You write lesson content for a tutoring platform for ${level} students. The house style is mechanism-focused, precise and exam-oriented - never vague, never padded with filler.
Write STRICTLY from the subject, lesson title and description given. Stick to well-established, standard knowledge consistent with that description; do not invent statistics, named studies or citations.
${siblings.length ? `Other lessons in this subject (do not duplicate their content; you may refer forward/back briefly): ${siblings.join(' | ')}` : ''}

${SUBJECT_COMPONENT_GUIDE}

Respond with ONLY these delimited sections, in exactly this order, nothing before or after:
===MINI_TEXT_HTML===
(the lesson, as HTML, per the structure above; roughly 350-700 words of actual content)
===VIDEO_TITLE===
(a short, specific title for a full-lecture video on this topic)
===VIDEO_DESC===
(one sentence describing what that lecture covers)
===ANSWER_TITLE===
(title in the pattern "How to Write a Structured Answer on {Topic}")
===ANSWER_DESC===
(one sentence describing the exam-answer framework)
===ANSWER_HTML===
(a model written exam answer to the most likely essay-style question on this topic, as HTML using ONLY <h4>, <p>, <ul>, <li>, <strong> and optionally one <div class="mini-summary exam-summary"> box at the end. Open with the likely question in <p><strong>Question:</strong> ...</p>, then a clear definition -> body (headed sections) -> conclusion structure.)
===YOUTUBE_QUERY===
(a precise YouTube search query, 4-9 words, likely to find a good educational lecture on exactly this topic at this level)
===END===`;
  const user = `Subject: "${subjectTitle}"\nLesson title: "${topicTitle}"\nWhat this lesson should cover: "${topicDescription}"\n\nWrite all sections now.`;

  const r = await subjectLlm({ system, user, maxTokens: 4200, temperature: 0.4 });
  if (!r.ok) return res.status(r.status).json({ error: r.message });

  const s = parseDelimited(r.text, ['MINI_TEXT_HTML', 'VIDEO_TITLE', 'VIDEO_DESC', 'ANSWER_TITLE', 'ANSWER_DESC', 'ANSWER_HTML', 'YOUTUBE_QUERY']);
  const miniTextHtml = sanitizeLessonHtml(s.MINI_TEXT_HTML);
  if (!miniTextHtml) {
    console.error('subject-lesson: missing mini-text. Raw:', r.text);
    return res.status(502).json({ error: 'The AI returned an unexpected format. Please try again.' });
  }

  // Quiz is its own call so a quiz hiccup never costs the lesson (same
  // split MedPhysio's topics/generate route uses).
  let questions = [];
  if (quizCount > 0) {
    const quizSystem = `You write multiple-choice exam questions for a tutoring platform, based STRICTLY on the lesson content given. Every question, option and explanation must be answerable from this content alone.
Return ONLY JSON: {"questions":[{"q":string,"opts":[string,string,string,string],"correct":0|1|2|3,"exp":string}]} with exactly ${quizCount} questions.
Rules: exactly 4 plausible, mutually exclusive options; vary which index is correct; "exp" is 1-2 sentences citing the lesson; cover distinct points.`;
    const quizUser = `Lesson: "${topicTitle}" (subject: "${subjectTitle}")\nCONTENT:\n"""\n${stripTags(miniTextHtml).slice(0, 9000)}\n"""\nWrite the ${quizCount} questions now.`;
    const qr = await subjectLlm({ system: quizSystem, user: quizUser, maxTokens: Math.min(450 * quizCount + 300, 4000), json: true, temperature: 0.3 });
    if (qr.ok) {
      try {
        const parsed = JSON.parse(qr.text);
        questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
          .filter((q) => q && typeof q.q === 'string' && Array.isArray(q.opts) && q.opts.length === 4
            && q.opts.every((o) => typeof o === 'string' && o.trim()) && Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3)
          .map((q) => ({ q: cleanStr(q.q, 500), opts: q.opts.map((o) => cleanStr(o, 300)), correct: q.correct, exp: cleanStr(q.exp, 600) }));
      } catch (e) { console.warn('subject-lesson quiz parse failed:', e); }
    } else {
      console.warn('subject-lesson quiz generation failed; continuing without it');
    }
  }

  const words = stripTags(miniTextHtml).split(/\s+/).filter(Boolean).length;
  res.json({
    miniTextHtml,
    miniTextReadMinutes: Math.max(1, Math.round(words / 200)),
    videoTitle: cleanStr(s.VIDEO_TITLE, 200),
    videoDesc: cleanStr(s.VIDEO_DESC, 400),
    answerTitle: cleanStr(s.ANSWER_TITLE, 200) || `How to Write a Structured Answer on ${topicTitle}`,
    answerDesc: cleanStr(s.ANSWER_DESC, 400),
    structuredAnswerHtml: sanitizeLessonHtml(s.ANSWER_HTML),
    youtubeQuery: cleanStr(s.YOUTUBE_QUERY, 120) || `${topicTitle} ${subjectTitle} lecture`,
    questions
  });
});

// --- 3) YouTube search (optional) ------------------------------------------
app.post('/api/ai/youtube-search', requireAuth, requireAdmin, async (req, res) => {
  const q = cleanStr(req.body?.query, 200);
  const max = clampInt(req.body?.max, 1, 8, 4);
  if (!q) return res.status(400).json({ error: 'A search query is required.' });
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.json({ configured: false, videos: [], searchUrl });

  try {
    const sp = new URLSearchParams({
      part: 'snippet', type: 'video', q, maxResults: String(max), key,
      videoEmbeddable: 'true', videoSyndicated: 'true', safeSearch: 'strict', relevanceLanguage: 'en'
    });
    const sResp = await fetch(`https://www.googleapis.com/youtube/v3/search?${sp}`);
    if (!sResp.ok) {
      console.error('youtube-search error:', sResp.status, await sResp.text());
      return res.json({ configured: true, videos: [], searchUrl, error: 'YouTube search failed (check YOUTUBE_API_KEY and quota).' });
    }
    const sData = await sResp.json();
    const items = (sData.items || []).filter((i) => i?.id?.videoId);
    const ids = items.map((i) => i.id.videoId);

    const durations = {};
    if (ids.length) {
      try {
        const vResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'contentDetails', id: ids.join(','), key })}`);
        if (vResp.ok) (await vResp.json()).items?.forEach((v) => { durations[v.id] = v.contentDetails?.duration || ''; });
      } catch (e) { /* durations are a nice-to-have */ }
    }
    const fmt = (iso) => {
      const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
      if (!m) return '';
      const h = Number(m[1] || 0), mi = Number(m[2] || 0), se = Number(m[3] || 0);
      return h ? `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}` : `${mi}:${String(se).padStart(2, '0')}`;
    };
    res.json({
      configured: true,
      searchUrl,
      videos: items.map((i) => ({
        id: i.id.videoId,
        title: cleanStr(i.snippet?.title, 200),
        channel: cleanStr(i.snippet?.channelTitle, 120),
        thumb: `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
        duration: fmt(durations[i.id.videoId]),
        url: `https://youtu.be/${i.id.videoId}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${i.id.videoId}?rel=0`
      }))
    });
  } catch (e) {
    console.error('youtube-search failed:', e);
    res.json({ configured: true, videos: [], searchUrl, error: 'YouTube search failed.' });
  }
});

// --- 4) Grounded lesson Q&A for students ("Ask AI" tab) --------------------
// Mirrors MedPhysio's askAboutLesson: the model only sees THIS lesson's own
// text and must say so when a question falls outside it. The lesson is read
// server-side from Firestore (never trusted from the client), and access is
// re-checked here: admin, active University Pass (university), or course
// owner / verified purchase (tutor).
const subjectAskHits = new Map(); // uid -> [timestamps]; in-memory per-instance throttle
async function canReadSubjectTopic(user, kind, topic) {
  if (user.admin === true) return true;
  if (kind === 'tutor') {
    const courseId = topic.tutorCourseId;
    if (!courseId) return false;
    const courseSnap = await db.collection('tutorCourses').doc(courseId).get();
    if (courseSnap.exists && courseSnap.data().tutorId === user.uid) return true;
    const p = await db.collection('tutorPurchases').doc(`${user.uid}_${courseId}`).get();
    if (p.exists && p.data().status === 'verified') return true; // legacy per-course purchase
    // Tutor courses are included with an active, verified University Pass.
    const us = await db.collection('users').doc(user.uid).get();
    const s = us.exists ? us.data().subscription : null;
    return !!(s && ['UNIVERSITY_PASS_30', 'UNIVERSITY_PASS_70'].includes(s.tier) && s.verified === true && s.status === 'active');
  }
  const u = await db.collection('users').doc(user.uid).get();
  const sub = u.exists ? u.data().subscription : null;
  return !!(sub && ['UNIVERSITY_PASS_30', 'UNIVERSITY_PASS_70'].includes(sub.tier) && sub.verified === true && sub.status === 'active');
}
app.post('/api/ai/subject-ask', requireAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Server not configured' });
  const kind = req.body?.kind === 'tutor' ? 'tutor' : 'uni';
  const topicId = cleanStr(req.body?.topicId, 200);
  const question = cleanStr(req.body?.question, 1000);
  if (!topicId || !question) return res.status(400).json({ error: 'topicId and question are required.' });

  const now = Date.now();
  const hits = (subjectAskHits.get(req.user.uid) || []).filter((t) => now - t < 3600_000);
  if (hits.length >= 40) return res.status(429).json({ error: 'You have asked a lot of questions this hour - please try again a little later.' });
  hits.push(now);
  subjectAskHits.set(req.user.uid, hits);

  try {
    const snap = await db.collection(kind === 'tutor' ? 'tutorTopics' : 'courseTopics').doc(topicId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Lesson not found.' });
    const topic = snap.data();
    if (!(await canReadSubjectTopic(req.user, kind, topic))) return res.status(403).json({ error: 'You do not have access to this lesson.' });

    const lessonText = stripTags(`${topic.miniTextHtml || topic.miniText || ''} ${topic.structuredAnswerHtml || ''}`).slice(0, 12000);
    if (lessonText.length < 40) return res.status(400).json({ error: 'This lesson has no text content to answer from yet.' });

    const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-6)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: cleanStr(m.content, 1500) }));

    const system = `You are the study assistant embedded in the "${cleanStr(topic.title, 200)}" lesson of "${cleanStr(topic.subjectTitle || topic.courseId || 'this subject', 200)}".
Answer ONLY using the lesson content below. Do not use outside knowledge to add facts the content does not support.
If the student asks something this lesson does not cover, say so plainly and point them to the part of the lesson (or the kind of topic) to look at instead - do not answer from general knowledge.
Keep answers concise and exam-focused, using the lesson's own terminology. Short paragraphs or a short list; no long essays.

LESSON CONTENT:
"""
${lessonText}
"""`;
    const r = await subjectLlm({ system, messages: [...history, { role: 'user', content: question }], maxTokens: 600, temperature: 0.3 });
    if (!r.ok) return res.status(r.status).json({ error: r.message });
    res.json({ message: r.text || "I couldn't generate a response - please try rephrasing your question." });
  } catch (e) {
    console.error('subject-ask failed:', e);
    res.status(500).json({ error: 'Could not answer right now.' });
  }
});



// Admin-only (not the CBT_GENERATION_DAILY_CAP consumer quota above — this is
// a content-ingestion tool for building the question bank, not a user-facing
// feature, and vision requests cost meaningfully more than the text-only
// /api/ai/generate-quiz route). Client renders each PDF page to an image
// (ai.js's renderPdfPagesAsImages) and sends a small batch here at a time.
//
// IMPORTANT LIMITATIONS (surfaced to the admin in main_admin.htm, not hidden):
// 1. Past-question PDFs almost never include the answer key in the same
//    document. When no marked answer is visible on the page, the model now
//    SOLVES the question itself using its own subject knowledge (rather than
//    leaving it blank) and tags the question answerSource: "ai_solved" so
//    the admin panel can visibly distinguish "confirmed by a printed answer
//    key" from "the AI's best attempt" — accuracy on the latter is real but
//    not guaranteed, especially on ambiguous or visual-dependent questions,
//    so ai_solved answers are flagged for review rather than presented as
//    equally trustworthy. answerSource is "unknown" only in the rare case
//    the model can't determine an answer at all (garbled/incomplete text).
// 2. Precise per-question diagram cropping isn't reliable from a model's
//    self-reported coordinates. When a question is flagged hasVisual, the
//    client attaches the FULL page screenshot as reference (not a tight
//    crop) so the admin can see the diagram in context and swap in a
//    cleaner image if needed before publishing.
app.post('/api/ai/parse-past-paper', requireAuth, requireAdmin, async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service not configured on server' });

  const { images, subject, examType, model } = req.body || {};
  if (!Array.isArray(images) || !images.length) {
    return res.status(400).json({ error: 'images array (data URLs) is required' });
  }
  if (images.length > 4) {
    return res.status(400).json({ error: 'Send at most 4 page images per request' });
  }
  // 'gpt-4o' costs meaningfully more per token than 'gpt-4o-mini', but OpenAI's
  // per-image tiling gives mini a much larger token count per picture — the
  // two roughly wash out for vision-heavy calls like this one. Restricted to
  // an allow-list so the client can't pass an arbitrary/expensive model name.
  const ALLOWED_MODELS = ['gpt-4o-mini', 'gpt-4o'];
  const selectedModel = ALLOWED_MODELS.includes(model) ? model : 'gpt-4o-mini';

  const systemPrompt = [
    'You transcribe exam past-question papers (JAMB/WAEC/NECO, Nigeria) from page images into structured JSON.',
    'Extract each question EXACTLY as printed — verbatim wording, do not paraphrase, do not correct spelling.',
    'Preserve every option exactly as printed too.',
    'If a question or option contains a mathematical expression, represent it as LaTeX: $...$ for inline, $$...$$ for a standalone equation.',
    'If a question contains tabular data, represent it as a GitHub-flavored markdown table embedded in the question text (| col | col |\\n|---|---|\\n| val | val |).',
    'If a question depends on a diagram, chart, chemical structure, graph, or figure that cannot be captured as text or a simple table, set hasVisual true, visualType to one of "diagram"|"chart"|"chemical_structure"|"graph"|"photo"|"other", and visualNote to a short description of what it shows.',
    'Detect the exam year from any header, footer, or watermark visible on the page. If no year is visible on this specific page, set year to null — do not guess or infer from context.',
    'Detect the subject (e.g. "Chemistry", "Physics", "Mathematics", "English Language") from any header visible on the page. If no subject is visible on this specific page, set subject to null — do not guess.',
    'For the correct answer: if an answer key, tick mark, circle, or other visible marking on THIS page indicates the correct option, use that and set answerSource to "page".',
    'If no answer is marked on the page, solve the question yourself. Before committing to an option, work through it step by step internally: eliminate options you can rule out, redo any calculation at least once to catch arithmetic slips, and check the option you land on actually answers what was asked (not a related but different quantity/concept). Only after that reasoning should you set the final correctAnswer. Set answerSource to "ai_solved", set "confidence" to "high" (certain, e.g. a direct factual recall or a calculation you verified), "medium" (reasoned it out but some ambiguity in the question/options), or "low" (had to guess between two plausible options), and put your key reasoning step in "explanation" (1-2 sentences — e.g. the calculation or the fact you relied on, not just "I calculated it").',
    'Only if you genuinely cannot determine an answer at all (badly garbled text, missing information the question depends on) should correctAnswer be null, answerSource "unknown", and confidence null — this should be rare.',
    'Return ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:',
    '{ "pages": [ { "year": string|null, "subject": string|null, "questions": [ { "number": number|null, "text": string, "options": [string,string,string,string], "explanation": string|null, "confidence": "high"|"medium"|"low"|null, "answerSource": "page"|"ai_solved"|"unknown", "correctAnswer": number|null, "hasVisual": boolean, "visualType": string|null, "visualNote": string|null } ] } ] }',
    'Field order in that JSON matters: write "explanation" (your reasoning) BEFORE "correctAnswer" for every question, even though correctAnswer appears later in this list — reason first, then decide, not the other way round.',
    'One entry in "pages" per image you were given, in the same order.'
  ].join('\n');

  const userTextPrompt = `Subject: ${subject || 'Unknown'}. Exam type: ${examType || 'Unknown'}. Transcribe every question visible across these ${images.length} page image(s).`;

  try {
    const content = [
      { type: 'text', text: userTextPrompt },
      ...images.map((dataUrl) => ({ type: 'image_url', image_url: { url: dataUrl } }))
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content }
        ],
        temperature: 0,
        max_tokens: 8000,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('parse-past-paper OpenAI error:', response.status, errBody);
      return res.status(502).json({ error: 'AI provider error' });
    }

    const result = await response.json();
    const rawContent = result.choices?.[0]?.message?.content;
    if (!rawContent) return res.status(502).json({ error: 'Empty response from AI' });

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      return res.status(502).json({ error: 'AI returned invalid JSON' });
    }

    // Basic sanity net, independent of the model's own judgment: drop
    // questions with malformed structure (wrong option count, duplicate
    // options, an out-of-range or otherwise inconsistent correctAnswer)
    // rather than silently passing garbage through to the admin panel.
    // These conditions are cheap to catch here and would otherwise show up
    // as a confusing "correct" highlight on the wrong option, or a question
    // with fewer than 4 real choices, deep in the review UI.
    if (Array.isArray(parsed?.pages)) {
      parsed.pages.forEach((page) => {
        if (!Array.isArray(page?.questions)) return;
        page.questions = page.questions.filter((q) => {
          if (!q || typeof q.text !== 'string' || !q.text.trim()) return false;
          if (!Array.isArray(q.options) || q.options.length !== 4) return false;
          if (q.options.some((o) => typeof o !== 'string' || !o.trim())) return false;
          const uniqueOptions = new Set(q.options.map((o) => o.trim().toLowerCase()));
          if (uniqueOptions.size < 4) return false; // duplicate options — extraction likely misread the page
          if (q.correctAnswer !== null && q.correctAnswer !== undefined) {
            if (!Number.isInteger(q.correctAnswer) || q.correctAnswer < 0 || q.correctAnswer > 3) {
              q.correctAnswer = null; q.answerSource = 'unknown'; q.confidence = null; // don't drop the question over a bad index, just discard the untrustworthy answer
            }
          }
          return true;
        });
      });
    }

    res.json(parsed);
  } catch (error) {
    console.error('parse-past-paper error:', error);
    res.status(500).json({ error: 'Failed to parse past paper pages' });
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
      const listPrice = Number(item.price) || 0;
      // Master rank (8,500+ XP) gets 10% off marketplace purchases. Derive
      // eligibility from the buyer's stored XP, never from the client.
      const buyerSnap = await tx.get(db.collection('users').doc(uid));
      const buyerXp = Number(buyerSnap.exists ? (buyerSnap.data() || {}).xp : 0) || 0;
      const discountOk = buyerXp >= 8500;
      const allowed = new Set([Math.floor(listPrice)]);
      if (discountOk) {
        allowed.add(Math.floor(listPrice * 0.9));
        allowed.add(Math.round(listPrice * 0.9));
        allowed.add(Math.ceil(listPrice * 0.9));
      }
      if (!allowed.has(price)) throw new Error('PRICE_MISMATCH');

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

// Tutor courses are now included with the University Pass (no per-course
// purchase). Endpoint kept as a stub so stale clients get a clear answer.
app.post('/api/tutor-courses/:courseId/purchase', requireAuth, (req, res) => {
  res.status(410).json({ error: 'Tutor courses are included with the University Pass.' });
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