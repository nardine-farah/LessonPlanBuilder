import { authedFetch } from "./planStore";

/**
 * Client side of the chunked teaching-video upload (/api/lesson-video).
 * Chunks stay well under Cloud Run's per-request cap; progress is reported
 * after each chunk so the lesson editor can show a real bar.
 */

export const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export function isVideoFile(file: File): boolean {
  return VIDEO_TYPES.has(file.type);
}

async function jsonOrError(res: Response): Promise<any> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Upload failed (HTTP ${res.status}).`);
  return body;
}

/**
 * Read a video's length in seconds from its metadata — works on local files
 * (object URL) before upload and usually on hosted URLs too. Returns null
 * rather than failing: duration is optional in the Studio schema.
 */
export function probeVideoDuration(source: File | string): Promise<number | null> {
  return new Promise((resolve) => {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const video = document.createElement("video");
    video.preload = "metadata";
    let done = false;
    const settle = (value: number | null) => {
      if (done) return;
      done = true;
      if (typeof source !== "string") URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(value);
    };
    video.onloadedmetadata = () =>
      settle(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => settle(null);
    setTimeout(() => settle(null), 8000);
    video.src = url;
  });
}

/** Upload a video file in chunks; resolves to the permanent Storage URL. */
export async function uploadVideoFile(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ url: string }> {
  const start = await jsonOrError(
    await authedFetch("/api/lesson-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        fileName: file.name,
        size: file.size,
        contentType: file.type,
      }),
    }),
  );
  const { uploadId, chunkBytes } = start as { uploadId: string; chunkBytes: number };

  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    const chunk = file.slice(offset, Math.min(offset + chunkBytes, file.size));
    await jsonOrError(
      await authedFetch(`/api/lesson-video?uploadId=${encodeURIComponent(uploadId)}`, {
        method: "PUT",
        body: chunk,
      }),
    );
    onProgress(Math.min((offset + chunk.size) / file.size, 1));
  }

  const finish = await jsonOrError(
    await authedFetch("/api/lesson-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finish", uploadId }),
    }),
  );
  return { url: (finish as { url: string }).url };
}

export function fmtDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}
