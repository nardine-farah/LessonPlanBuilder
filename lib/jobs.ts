import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Draft } from "./types";
import {
  AnalysisError,
  MAX_PAGES_PER_REQUEST,
  SINGLE_PASS_MAX_TOKENS,
  countPdfTokens,
  estimateParts,
  extractChunk,
  getPageCount,
  mergeExtractions,
  planChunks,
  slicePdf,
  toDraft,
  type ChunkPlan,
} from "./extraction";
import {
  formatRanges,
  normalizeRanges,
  pagesToRanges,
  rangesToPages,
  type PageRange,
} from "./pages";
import { persistSourcePdf, restoreSourcePdf } from "./sourceStore";

/**
 * Resumable analysis jobs. An upload is keyed by the hash of its bytes +
 * target language ("base id"); each analysis scope (full document, or a
 * curator-chosen page selection) is its own job under that base. The source
 * PDF, the chunk plan, and every completed part are written to
 * .analysis-cache/ as they finish, so a dead browser, connection, or server
 * resumes instead of re-spending tokens.
 */

const CACHE_DIR = path.join(process.cwd(), ".analysis-cache");
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Jobs actively running in THIS server process. */
const running = new Set<string>();

export type Scope = { type: "full" } | { type: "pages"; ranges: PageRange[] };

export interface Measurement {
  tokens: number; // 0 when measuring failed (treated as "unknown", never cached)
  pageCount: number;
}

export interface JobState {
  status: "running" | "done" | "error";
  stage: string;
  partsTotal: number;
  partsDone: number;
  fileName: string;
  error?: string;
  draft?: Draft;
  partsUsed?: number;
  updatedAt: string;
}

interface JobMeta {
  baseId: string;
  fileName: string;
  language: "en" | "ar";
  scope: Scope;
  chunkPlan?: ChunkPlan[]; // saved once computed so a resume splits identically
  createdAt: string;
}

const p = {
  pdf: (baseId: string) => path.join(CACHE_DIR, `${baseId}.pdf`),
  measure: (baseId: string) => path.join(CACHE_DIR, `${baseId}.measure.json`),
  meta: (jobId: string) => path.join(CACHE_DIR, `${jobId}.meta.json`),
  job: (jobId: string) => path.join(CACHE_DIR, `${jobId}.job.json`),
  part: (jobId: string, i: number) => path.join(CACHE_DIR, `${jobId}.part-${i}.json`),
};

export function hashUpload(bytes: Uint8Array, language: string): string {
  return crypto.createHash("sha256").update(bytes).update(language).digest("hex").slice(0, 24);
}

export function jobIdFor(baseId: string, scope: Scope): string {
  if (scope.type === "pages") {
    const sel = crypto.createHash("sha256").update(normalizeRanges(scope.ranges)).digest("hex").slice(0, 10);
    return `${baseId}-p${sel}`;
  }
  return `${baseId}-full`;
}

export const JOB_ID_PATTERN = /^[a-f0-9]{24}(-full|-p[a-f0-9]{10}|-r\d{1,4}-\d{1,4})$/;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
}

async function patchJob(jobId: string, patch: Partial<JobState>) {
  const prev = (await readJson<JobState>(p.job(jobId))) ?? {
    status: "running" as const,
    stage: "starting",
    partsTotal: 0,
    partsDone: 0,
    fileName: "",
    updatedAt: "",
  };
  await writeJson(p.job(jobId), { ...prev, ...patch, updatedAt: new Date().toISOString() });
}

