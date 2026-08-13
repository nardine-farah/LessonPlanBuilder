import { NextRequest } from "next/server";
import { identityFromRequest, uploadLessonAudio } from "@/lib/firestore-server";
import { audioSignature, synthesize } from "@/lib/tts";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Render ONE lesson's reflection narration while editing, so the reviewer can
 * listen and fix the script before finishing — publishing no longer
 * synthesizes anything. Each render uploads a unique object (a re-render must
 * never break a URL an already-published plan still serves); the draft keeps
 * {url, duration, script, voice} and treats the audio as stale the moment the
 * script diverges from what it was rendered from.
 */

const MAX_SCRIPT_CHARS = 2000; // matches the Studio schema's reflectionScript cap

export async function POST(req: NextRequest) {
  const caller = await identityFromRequest(req.headers.get("authorization"));
  if (!caller) return Response.json({ error: "Sign in to render narration." }, { status: 401 });

  let body: { script?: string; language?: string; planId?: string; n?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const script = typeof body.script === "string" ? body.script.trim() : "";
  if (!script) return Response.json({ error: "Nothing to render — the reflection script is empty." }, { status: 422 });
  if (script.length > MAX_SCRIPT_CHARS) {
    return Response.json(
      { error: `The reflection script is over ${MAX_SCRIPT_CHARS} characters — shorten it first.` },
      { status: 422 },
    );
  }
  const language = body.language === "ar" ? "ar" : "en";
  const n = Number.isInteger(body.n) && (body.n as number) >= 1 ? (body.n as number) : 0;
  if (!n) return Response.json({ error: "Missing lesson number." }, { status: 400 });

  // Storage folder: the plan's slug when it has one, else a per-reviewer
  // drafts folder — the URL is what matters, the path is just organization.
  const folder =
    typeof body.planId === "string" && /^[a-z0-9-]{3,60}$/.test(body.planId)
      ? body.planId
      : `drafts-${caller.uid}`;

  try {
    const voice = audioSignature(language);
    const { mp3, durationSec } = await synthesize(script, language);
    const url = await uploadLessonAudio(folder, n, mp3, voice, true);
    return Response.json({ url, duration: durationSec, script, voice });
  } catch (e) {
    return Response.json(
      { error: `Narration failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
