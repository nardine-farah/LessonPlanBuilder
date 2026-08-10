import { emptyQuiz, type Draft, type DraftLesson, type DraftQuiz } from "./types";

/**
 * Import a plan JSON file back into an editable wizard draft. Accepts either
 * shape and detects which one it is:
 *  - a Scripture Studio seed file (LessonPlanDoc — what this tool exports and
 *    what lives in the Studio's data/lesson-plans/), or
 *  - a raw wizard draft (the internal Draft shape, e.g. from a synced plan).
 *
 * Imports are deliberately lenient: a file that would fail the seeder is
 * still imported so the reviewer can fix it in the wizard — validation
 * happens at the Review step as usual.
 */

export function importedDraftFromJson(
  text: string,
  fileName: string,
): { draft: Draft } | { error: string } {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    return { error: `"${fileName}" isn't valid JSON.` };
  }
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.lessons)) {
    return { error: `"${fileName}" doesn't look like a lesson plan — no lessons array found.` };
  }

  // Wizard-draft shape? (lessons carry quiz.enabled; docs carry quiz.mc)
  const looksLikeDraft =
    "sourceFileName" in obj || obj.lessons.some((l: any) => l?.quiz && "enabled" in l.quiz);

  const draft = looksLikeDraft ? draftFromDraftShape(obj) : draftFromDocShape(obj);
  draft.sourceFileName = draft.sourceFileName || fileName;
  draft.sourceNotes = [`Imported from "${fileName}".`, draft.sourceNotes].filter(Boolean).join(" ");
  return { draft };
}

function quizFromMc(quiz: any): DraftQuiz {
  if (!quiz?.mc) return emptyQuiz();
  return {
    enabled: true,
    question: str(quiz.mc.question),
    options: Array.isArray(quiz.mc.options)
      ? quiz.mc.options.map((o: any, i: number) => ({
          id: str(o?.id) || "abcde"[i] || String(i),
          text: str(o?.text),
          correct: !!o?.correct,
        }))
      : emptyQuiz().options,
    good: str(quiz.mc.good),
    bad: str(quiz.mc.bad),
    reflectPrompt: str(quiz.reflectPrompt),
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Seed file (LessonPlanDoc) → Draft. The reverse of buildPlanDoc. */
function draftFromDocShape(doc: any): Draft {
  const lessons: DraftLesson[] = doc.lessons.map((l: any, i: number) => ({
    n: i + 1,
    title: str(l?.title),
    ref: str(l?.ref),
    verseUsfm: str(l?.verseUsfm),
    keyVerseRef: str(l?.keyVerseRef),
    teaching: Array.isArray(l?.teaching) ? l.teaching.filter((p: unknown) => typeof p === "string") : [],
    keyIdea: str(l?.keyIdea),
    reflectionScript: str(l?.reflectionScript),
    prayer: str(l?.prayer),
    supportingScriptures: Array.isArray(l?.supportingScriptures)
      ? l.supportingScriptures.map((s: any) => ({ ref: str(s?.ref), usfm: str(s?.usfm) }))
      : [],
    quiz: quizFromMc(l?.quiz),
    artPages: [],
    image: str(l?.media?.image?.asset) ? { url: str(l.media.image.asset), page: null } : null,
    video: str(l?.media?.video?.asset)
      ? {
          url: str(l.media.video.asset),
          duration: typeof l.media.video.duration === "number" ? l.media.video.duration : null,
          fileName: "",
          sizeBytes: null,
        }
      : null,
  }));

  return {
    sourceFileName: "",
    sourceId: "",
    detectedLanguage: "",
    sourceNotes: "",
    planId: str(doc.planId),
    title: str(doc.title),
    subtitle: str(doc.subtitle),
    summary: str(doc.summary),
    language: doc.language === "ar" ? "ar" : "en",
    translation: str(doc.translation) || (doc.language === "ar" ? "NAV" : "NIV"),
    span: str(doc.span),
    reviewedBy: str(doc.reviewedBy),
    match: {
      faithLevel: arr(doc.match?.faithLevel),
      audience: arr(doc.match?.audience),
      focus: arr(doc.match?.focus),
      lengthBand: str(doc.match?.lengthBand),
      resources: arr(doc.match?.resources),
    },
    lessons,
  };
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** Already a wizard draft — normalize defensively and renumber. */
function draftFromDraftShape(obj: any): Draft {
  const lessons: DraftLesson[] = obj.lessons.map((l: any, i: number) => ({
    n: i + 1,
    title: str(l?.title),
    ref: str(l?.ref),
    verseUsfm: str(l?.verseUsfm),
    keyVerseRef: str(l?.keyVerseRef),
    teaching: Array.isArray(l?.teaching) ? l.teaching.filter((p: unknown) => typeof p === "string") : [],
    keyIdea: str(l?.keyIdea),
    reflectionScript: str(l?.reflectionScript),
    prayer: str(l?.prayer),
    supportingScriptures: Array.isArray(l?.supportingScriptures)
      ? l.supportingScriptures.map((s: any) => ({ ref: str(s?.ref), usfm: str(s?.usfm) }))
      : [],
    quiz:
      l?.quiz && "enabled" in l.quiz
        ? {
            enabled: !!l.quiz.enabled,
            question: str(l.quiz.question),
            options: Array.isArray(l.quiz.options)
              ? l.quiz.options.map((o: any, j: number) => ({
                  id: str(o?.id) || "abcde"[j] || String(j),
                  text: str(o?.text),
                  correct: !!o?.correct,
                }))
              : emptyQuiz().options,
            good: str(l.quiz.good),
            bad: str(l.quiz.bad),
            reflectPrompt: str(l.quiz.reflectPrompt),
          }
        : quizFromMc(l?.quiz),
    artPages: Array.isArray(l?.artPages) ? l.artPages.filter((p: unknown) => Number.isInteger(p)) : [],
    image:
      l?.image && str(l.image.url)
        ? { url: str(l.image.url), page: Number.isInteger(l.image.page) ? l.image.page : null }
        : str(l?.media?.image?.asset)
          ? { url: str(l.media.image.asset), page: null }
          : null,
    video:
      l?.video && str(l.video.url)
        ? {
            url: str(l.video.url),
            duration: typeof l.video.duration === "number" ? l.video.duration : null,
            fileName: str(l.video.fileName),
            sizeBytes: typeof l.video.sizeBytes === "number" ? l.video.sizeBytes : null,
          }
        : str(l?.media?.video?.asset)
          ? {
              url: str(l.media.video.asset),
              duration: typeof l.media.video.duration === "number" ? l.media.video.duration : null,
              fileName: "",
              sizeBytes: null,
            }
          : null,
  }));

  return {
    sourceFileName: str(obj.sourceFileName),
    sourceId: str(obj.sourceId),
    detectedLanguage: str(obj.detectedLanguage),
    sourceNotes: str(obj.sourceNotes),
    planId: str(obj.planId),
    title: str(obj.title),
    subtitle: str(obj.subtitle),
    summary: str(obj.summary),
    language: obj.language === "ar" ? "ar" : "en",
    translation: str(obj.translation) || "NIV",
    span: str(obj.span),
    reviewedBy: str(obj.reviewedBy),
    match: {
      faithLevel: arr(obj.match?.faithLevel),
      audience: arr(obj.match?.audience),
      focus: arr(obj.match?.focus),
      lengthBand: str(obj.match?.lengthBand),
      resources: arr(obj.match?.resources),
    },
    lessons,
  };
}
