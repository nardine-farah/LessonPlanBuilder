import { NextRequest } from "next/server";
import { AnalysisError, SINGLE_PASS_MAX_TOKENS, estimateParts } from "@/lib/extraction";
import { parsePageSpec } from "@/lib/pages";
import {
  JOB_ID_PATTERN,
  fitsSinglePass,
  getJob,
  hashUpload,
  registerUpload,
  startJob,
  type Scope,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 600;

const MAX_PDF_BYTES = 30 * 1024 * 1024;
/** With an unknown token count, documents up to this many pages just try a single pass. */
const UNMEASURED_SINGLE_PASS_PAGES = 60;

/**
 * POST — register an upload; measure it; then either start the analysis job
 * or, for oversized (or unmeasurable) documents, return `needsChoice` so the
 * curator decides between a page selection (`mode=pages&pages=1-10,15,22-30`)
 * and processing everything in parts (`mode=all`). Jobs are keyed by content
 * hash + scope, so re-uploading the same file with the same choice resumes
 * cached work.
 */
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 },
    );
  }

  let file: File | null = null;
  let targetLanguage: "en" | "ar" = "en";
  let mode: string | null = null;
  let pagesSpec = "";
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
    targetLanguage = form.get("language") === "ar" ? "ar" : "en";
    mode = (form.get("mode") as string | null) ?? null;
    pagesSpec = (form.get("pages") as string | null) ?? "";
  } catch {
    return Response.json({ error: "Expected multipart form data with a 'file' field." }, { status: 400 });
  }

  if (!file) return Response.json({ error: "No PDF uploaded." }, { status: 400 });
  if (file.size > MAX_PDF_BYTES) {
    return Response.json({ error: "PDF is larger than 30 MB. Split it or compress it first." }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const baseId = hashUpload(bytes, targetLanguage);

  try {
    const measurement = await registerUpload(baseId, bytes, file.name);

    let scope: Scope;
    if (mode === "pages") {
      const parsed = parsePageSpec(pagesSpec, measurement.pageCount);
      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: 400 });
      }
      scope = { type: "pages", ranges: parsed.ranges };
    } else if (mode === "all") {
      scope = { type: "full" };
    } else if (
      fitsSinglePass(measurement) ||
      (measurement.tokens === 0 && measurement.pageCount <= UNMEASURED_SINGLE_PASS_PAGES)
    ) {
      scope = { type: "full" };
    } else {
      // Too big (or too big to be sure) for one pass, and no choice made yet.
      // With an unknown token count, estimate from pages (~2.5k tokens/page).
      const tokensForEstimate = measurement.tokens || measurement.pageCount * 2500;
      return Response.json({
        needsChoice: true,
        fileName: file.name,
        measurement: {
          tokens: measurement.tokens, // 0 = could not be measured
          pageCount: measurement.pageCount,
          singlePassMaxTokens: SINGLE_PASS_MAX_TOKENS,
          estimatedParts: Math.max(estimateParts(tokensForEstimate, measurement.pageCount), 2),
        },
      });
    }

    const { jobId, job } = await startJob(baseId, file.name, targetLanguage, scope);
    return Response.json({ jobId, job }, { status: job.status === "done" ? 200 : 202 });
  } catch (err) {
    if (err instanceof AnalysisError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: `The analysis failed to start (${String(err)}).` }, { status: 502 });
  }
}

/** GET ?job={id} — poll a job's progress; revives orphaned jobs after a server restart. */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");
  if (!jobId || !JOB_ID_PATTERN.test(jobId)) {
    return Response.json({ error: "Missing or malformed 'job' parameter." }, { status: 400 });
  }
  const job = await getJob(jobId);
  if (!job) {
    return Response.json({ error: "Unknown job — the analysis cache may have been cleared. Upload the PDF again." }, { status: 404 });
  }
  return Response.json({ jobId, job });
}
