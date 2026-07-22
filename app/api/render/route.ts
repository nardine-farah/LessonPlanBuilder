import { NextRequest } from "next/server";
import { uidFromRequest } from "@/lib/firestore-server";
import { RenderError, renderPdfFromBytes, renderPdfPage } from "@/lib/render";

export const runtime = "nodejs";

/**
 * GET /api/render?source={contentHash}&page={n}&w={px} — render one page of
 * an analyzed PDF as a PNG for the lesson-image picker. Requires a signed-in
 * reviewer (the client fetches with a bearer token and displays blob URLs) —
 * uploaded ministry documents shouldn't be renderable by anonymous callers.
 */
export async function GET(req: NextRequest) {
  // Unauthenticated health probe: renders a synthetic in-memory PDF, proving
  // the mupdf WASM pipeline works on this runtime without touching any
  // uploaded document.
  if (req.nextUrl.searchParams.get("selftest") === "1") {
    try {
      const { PDFDocument, StandardFonts } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      const page = doc.addPage([300, 200]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText("render selftest", { x: 40, y: 90, size: 18, font });
      const t0 = Date.now();
      const r = await renderPdfFromBytes(await doc.save(), 1, 200);
      return Response.json({ ok: true, width: r.width, height: r.height, ms: Date.now() - t0 });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 500 });
    }
  }

  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in to render pages." }, { status: 401 });

  const source = req.nextUrl.searchParams.get("source") ?? "";
  const page = Number(req.nextUrl.searchParams.get("page") ?? "0");
  const w = Math.min(1600, Math.max(120, Number(req.nextUrl.searchParams.get("w") ?? "480")));

  if (!/^[a-f0-9]{24}$/.test(source)) {
    return Response.json({ error: "Missing or malformed 'source'." }, { status: 400 });
  }
  try {
    const { png } = await renderPdfPage(source, page, w);
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // Renders are deterministic for a given content hash — cache hard.
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (err) {
    if (err instanceof RenderError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: `Rendering failed (${String(err)}).`, code: "render" }, { status: 500 });
  }
}
