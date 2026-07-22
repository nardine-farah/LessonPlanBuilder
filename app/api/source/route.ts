import { NextRequest } from "next/server";
import { AnalysisError } from "@/lib/extraction";
import { uidFromRequest } from "@/lib/firestore-server";
import { storeSourcePdf } from "@/lib/jobs";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 30 * 1024 * 1024;

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
    return Response.json(result);
  } catch (err) {
    if (err instanceof AnalysisError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: `Couldn't store the PDF (${String(err)}).` }, { status: 502 });
  }
}
