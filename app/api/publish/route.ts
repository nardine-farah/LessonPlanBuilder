import { NextRequest } from "next/server";
import { planScreenIssues } from "@/lib/screens";
import { lessonPlanDocSchema } from "@/lib/schema";
import { buildPlanDoc, type Draft } from "@/lib/types";
import { adminDb, identityFromRequest } from "@/lib/firestore-server";
import { audioSignature } from "@/lib/tts";

export const maxDuration = 120;

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
 *  4. Every lesson's four screens (Hear · Understand · Check · Respond) must
 *     carry their required blocks (lib/screens.ts) — the schema keeps these
 *     fields optional for legacy plans, so the screen rule is its own gate.
 *  5. An existing library plan with the same planId is never overwritten
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

  const screenIssues = planScreenIssues(draft);
  if (screenIssues.length > 0) {
    return Response.json(
      {
        error:
          "Every lesson screen needs its required blocks — Hear (Scripture), Understand (main teaching), Check (quiz), Respond (reflection prompt + closing prayer). Reopen the plan, fill what's missing, and finish it again.",
        issues: screenIssues,
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

  // Everything above is a fast gate answered with a normal JSON status code
  // (401/403/404/422/409). From here the publish is committing and can take a
  // while — narration is synthesized per lesson — so the rest streams NDJSON
  // progress events, which the plans page renders as a live overlay.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const doc = parsed.data;
        const scripted = doc.lessons.filter((l) => l.reflectionScript);
        // Narration is RENDERED IN THE BUILDER now (the Review step blocks
        // finishing until every script has fresh audio), so publish only
        // carries recordings — it never synthesizes. The audio pass is a
        // quick check, not the long middle it used to be.
        const AUDIO_FROM = 15;
        const AUDIO_TO = 60;
        const audioPercent = (done: number) =>
          scripted.length ? AUDIO_FROM + ((AUDIO_TO - AUDIO_FROM) * done) / scripted.length : AUDIO_TO;

        send({
          type: "progress",
          percent: AUDIO_FROM,
          stage: "validated",
          message: `“${doc.title}” passes the Studio schema`,
          detail: `${doc.lessons.length} lesson${doc.lessons.length === 1 ? "" : "s"}${
            scripted.length ? ` · ${scripted.length} with reflection narration` : " · no narration"
          }`,
        });

        const audio = { fromBuilder: 0, reused: 0, warnings: [] as string[] };
        const previousLessons: any[] = existing.exists ? ((existing.data() as any)?.lessons ?? []) : [];
        const voiceSig = audioSignature(doc.language);
        let handled = 0;
        for (const lesson of doc.lessons) {
          if (!lesson.reflectionScript) continue;
          handled++;
          // buildPlanDoc already placed the builder-rendered recording (only
          // when fresh for its script) into media.reflectionAudio.
          if (typeof lesson.media?.reflectionAudio?.asset === "string") {
            audio.fromBuilder++;
            send({
              type: "progress",
              percent: audioPercent(handled),
              stage: "audio",
              message: `Using the narration rendered in the builder — lesson ${lesson.n}`,
              detail: `${handled} of ${scripted.length} checked`,
            });
            continue;
          }
          // Legacy grace: plans finished before in-editor rendering existed.
          // An unchanged script keeps the narration the last publish rendered
          // (same voice only — the filename carries the voice signature).
          const prev = previousLessons.find((l) => l?.n === lesson.n);
          const prevAudio = prev?.media?.reflectionAudio;
          if (
            prev?.reflectionScript === lesson.reflectionScript &&
            typeof prevAudio?.asset === "string" &&
            prevAudio.asset.startsWith("http") &&
            prevAudio.asset.includes(`-${voiceSig}.mp3`)
          ) {
            lesson.media = { ...(lesson.media ?? {}), reflectionAudio: prevAudio };
            audio.reused++;
            send({
              type: "progress",
              percent: audioPercent(handled),
              stage: "audio",
              message: `Keeping the previously published narration — lesson ${lesson.n}`,
              detail: "Its reflection script hasn't changed since the last publish",
            });
            continue;
          }
          audio.warnings.push(
            `Lesson ${lesson.n} has a reflection script but no rendered narration — reopen the plan, render it in the Lessons step, and republish.`,
          );
          send({
            type: "progress",
            percent: audioPercent(handled),
            stage: "audio",
            message: `No narration for lesson ${lesson.n} — publishing without it`,
            detail: "Render it in the Lessons step and republish to add the audio",
          });
        }

        send({
          type: "progress",
          percent: 90,
          stage: "library",
          message: "Writing the plan into the Studio library",
          detail: doc.planId,
        });
        await libraryRef.set(doc);

        send({
          type: "progress",
          percent: 96,
          stage: "marker",
          message: "Marking the plan as published in your profile",
        });
        const publishedAt = new Date().toISOString();
        await planSnap.ref.set({ publishedAt, publishedPlanId: doc.planId }, { merge: true });

        send({
          type: "done",
          percent: 100,
          stage: "done",
          message: `“${doc.title}” is live in the Studio library`,
          result: { ok: true, planId: doc.planId, publishedAt, audio },
        });
      } catch (e) {
        // The stream already carries a 200, so failures are reported in-band.
        send({
          type: "error",
          error: e instanceof Error ? e.message : "Publishing failed part-way through.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Defeat any proxy buffering so events arrive as they happen.
      "X-Accel-Buffering": "no",
    },
  });
}
