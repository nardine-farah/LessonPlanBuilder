import { NextRequest } from "next/server";
import { lessonPlanDocSchema } from "@/lib/schema";
import { buildPlanDoc, type Draft } from "@/lib/types";
import { adminDb, identityFromRequest, uploadLessonAudio } from "@/lib/firestore-server";
import { audioSignature, synthesize } from "@/lib/tts";

export const maxDuration = 600;

export const runtime = "nodejs";

/**
 * Publish a finished, checklist-complete plan into the Scripture Studio
 * library — the same write the Studio's `npm run db:seed:plans` performs
 * (lessonPlans/{planId} ← the validated LessonPlanDoc), but with
 * status "published" since the reviewer checklist is the review gate.
 *
 * Guards, in order:
 *  1. Signed-in reviewer whose email is on the allowed domain
 *     (PUBLISH_ALLOWED_DOMAIN, default biblica.com) — the library is live
 *     product data, not per-user data.
 *  2. The plan must be status "completed" with the checklist fully checked.
 *  3. The exported doc must pass the Studio's own schema.
 *  4. An existing library plan with the same planId is never overwritten
 *     unless the client explicitly re-sends with overwrite: true.
 */

const ALLOWED_DOMAIN = (process.env.PUBLISH_ALLOWED_DOMAIN ?? "biblica.com").toLowerCase();

export async function POST(req: NextRequest) {
  const caller = await identityFromRequest(req.headers.get("authorization"));
  if (!caller) return Response.json({ error: "Sign in to publish." }, { status: 401 });
  if (!caller.email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    return Response.json(
      { error: `Publishing to the Studio library is limited to @${ALLOWED_DOMAIN} accounts.` },
      { status: 403 },
    );
  }

  let body: { key?: string; overwrite?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body with a plan 'key'." }, { status: 400 });
  }
  const key = body.key ?? "";
  if (!/^[a-z0-9-]{1,80}$/.test(key)) {
    return Response.json({ error: "Missing or malformed 'key'." }, { status: 400 });
  }

  const planSnap = await adminDb()
    .collection("reviewerPlans")
    .doc(caller.uid)
    .collection("plans")
    .doc(key)
    .get();
  if (!planSnap.exists) {
    return Response.json({ error: "That plan isn't in your profile." }, { status: 404 });
  }
  const stored = planSnap.data() as {
    status: string;
    checklistDone: boolean;
    draftJson: string;
  };

  if (stored.status !== "completed") {
    return Response.json(
      { error: "Finish the plan in the builder before publishing." },
      { status: 422 },
    );
  }
  if (!stored.checklistDone) {
    return Response.json(
      { error: "The reviewer checklist isn't complete. Reopen the plan, work through every checklist item, and finish it again before publishing." },
      { status: 422 },
    );
  }

  let draft: Draft;
  try {
    draft = JSON.parse(stored.draftJson);
  } catch {
    return Response.json({ error: "This plan's saved data couldn't be read." }, { status: 422 });
  }

  const doc = { ...buildPlanDoc(draft), status: "published" };
  const parsed = lessonPlanDocSchema.safeParse(doc);
  if (!parsed.success) {
    return Response.json(
      {
        error: "The plan doesn't pass the Studio schema.",
        issues: parsed.error.issues.map((i) => `${i.path.join(" › ") || "plan"} — ${i.message}`),
      },
      { status: 422 },
    );
  }

  const libraryRef = adminDb().collection("lessonPlans").doc(parsed.data.planId);
  const existing = await libraryRef.get();
  if (existing.exists && !body.overwrite) {
    const current = existing.data() as { status?: string; lessonCount?: number } | undefined;
    return Response.json(
      {
        error: `“${parsed.data.planId}” already exists in the Studio library (${current?.status ?? "unknown"}, ${current?.lessonCount ?? "?"} lessons).`,
        exists: true,
      },
      { status: 409 },
    );
  }

  // Render reflection narration automatically (LESSON_PLAN_PLAN.md §6, but
  // hosted on Firebase Storage instead of the Studio's public/ folder — the
  // player takes the URL as-is). Unchanged scripts on a republish reuse the
  // already-rendered asset; failures never block the publish, since the
  // runtime simply hides a missing player.
  const audio = { rendered: 0, reused: 0, warnings: [] as string[] };
  const previousLessons: any[] = existing.exists ? ((existing.data() as any)?.lessons ?? []) : [];
  const voiceSig = audioSignature(parsed.data.language);
  for (const lesson of parsed.data.lessons) {
    if (!lesson.reflectionScript) continue;
    const prev = previousLessons.find((l) => l?.n === lesson.n);
    const prevAudio = prev?.media?.reflectionAudio;
    if (
      prev?.reflectionScript === lesson.reflectionScript &&
      typeof prevAudio?.asset === "string" &&
      prevAudio.asset.startsWith("http") &&
      // Reuse only recordings made with the CURRENT voice setup — a voice
      // upgrade re-renders everything on the next republish.
      prevAudio.asset.includes(`-${voiceSig}.mp3`)
    ) {
      lesson.media = { ...(lesson.media ?? {}), reflectionAudio: prevAudio };
      audio.reused++;
      continue;
    }
    try {
      const { mp3, durationSec } = await synthesize(lesson.reflectionScript, parsed.data.language);
      const url = await uploadLessonAudio(parsed.data.planId, lesson.n, mp3, voiceSig);
      lesson.media = { ...(lesson.media ?? {}), reflectionAudio: { asset: url, duration: durationSec } };
      audio.rendered++;
    } catch (e) {
      audio.warnings.push(`Lesson ${lesson.n}: ${e instanceof Error ? e.message : String(e)}`);
      if (audio.warnings.length >= 3) {
        audio.warnings.push("Stopped rendering after repeated failures — the plan publishes without the remaining narration audio.");
        break;
      }
    }
  }

  await libraryRef.set(parsed.data);

  const publishedAt = new Date().toISOString();
  await planSnap.ref.set({ publishedAt, publishedPlanId: parsed.data.planId }, { merge: true });

  return Response.json({ ok: true, planId: parsed.data.planId, publishedAt, audio });
}
