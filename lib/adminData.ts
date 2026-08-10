import { lessonPlanDocSchema } from "./schema";
import { buildPlanDoc, normalizeDraft, type Draft, type DraftLesson } from "./types";

/**
 * Admin dashboard data — the shapes /api/admin/* returns and the progress
 * scoring behind them, shared with the /admin page so client and server
 * agree. Everything is DERIVED from a reviewer's stored record: the admin
 * view is strictly read-only and the raw draftJson never leaves the server
 * (only these summaries do; the export doc is fetched per plan on demand).
 */

export interface LessonProgress {
  n: number;
  title: string;
  ref: string;
  /** The schema-required core: title + passage ref + USFM code. */
  core: boolean;
  teaching: boolean;
  keyIdea: boolean;
  reflection: boolean;
  prayer: boolean;
  /** "ok" passes the Studio quiz rules; "partial" is enabled but incomplete; "off" not offered. */
  quiz: "ok" | "partial" | "off";
  image: boolean;
  supporting: number;
}

export interface PlanProgress {
  /** 0–100, weighted to the wizard: naming 15, tags 10, lessons 60, finish 15. */
  percent: number;
  details: boolean;
  detailsFilled: number;
  detailsTotal: number;
  audience: boolean;
  lessonsTotal: number;
  /** Lessons with core + teaching + key idea — "drafted". */
  lessonsComplete: number;
  imagesChosen: number;
  quizzesOk: number;
  schemaValid: boolean;
  schemaIssueCount: number;
  /** First few issues, prettified like the publish route's messages. */
  schemaIssues: string[];
  lessons: LessonProgress[];
}

export interface AdminPlanSummary {
  key: string;
  title: string;
  planId: string;
  language: string;
  lessonCount: number;
  sourceFileName: string;
  status: "in_progress" | "completed";
  checklistDone: boolean;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  publishedAt?: string;
  publishedPlanId?: string;
  /** Null when the stored draftJson couldn't be parsed. */
  progress: PlanProgress | null;
}

export interface AdminUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  /** False when the Firebase account no longer exists (plans outlive accounts). */
  accountExists: boolean;
  /** Most recent updatedAt across the profile's plans. */
  lastActive: string;
  counts: { total: number; inProgress: number; completed: number; published: number };
  plans: AdminPlanSummary[];
}

export interface AdminLibraryPlan {
  planId: string;
  title: string;
  subtitle: string;
  language: string;
  translation: string;
  lessonCount: number | null;
  span: string;
  status: string;
  reviewedBy: string;
  /** The reviewer profile that published it — null for Studio seeds / pre-tracking writes. */
  publishedBy: { uid: string; email: string; displayName: string } | null;
  publishedAt: string | null;
}

export interface AdminOverview {
  users: AdminUser[];
  library: AdminLibraryPlan[];
  totals: {
    reviewers: number;
    plans: number;
    inProgress: number;
    completed: number;
    published: number;
    libraryPlans: number;
  };
}

const has = (s: string | null | undefined) => typeof s === "string" && s.trim().length > 0;

export function lessonProgress(l: DraftLesson): LessonProgress {
  const quiz = l.quiz ?? { enabled: false, question: "", options: [], good: "", bad: "", reflectPrompt: "" };
  const filledOptions = (quiz.options ?? []).filter((o) => has(o.text));
  const quizOk =
    quiz.enabled &&
    has(quiz.question) &&
    filledOptions.length >= 2 &&
    filledOptions.filter((o) => o.correct).length === 1 &&
    has(quiz.good) &&
    has(quiz.bad) &&
    has(quiz.reflectPrompt);
  return {
    n: l.n,
    title: has(l.title) ? l.title : `Lesson ${l.n}`,
    ref: l.ref ?? "",
    core: has(l.title) && has(l.ref) && has(l.verseUsfm),
    teaching: (l.teaching ?? []).some(has),
    keyIdea: has(l.keyIdea),
    reflection: has(l.reflectionScript),
    prayer: has(l.prayer),
    quiz: quiz.enabled ? (quizOk ? "ok" : "partial") : "off",
    image: !!l.image?.url,
    supporting: (l.supportingScriptures ?? []).filter((s) => has(s.ref) && has(s.usfm)).length,
  };
}

/**
 * Score a plan 0–100 for the admin progress bar. The weights follow the
 * wizard's own emphasis — lessons are the heart of curation — and the last
 * 15 points belong to the human review (finished + checklist), so a bar
 * only fills when a reviewer actually walked the plan home. Images are
 * reported but not scored (artwork is optional by design).
 */
export function planProgress(draftIn: Draft, status: string, checklistDone: boolean): PlanProgress {
  const draft = normalizeDraft(draftIn);
  const lessons = (draft.lessons ?? []).map(lessonProgress);

  const detailChecks = [
    draft.title,
    draft.planId,
    draft.subtitle,
    draft.summary,
    draft.translation,
    draft.span,
    draft.reviewedBy,
  ].map(has);
  const detailsFilled = detailChecks.filter(Boolean).length;

  const m = draft.match ?? { faithLevel: [], audience: [], focus: [], lengthBand: "", resources: [] };
  const audienceChecks = [
    (m.faithLevel ?? []).length > 0,
    (m.audience ?? []).length > 0,
    (m.focus ?? []).length > 0,
    has(m.lengthBand),
    (m.resources ?? []).length > 0,
  ];
  const audienceFilled = audienceChecks.filter(Boolean).length;

  const lessonScore = (lp: LessonProgress) =>
    [lp.core, lp.teaching, lp.keyIdea, lp.reflection, lp.prayer].filter(Boolean).length / 5;
  const lessonsAvg = lessons.length
    ? lessons.reduce((sum, lp) => sum + lessonScore(lp), 0) / lessons.length
    : 0;

  // A structurally broken draft (e.g. missing match) makes buildPlanDoc
  // throw — report that as schema-invalid instead of losing the whole row.
  let schemaValid = false;
  let issues: string[] = [];
  try {
    const parsed = lessonPlanDocSchema.safeParse(buildPlanDoc(draft));
    schemaValid = parsed.success;
    if (!parsed.success) {
      issues = parsed.error.issues.map((i) => `${i.path.join(" › ") || "plan"} — ${i.message}`);
    }
  } catch {
    issues = ["plan — the draft is missing required structure and couldn't be checked against the schema"];
  }

  let percent =
    15 * (detailsFilled / detailChecks.length) +
    10 * (audienceFilled / audienceChecks.length) +
    60 * lessonsAvg;
  if (status === "completed") percent += 10;
  if (checklistDone) percent += 5;

  return {
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    details: detailsFilled === detailChecks.length,
    detailsFilled,
    detailsTotal: detailChecks.length,
    audience: audienceFilled === audienceChecks.length,
    lessonsTotal: lessons.length,
    lessonsComplete: lessons.filter((lp) => lp.core && lp.teaching && lp.keyIdea).length,
    imagesChosen: lessons.filter((lp) => lp.image).length,
    quizzesOk: lessons.filter((lp) => lp.quiz === "ok").length,
    schemaValid,
    schemaIssueCount: issues.length,
    schemaIssues: issues.slice(0, 12),
    lessons,
  };
}
