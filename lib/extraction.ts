import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { parseReference, isValidUsfm } from "./usfm";
import { pagesToRanges, type PageRange } from "./pages";
import { emptyQuiz, type Draft, type DraftLesson } from "./types";

/**
 * Server-side extraction pipeline: token measuring, PDF splitting, the Claude
 * extraction call, part merging, and draft assembly. Used by the job runner
 * (lib/jobs.ts); keep this module free of Next.js request/response types.
 */

export const MODEL = "claude-opus-4-8";
/** Above this measured size, the PDF is split and analyzed in parts. */
export const SINGLE_PASS_MAX_TOKENS = Number(process.env.LPB_SINGLE_PASS_MAX ?? 850_000);
/** Target input size per part when splitting. */
export const CHUNK_BUDGET_TOKENS = Number(process.env.LPB_CHUNK_BUDGET ?? 550_000);
/** API page ceiling per request on 1M-context models. */
export const MAX_PAGES_PER_REQUEST = 500;

export class AnalysisError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Structured-output schema for the extraction pass. This is deliberately a
 * DRAFT shape, not the final library schema: the AI proposes, the curator
 * disposes. Every reference is also requested in canonical English book-name
 * form so we can resolve USFM codes deterministically server-side, whatever
 * language the PDF (or the target plan) is in.
 */
const scriptureRef = {
  type: "object",
  properties: {
    ref: { type: "string", description: "Display reference in the target plan language, e.g. 'Judges 6:11-16' or 'قضاة ٦:‏١١-١٦'" },
    refEnglish: { type: "string", description: "Same reference with the ENGLISH book name and Western digits, 'Book C:V' or 'Book C:V-V', e.g. 'Judges 6:11-16'" },
  },
  required: ["ref", "refEnglish"],
  additionalProperties: false,
} as const;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    detectedLanguage: { type: "string", description: "Language of the source PDF, e.g. 'English', 'Arabic', 'Swahili'" },
    title: { type: "string", description: "Series title, <= 80 chars, in the target language" },
    subtitle: { type: "string", description: "Short subtitle, <= 120 chars, e.g. 'Devotional · Judges 6-8 (Gideon)'" },
    summary: { type: "string", description: "1-2 sentence summary for the recommendation card, <= 280 chars" },
    planId: { type: "string", description: "Suggested slug: lowercase letters, digits, hyphens, 3-60 chars, e.g. 'fear-gideon'" },
    span: { type: "string", description: "Human label, <= 80 chars, e.g. '5 sessions · about 1 week'" },
    match: {
      type: "object",
      properties: {
        faithLevel: { type: "array", items: { type: "string", enum: ["scholars", "believers", "seekers", "new_to_faith"] } },
        audience: { type: "array", items: { type: "string", enum: ["women", "kids", "teens", "adults", "pastors"] } },
        focus: { type: "array", items: { type: "string", enum: ["discipleship", "trauma_healing", "bible_study", "devotional"] } },
        lengthBand: { type: "string", enum: ["short", "full", "season", "open"], description: "short ≈5 lessons, full ≈8, season ≈10-12, open otherwise" },
        resources: { type: "array", items: { type: "string", enum: ["video", "audio", "reading", "printable"] }, description: "Only what the plan can genuinely deliver; text plans are ['reading']" },
      },
      required: ["faithLevel", "audience", "focus", "lengthBand", "resources"],
      additionalProperties: false,
    },
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer", description: "1-based session number, in order" },
          title: { type: "string", description: "Session title, <= 120 chars" },
          passage: { ...scriptureRef, description: "The full passage the session works through" },
          keyVerse: { anyOf: [scriptureRef, { type: "null" }], description: "The single anchor verse shown large; null if the session has none" },
          teaching: { type: "array", items: { type: "string" }, description: "Exposition paragraphs, lightly edited for a phone screen. PARAPHRASE Scripture - never quote long runs verbatim." },
          keyIdea: { type: "string", description: "The one-line takeaway ('Hold on to this'), <= 400 chars. Empty string if none." },
          quiz: {
            anyOf: [
              {
                type: "object",
                properties: {
                  question: { type: "string", description: "<= 280 chars, answerable from the passage" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", description: "'a', 'b', 'c', 'd'" },
                        text: { type: "string", description: "<= 240 chars" },
                        correct: { type: "boolean" },
                      },
                      required: ["id", "text", "correct"],
                      additionalProperties: false,
                    },
                    description: "2-5 options, EXACTLY ONE with correct=true, verified against the passage",
                  },
                  good: { type: "string", description: "Feedback when right, <= 400 chars" },
                  bad: { type: "string", description: "Gentle correction when wrong, <= 400 chars" },
                  reflectPrompt: { type: "string", description: "Open, no-wrong-answer application question, <= 400 chars" },
                },
                required: ["question", "options", "good", "bad", "reflectPrompt"],
                additionalProperties: false,
              },
              { type: "null" },
            ],
            description: "Draft a quiz for every lesson even if the PDF has none - the curator reviews it. Null only when the material genuinely cannot support one.",
          },
          prayer: { type: "string", description: "Closing prayer, or empty string" },
          reflectionScript: { type: "string", description: "20-45 second guided-reflection narration script (<= 2000 chars), your own prose, never Scripture text. Empty string if the plan offers no audio." },
          supportingScriptures: { type: "array", items: scriptureRef, description: "'Scriptures to consider' list" },
          artPages: {
            type: "array",
            items: { type: "integer" },
            description:
              "ORIGINAL document page numbers (1-based) containing an illustration, photo, or artwork that could serve as this session's lesson image. Genuine artwork only — never logos, headers, page furniture, or decorative borders. Empty array when the session's pages have no real artwork.",
          },
        },
        required: ["n", "title", "passage", "keyVerse", "teaching", "keyIdea", "quiz", "prayer", "reflectionScript", "supportingScriptures", "artPages"],
        additionalProperties: false,
      },
    },
    sourceNotes: { type: "string", description: "Anything ambiguous, missing, or needing curator attention (unmapped structure, chapter-only refs you narrowed, translation choices)" },
  },
  required: ["detectedLanguage", "title", "subtitle", "summary", "planId", "span", "match", "lessons", "sourceNotes"],
  additionalProperties: false,
} as const;

