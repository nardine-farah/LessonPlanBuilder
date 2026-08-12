/**
 * The ONE lifecycle vocabulary for a reviewer's plan, shown identically on
 * the plans page and the admin dashboard. Stages are DERIVED from fields the
 * records already carry (status, checklistDone, publishedAt, updatedAt) —
 * nothing new is stored, so historical records need no migration:
 *
 *   in_progress        editing, never published
 *   awaiting_checklist finished, checklist incomplete (blocks publishing)
 *   ready              finished + checklist done, not in the library yet
 *   published          live in the library, no edits since publishing
 *   needs_republish    live in the library, but edited/refinished since —
 *                      the live copy is outdated until Republish
 *
 * An admin unpublish clears publishedAt (stamping unpublishedAt, keeping
 * publishedPlanId for attribution), so the plan falls back to `ready`.
 */

export type PlanStage = "in_progress" | "awaiting_checklist" | "ready" | "published" | "needs_republish";

export interface StageSource {
  status: string;
  checklistDone: boolean;
  updatedAt?: string;
  publishedAt?: string | null;
}

export function planStage(p: StageSource): PlanStage {
  if (p.publishedAt) {
    return p.updatedAt && p.updatedAt > p.publishedAt ? "needs_republish" : "published";
  }
  if (p.status !== "completed") return "in_progress";
  return p.checklistDone ? "ready" : "awaiting_checklist";
}

export const STAGE_INFO: Record<PlanStage, { label: string; badge: string; hint: string }> = {
  in_progress: {
    label: "In progress",
    badge: "badge-garnet",
    hint: "Being edited — has never been published.",
  },
  awaiting_checklist: {
    label: "Awaiting checklist",
    badge: "badge-gold",
    hint: "Finished — complete the reviewer checklist to make it publishable.",
  },
  ready: {
    label: "Ready to publish",
    badge: "badge-moss",
    hint: "Finished and checklist-complete — not in the Studio library yet.",
  },
  published: {
    label: "Published",
    badge: "badge-trust",
    hint: "Live in the Studio library, with no edits since publishing.",
  },
  needs_republish: {
    label: "Needs republish",
    badge: "badge-amber",
    hint: "Live in the Studio library, but edited since publishing — the live copy is outdated. Finish the plan (if open) and Republish to update it.",
  },
};

export const STAGE_ORDER: PlanStage[] = [
  "in_progress",
  "awaiting_checklist",
  "ready",
  "published",
  "needs_republish",
];

export function stageCounts(plans: StageSource[]): Record<PlanStage, number> {
  const counts: Record<PlanStage, number> = {
    in_progress: 0,
    awaiting_checklist: 0,
    ready: 0,
    published: 0,
    needs_republish: 0,
  };
  for (const p of plans) counts[planStage(p)]++;
  return counts;
}
