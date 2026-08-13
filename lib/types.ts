import type { LessonPlanDoc } from "./schema";

/**
 * The working draft the wizard edits. Looser than the final schema — fields
 * may be empty while the curator works; `buildPlanDoc` converts a draft into
 * the exact JSON shape Scripture Studio's seeder expects.
 */

export interface DraftScripture {
  ref: string;
  usfm: string;
}

export interface DraftQuizOption {
  id: string;
  text: string;
  correct: boolean;
}

export interface DraftQuiz {
  enabled: boolean;
  question: string;
  options: DraftQuizOption[];
  good: string;
  bad: string;
  reflectPrompt: string;
}

export interface DraftLessonImage {
  /** Public URL of the cropped, uploaded PNG (Firebase Storage). */
  url: string;
  /** Source page in the original PDF, when known (null for imported plans). */
  page: number | null;
}

export interface DraftLessonAudio {
  /** Public URL of the rendered narration MP3 (Firebase Storage, unique per render). */
  url: string;
  /** Estimated length in seconds. */
  duration: number;
  /** The exact reflection script this was rendered from — editing the script makes the audio stale. */
  script: string;
  /** Voice signature at render time (folded into the filename; republish tooling reads it). */
  voice: string;
}

export interface DraftLessonVideo {
  /** Public URL of the teaching video (Firebase Storage upload or a hosted link). */
  url: string;
  /** Length in seconds, when it could be read from the file (null otherwise). */
  duration: number | null;
  /** Original file name for uploaded videos ("" for pasted URLs). */
  fileName: string;
  /** Upload size in bytes (null for pasted URLs). */
  sizeBytes: number | null;
}

export interface DraftLesson {
  n: number;
  title: string;
  ref: string;
  verseUsfm: string;
  keyVerseRef: string;
  teaching: string[];
  keyIdea: string;
  reflectionScript: string;
  prayer: string;
  supportingScriptures: DraftScripture[];
  quiz: DraftQuiz;
  /** Analysis-suggested original page numbers holding usable artwork. */
  artPages: number[];
  /** The curator's chosen lesson image, if any. */
  image: DraftLessonImage | null;
  /** The curator's attached teaching video, if any. */
  video: DraftLessonVideo | null;
  /** Narration rendered in the builder for reflectionScript (listen-and-iterate; publish uses it as-is). */
  reflectionAudio: DraftLessonAudio | null;
}

export interface Draft {
  sourceFileName: string;
  /** Content hash of the analyzed PDF — keys the server-side render cache. Empty for imported plans. */
  sourceId: string;
  detectedLanguage: string;
  sourceNotes: string;
  planId: string;
  title: string;
  subtitle: string;
  summary: string;
  language: "en" | "ar";
  translation: string;
  span: string;
  reviewedBy: string;
  match: {
    faithLevel: string[];
    audience: string[];
    focus: string[];
    lengthBand: string;
    resources: string[];
  };
  lessons: DraftLesson[];
}

/** A finished plan, kept in the browser's completed list. */
export interface CompletedPlan {
  key: string;
  finishedAt: string;
  checklistDone: boolean;
  draft: Draft;
}

export function emptyQuiz(): DraftQuiz {
  return {
    enabled: false,
    question: "",
    options: [
      { id: "a", text: "", correct: true },
      { id: "b", text: "", correct: false },
      { id: "c", text: "", correct: false },
    ],
    good: "",
    bad: "",
    reflectPrompt: "",
  };
}

export function emptyLesson(n: number): DraftLesson {
  return {
    n,
    title: "",
    ref: "",
    verseUsfm: "",
    keyVerseRef: "",
    teaching: [],
    keyIdea: "",
    reflectionScript: "",
    prayer: "",
    supportingScriptures: [],
    quiz: emptyQuiz(),
    artPages: [],
    image: null,
    video: null,
    reflectionAudio: null,
  };
}

export function emptyDraft(): Draft {
  return {
    sourceFileName: "",
    sourceId: "",
    detectedLanguage: "",
    sourceNotes: "",
    planId: "",
    title: "",
    subtitle: "",
    summary: "",
    language: "en",
    translation: "NIV",
    span: "",
    reviewedBy: "",
    match: { faithLevel: [], audience: [], focus: [], lengthBand: "", resources: ["reading"] },
    lessons: [],
  };
}

const trimmed = (s: string) => s.trim();

/**
 * Backfill fields added after a draft was saved (localStorage or a synced
 * profile) so older drafts load safely into newer wizard steps.
 */