export interface ChunkInfo {
  index: number;
  total: number;
  /** Human label of the pages this pass sees, e.g. "5–48" or "1–10, 15, 22–30". */
  pagesLabel: string;
}

function systemPrompt(targetLanguage: "en" | "ar", chunk: ChunkInfo | null) {
  const langName = targetLanguage === "ar" ? "Arabic" : "English";
  const chunkRules = chunk
    ? chunk.total > 1
      ? `

CHUNKED DOCUMENT: you are seeing PART ${chunk.index} of ${chunk.total} (original pages ${chunk.pagesLabel}) of a longer document; the parts overlap by one page and will be merged afterwards. Extract every session visible in these pages, even if its opening or closing is cut off at a boundary (extract what you can see and note the truncation in sourceNotes). Plan-level fields (title, subtitle, summary, match) should describe the whole series as best you can tell from this part.`
      : `

PARTIAL DOCUMENT: you are seeing only pages ${chunk.pagesLabel} of a longer document — the curator chose these pages deliberately. Extract every session visible in them, even if one is cut off at a boundary (extract what you can see and note the truncation in sourceNotes). Plan-level fields should describe the series as best you can tell from these pages.`
    : "";
  return `You are an extraction assistant for Biblica's Scripture Studio curation team. A curator feeds you a ministry PDF (devotional series, discipleship course, study guide - in any language) and you map it into a DRAFT lesson plan that a human curator will review, edit, and approve. You never publish anything yourself.

Follow Biblica's authoring rules exactly:

1. SCRIPTURE IS REFERENCED, NEVER STORED. Do not copy verse text into teaching, keyIdea, prayer, or reflectionScript. Paraphrase Scripture in your own words; the verbatim text is fetched at runtime from the licensed verse pipeline via the reference. Short fragments a source author wove into their own prose are acceptable; long verbatim runs are not.
2. TARGET LANGUAGE: write ALL content fields (title, subtitle, summary, teaching, keyIdea, quiz, prayer, reflectionScript, span) in ${langName}, faithfully translating/adapting the source if it is in another language. Preserve the author's meaning and pastoral tone; edit lightly for a phone screen (short paragraphs).
3. REFERENCES: give every reference twice - 'ref' as the display form in ${langName}, and 'refEnglish' with the English book name and Western digits in 'Book C:V' or 'Book C:V-V' form (e.g. 'Judges 6:11-16', 'Psalm 56:11'). refEnglish must be verse-level: if the source cites a whole chapter or multi-chapter range, choose the most representative verse range within one chapter and note the narrowing in sourceNotes.
4. STRUCTURE MAPPING: series/booklet title → title+subtitle; intro paragraph → summary; each session/day/week → one lesson; session anchor verse → keyVerse; full passage → passage; exposition → teaching[]; big idea → keyIdea; application question → reflectPrompt; 'scriptures to consider' → supportingScriptures; closing prayer → prayer.
5. QUIZZES: many source PDFs have no multiple-choice check - draft one anyway for each lesson (the curator reviews every answer). The question must be answerable from the passage, exactly one option correct, distractors plausible, feedback accurate and kind.
6. MATCH TAGS: pick every tag that genuinely applies; never invent values outside the allowed enums. lengthBand from lesson count: ~5=short, ~8=full, ~10-12=season, else open. resources: only what the plan actually delivers ('reading' always for text; add 'audio' only because reflection narration can be rendered later - include it if the content suits calm narration).
7. LESSON ARTWORK: for each session, list in artPages the ORIGINAL page numbers that carry an illustration, photo, or piece of artwork a curator could crop into that session's lesson image. Only genuine artwork counts — skip logos, mastheads, decorative rules, and text-only pages. When you are viewing a partial or chunked document, translate the pages you see back to their original numbering using the page label given to you.
8. HONESTY: use sourceNotes to flag everything you were unsure about, skipped, invented (like drafted quizzes), or narrowed.${chunkRules}`;
}

