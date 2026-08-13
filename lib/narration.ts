import { authedFetch } from "./planStore";
import type { DraftLesson, DraftLessonAudio } from "./types";

/**
 * Client side of in-editor narration rendering (/api/lesson-audio): render a
 * lesson's reflection script to MP3 so the reviewer can listen and iterate.
 * The returned record stores the exact script it was rendered from — the
 * freshness check (types.narrationFresh) compares against it, and the Review
 * step blocks finishing until every scripted lesson has fresh audio.
 */
export async function renderNarration(
  lesson: DraftLesson,
  planId: string,
  language: "en" | "ar",
): Promise<DraftLessonAudio> {
  const res = await authedFetch("/api/lesson-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script: lesson.reflectionScript, language, planId, n: lesson.n }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Narration failed (HTTP ${res.status}).`);
  return {
    url: body.url as string,
    duration: typeof body.duration === "number" ? body.duration : 0,
    script: lesson.reflectionScript,
    voice: typeof body.voice === "string" ? body.voice : "",
  };
}
