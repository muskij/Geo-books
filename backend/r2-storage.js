import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

dotenv.config();

// --- Env validation -----------------------------------------------------
// This checks that each named env var is actually SET, and throws with the
// missing var's name if not. (The previous version of this file had this
// logic broken — it was assigning literal values inline instead of listing
// var names to check, which also meant real R2 secrets were hardcoded
// directly into source. Do not put real key values in this array; put the
// values in .env, which must stay out of git via .gitignore.)
const requiredEnv = [
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_ENDPOINT_URL",
  "CLOUDFLARE_R2_BUCKET_NAME",
  "CLOUDFLARE_R2_PUBLIC_URL", // still needed for public assets like book covers
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Critical Config Error: Missing environment variable [${key}].`);
  }
}

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME;

const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

// --- PUBLIC assets (books, covers, marketplace images) -------------------
// These live under the bucket's public .r2.dev URL (or your custom domain,
// once you attach one). Anyone with the link can view them — appropriate
// for browsable, non-gated content like book covers.

/**
 * Upload a file and return its permanent public URL.
 * Use for: book covers, marketplace thumbnails, anything meant to be
 * publicly browsable without auth.
 */
export async function uploadPublicAsset(fileBuffer, destinationKey, mimeType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: destinationKey,
    Body: fileBuffer,
    ContentType: mimeType,
  });

  try {
    await r2Client.send(command);
    return `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${destinationKey}`;
  } catch (error) {
    console.error(`[R2 Storage] Public upload failed for key: ${destinationKey}`, error);
    throw error;
  }
}

// --- PRIVATE assets (lecture videos, gated hostel docs, etc) -------------
// These are never exposed via the public URL. Access is only ever granted
// through short-lived signed URLs, checked against your existing
// lecturer-access / enrollment logic before a URL is ever issued.

/**
 * Get a signed URL the CLIENT can use to PUT a file directly to R2.
 * Use for: lecture video uploads by admins/authorized lecturers.
 */
export async function getSignedUploadUrl(destinationKey, mimeType, expiresInSeconds = 300) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: destinationKey,
    ContentType: mimeType,
  });
  return getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}

/**
 * Get a signed URL the CLIENT can use to view/stream a private object.
 * Use for: students viewing a lecture they're enrolled/authorized to see.
 * Call this only after checking permission server-side — the URL itself
 * grants access to anyone holding it for its expiry window.
 */
export async function getSignedViewUrl(destinationKey, expiresInSeconds = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: destinationKey });
  return getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}

/**
 * Delete any object (public or private) by key.
 */
export async function deleteAsset(destinationKey) {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: destinationKey });
  try {
    await r2Client.send(command);
  } catch (error) {
    console.error(`[R2 Storage] Delete failed for key: ${destinationKey}`, error);
    throw error;
  }
}

// --- Backward-compat export ----------------------------------------------
// Keeps storage-examples.js (and anything else importing uploadToR2)
// working without edits elsewhere. Same behavior as before: public upload.
export const uploadToR2 = uploadPublicAsset;
