import { hashStr } from "./dynasties";

export const CHAR_BUCKET_COUNT = 4096;
export const charsBucket = (s: string): string => (hashStr(s) & 0xfff).toString(16).padStart(3, "0");

export interface CharRecord { p: string; i: number; t: string; f: string; line: string }
export function decodeCharRecords(rows: unknown): CharRecord[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is [string, number, string, string, string] =>
    Array.isArray(r) && r.length >= 5 && typeof r[0] === "string" && typeof r[1] === "number" &&
    typeof r[2] === "string" && typeof r[3] === "string" && typeof r[4] === "string",
  ).map(([p, i, t, f, line]) => ({ p, i, t, f, line }));
}

/** Select the least populated character index as the candidate set for a multi-character substring. */
export function rarestCharIndex<T>(chars: string[], lists: Map<string, T[]>): T[] {
  return chars.map((char) => lists.get(char) || []).sort((a, b) => a.length - b.length)[0] || [];
}

export function filterCharSubstring<T extends { line: string }>(rows: T[], query: string): T[] {
  return rows.filter((row) => row.line.includes(query));
}

/** Rank/cap logic — a TS mirror of pipeline/build-chars.mjs phase 2 (keep the two in sync). Picks the
 *  best `limit` rows (famous/quality score first, ≤ perPoet per poet), then INTERLEAVES them: every
 *  poet's 1st line (best poet first), then every poet's 2nd line, … — so a prolific landmark poet
 *  (陆游) can't fill the whole first page of a one-character query (#132 wants many different lines). */
export function capCharRecords<T extends { p: string; score: number }>(rows: T[], limit: number, perPoet: number): T[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
  const counts = new Map<string, number>(), chosen: { row: T; k: number }[] = [];
  for (const row of sorted) {
    const n = counts.get(row.p) || 0;
    if (n >= perPoet) continue;
    counts.set(row.p, n + 1); chosen.push({ row, k: n });
    if (chosen.length >= limit) break;
  }
  // stable sort: within the same per-poet rank, the score order from above is kept
  return chosen.sort((a, b) => a.k - b.k).map((c) => c.row);
}

/** Returns true only for the one response that should permanently latch an absent optional index. */
export const shouldLatchCharsUnavailable = (status: number): boolean => status === 404;
