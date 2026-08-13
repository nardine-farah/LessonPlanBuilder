import { auth } from "./firebase";
import { normalizeDraft, type Draft } from "./types";

/**
 * Reviewer plan sync (client side). Plans live at
 * reviewerPlans/{uid}/plans/{key} in Firestore, but the browser never touches
 * Firestore directly — all reads/writes go through /api/plans with the
 * reviewer's Firebase ID token, matching Scripture Studio's deny-all client
 * rules. "in_progress" while it's the working draft in the builder,
 * "completed" once finished.
 */

export type PlanStatus = "in_progress" | "completed";

export interface StoredPlan {
  key: string;
  status: PlanStatus;
  checklistDone: boolean;
  /** JSON.stringify(Draft) — parse with parseStoredDraft. */
  draftJson: string;
  /* Denormalized for list rendering without parsing the draft. */
  title: string;
  planId: string;
  language: string;
  lessonCount: number;
  sourceFileName: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** Set by /api/publish when the plan is written into the Studio library. */
  publishedAt?: string;
  publishedPlanId?: string;
  /** Set by an admin unpublish (publishedAt is cleared; attribution stays). */
  unpublishedAt?: string;
}

export class PublishConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const user = auth().currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();
  return fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

export function newPlanKey(draft: Draft): string {
  const slug = (draft.planId || draft.title || "plan")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "plan"}-${Date.now()}`;
}

export function planRecord(
  key: string,
  draft: Draft,
  status: PlanStatus,
  checklistDone: boolean,
  createdAt?: string,
): StoredPlan {
  const now = new Date().toISOString();
  const record: StoredPlan = {
    key,
    status,
    checklistDone,
    draftJson: JSON.stringify(draft),
    title: draft.title || "Untitled plan",
    planId: draft.planId || "",
    language: draft.language,
    lessonCount: draft.lessons.length,
    sourceFileName: draft.sourceFileName || "",
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
  if (status === "completed") record.finishedAt = now;
  return record;
}

export async function savePlan(plan: StoredPlan): Promise<void> {
  const res = await authedFetch("/api/plans", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Save failed (HTTP ${res.status}).`);
  }
}

export async function listPlans(): Promise<StoredPlan[]> {
  const res = await authedFetch("/api/plans");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Load failed (HTTP ${res.status}).`);
  }
  const { plans } = (await res.json()) as { plans: StoredPlan[] };
  // In-progress first, then most recently touched.
  return plans.sort((a, b) => {
    if (a.status !== b.status) return a.status === "in_progress" ? -1 : 1;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

export async function deletePlan(key: string): Promise<void> {
  const res = await authedFetch(`/api/plans?key=${encodeURIComponent(key)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Delete failed (HTTP ${res.status}).`);
  }
}

export interface PublishAudioSummary {
  /** Narrations carried from builder-time renders (publish never synthesizes). */
  fromBuilder: number;
  /** Legacy grace: unchanged scripts keeping the narration a past publish rendered. */
  reused: number;
  warnings: string[];
}

export interface PublishProgress {
  percent: number;
  /** Machine-readable phase: validated | audio | library | marker | done. */
  stage: string;
  message: string;
  detail?: string;
}

export type PublishResult = { planId: string; publishedAt: string; audio?: PublishAudioSummary };

/**
 * Publish a completed, checklist-done plan into the Studio library.
 *
 * The route answers its gates (401/403/404/422/409) with ordinary JSON, then
 * streams NDJSON progress for the committing phase — narration synthesis can
 * take a minute on a long plan, so `onProgress` drives a live overlay instead
 * of a silent spinner. A pre-streaming server (or any non-NDJSON reply) still
 * works: the single JSON object is returned as the result.
 */
export async function publishPlan(
  key: string,
  overwrite = false,
  onProgress?: (p: PublishProgress) => void,
): Promise<PublishResult> {
  const res = await authedFetch("/api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, overwrite }),
  });

  const streaming = res.headers.get("content-type")?.includes("ndjson") && res.body;
  if (!streaming) {
    const body = await res.json().catch(() => null);
    if (res.status === 409 && body?.exists) {
      throw new PublishConflictError(body.error ?? "A plan with this planId already exists in the library.");
    }
    if (!res.ok) {
      const issues = Array.isArray(body?.issues) ? ` ${body.issues.join("; ")}` : "";
      throw new Error((body?.error ?? `Publish failed (HTTP ${res.status}).`) + issues);
    }
    return body as PublishResult;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: PublishResult | null = null;
  let failure: string | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return; // ignore a partial/garbled line rather than failing the publish
    }
    if (event.type === "progress" || event.type === "done") {
      onProgress?.({
        percent: typeof event.percent === "number" ? event.percent : 0,
        stage: event.stage ?? "",
        message: event.message ?? "",
        detail: event.detail,
      });
    }
    if (event.type === "done") result = event.result as PublishResult;
    if (event.type === "error") failure = event.error ?? "Publishing failed part-way through.";
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    if (done) break;
  }
  handleLine(buffer);

  if (failure) throw new Error(failure);
  if (!result) {
    throw new Error("The publish ended without confirming — check the library before retrying.");
  }
  return result;
}

export function parseStoredDraft(plan: StoredPlan): Draft | null {
  try {
    const draft = JSON.parse(plan.draftJson);
    return draft && Array.isArray(draft.lessons) ? normalizeDraft(draft as Draft) : null;
  } catch {
    return null;
  }
}
