// multipart-upload.js — parallel chunked upload to R2 via server-signed URLs.
// Use for lecture videos / anything above ~20MB. For small files (images),
// keep using the simpler single-PUT /api/upload/signed-url flow — the extra
// round trips here aren't worth it below that size.

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per part
// R2 is HTTP/2, so concurrency isn't capped by the browser's old
// 6-connections-per-host rule the way plain HTTP/1.1 uploads would be —
// this is really bounded by the user's own uplink, not the code. 6 is a
// reasonable default across a mix of connections.
const MAX_CONCURRENT = 6;
const MAX_PART_RETRIES = 4;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Retries transient failures (network blips, R2 5xx, a dropped connection
// mid-PUT) with exponential backoff + jitter. This is what stands between
// "the upload eventually finishes on a shaky connection" and "one bad
// chunk means restarting the whole file from zero" — by far the biggest
// real-world time cost on unreliable mobile networks, more than chunk
// size or concurrency tuning.
async function withRetry(fn, { attempts = MAX_PART_RETRIES, label = 'request' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const backoffMs = Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.random() * 300;
        console.warn(`${label} failed (attempt ${attempt}/${attempts}), retrying in ${Math.round(backoffMs)}ms:`, err.message);
        await sleep(backoffMs);
      }
    }
  }
  throw lastErr;
}

/**
 * @param {File} file
 * @param {string} destinationKey - e.g. `lectures/${courseId}/${file.name}`
 * @param {(percent: number, meta?: object) => void} [onProgress] - meta:
 *   { uploadedBytes, totalBytes, speedBps, etaSeconds, totalParts, completedParts }
 * @returns {Promise<{ url: string, key: string }>}
 */
export async function uploadFileMultipart(file, destinationKey, onProgress) {
  const idToken = await firebase.auth().currentUser.getIdToken();
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${idToken}`
  };

  // 1. Init — get an uploadId + the final storage key
  const { uploadId, key } = await fetch(`${ADMIN_API_BASE_URL}/api/upload/multipart/init`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ destinationKey, contentType: file.type })
  }).then(r => r.json());

  // 2. Split into chunks
  const totalParts = Math.ceil(file.size / CHUNK_SIZE);
  const chunks = [];
  for (let i = 0; i < totalParts; i++) {
    chunks.push(file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size)));
  }

  // 3. Get every part's signed URL in ONE request instead of one-per-part.
  // Besides removing a round trip of dead time before each PUT, this keeps
  // large files from burning through the server's uploadLimiter
  // (30 requests/15min) — under the old one-request-per-part design, a
  // 500MB file at 10MB chunks was already 50 part-url calls alone,
  // guaranteed to 429 partway through on anything over ~280MB.
  const { urls } = await fetch(`${ADMIN_API_BASE_URL}/api/upload/multipart/part-urls`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ key, uploadId, partNumbers: Array.from({ length: totalParts }, (_, i) => i + 1) })
  }).then(r => r.json());
  const urlByPart = new Map(urls.map((u) => [u.partNumber, u.url]));

  let uploadedBytes = 0;
  const parts = new Array(totalParts);
  const startedAt = performance.now();
  let lastTickBytes = 0, lastTickAt = startedAt, speedBps = 0;

  function reportProgress(completedParts, justCompletedPart) {
    const now = performance.now();
    const dt = (now - lastTickAt) / 1000;
    if (dt > 0.2) {
      const instBps = (uploadedBytes - lastTickBytes) / dt;
      speedBps = speedBps ? speedBps * 0.7 + instBps * 0.3 : instBps;
      lastTickBytes = uploadedBytes;
      lastTickAt = now;
    }
    const remaining = file.size - uploadedBytes;
    const etaSeconds = speedBps > 0 ? remaining / speedBps : null;
    if (onProgress) {
      onProgress(Math.round((uploadedBytes / file.size) * 100), {
        uploadedBytes, totalBytes: file.size, speedBps, etaSeconds, totalParts, completedParts, justCompletedPart
      });
    }
  }

  async function uploadOnePart(partNumber) {
    const chunk = chunks[partNumber - 1];
    const url = urlByPart.get(partNumber);

    await withRetry(async () => {
      const putRes = await fetch(url, { method: 'PUT', body: chunk });
      if (!putRes.ok) throw new Error(`Part ${partNumber} failed (${putRes.status})`);
      parts[partNumber - 1] = { PartNumber: partNumber, ETag: putRes.headers.get('ETag') };
    }, { label: `Part ${partNumber}` });

    uploadedBytes += chunk.size;
    reportProgress(parts.filter(Boolean).length, partNumber);
  }

  // 4. Upload chunks with bounded concurrency (MAX_CONCURRENT at a time)
  let nextPart = 1;
  async function worker() {
    while (nextPart <= totalParts) {
      const partNumber = nextPart++;
      await uploadOnePart(partNumber);
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, totalParts) }, worker);

  try {
    await Promise.all(workers);
  } catch (err) {
    // Best-effort cleanup so the abandoned upload doesn't sit in the bucket
    fetch(`${ADMIN_API_BASE_URL}/api/upload/multipart/abort`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ key, uploadId })
    }).catch(() => {});
    throw err;
  }

  // 5. Complete — R2 requires parts listed in ascending order
  const { url: fileUrl } = await fetch(`${ADMIN_API_BASE_URL}/api/upload/multipart/complete`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ key, uploadId, parts })
  }).then(r => r.json());

  return { url: fileUrl, key };
}
