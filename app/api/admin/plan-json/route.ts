import { NextRequest } from "next/server";
import { adminDb, requireAdmin } from "@/lib/firestore-server";
import { buildPlanDoc, normalizeDraft, type Draft } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Admin download of any profile's plan as the seed-file JSON — the exact
 * export the owner gets from the Review step (status stays "draft"; the
 * admin view never publishes). Fetched on demand so the overview payload
 * stays light.
 */

const KEY_PATTERN = /^[a-z0-9-]{1,80}$/;
const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req.headers.get("authorization"));
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  const uid = req.nextUrl.searchParams.get("uid") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!UID_PATTERN.test(uid) || !KEY_PATTERN.test(key)) {
    return Response.json({ error: "Missing or malformed 'uid' / 'key'." }, { status: 400 });
  }

  const snap = await adminDb().collection("reviewerPlans").doc(uid).collection("plans").doc(key).get();
  if (!snap.exists) return Response.json({ error: "That plan no longer exists." }, { status: 404 });

  try {
    const draft: Draft = JSON.parse((snap.data() as { draftJson?: string }).draftJson ?? "");
    if (!draft || !Array.isArray(draft.lessons)) throw new Error("not a draft");
    const doc = buildPlanDoc(normalizeDraft(draft));
    return Response.json({ fileName: `${draft.planId || key}.json`, doc });
  } catch {
    return Response.json({ error: "This plan's saved data couldn't be read." }, { status: 422 });
  }
}
