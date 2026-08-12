import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { adminDb, requireAdmin } from "@/lib/firestore-server";

export const runtime = "nodejs";

/**
 * Admin unpublish: take a plan OUT of what leaders see without deleting
 * anything. The Studio lists only status=="published" docs, so flipping the
 * library copy to "draft" hides it instantly while it stays in lessonPlans
 * (visible to admins, labeled draft). The owning reviewer's record loses its
 * live marker (publishedAt → unpublishedAt; publishedPlanId stays for
 * attribution), so their plan reads "Ready to publish" — republishing brings
 * it back. This is the admin dashboard's only write action.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req.headers.get("authorization"));
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  let body: { planId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body with a 'planId'." }, { status: 400 });
  }
  const planId = body.planId ?? "";
  if (!/^[a-z0-9-]{3,60}$/.test(planId)) {
    return Response.json({ error: "Missing or malformed 'planId'." }, { status: 400 });
  }

  const db = adminDb();
  const libraryRef = db.collection("lessonPlans").doc(planId);
  const doc = await libraryRef.get();
  if (!doc.exists) return Response.json({ error: "That plan isn't in the library." }, { status: 404 });
  if ((doc.data() as { status?: string }).status !== "published") {
    return Response.json({ error: "That plan isn't published." }, { status: 409 });
  }

  await libraryRef.set({ status: "draft" }, { merge: true });

  // Clear the live marker on every reviewer record that published this plan.
  // (Per-profile queries instead of a collection-group filter — those need a
  // manually-enabled index; this stays index-free at team scale.)
  const unpublishedAt = new Date().toISOString();
  let ownersUpdated = 0;
  for (const profile of await db.collection("reviewerPlans").listDocuments()) {
    const snap = await profile.collection("plans").where("publishedPlanId", "==", planId).get();
    for (const planDoc of snap.docs) {
      await planDoc.ref.update({ publishedAt: FieldValue.delete(), unpublishedAt });
      ownersUpdated++;
    }
  }

  return Response.json({ ok: true, planId, status: "draft", ownersUpdated, unpublishedAt });
}