export function normalizeDraft(draft: Draft): Draft {
  return {
    ...draft,
    sourceId: draft.sourceId ?? "",
    lessons: (draft.lessons ?? []).map((l) => ({
      ...l,
      artPages: Array.isArray(l.artPages) ? l.artPages : [],
      image: l.image && typeof l.image.url === "string" ? l.image : null,
      video: l.video && typeof l.video.url === "string" ? l.video : null,
      reflectionAudio:
        l.reflectionAudio && typeof l.reflectionAudio.url === "string" ? l.reflectionAudio : null,
    })),
  };
}

/** True when a lesson's rendered narration matches its current reflection script. */
export function narrationFresh(l: DraftLesson): boolean {
  return !!l.reflectionAudio?.url && l.reflectionAudio.script.trim() === l.reflectionScript.trim();
}

/**
 * Convert the working draft into the seed-file JSON. Plans always export as
 * status "draft" — flipping to "published" is a human review decision made in
 * Scripture Studio after the checklist passes. Empty optional fields are
 * stripped so outline-only lessons stay valid.
 */
export function buildPlanDoc(draft: Draft): Record<string, unknown> {
  const offersAudio = draft.match.resources.includes("audio");
  const offersVideo = draft.match.resources.includes("video");

  const lessons = draft.lessons.map((l) => {
    const lesson: Record<string, unknown> = {
      n: l.n,
      title: trimmed(l.title),
      ref: trimmed(l.ref),
      verseUsfm: trimmed(l.verseUsfm),
    };
    if (trimmed(l.keyVerseRef)) lesson.keyVerseRef = trimmed(l.keyVerseRef);
    const teaching = l.teaching.map(trimmed).filter(Boolean);
    if (teaching.length) lesson.teaching = teaching;
    if (trimmed(l.keyIdea)) lesson.keyIdea = trimmed(l.keyIdea);
    if (trimmed(l.reflectionScript)) lesson.reflectionScript = trimmed(l.reflectionScript);
    const supporting = l.supportingScriptures
      .map((s) => ({ ref: trimmed(s.ref), usfm: trimmed(s.usfm) }))
      .filter((s) => s.ref && s.usfm);
    if (supporting.length) lesson.supportingScriptures = supporting;
    if (l.quiz.enabled) {
      lesson.quiz = {
        mc: {
          question: trimmed(l.quiz.question),
          options: l.quiz.options
            .filter((o) => trimmed(o.text))
            .map((o) => (o.correct ? { id: o.id, text: trimmed(o.text), correct: true } : { id: o.id, text: trimmed(o.text) })),
          good: trimmed(l.quiz.good),
          bad: trimmed(l.quiz.bad),
        },
        reflectPrompt: trimmed(l.quiz.reflectPrompt),
      };
    }
    if (trimmed(l.prayer)) lesson.prayer = trimmed(l.prayer);
    const media: Record<string, unknown> = {};
    if (offersAudio) media.scriptureAudio = true;
    // Narration rendered in the builder ships with the plan — publish does
    // not synthesize. Stale audio (script edited after rendering) is omitted;
    // the Review step blocks finishing until it's re-rendered.
    if (narrationFresh(l) && l.reflectionAudio!.duration > 0) {
      media.reflectionAudio = { asset: l.reflectionAudio!.url, duration: l.reflectionAudio!.duration };
    }
    if (l.video?.url) {
      media.video = {
        asset: l.video.url,
        ...(l.video.duration && l.video.duration > 0 ? { duration: Math.round(l.video.duration * 10) / 10 } : {}),
      };
    } else if (offersVideo) {
      // Placeholder tile for lessons that don't have a real video yet.
      media.videoPoster = { label: "Teaching · video", duration: "0:00" };
    }
    if (l.image?.url) media.image = { asset: l.image.url, alt: trimmed(l.title) || "Lesson artwork" };
    if (Object.keys(media).length) lesson.media = media;
    return lesson;
  });

  return {
    planId: trimmed(draft.planId),
    title: trimmed(draft.title),
    subtitle: trimmed(draft.subtitle),
    summary: trimmed(draft.summary),
    language: draft.language,
    translation: trimmed(draft.translation),
    match: {
      faithLevel: draft.match.faithLevel,
      audience: draft.match.audience,
      focus: draft.match.focus,
      lengthBand: draft.match.lengthBand,
      resources: draft.match.resources,
    },
    lessonCount: lessons.length,
    span: trimmed(draft.span),
    status: "draft",
    reviewedBy: trimmed(draft.reviewedBy),
    lessons,
  };
}

export type { LessonPlanDoc };
