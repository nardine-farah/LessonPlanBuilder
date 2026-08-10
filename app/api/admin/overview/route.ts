import { NextRequest } from "next/server";
import {
  planProgress,
  type AdminLibraryPlan,
  type AdminOverview,
  type AdminPlanSummary,
  type AdminUser,
} from "@/lib/adminData";
import { adminAuth, adminDb, requireAdmin } from "@/lib/firestore-server";

export const runtime = "nodejs";

/**
 * The whole admin picture in one authed read: every reviewer profile with
 * every plan (progress computed HERE, from the stored draftJson — the raw
 * draft never travels to the browser), plus the Studio library with each
 * plan joined back to the profile that published it.
 *
 * Scale note: this parses each profile plan's draftJson (≤900KB each) on
 * every load. Fine for a curation team; revisit with denormalized progress
 * fields if profiles ever number in the hundreds.
 */

interface StoredPlanDoc {
  key?: string;
  status?: string;
  checklistDone?: boolean;
  draftJson?: string;
  title?: string;
  planId?: string;
  language?: string;
  lessonCount?: number;
  sourceFileName?: string;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  publishedAt?: string;
  publishedPlanId?: string;
}

function toSummary(docId: string, data: StoredPlanDoc): AdminPlanSummary {
  let progress: AdminPlanSummary["progress"] = null;
  try {
    const draft = JSON.parse(data.draftJson ?? "");
    if (draft && Array.isArray(draft.lessons)) {
      progress = planProgress(draft, data.status ?? "in_progress", !!data.checklistDone);
    }
  } catch {
    /* unreadable draft — surfaced as progress: null */
  }
  return {
    key: data.key || docId,
    title: data.title || "Untitled plan",
    planId: data.planId || "",
    language: data.language || "en",
    lessonCount: typeof data.lessonCount === "number" ? data.lessonCount : (progress?.lessonsTotal ?? 0),
    sourceFileName: data.sourceFileName || "",
    status: data.status === "completed" ? "completed" : "in_progress",
    checklistDone: !!data.checklistDone,
    createdAt: data.createdAt || "",
    updatedAt: data.updatedAt || "",
    finishedAt: data.finishedAt,
    publishedAt: data.publishedAt,
    publishedPlanId: data.publishedPlanId,
    progress,
  };
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req.headers.get("authorization"));
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  const db = adminDb();

  // Every reviewer plan across every profile. The path check pins results to
  // reviewerPlans/{uid}/plans/{key} — a collection-group query would match
  // any other "plans" subcollection this shared project ever grows.
  const plansSnap = await db.collectionGroup("plans").get();
  const byUid = new Map<string, AdminPlanSummary[]>();
  for (const doc of plansSnap.docs) {
    const segments = doc.ref.path.split("/");
    if (segments.length !== 4 || segments[0] !== "reviewerPlans") continue;
    const uid = segments[1];
    const list = byUid.get(uid) ?? [];
    list.push(toSummary(doc.id, doc.data() as StoredPlanDoc));
    byUid.set(uid, list);
  }

  // Resolve profile identities (batches of 100 — the Admin SDK's limit).
  // A failed lookup degrades to uid-labeled rows instead of failing the view.
  const uids = [...byUid.keys()];
  const accounts = new Map<string, { email: string; displayName: string; photoURL: string }>();
  try {
    for (let i = 0; i < uids.length; i += 100) {
      const res = await adminAuth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
      for (const u of res.users) {
        accounts.set(u.uid, {
          email: u.email ?? "",
          displayName: u.displayName ?? "",
          photoURL: u.photoURL ?? "",
        });
      }
    }
  } catch {
    /* identities stay unresolved */
  }

  const users: AdminUser[] = uids.map((uid) => {
    const account = accounts.get(uid);
    const plans = (byUid.get(uid) ?? []).sort((a, b) => {
      if (a.status !== b.status) return a.status === "in_progress" ? -1 : 1;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });
    return {
      uid,
      email: account?.email ?? "",
      displayName: account?.displayName ?? "",
      photoURL: account?.photoURL ?? "",
      accountExists: !!account,
      lastActive: plans.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), ""),
      counts: {
        total: plans.length,
        inProgress: plans.filter((p) => p.status === "in_progress").length,
        completed: plans.filter((p) => p.status === "completed").length,
        published: plans.filter((p) => p.publishedAt).length,
      },
      plans,
    };
  });
  users.sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  // planId → the profile that most recently published it, for the library join.
  const publisherByPlanId = new Map<string, { uid: string; publishedAt: string }>();
  for (const u of users) {
    for (const p of u.plans) {
      if (!p.publishedPlanId || !p.publishedAt) continue;
      const current = publisherByPlanId.get(p.publishedPlanId);
      if (!current || p.publishedAt > current.publishedAt) {
        publisherByPlanId.set(p.publishedPlanId, { uid: u.uid, publishedAt: p.publishedAt });
      }
    }
  }

  // The Studio library — light fields only; the lessons array (the bulk of
  // each doc) stays in Firestore.
  const librarySnap = await db
    .collection("lessonPlans")
    .select("planId", "title", "subtitle", "language", "translation", "lessonCount", "span", "status", "reviewedBy")
    .get();
  const library: AdminLibraryPlan[] = librarySnap.docs
    .map((doc) => {
      const data = doc.data() as Partial<AdminLibraryPlan>;
      const planId = data.planId || doc.id;
      const publisher = publisherByPlanId.get(planId);
      const account = publisher ? accounts.get(publisher.uid) : undefined;
      return {
        planId,
        title: data.title || planId,
        subtitle: data.subtitle || "",
        language: data.language || "",
        translation: data.translation || "",
        lessonCount: typeof data.lessonCount === "number" ? data.lessonCount : null,
        span: data.span || "",
        status: data.status || "unknown",
        reviewedBy: data.reviewedBy || "",
        publishedBy: publisher
          ? {
              uid: publisher.uid,
              email: account?.email ?? "",
              displayName: account?.displayName ?? "",
            }
          : null,
        publishedAt: publisher?.publishedAt ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  const allPlans = users.flatMap((u) => u.plans);
  const overview: AdminOverview = {
    users,
    library,
    totals: {
      reviewers: users.length,
      plans: allPlans.length,
      inProgress: allPlans.filter((p) => p.status === "in_progress").length,
      completed: allPlans.filter((p) => p.status === "completed").length,
      published: allPlans.filter((p) => p.publishedAt).length,
      libraryPlans: library.length,
    },
  };
  return Response.json(overview);
}
