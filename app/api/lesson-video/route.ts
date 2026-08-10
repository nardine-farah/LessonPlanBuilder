import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { uidFromRequest, uploadLessonVideo } from "@/lib/firestore-server";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Teaching-video upload, chunked. Cloud Run caps a single request at ~32MB,
 * so the client stages the file here in ≤6MB chunks (same single-instance
 * disk the analysis cache relies on — maxInstances: 1), and `finish` streams
 * the assembled file to Storage `lesson-videos/{uid}/…` with a download-token
 * URL. The upload happens AT ATTACH TIME, so the asset survives cache expiry
 * and rollouts just like lesson images.
 *
 *  POST {action:"start", fileName, size, contentType} → { uploadId, chunkBytes }
 *  PUT  ?uploadId=…  (raw chunk body, strictly in order)  → { received }
 *  POST {action:"finish", uploadId}                       → { url, size }
 */

const STAGING = path.join(process.cwd(), ".video-uploads");
const CHUNK_BYTES = 6 * 1024 * 1024;
const MAX_BYTES = Number(process.env.LPB_VIDEO_MAX_MB || 200) * 1024 * 1024;
const STALE_MS = 24 * 60 * 60 * 1000;
const CONTENT_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const ID_PATTERN = /^[a-f0-9-]{36}$/;

interface UploadMeta {
  uid: string;
  fileName: string;
  size: number;
  contentType: string;
  received: number;
}

const metaPath = (id: string) => path.join(STAGING, `${id}.json`);
const binPath = (id: string) => path.join(STAGING, `${id}.bin`);

async function readMeta(id: string): Promise<UploadMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}

/** Abandoned uploads (browser closed mid-transfer) are swept on the next start. */
async function pruneStale() {
  try {
    for (const name of await readdir(STAGING)) {
      const p = path.join(STAGING, name);
      try {
        if (Date.now() - (await stat(p)).mtimeMs > STALE_MS) await rm(p, { force: true });
      } catch {
        /* another request may have removed it */
      }
    }
  } catch {
    /* staging dir doesn't exist yet */
  }
}

export async function POST(req: NextRequest) {
  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in to upload videos." }, { status: 401 });

  let body: { action?: string; fileName?: string; size?: number; contentType?: string; uploadId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (body.action === "start") {
    const size = Number(body.size);
    const contentType = body.contentType ?? "";
    if (!Number.isFinite(size) || size <= 0) {
      return Response.json({ error: "Missing or invalid file size." }, { status: 400 });
    }
    if (size > MAX_BYTES) {
      return Response.json(
        { error: `That video is ${(size / 1048576).toFixed(0)}MB — the limit is ${MAX_BYTES / 1048576}MB. Compress it (H.264 MP4) and try again.` },
        { status: 413 },
      );
    }
    if (!CONTENT_TYPES.has(contentType)) {
      return Response.json({ error: "Use an MP4, WebM, or QuickTime video file." }, { status: 415 });
    }
    await mkdir(STAGING, { recursive: true });
    await pruneStale();
    const uploadId = randomUUID();
    const meta: UploadMeta = {
      uid,
      fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "video.mp4",
      size,
      contentType,
      received: 0,
    };
    await writeFile(metaPath(uploadId), JSON.stringify(meta));
    await writeFile(binPath(uploadId), Buffer.alloc(0));
    return Response.json({ uploadId, chunkBytes: CHUNK_BYTES });
  }

  if (body.action === "finish") {
    const uploadId = body.uploadId ?? "";
    if (!ID_PATTERN.test(uploadId)) return Response.json({ error: "Malformed uploadId." }, { status: 400 });
    const meta = await readMeta(uploadId);
    if (!meta || meta.uid !== uid) {
      return Response.json({ error: "That upload doesn't exist (it may have expired — try again)." }, { status: 404 });
    }
    if (meta.received !== meta.size) {
      return Response.json(
        { error: `Upload incomplete (${meta.received} of ${meta.size} bytes) — try again.` },
        { status: 409 },
      );
    }
    try {
      const url = await uploadLessonVideo(uid, uploadId, meta.fileName, binPath(uploadId), meta.contentType);
      return Response.json({ url, size: meta.size });
    } finally {
      await rm(binPath(uploadId), { force: true });
      await rm(metaPath(uploadId), { force: true });
    }
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}

export async function PUT(req: NextRequest) {
  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in to upload videos." }, { status: 401 });

  const uploadId = req.nextUrl.searchParams.get("uploadId") ?? "";
  if (!ID_PATTERN.test(uploadId)) return Response.json({ error: "Malformed uploadId." }, { status: 400 });
  const meta = await readMeta(uploadId);
  if (!meta || meta.uid !== uid) {
    return Response.json({ error: "That upload doesn't exist (it may have expired — try again)." }, { status: 404 });
  }

  const chunk = Buffer.from(await req.arrayBuffer());
  if (chunk.length === 0 || chunk.length > CHUNK_BYTES + 1024) {
    return Response.json({ error: "Bad chunk size." }, { status: 400 });
  }
  if (meta.received + chunk.length > meta.size) {
    return Response.json({ error: "Upload larger than the declared file size." }, { status: 400 });
  }

  await appendFile(binPath(uploadId), chunk);
  meta.received += chunk.length;
  await writeFile(metaPath(uploadId), JSON.stringify(meta));
  return Response.json({ received: meta.received });
}
