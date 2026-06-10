import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hashStr } from "./dynasties";

// ============================================================================
// FNV-1a SHARD-BUCKET HASH — FROZEN CONTRACT
// ----------------------------------------------------------------------------
// The shard-bucket hash exists in FIVE copies that MUST agree byte-for-byte:
//   • producer (pipeline): pipeline/build-search.mjs   fnv32
//                          pipeline/build-lines.mjs    fnv32
//                          pipeline/build-fuzzy.mjs    fnv32
//   • consumer (frontend): src/data/dynasties.ts       hashStr   (this is `hashStr`)
//                          consumed by src/data/load.ts as lineBucket/fzBucket/sxBucket
//
// It is FNV-1a 32-bit: offset basis 0x811c9dc5, prime 0x01000193, mixing one
// charCodeAt per UTF-16 code unit, masked to uint32 (`>>> 0`).
//
// If the producer and the consumer ever disagree on a bucket, search goes
// SILENTLY EMPTY — the client looks in a shard the data was never written to,
// finds {}, and shows zero hits with no error. There is no runtime signal.
//
// This file is the tripwire. The golden values below were produced by RUNNING
// the current `hashStr` once and hard-coding its output — they are FROZEN
// contract values, NOT independently derived. Changing the algorithm on either
// side turns these red. Do NOT "fix" a failing golden by re-recording it unless
// you have deliberately re-sharded ALL data with a matching pipeline change.
// ============================================================================

describe("FNV-1a shard-bucket hash — frozen golden values (hashStr)", () => {
  // FROZEN: each value = the literal output of the CURRENT hashStr on that key.
  // Keys span the real key shapes the index uses: a full 汉字 line, a single 字,
  // an id-like ASCII string, a short prefix, a title, and the empty string
  // (= the bare FNV offset basis, a canary for the constant).
  const GOLDEN: Record<string, number> = {
    床前明月光: 928896077, // a whole 诗句 line (build-lines / load.ts::lineBucket)
    字: 3528234966, // a single 汉字 (single-char prefix key)
    "poet-abc123": 2941901796, // an id-like ASCII string
    静: 3676615572, // single-char prefix (寻诗 incremental)
    举头望: 59616380, // a len-3 prefix key (build-search PREFIX_MAX)
    春江花月夜: 1574405848, // an exact poem TITLE key
    "": 2166136261, // empty → 0x811c9dc5, the FNV offset basis itself
  };

  for (const [key, expected] of Object.entries(GOLDEN)) {
    it(`hashStr(${JSON.stringify(key)}) === ${expected}`, () => {
      expect(hashStr(key)).toBe(expected);
    });
  }

  it("output is an unsigned 32-bit integer for every golden key", () => {
    for (const key of Object.keys(GOLDEN)) {
      const h = hashStr(key);
      expect(h).toBe(h >>> 0);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  // The buckets the consumer (load.ts) actually derives — these are what the
  // pipeline writes its shards under, so a drift here = empty search.
  it("derives the documented shard buckets (load.ts lineBucket/fzBucket/sxBucket)", () => {
    const lineBucket = (s: string) => (hashStr(s) & 0xff).toString(16).padStart(2, "0");
    const fzBucket = (s: string) => (hashStr(s) & 0xfff).toString(16).padStart(3, "0");
    const sxBucket = (s: string) => (hashStr(s) & 0xff).toString(16).padStart(2, "0");
    expect(lineBucket("床前明月光")).toBe("4d"); // 928896077 & 0xff
    expect(sxBucket("举头望")).toBe("7c"); //  59616380 & 0xff
    expect(fzBucket("床前明月光")).toBe("44d"); // 928896077 & 0xfff (4096 shards)
  });
});

// ── Source-text tripwire: read the THREE pipeline fnv32 sources and assert both
//    FNV constants literally appear in each. A "helpful refactor" that swaps a
//    constant or pulls fnv32 from a shared module (drifting from hashStr) turns
//    CI red here — the contract is enforced at the byte level, not just by value. ──
describe("FNV-1a constants present in every pipeline fnv32 source", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SOURCES = ["build-search.mjs", "build-lines.mjs", "build-fuzzy.mjs"];
  const OFFSET_BASIS = "0x811c9dc5";
  const PRIME = "0x01000193";

  for (const file of SOURCES) {
    it(`pipeline/${file} contains both FNV constants (${OFFSET_BASIS} / ${PRIME})`, () => {
      const src = readFileSync(join(ROOT, "pipeline", file), "utf8");
      expect(src, `${file} must keep the FNV offset basis`).toContain(OFFSET_BASIS);
      expect(src, `${file} must keep the FNV prime`).toContain(PRIME);
    });
  }
});