/** Drop cache entries older than two weeks. Best-effort. */
async function pruneCache() {
  try {
    const cutoff = Date.now() - CACHE_MAX_AGE_MS;
    for (const name of await fs.readdir(CACHE_DIR)) {
      const file = path.join(CACHE_DIR, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.unlink(file).catch(() => {});
    }
  } catch {
    /* cache dir may not exist yet */
  }
}

/**
 * Store a PDF in the analysis cache WITHOUT starting any analysis — used to
 * re-attach a source document to an existing draft so page renders work
 * again (older plans predate sourceId; caches are per-machine and pruned).
 */
export async function storeSourcePdf(
  bytes: Uint8Array,
  language: string,
): Promise<{ sourceId: string; pageCount: number }> {
  const sourceId = hashUpload(bytes, language);
  const pageCount = await getPageCount(bytes).catch(() => {
    throw new AnalysisError("This PDF could not be read — it may be corrupted or malformed.", 422);
  });
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(p.pdf(sourceId), bytes);
  persistSourcePdf(sourceId, bytes); // durable copy — survives rollouts & pruning
  return { sourceId, pageCount };
}

/**
 * Store the upload and measure it (token count + pages). Successful
 * measurements are cached; a failed token count is retried once and — if it
 * still fails — reported as tokens=0 ("unknown") WITHOUT being cached, so the
 * next attempt measures again instead of inheriting a bogus zero.
 */
export async function registerUpload(
  baseId: string,
  bytes: Uint8Array,
  fileName: string,
): Promise<Measurement> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  void pruneCache();
  await fs.writeFile(p.pdf(baseId), bytes);
  persistSourcePdf(baseId, bytes); // durable copy — survives rollouts & pruning

  const cached = await readJson<Measurement>(p.measure(baseId));
  if (cached && cached.tokens > 0) return cached;

  let pageCount = 0;
  try {
    pageCount = await getPageCount(bytes);
  } catch {
    throw new AnalysisError("This PDF could not be read — it may be corrupted or malformed.", 422);
  }

  let tokens = 0;
  const client = new Anthropic();
  const b64 = Buffer.from(bytes).toString("base64");
  for (let attempt = 0; attempt < 2 && tokens === 0; attempt++) {
    try {
      tokens = await countPdfTokens(client, b64);
    } catch {
      /* retry once, then give up and report "unknown" */
    }
  }

  const measurement: Measurement = { tokens, pageCount };
  if (tokens > 0) await writeJson(p.measure(baseId), measurement);
  return measurement;
}

/** True when the measured document safely fits one pass. Unknown size (tokens=0) never "fits". */
export function fitsSinglePass(m: Measurement): boolean {
  return m.tokens > 0 && m.tokens <= SINGLE_PASS_MAX_TOKENS && m.pageCount <= MAX_PAGES_PER_REQUEST;
}

/**
 * Start (or attach to) the analysis job for one scope of an uploaded PDF.
 * Idempotent: the same file + language + scope always maps to the same job.
 */
export async function startJob(
  baseId: string,
  fileName: string,
  language: "en" | "ar",
  scope: Scope,
): Promise<{ jobId: string; job: JobState }> {
  const jobId = jobIdFor(baseId, scope);
  const existing = await readJson<JobState>(p.job(jobId));
  if (existing?.status === "done") return { jobId, job: existing };

  const meta = (await readJson<JobMeta>(p.meta(jobId))) ?? {
    baseId,
    fileName,
    language,
    scope,
    createdAt: new Date().toISOString(),
  };
  await writeJson(p.meta(jobId), meta);
  await patchJob(jobId, { status: "running", stage: "preparing", fileName, error: undefined });

  if (!running.has(jobId)) {
    void runJob(jobId).catch(() => {});
  }
  return { jobId, job: (await readJson<JobState>(p.job(jobId)))! };
}

/**
 * Current state of a job. If the job file says "running" but no runner exists
 * in this process (the server restarted mid-analysis), the runner is revived
 * from the cached PDF and completed parts.
 */
export async function getJob(jobId: string): Promise<JobState | null> {
  const job = await readJson<JobState>(p.job(jobId));
  if (!job) return null;
  if (job.status === "running" && !running.has(jobId)) {
    void runJob(jobId).catch(() => {});
  }
  return job;
}

async function cachedPart(jobId: string, index: number, run: () => Promise<any>): Promise<any> {
  const cached = await readJson<any>(p.part(jobId, index));
  if (cached) return cached;
  const result = await run();
  await writeJson(p.part(jobId, index), result);
  return result;
}

