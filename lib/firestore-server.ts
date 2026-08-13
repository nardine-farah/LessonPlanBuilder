import { cert, getApp, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";
import { createReadStream, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import path from "path";

/**
 * Server-side Firebase (admin SDK) — mirrors Scripture Studio's posture:
 * Firestore is touched ONLY from the server; client rules stay deny-all.
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON path,
 * relative paths resolved against the project root) for local dev; on
 * Firebase App Hosting / Cloud Run, Application Default Credentials are used
 * automatically and no env var is needed.
 */

function adminApp() {
  if (getApps().length) return getApp();
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saPath) {
    const resolved = path.isAbsolute(saPath) ? saPath : path.join(process.cwd(), saPath);
    try {
      const sa = JSON.parse(readFileSync(resolved, "utf8"));
      return initializeApp({ credential: cert(sa), projectId: sa.project_id });
    } catch {
      /* fall through to ADC */
    }
  }
  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

export function adminAuth() {
  return getAuth(adminApp());
}

export function adminDb() {
  return getFirestore(adminApp());
}

let cachedBucketName: string | null | undefined;

/**
 * The project's default Storage bucket. FIREBASE_STORAGE_BUCKET overrides;
 * otherwise the two default naming schemes are probed once and cached.
 */
export async function storageBucket() {
  const storage = getStorage(adminApp());
  if (cachedBucketName === undefined) {
    const explicit = process.env.FIREBASE_STORAGE_BUCKET;
    const projectId =
      process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
    const candidates = explicit
      ? [explicit]
      : [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];
    cachedBucketName = null;
    if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
      // Against the Storage emulator the exists() probe is meaningless —
      // buckets materialize on first write. Trust the configured name.
      cachedBucketName = candidates[0];
    } else {
      for (const name of candidates) {
        try {
          const [exists] = await storage.bucket(name).exists();
          if (exists) {
            cachedBucketName = name;
            break;
          }
        } catch {
          /* try the next candidate */
        }
      }
    }
  }
  if (!cachedBucketName) {
    throw new Error(
      "No Firebase Storage bucket found on this project — enable Storage in the Firebase console (or set FIREBASE_STORAGE_BUCKET).",
    );
  }
  return getStorage(adminApp()).bucket(cachedBucketName);
}

/**
 * Firebase download-token URL for a Storage object. Emulator-aware so local
 * demos against the Storage emulator get playable URLs; in production (no
 * emulator env) this is the standard firebasestorage.googleapis.com form.
 */
function tokenDownloadUrl(bucketName: string, objectPath: string, token: string) {
  const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const base = emulator ? `http://${emulator}` : "https://firebasestorage.googleapis.com";
  return `${base}/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/**
 * Stream a staged teaching-video file into Storage and return a permanent,
 * publicly playable URL (download-token style, like lesson audio/images).
 * Streaming (not buffering) keeps 100MB+ videos out of instance memory.
 */
export async function uploadLessonVideo(
  uid: string,
  uploadId: string,
  fileName: string,
  localPath: string,
  contentType: string,
): Promise<string> {
  const bucket = await storageBucket();
  const safeName = fileName.replace(/[^\w.-]+/g, "_").slice(-80) || "video.mp4";
  const objectPath = `lesson-videos/${uid}/${uploadId}-${safeName}`;
  const token = randomUUID();
  await pipeline(
    createReadStream(localPath),
    bucket.file(objectPath).createWriteStream({
      contentType,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      resumable: false,
    }),
  );
  return tokenDownloadUrl(bucket.name, objectPath, token);
}

/**
 * Upload lesson narration audio and return a permanent, publicly playable
 * URL (Firebase download-token style — independent of bucket ACL settings).
 * The voice signature is part of the filename so a republish can tell whether
 * an existing recording was made with the current voice configuration.
 */
export async function uploadLessonAudio(
  planId: string,
  n: number,
  mp3: Buffer,
  voiceSignature: string,
  /**
   * Builder-time renders pass true: each render gets its own object, so a
   * re-render can never clobber a URL that an already-published plan still
   * serves. The `-{voiceSignature}.mp3` suffix is kept in every shape — the
   * republish reuse check reads the voice out of the filename.
   */
  unique = false,
): Promise<string> {
  const bucket = await storageBucket();
  const uniquePart = unique ? `${randomUUID().slice(0, 8)}-` : "";
  const objectPath = `lesson-audio/${planId}/${n}-${uniquePart}${voiceSignature}.mp3`;
  const token = randomUUID();
  await bucket.file(objectPath).save(mp3, {
    contentType: "audio/mpeg",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    resumable: false,
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

export interface CallerIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
}

/** Verify a Firebase ID token from an Authorization: Bearer header. */
export async function identityFromRequest(authorization: string | null): Promise<CallerIdentity | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(authorization.slice(7));
    return { uid: decoded.uid, email: decoded.email ?? "", emailVerified: decoded.email_verified === true };
  } catch {
    return null;
  }
}

/**
 * Admin allowlist — ADMIN_EMAILS is a comma-separated list of reviewer
 * emails allowed to see EVERY profile's plans and the whole library
 * (/admin + /api/admin/*). Defaults to the Biblica curator so the deployed
 * tool has a working admin with zero setup, same precedent as
 * PUBLISH_ALLOWED_DOMAIN's default.
 */
const DEFAULT_ADMIN_EMAILS = "nardine.farah@biblica.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? DEFAULT_ADMIN_EMAILS)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export type AdminGate =
  | { ok: true; caller: CallerIdentity }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Gate an /api/admin route: signed in (401 otherwise) AND on the admin
 * allowlist with a verified email (403 otherwise). Admin views are
 * read-only, but they cross profile boundaries — hence the hard gate.
 */
export async function requireAdmin(authorization: string | null): Promise<AdminGate> {
  const caller = await identityFromRequest(authorization);
  if (!caller) return { ok: false, status: 401, error: "Sign in first." };
  if (!caller.emailVerified || !isAdminEmail(caller.email)) {
    return { ok: false, status: 403, error: "This view is limited to admin accounts." };
  }
  return { ok: true, caller };
}

/** Verify a Firebase ID token from an Authorization: Bearer header; returns the uid or null. */
export async function uidFromRequest(authorization: string | null): Promise<string | null> {
  return (await identityFromRequest(authorization))?.uid ?? null;
}
