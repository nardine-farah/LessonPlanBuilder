/**
 * Page-selection spec parsing, shared by the chooser UI and the API.
 * A spec is a comma-separated list of pages and ranges: "1-10, 15, 22-30".
 * Accepts hyphen or en-dash, ignores whitespace, merges overlaps, sorts.
 */

export interface PageRange {
  from: number;
  to: number;
}

export type ParseResult = { ok: true; ranges: PageRange[]; pageCount: number } | { ok: false; error: string };

export function parsePageSpec(spec: string, maxPage: number): ParseResult {
  const cleaned = spec.trim();
  if (!cleaned) return { ok: false, error: "Enter at least one page or range." };

  const ranges: PageRange[] = [];
  for (const rawPart of cleaned.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const m = part.match(/^(\d{1,4})\s*[-–—]\s*(\d{1,4})$/) ?? part.match(/^(\d{1,4})$/);
    if (!m) {
      return { ok: false, error: `"${part}" isn't a page or range — use forms like 12 or 5-40.` };
    }
    const from = parseInt(m[1], 10);
    const to = m[2] !== undefined ? parseInt(m[2], 10) : from;
    if (from < 1 || to < from) {
      return { ok: false, error: `"${part}" isn't a valid range.` };
    }
    if (to > maxPage) {
      return { ok: false, error: `"${part}" goes past the last page (${maxPage}).` };
    }
    ranges.push({ from, to });
  }
  if (!ranges.length) return { ok: false, error: "Enter at least one page or range." };

  // Sort and merge overlapping/adjacent ranges.
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: PageRange[] = [ranges[0]];
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }

  return { ok: true, ranges: merged, pageCount: countPages(merged) };
}

export function countPages(ranges: PageRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.to - r.from + 1), 0);
}

/** Canonical machine form: "1-10,15,22-30" — used for job identity. */
export function normalizeRanges(ranges: PageRange[]): string {
  return ranges.map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`)).join(",");
}

/** Human form with en-dashes: "1–10, 15, 22–30". */
export function formatRanges(ranges: PageRange[]): string {
  return ranges.map((r) => (r.from === r.to ? String(r.from) : `${r.from}–${r.to}`)).join(", ");
}

export function rangesToPages(ranges: PageRange[]): number[] {
  const pages: number[] = [];
  for (const r of ranges) for (let p = r.from; p <= r.to; p++) pages.push(p);
  return pages;
}

/** Collapse a sorted list of page numbers back into ranges. */
export function pagesToRanges(pages: number[]): PageRange[] {
  const ranges: PageRange[] = [];
  for (const p of pages) {
    const last = ranges[ranges.length - 1];
    if (last && p === last.to + 1) last.to = p;
    else ranges.push({ from: p, to: p });
  }
  return ranges;
}
