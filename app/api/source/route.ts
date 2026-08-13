import { promises as fs } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { AnalysisError } from "@/lib/extraction";
import { uidFromRequest } from "@/lib/firestore-server";
import { storeSourcePdf } from "@/lib/jobs";
import { hasDurableSourcePdf } from "@/lib/sourceStore";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 30 * 1024 * 1024;

/**
 * GET /api/source?sourceId=… — is this plan's PDF actually linked? `durable`
 * means a permanent copy exists in Storage (renders work after any rollout);
 * `cached` means only this instance's disk has it. Lets the builder tell the
 * curator the truth instead of assuming a sourceId implies a usable file.
 */
export async function GET(req: NextRequest) {
  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in first." }, { status: 401 });

  const sourceId = req.nextUrl.searchParams.get("sourceId") ?? "";
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sourceId)) {
    return Response.json({ error: "Missing or malformed 'sourceId'." }, { status: 400 });
  }
  const cached = await fs
    .access(path.join(process.cwd(), ".analysis-cache", `${sourceId}.pdf`))
    .then(() => true)
    .catch(() => false);
  return Response.json({ sourceId, cached, durable: await hasDurableSourcePdf(sourceId) });
}

/**
 * POST /api/source — attach a source PDF to an existing draft (no analysis,
 * no AI cost). Stores the file in the render cache and returns its sourceId,
 * so the lesson-image picker can render pages for plans that were analyzed
 * before sourceId existed, or on a server whose cache no longer has the file.
 */
export async function POST(req: NextRequest) {
  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in to attach a source PDF." }, { status: 401 });

  let file: File | null = null;
  let language = "en";
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
    language = form.get("language") === "ar" ? "ar" : "en";
  } catch {
    return Response.json({ error: "Expected multipart form data with a 'file' field." }, { status: 400 });
  }
  if (!file) return Response.json({ error: "No PDF uploaded." }, { status: 400 });
  if (file.size > MAX_PDF_BYTES) {
    return Response.json({ error: "PDF is larger than 30 MB." }, { status: 413 });
  }

  try {
    const result = await storeSourcePdf(new Uint8Array(await file.arrayBuffer()), language);
    // `durable` tells the client whether the permanent Storage copy landed —
    // if it didn't, this attach only lasts until the next rollout.
    return Response.json(result);
  } catch (err) {
    if (err instanceof AnalysisError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: `Couldn't store the PDF (${String(err)}).` }, { status: 502 });
  }
}
