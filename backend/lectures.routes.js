// lectures.routes.js — Express routes using the merged r2-storage.js
// Matches existing ESM style (import/export) already used in this backend.

import express from "express";
import { getSignedUploadUrl, getSignedViewUrl, deleteAsset } from "./r2-storage.js";
// import { requireAuth, requireLectureUploadPermission } from "./middleware/auth.js";

const router = express.Router();

function buildLectureKey(courseId, originalFilename) {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `lectures/${courseId}/${Date.now()}_${safeName}`;
}

/**
 * STEP 1 — client requests a signed upload URL before sending the file.
 * Gate behind auth + lecturer-access check (accessGranted + courseId in
 * lecturers/{uid}.courses) or admin, per the University section spec.
 */
router.post(
  "/api/lectures/upload-url",
  /* requireAuth, requireLectureUploadPermission, */
  async (req, res) => {
    try {
      const { filename, contentType, courseId } = req.body;
      if (!filename || !contentType || !courseId) {
        return res.status(400).json({ error: "filename, contentType, courseId required" });
      }

      const key = buildLectureKey(courseId, filename);
      const uploadUrl = await getSignedUploadUrl(key, contentType);

      // Return key too — client sends it back after upload succeeds so you
      // can write it into the lectures/{lectureId} Firestore doc.
      res.json({ uploadUrl, key });
    } catch (err) {
      console.error("upload-url error:", err);
      res.status(500).json({ error: "Could not generate upload URL" });
    }
  }
);

/**
 * Get a temporary viewing URL for a lecture (e.g. a student opening it).
 * In production, look up `key` from the lecture's Firestore doc by
 * lectureId — never trust a client-supplied key here.
 */
router.get(
  "/api/lectures/:lectureId/view-url",
  /* requireAuth, */
  async (req, res) => {
    try {
      // const lecture = await db.collection("lectures").doc(req.params.lectureId).get();
      // const key = lecture.data().r2Key;
      const key = req.query.key; // placeholder until wired to Firestore lookup

      if (!key) return res.status(400).json({ error: "missing key" });

      const url = await getSignedViewUrl(key, 3600);
      res.json({ url });
    } catch (err) {
      console.error("view-url error:", err);
      res.status(500).json({ error: "Could not generate view URL" });
    }
  }
);

/**
 * Delete a lecture's video asset from R2 (call alongside deleting the
 * Firestore doc).
 */
router.delete(
  "/api/lectures/:lectureId/asset",
  /* requireAuth, requireAdmin, */
  async (req, res) => {
    try {
      const { key } = req.body;
      if (!key) return res.status(400).json({ error: "missing key" });
      await deleteAsset(key);
      res.json({ success: true });
    } catch (err) {
      console.error("delete asset error:", err);
      res.status(500).json({ error: "Could not delete asset" });
    }
  }
);

export default router;
