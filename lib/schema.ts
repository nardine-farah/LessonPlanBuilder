import { z } from "zod";

/**
 * Exact port of Scripture Studio's lesson-plan library schema
 * (src/lib/lesson-plans.ts). A plan exported by this builder must pass this
 * schema so that `npm run db:seed:plans` in Scripture Studio accepts it
 * without edits. Keep in sync with the Studio's source of truth.
 */

export const FAITH_LEVEL_TAGS = ["scholars", "believers", "seekers", "new_to_faith"] as const;
export const AUDIENCE_TAGS = ["women", "kids", "teens", "adults", "pastors"] as const;
export const FOCUS_TAGS = ["discipleship", "trauma_healing", "bible_study", "devotional"] as const;
export const LENGTH_BANDS = ["short", "full", "season", "open"] as const;
export const RESOURCE_TAGS = ["video", "audio", "reading", "printable"] as const;

export const faithLevelTagSchema = z.enum(FAITH_LEVEL_TAGS);
export const audienceTagSchema = z.enum(AUDIENCE_TAGS);
export const focusTagSchema = z.enum(FOCUS_TAGS);
export const lengthBandSchema = z.enum(LENGTH_BANDS);
export const resourceTagSchema = z.enum(RESOURCE_TAGS);

const mcOptionSchema = z.object({
  id: z.string().min(1).max(4),
  text: z.string().min(1).max(240),
  correct: z.boolean().optional(),
});

const quizSchema = z.object({
  mc: z
    .object({
      question: z.string().min(1).max(280),
      options: z.array(mcOptionSchema).min(2).max(5),
      good: z.string().min(1).max(400),
      bad: z.string().min(1).max(400),
    })
    .refine((q) => q.options.filter((o) => o.correct).length === 1, {
      message: "Exactly one option must be marked correct",
    }),
  reflectPrompt: z.string().min(1).max(400),
});

const mediaSchema = z.object({
  videoPoster: z.object({ label: z.string(), duration: z.string() }).optional(),
  scriptureAudio: z.boolean().optional(),
  reflectionAudio: z
    .object({ asset: z.string(), duration: z.number().positive() })
    .optional(),
  /** Curator-chosen lesson artwork (public URL + alt text). */
  image: z.object({ asset: z.string(), alt: z.string().optional() }).optional(),
});

export const lessonSchema = z.object({
  n: z.number().int().positive(),
  title: z.string().min(1).max(120),
  ref: z.string().min(1).max(80),
  verseUsfm: z.string().min(1).max(40),
  keyVerseRef: z.string().min(1).max(80).optional(),
  teaching: z.array(z.string().min(1)).optional(),
  keyIdea: z.string().min(1).max(400).optional(),
  reflectionScript: z.string().min(1).max(2000).optional(),
  supportingScriptures: z
    .array(z.object({ ref: z.string(), usfm: z.string() }))
    .optional(),
  quiz: quizSchema.optional(),
  prayer: z.string().optional(),
  media: mediaSchema.optional(),
});

export const lessonPlanDocSchema = z
  .object({
    planId: z.string().min(3).max(60).regex(/^[a-z0-9-]+$/, "lowercase letters, digits, hyphens"),
    title: z.string().min(1).max(80),
    subtitle: z.string().min(1).max(120),
    summary: z.string().min(1).max(280),
    language: z.enum(["en", "ar"]),
    translation: z.string().min(1).max(40),
    match: z.object({
      faithLevel: z.array(faithLevelTagSchema).min(1),
      audience: z.array(audienceTagSchema).min(1),
      focus: z.array(focusTagSchema).min(1),
      lengthBand: lengthBandSchema,
      resources: z.array(resourceTagSchema).min(1),
    }),
    lessonCount: z
      .number()
      .int()
      .positive()
      .max(40, "The Scripture Studio library allows at most 40 lessons per plan"),
    span: z.string().min(1).max(80),
    status: z.enum(["draft", "published"]),
    reviewedBy: z.string().min(1).max(120),
    lessons: z.array(lessonSchema).min(1),
  })
  .refine((p) => p.lessons.length === p.lessonCount, {
    message: "lessonCount must equal lessons.length",
    path: ["lessonCount"],
  });

export type LessonPlanDoc = z.infer<typeof lessonPlanDocSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