async function runJob(jobId: string) {
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    const meta = await readJson<JobMeta>(p.meta(jobId));
    if (!meta) throw new AnalysisError("The job's cached files are missing — please upload the PDF again.", 410);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fs.readFile(p.pdf(meta.baseId)));
    } catch {
      // Local cache lost (restart/prune mid-job) — the durable copy revives it.
      if (!(await restoreSourcePdf(meta.baseId))) {
        throw new AnalysisError("The job's cached PDF is gone from this server — upload the same PDF again to resume.", 410);
      }
      bytes = new Uint8Array(await fs.readFile(p.pdf(meta.baseId)));
    }

    const client = new Anthropic();
    const totalPages = await getPageCount(bytes);
    const selectedPages =
      meta.scope.type === "pages"
        ? rangesToPages(meta.scope.ranges).filter((page) => page >= 1 && page <= totalPages)
        : Array.from({ length: totalPages }, (_, i) => i + 1);
    if (!selectedPages.length) {
      throw new AnalysisError("The selected pages don't exist in this document.", 422);
    }
    const selectionRanges = pagesToRanges(selectedPages);
    const isWholeDoc = selectedPages.length === totalPages;

    // Decide (or restore) the chunk plan for this scope.
    let chunkPlan = meta.chunkPlan;
    if (!chunkPlan) {
      await patchJob(jobId, { stage: "measuring the selection" });
      let tokens = 0;
      try {
        const scopedB64 = isWholeDoc
          ? Buffer.from(bytes).toString("base64")
          : await slicePdf(bytes, { ranges: selectionRanges });
        tokens = await countPdfTokens(client, scopedB64);
      } catch {
        /* if measuring fails, try a single pass */
      }
      chunkPlan = planChunks(selectedPages, estimateParts(tokens, selectedPages.length));
      await writeJson(p.meta(jobId), { ...meta, chunkPlan });
    }

    const total = chunkPlan.length;
    const parts: any[] = [];
    for (let i = 0; i < total; i++) {
      const label = formatRanges(chunkPlan[i].ranges);
      await patchJob(jobId, {
        status: "running",
        partsTotal: total,
        partsDone: i,
        stage:
          total > 1
            ? `analyzing part ${i + 1} of ${total} (pages ${label})`
            : isWholeDoc
              ? "reading the document"
              : `reading pages ${label}`,
      });
      // A whole-document single pass needs no partial-document framing; a
      // page selection or multi-part pass always gets its page context.
      const chunkInfo = total === 1 && isWholeDoc ? null : { index: i + 1, total, pagesLabel: label };
      parts.push(
        await cachedPart(jobId, i, async () => {
          const b64 =
            total === 1 && isWholeDoc
              ? Buffer.from(bytes).toString("base64")
              : await slicePdf(bytes, chunkPlan![i]);
          return extractChunk(client, b64, meta.language, meta.fileName, chunkInfo);
        }),
      );
    }

    await patchJob(jobId, { partsTotal: total, partsDone: total, stage: "merging & resolving references" });
    const extracted = mergeExtractions(parts);
    const draft = toDraft(extracted, meta.fileName, meta.language);
    draft.sourceId = meta.baseId; // lets the wizard render candidate pages from the cached PDF
    // Drop hallucinated artwork pages beyond the document's actual length.
    for (const lesson of draft.lessons) {
      lesson.artPages = lesson.artPages.filter((p) => p <= totalPages);
    }
    if (!isWholeDoc) {
      draft.sourceNotes =
        `Analyzed pages ${formatRanges(selectionRanges)} of ${totalPages} only (curator's selection). ` +
        draft.sourceNotes;
    }
    await patchJob(jobId, { status: "done", stage: "done", draft, partsUsed: total });
  } catch (err) {
    const message =
      err instanceof AnalysisError
        ? err.message
        : err instanceof Anthropic.APIError
          ? `The analysis request failed (${err.status}: ${err.message}). Completed parts are saved — retry to resume.`
          : `The analysis failed (${String(err)}). Completed parts are saved — retry to resume.`;
    await patchJob(jobId, { status: "error", stage: "failed", error: message });
  } finally {
    running.delete(jobId);
  }
}