/** One extraction call over one (possibly partial) PDF. Throws on failure. */
export async function extractChunk(
  client: Anthropic,
  pdfBase64: string,
  targetLanguage: "en" | "ar",
  fileName: string,
  chunk: ChunkInfo | null,
): Promise<any> {
  const partLabel = chunk ? ` (part ${chunk.index} of ${chunk.total}, pages ${chunk.pagesLabel})` : "";
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    system: systemPrompt(targetLanguage, chunk),
    output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          {
            type: "text",
            text: `Read this PDF ("${fileName}"${partLabel}) and extract a complete draft lesson plan in ${targetLanguage === "ar" ? "Arabic" : "English"}, following every rule in your instructions. Cover every session in the document.`,
          },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new AnalysisError("The model declined to process this document.", 422);
  }
  if (message.stop_reason === "max_tokens") {
    throw new AnalysisError(
      "One part of the document produced more content than fits in a single pass. Try splitting the PDF into smaller booklets.",
      422,
    );
  }
  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    throw new AnalysisError("The model returned unparseable output. Please retry.", 502);
  }
}

export async function countPdfTokens(client: Anthropic, pdfBase64: string): Promise<number> {
  const res = await client.messages.countTokens({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: "Extract." },
        ],
      },
    ],
  });
  return res.input_tokens;
}

export async function getPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

/** One extraction pass covers a set of (original-numbering) page ranges. */
export interface ChunkPlan {
  ranges: PageRange[];
}

/** How many extraction passes a document (or page selection) of this size needs. */
export function estimateParts(tokens: number, pages: number): number {
  if (tokens <= SINGLE_PASS_MAX_TOKENS && pages <= MAX_PAGES_PER_REQUEST) return 1;
  return Math.max(
    Math.ceil(tokens / CHUNK_BUDGET_TOKENS),
    Math.ceil(pages / MAX_PAGES_PER_REQUEST),
    2,
  );
}

/**
 * Split a selected-page list (sorted, 1-based, possibly with gaps) into
 * `numChunks` consecutive segments, each overlapping the previous by one page.
 */
export function planChunks(selectedPages: number[], numChunks: number): ChunkPlan[] {
  const per = Math.ceil(selectedPages.length / numChunks);
  const plan: ChunkPlan[] = [];
  for (let start = 0; start < selectedPages.length; start += per) {
    const from = Math.max(0, start - 1); // one selected page of overlap with the previous part
    const segment = selectedPages.slice(from, Math.min(selectedPages.length, start + per));
    plan.push({ ranges: pagesToRanges(segment) });
  }
  return plan;
}

/** Extract a set of page ranges of a PDF into one standalone base64 PDF. */
export async function slicePdf(bytes: Uint8Array, plan: ChunkPlan): Promise<string> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  const indices: number[] = [];
  for (const r of plan.ranges) {
    for (let page = r.from; page <= r.to; page++) indices.push(page - 1);
  }
  const pages = await doc.copyPages(src, indices);
  pages.forEach((p) => doc.addPage(p));
  return Buffer.from(await doc.save()).toString("base64");
}

