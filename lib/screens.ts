import type { Draft, DraftLesson } from "./types";

/**
 * The four learner screens of the Scripture Studio lesson player
 * (LessonPlayer: hear → understand → check → respond → complete) and the
 * authored blocks each screen renders. The builder groups the per-lesson
 * editor under the SAME names and enforces — at Finish and at Publish — that
 * every screen of every lesson carries its required blocks:
 *
 *   Hear        artwork · reflection narration · SCRIPTURE (required)
 *   Understand  teaching video · MAIN TEACHING (required) · key idea ·
 *               scriptures to consider
 *   Check       QUIZ (required)
 *   Respond     REFLECTION PROMPT + CLOSING PRAYER (every block required)
 *
 * Download/copy of the JSON stays available whatever the state (work is never
 * stuck); these rules gate finishing and publishing, ALONGSIDE the ported
 * Studio schema. `lib/schema.ts` itself stays the exact Studio port — these
 * fields remain optional there so legacy library plans still parse.
 */

export const SCREENS = ["Hear", "Understand", "Check", "Respond"] as const;
export type ScreenName = (typeof SCREENS)[number];

export interface ScreenIssue {
  /** Lesson number the issue belongs to. */
  n: number;
  screen: ScreenName;
  message: string;
}

const has = (s: string | null | undefined) => typeof s === "string" && s.trim().length > 0;

/** Required-block check for one lesson. Empty array = all four screens complete. */
export function lessonScreenIssues(l: DraftLesson): ScreenIssue[] {
  const issues: ScreenIssue[] = [];
  // Old stored drafts may predate the quiz shape — read it defensively.
  const quiz = l.quiz ?? { enabled: false, reflectPrompt: "" };

  if (!has(l.ref) || !has(l.verseUsfm)) {
    issues.push({
      n: l.n,
      screen: "Hear",
      message: "Scripture is required — fill in the passage and its USFM code",
    });
  }
  if (!(l.teaching ?? []).some(has)) {
    issues.push({
      n: l.n,
      screen: "Understand",
      message: "the main teaching is required — add at least one paragraph",
    });
  }
  if (!quiz.enabled) {
    issues.push({
      n: l.n,
      screen: "Check",
      message: "the comprehension quiz is required — every lesson needs its check",
    });
  }
  if (!has(quiz.reflectPrompt)) {
    issues.push({ n: l.n, screen: "Respond", message: "the reflection prompt is required" });
  }
  if (!has(l.prayer)) {
    issues.push({ n: l.n, screen: "Respond", message: "the closing prayer is required" });
  }
  return issues;
}

/** Distinct screens still missing required blocks — for the lesson-row badge. */
export function incompleteScreens(l: DraftLesson): ScreenName[] {
  const missing = new Set(lessonScreenIssues(l).map((i) => i.screen));
  return SCREENS.filter((s) => missing.has(s));
}

/** All screen issues across a draft, formatted like the schema's error lines. */
export function planScreenIssues(draft: Draft): string[] {
  return (draft.lessons ?? []).flatMap((l) =>
    lessonScreenIssues(l).map((i) => `Lesson ${i.n} › ${i.screen} — ${i.message}`),
  );
}
