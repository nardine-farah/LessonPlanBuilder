import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { storageBucket, uidFromRequest } from "@/lib/firestore-server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * POST /api/lesson-image — store a curator-cropped lesson image. The client
 * renders + crops the page on a canvas and sends the finished PNG; the
 * server only validates and uploads it to Firebase Storage, returning a
 * permanent public URL (same download-token scheme as the narration MP3s).
 */
export async function POST(req: NextRequest) {
  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in to save lesson images." }, { status: 401 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
  } catch {
    return Response.json({ error: "Expected multipart form data with a 'file' field." }, { status: 400 });
  }
  if (!file) return Response.json({ error: "No image uploaded." }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json({ error: "Image is larger than 3 MB — crop tighter or reduce quality." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // Full 8-byte PNG signature check — the canvas always produces PNG.
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length <= 8 || !PNG_SIG.every((b, i) => bytes[i] === b)) {
    return Response.json({ error: "Only PNG images are accepted." }, { status: 415 });
  }

  try {
    const bucket = await storageBucket();
    const objectPath = `lesson-images/${uid}/${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    const token = randomUUID();
    await bucket.file(objectPath).save(bytes, {
      contentType: "image/png",
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      resumable: false,
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    return Response.json({ url });
  } catch (err) {
    return Response.json(
      { error: `Couldn't store the image (${err instanceof Error ? err.message : String(err)}).` },
      { status: 502 },
    );
  }
}