/** Merge per-part extractions into one: part 1 wins plan-level fields, lessons concatenate with dedupe. */
export function mergeExtractions(parts: any[]): any {
  if (parts.length === 1) return parts[0];
  const base = { ...parts[0] };

  const seen = new Map<string, any>();
  const lessons: any[] = [];
  for (const part of parts) {
    for (const l of part.lessons ?? []) {
      const key = `${(l.title ?? "").trim().toLowerCase()}|${(l.passage?.refEnglish ?? "").trim().toLowerCase()}`;
      if (key !== "|" && seen.has(key)) {
        // Duplicate from the overlap page — keep the first copy, but union
        // its artwork suggestions so boundary lessons don't lose artPages.
        const kept = seen.get(key);
        const extra = Array.isArray(l.artPages) ? l.artPages : [];
        kept.artPages = [...new Set([...(kept.artPages ?? []), ...extra])];
        continue;
      }
      seen.set(key, l);
      lessons.push(l);
    }
  }
  base.lessons = lessons;

  base.match = base.match ?? {};
  for (const key of ["faithLevel", "audience", "focus", "resources"] as const) {
    base.match[key] = [...new Set(parts.flatMap((p) => p.match?.[key] ?? []))];
  }
  const n = lessons.length;
  base.match.lengthBand = n <= 6 ? "short" : n <= 9 ? "full" : n <= 13 ? "season" : "open";
  base.span = `${n} sessions`;

  base.sourceNotes = [
    `Large document — analyzed in ${parts.length} parts and merged; check for sessions split or duplicated at part boundaries.`,
    ...parts.map((p, i) => (p.sourceNotes ? `Part ${i + 1}: ${p.sourceNotes}` : "")),
  ]
    .filter(Boolean)
    .join(" ");

  return base;
}

/** Convert a merged extraction into the wizard's Draft shape. Throws on empty plans. */
export function toDraft(extracted: any, fileName: string, targetLanguage: "en" | "ar"): Draft {
  if (!extracted.lessons?.length) {
    const why = (extracted.sourceNotes ?? "").slice(0, 500);
    throw new AnalysisError(
      `No sessions were found in "${fileName}" — it may not be a devotional, course, or study-guide document.${why ? ` Analysis notes: ${why}` : ""}`,
      422,
    );
  }

  const resolveUsfm = (refEnglish: string): string => {
    const parsed = parseReference(refEnglish ?? "");
    if (parsed) return parsed.usfm;
    return isValidUsfm(refEnglish ?? "") ? refEnglish.trim().toUpperCase() : "";
  };

  const lessons: DraftLesson[] = (extracted.lessons ?? []).map((l: any, i: number) => {
    const quiz = l.quiz
      ? {
          enabled: true,
          question: l.quiz.question ?? "",
          options: (l.quiz.options ?? []).map((o: any) => ({
            id: String(o.id ?? "").toLowerCase(),
            text: o.text ?? "",
            correct: !!o.correct,
          })),
          good: l.quiz.good ?? "",
          bad: l.quiz.bad ?? "",
          reflectPrompt: l.quiz.reflectPrompt ?? "",
        }
      : emptyQuiz();
    return {
      n: i + 1,
      title: l.title ?? "",
      ref: l.passage?.ref ?? "",
      verseUsfm: resolveUsfm(l.passage?.refEnglish),
      keyVerseRef: l.keyVerse?.ref ?? "",
      teaching: (l.teaching ?? []).filter((p: unknown) => typeof p === "string" && p.trim()),
      keyIdea: l.keyIdea ?? "",
      reflectionScript: l.reflectionScript ?? "",
      prayer: l.prayer ?? "",
      supportingScriptures: (l.supportingScriptures ?? [])
        .map((s: any) => ({ ref: s.ref ?? "", usfm: resolveUsfm(s.refEnglish) }))
        .filter((s: { ref: string }) => s.ref),
      quiz,
      artPages: [...new Set(
        (Array.isArray(l.artPages) ? l.artPages : [])
          .filter((p: unknown) => Number.isInteger(p) && (p as number) >= 1)
      )].sort((a, b) => (a as number) - (b as number)) as number[],
      image: null,
    };
  });

  return {
    sourceFileName: fileName,
    sourceId: "",
    detectedLanguage: extracted.detectedLanguage ?? "",
    sourceNotes: extracted.sourceNotes ?? "",
    planId: (extracted.planId ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
    title: extracted.title ?? "",
    subtitle: extracted.subtitle ?? "",
    summary: extracted.summary ?? "",
    language: targetLanguage,
    translation: targetLanguage === "ar" ? "NAV" : "NIV",
    span: extracted.span ?? "",
    reviewedBy: `Adapted from "${fileName}" via Lesson Plan Builder — pending review`,
    match: {
      faithLevel: extracted.match?.faithLevel ?? [],
      audience: extracted.match?.audience ?? [],
      focus: extracted.match?.focus ?? [],
      lengthBand: extracted.match?.lengthBand ?? "",
      resources: extracted.match?.resources?.length ? extracted.match.resources : ["reading"],
    },
    lessons,
  };
}
