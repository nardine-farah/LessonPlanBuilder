import { NextRequest } from "next/server";
import { adminDb, uidFromRequest } from "@/lib/firestore-server";

export const runtime = "nodejs";

/**
 * Reviewer plan sync API. All Firestore access happens here (admin SDK) so
 * the project's deny-all client rules stay intact — same architecture as
 * Scripture Studio. Every request must carry the reviewer's Firebase ID
 * token; plans live at reviewerPlans/{uid}/plans/{key}.
 */

const KEY_PATTERN = /^[a-z0-9-]{1,80}$/;

function plansCollection(uid: string) {
  return adminDb().collection("reviewerPlans").doc(uid).collection("plans");
}

export async function GET(req: NextRequest) {
  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in to load your plans." }, { status: 401 });

  const snap = await plansCollection(uid).get();
  const plans = snap.docs.map((d) => d.data());
  return Response.json({ plans });
}

export async function PUT(req: NextRequest) {
  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in to save plans." }, { status: 401 });

  let plan: any;
  try {
    plan = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON plan record." }, { status: 400 });
  }
  if (!plan || typeof plan.key !== "string" || !KEY_PATTERN.test(plan.key) || typeof plan.draftJson !== "string") {
    return Response.json({ error: "Malformed plan record." }, { status: 400 });
  }
  if (plan.draftJson.length > 900_000) {
    return Response.json({ error: "This plan is too large to sync (over ~900KB)." }, { status: 413 });
  }

  // Out-of-order write guard: a slow, stale autosave must never overwrite a
  // newer write (e.g. regress a just-finished plan back to in_progress).
  const ref = plansCollection(uid).doc(plan.key);
  const existing = await ref.get();
  const prior = existing.exists ? (existing.data() as any) : null;
  const existingUpdatedAt = prior?.updatedAt ?? "";
  if (existingUpdatedAt && typeof plan.updatedAt === "string" && plan.updatedAt < existingUpdatedAt) {
    return Response.json({ ok: true, stale: true });
  }

  // Publish/finish markers are set by their own flows and survive rewrites:
  // a builder autosave (which builds a fresh record) must never erase the
  // fact that a plan was published to the library.
  if (prior) {
    if (prior.publishedAt && plan.publishedAt === undefined) plan.publishedAt = prior.publishedAt;
    if (prior.publishedPlanId && plan.publishedPlanId === undefined) plan.publishedPlanId = prior.publishedPlanId;
    if (prior.unpublishedAt && plan.unpublishedAt === undefined) plan.unpublishedAt = prior.unpublishedAt;
    if (prior.finishedAt && plan.finishedAt === undefined) plan.finishedAt = prior.finishedAt;
  }

  await ref.set(plan);
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const uid = await uidFromRequest(req.headers.get("authorization"));
  if (!uid) return Response.json({ error: "Sign in to delete plans." }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!KEY_PATTERN.test(key)) {
    return Response.json({ error: "Missing or malformed 'key'." }, { status: 400 });
  }
  await plansCollection(uid).doc(key).delete();
  return Response.json({ ok: true });
}
