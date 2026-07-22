/**
 * Book-name → USFM code mapper, ported from Scripture Studio (src/lib/usfm.ts)
 * so the builder resolves references to the exact same canonical codes the
 * Studio runtime uses to fetch verse text.
 */

export const BOOKS: Record<string, string> = {
  genesis: "GEN", exodus: "EXO", leviticus: "LEV", numbers: "NUM",
  deuteronomy: "DEU", joshua: "JOS", judges: "JDG", ruth: "RUT",
  "1 samuel": "1SA", "2 samuel": "2SA", "1 kings": "1KI", "2 kings": "2KI",
  "1 chronicles": "1CH", "2 chronicles": "2CH", ezra: "EZR", nehemiah: "NEH",
  esther: "EST", job: "JOB", psalm: "PSA", psalms: "PSA", proverbs: "PRO",
  ecclesiastes: "ECC", "song of solomon": "SNG", "song of songs": "SNG",
  isaiah: "ISA", jeremiah: "JER", lamentations: "LAM", ezekiel: "EZK",
  daniel: "DAN", hosea: "HOS", joel: "JOL", amos: "AMO", obadiah: "OBA",
  jonah: "JON", micah: "MIC", nahum: "NAM", habakkuk: "HAB",
  zephaniah: "ZEP", haggai: "HAG", zechariah: "ZEC", malachi: "MAL",
  matthew: "MAT", mark: "MRK", luke: "LUK", john: "JHN", acts: "ACT",
  romans: "ROM", "1 corinthians": "1CO", "2 corinthians": "2CO",
  galatians: "GAL", ephesians: "EPH", philippians: "PHP", colossians: "COL",
  "1 thessalonians": "1TH", "2 thessalonians": "2TH", "1 timothy": "1TI",
  "2 timothy": "2TI", titus: "TIT", philemon: "PHM", hebrews: "HEB",
  james: "JAS", "1 peter": "1PE", "2 peter": "2PE", "1 john": "1JN",
  "2 john": "2JN", "3 john": "3JN", jude: "JUD", revelation: "REV",
};

export interface ParsedReference {
  /** USFM passage ref, e.g. "MAT.11.28" or "LAM.3.22-23" for ranges */
  usfm: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  /** Normalized display form, e.g. "Matthew 11:28" */
  display: string;
}

const REF_PATTERN =
  /\b([1-3]?\s?[A-Za-z]+(?:\s(?:of\s)?[A-Za-z]+)?)\s(\d{1,3})[:.](\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?\b/;

/** Parses the first scripture reference found in an English-book-name string. */
export function parseReference(text: string): ParsedReference | null {
  const match = text.match(REF_PATTERN);
  if (!match) return null;

  const rawBook = match[1].trim().toLowerCase().replace(/\s+/g, " ");
  const book = BOOKS[rawBook];
  if (!book) {
    const words = rawBook.split(" ");
    for (let i = 1; i < words.length; i++) {
      const candidate = BOOKS[words.slice(i).join(" ")];
      if (candidate) return build(candidate, words.slice(i).join(" "), match);
    }
    return null;
  }
  return build(book, rawBook, match);
}

function build(book: string, rawBook: string, match: RegExpMatchArray): ParsedReference {
  const chapter = parseInt(match[2], 10);
  const verseStart = parseInt(match[3], 10);
  const verseEnd = match[4] ? parseInt(match[4], 10) : undefined;

  const displayBook = rawBook
    .split(" ")
    .map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/^Psalms$/, "Psalm");

  const usfm =
    verseEnd && verseEnd > verseStart
      ? `${book}.${chapter}.${verseStart}-${verseEnd}`
      : `${book}.${chapter}.${verseStart}`;

  return {
    usfm,
    book,
    chapter,
    verseStart,
    verseEnd,
    display: `${displayBook} ${chapter}:${verseStart}${verseEnd ? `-${verseEnd}` : ""}`,
  };
}

/** True when a string is already a plausible USFM ref like "JDG.6.11-16". */
export function isValidUsfm(usfm: string): boolean {
  return /^[1-5A-Z]{2,3}\.\d{1,3}\.\d{1,3}(-\d{1,3})?$/.test(usfm.trim().toUpperCase());
}
