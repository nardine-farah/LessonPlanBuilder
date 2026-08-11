import { promises as fs } from "fs";
import path from "path";
import { restoreSourcePdf } from "./sourceStore";

/**
 * mupdf is ESM-only with top-level await, which breaks require()-style
 * loading in Next's CJS server output — load it lazily via dynamic import()
 * and cache the module promise.
 */
let mupdfPromise: Promise<typeof import("mupdf")> | null = null;
function loadMupdf() {
  mupdfPromise ??= import("mupdf");
  return mupdfPromise;
}

/**
 * Local PDF page rendering (mupdf WASM) for the lesson-image picker. Pages
 * are rendered from the analysis cache (.analysis-cache/{sourceId}.pdf) —
 * no AI involved; this is pure CPU work. The client crops the rendered PNG
 * itself, so the server only ever produces full-page renders.
 */

const CACHE_DIR = path.join(process.cwd(), ".analysis-cache");

export type RenderErrorCode = "cache-miss" | "bad-page" | "render";

export class RenderError extends Error {
  constructor(message: string, public status: number, public code: RenderErrorCode = "render") {
    super(message);
  }
}

export interface RenderedPage {
  png: Buffer;
  width: number;
  height: number;
  pageCount: number;
}

/** Cheap semaphore: page renders are CPU-heavy; don't let a burst of thumbnail requests pile up. */
const MAX_CONCURRENT_RENDERS = 3;
let active = 0;
const waiters: (() => void)[] = [];

async function acquire() {
  if (active < MAX_CONCURRENT_RENDERS) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function release() {
  active--;
  waiters.shift()?.();
}

export async function renderPdfPage(
  sourceId: string,
  page1: number,
  targetWidth: number,
): Promise<RenderedPage> {
  await acquire();
  try {
    return await renderPdfPageInner(sourceId, page1, targetWidth);
  } finally {
    release();
  }
}

async function renderPdfPageInner(
  sourceId: string,
  page1: number,
  targetWidth: number,
): Promise<RenderedPage> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path.join(CACHE_DIR, `${sourceId}.pdf`));
  } catch {
    // Self-heal: the local cache is ephemeral (rollouts, pruning), but every
    // analyzed PDF also lives in Storage — pull it back and carry on. The
    // attach-PDF banner remains only for plans that predate persistence.
    if (!(await restoreSourcePdf(sourceId))) {
      throw new RenderError(
        "The source PDF isn't on this server anymore (caches reset on redeploy) — attach the source PDF to continue.",
        404,
        "cache-miss",
      );
    }
    bytes = await fs.readFile(path.join(CACHE_DIR, `${sourceId}.pdf`));
  }
  return renderPdfFromBytes(bytes, page1, targetWidth);
}

/** Render a page of an in-memory PDF — also used by the /api/render self-test. */
export async function renderPdfFromBytes(
  bytes: Uint8Array,
  page1: number,
  targetWidth: number,
): Promise<RenderedPage> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  try {
    const pageCount = doc.countPages();
    if (!Number.isInteger(page1) || page1 < 1 || page1 > pageCount) {
      throw new RenderError(`Page ${page1} is out of range (1–${pageCount}).`, 400, "bad-page");
    }
    let page: import("mupdf").Page | null = null;
    let pixmap: import("mupdf").Pixmap | null = null;
    try {
      page = doc.loadPage(page1 - 1);
      const [x0, y0, x1, y1] = page.getBounds();
      const pageWidthPts = Math.max(1, x1 - x0);
      const pageHeightPts = Math.max(1, y1 - y0);
      // Clamp by BOTH axes — extreme aspect ratios must not produce unbounded
      // pixmaps (a 1pt-wide, 10000pt-tall page would otherwise OOM the server).
      const MAX_HEIGHT_PX = 2600;
      const scale = Math.min(
        4,
        Math.max(0.1, targetWidth / pageWidthPts),
        MAX_HEIGHT_PX / pageHeightPts,
      );
      pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
      const png = Buffer.from(pixmap.asPNG());
      return { png, width: pixmap.getWidth(), height: pixmap.getHeight(), pageCount };
    } finally {
      // Destroy on every path — WASM heap objects don't garbage-collect.
      pixmap?.destroy();
      page?.destroy();
    }
  } finally {
    doc.destroy();
  }
}
