import { describe, it, expect } from "vitest";
import {
  FORM_LIST,
  babelRank,
  babelUnrank,
  babelSize,
  prefixIndex,
  prefixRange,
  regulatedSize,
  regulatedUnrank,
  regulatedRank,
  embedToGlobal,
  globalToRegulated,
  isRegulated,
  scatter,
  unscatter,
  indexToPoint,
  freeRadix,
  freeSize,
  freeUnrank,
  freeRank,
  splitFree,
  anyRank,
  anyUnrank,
  randBig,
  hamming,
  type FormDef,
} from "./engine";
import { makeFixtureLexicon } from "./lexicon.fixture";

const lex = makeFixtureLexicon(60, 60, 6); // N=120
const N = BigInt(lex.N);
const KEY = 0xc0ffeen;
const ITERS = 200;

describe.each(FORM_LIST)("form $id", (form: FormDef) => {
  const babelN = babelSize(form.L, N);
  const gN = regulatedSize(lex, form);

  it("Babel round-trip: rank(unrank(k)) === k", () => {
    for (let t = 0; t < ITERS; t++) {
      const k = randBig(babelN);
      expect(babelRank(N, babelUnrank(form.L, N, k))).toBe(k);
    }
  });

  it("Babel edge cases (0 and N^L - 1)", () => {
    for (const k of [0n, babelN - 1n]) {
      expect(babelRank(N, babelUnrank(form.L, N, k))).toBe(k);
    }
  });

  it("格律 round-trip: regulatedRank(regulatedUnrank(s)) === s", () => {
    for (let t = 0; t < ITERS; t++) {
      const s = randBig(gN);
      const poem = regulatedUnrank(lex, form, s);
      expect(regulatedRank(lex, form, poem)).toBe(s);
    }
  });

  it("every 格律-unrank output passes the independent validator", () => {
    for (let t = 0; t < ITERS; t++) {
      const poem = regulatedUnrank(lex, form, randBig(gN));
      expect(isRegulated(lex, form, poem.chars)).toBe(true);
    }
  });

  it("格律 edge cases (0 and |G| - 1) round-trip and validate", () => {
    for (const s of [0n, gN - 1n]) {
      const poem = regulatedUnrank(lex, form, s);
      expect(regulatedRank(lex, form, poem)).toBe(s);
      expect(isRegulated(lex, form, poem.chars)).toBe(true);
    }
  });

  it("dual-index nesting: globalToRegulated(embedToGlobal(s)) === s", () => {
    for (let t = 0; t < ITERS; t++) {
      const s = randBig(gN);
      const g = embedToGlobal(lex, form, s);
      expect(g).toBeLessThan(babelN); // 格律 index embeds inside the Babel catalog
      expect(globalToRegulated(lex, form, g)).toBe(s);
    }
  });

  it("Feistel scatter is an exact involution on both catalogs", () => {
    for (const M of [babelN, gN]) {
      for (let t = 0; t < ITERS; t++) {
        const x = randBig(M);
        const y = scatter(M, KEY, x);
        expect(y).toBeLessThan(M); // stays in range (cycle-walk)
        expect(unscatter(M, KEY, y)).toBe(x);
      }
    }
  });

  it("Feistel scatter has no collisions on a sample", () => {
    const seen = new Set<string>();
    for (let t = 0; t < ITERS; t++) {
      const y = scatter(babelN, KEY, randBig(babelN));
      seen.add(y.toString());
    }
    expect(seen.size).toBe(ITERS);
  });
});

describe("scatter decorrelates neighbours (statistical)", () => {
  it("consecutive Babel indices map to dissimilar poems (≥80% Hamming)", () => {
    const form = FORM_LIST[0]; // wujue, L=20
    const babelN = babelSize(form.L, N);
    let total = 0;
    const trials = 300;
    for (let t = 0; t < trials; t++) {
      const x = randBig(babelN - 1n);
      const a = babelUnrank(form.L, N, unscatter(babelN, KEY, x));
      const b = babelUnrank(form.L, N, unscatter(babelN, KEY, x + 1n));
      total += hamming(a, b);
    }
    expect(total / trials).toBeGreaterThanOrEqual(0.8 * form.L);
  });
});

describe("半编号 prefix index (content search)", () => {
  it.each(FORM_LIST)("a full poem's prefix index === its babel index ($id)", (form: FormDef) => {
    for (let t = 0; t < 50; t++) {
      const chars = babelUnrank(form.L, N, randBig(babelSize(form.L, N)));
      expect(prefixIndex(form.L, N, chars)).toBe(babelRank(N, chars));
      expect(prefixRange(form.L, N, form.L)).toBe(1n); // a full poem locks everything
    }
  });

  it("a leading prefix pins the high-order chars and the range = N^(L-m)", () => {
    const form = FORM_LIST[0]; // wujue L=20
    for (let t = 0; t < 50; t++) {
      const full = babelUnrank(form.L, N, randBig(babelSize(form.L, N)));
      const m = 5; // first line of a 五绝
      const prefix = full.slice(0, m);
      const lo = prefixIndex(form.L, N, prefix);
      // every poem in [lo, lo+range) shares the prefix; unranking lo reproduces the prefix
      const back = babelUnrank(form.L, N, lo);
      expect(back.slice(0, m)).toEqual(prefix);
      expect(back.slice(m).every((c) => c === 0)).toBe(true); // padded with id 0
      expect(prefixRange(form.L, N, m)).toBe(N ** BigInt(form.L - m));
      // the FULL poem lives inside the prefix's contiguous range [lo, lo+range)
      const full_i = babelRank(N, full);
      expect(full_i).toBeGreaterThanOrEqual(lo);
      expect(full_i).toBeLessThan(lo + prefixRange(form.L, N, m));
    }
  });
});

describe("自由 catalog (变长 词 / 自由诗)", () => {
  const FN = lex.N; // 120 in the fixture
  const FL = 14; // shorter length keeps the random indices small & the suite fast

  it("freeRank(freeUnrank(k)) === k over the radix-(N+W) alphabet", () => {
    const size = freeSize(FN, FL);
    for (let t = 0; t < ITERS; t++) {
      const k = randBig(size);
      expect(freeRank(FN, freeUnrank(FN, k, FL))).toBe(k);
    }
  });

  it("edge cases 0 and |free| - 1 round-trip", () => {
    const size = freeSize(FN, FL);
    for (const k of [0n, size - 1n]) {
      expect(freeRank(FN, freeUnrank(FN, k, FL))).toBe(k);
    }
  });

  it("every unrank id is in [0, N+W); break ids are exactly those >= N", () => {
    const radix = Number(freeRadix(FN));
    for (let t = 0; t < ITERS; t++) {
      const ids = freeUnrank(FN, randBig(freeSize(FN, FL)), FL);
      expect(ids.length).toBe(FL);
      for (const id of ids) {
        expect(id).toBeGreaterThanOrEqual(0);
        expect(id).toBeLessThan(radix);
      }
    }
  });

  it("splitFree groups runs of real chars, drops break ids, and never emits a break", () => {
    // ids: real, real, break, real, break, break, real  → 3 lines [2,1,1]
    const B = FN; // first break id
    const ids = [0, 1, B, 2, B, B + 3, 3];
    const lines = splitFree(FN, ids);
    expect(lines.map((l) => l.length)).toEqual([2, 1, 1]);
    for (const line of lines) for (const id of line) expect(id).toBeLessThan(FN);
  });

  it("splitFree on an all-break sequence yields a single empty line (never zero lines)", () => {
    expect(splitFree(FN, [FN, FN, FN])).toEqual([[]]);
  });
});

describe("任意长 catalog (bijective — gives 新诗/古体 a reversible 编号)", () => {
  const FN = lex.N; // N=120; break symbol = N
  const B = FN + 1;

  it("anyUnrank(anyRank(syms)) === syms for arbitrary-length symbol strings", () => {
    for (let t = 0; t < ITERS; t++) {
      const len = 1 + (t % 40); // 1..40 symbols
      const syms: number[] = [];
      for (let i = 0; i < len; i++) syms.push(Number(randBig(BigInt(B)))); // each in [0, N]
      expect(anyUnrank(FN, anyRank(FN, syms))).toEqual(syms);
    }
  });

  it("is a true bijection on the index side: anyRank(anyUnrank(k)) === k", () => {
    for (let t = 0; t < ITERS; t++) {
      const k = randBig(10n ** 30n); // any positive index
      expect(anyRank(FN, anyUnrank(FN, k))).toBe(k);
    }
  });

  it("empty ⇄ 0; encodes line breaks (symbol N) distinctly from chars", () => {
    expect(anyRank(FN, [])).toBe(0n);
    expect(anyUnrank(FN, 0n)).toEqual([]);
    // two one-char lines "a","b" = [0, break, 1] differs from one line "ab" = [0,1]
    expect(anyRank(FN, [0, FN, 1])).not.toBe(anyRank(FN, [0, 1]));
  });
});

describe("indexToPoint", () => {
  it("is deterministic and bounded", () => {
    const idx = randBig(1n << 200n);
    const p1 = indexToPoint(idx, 1000);
    const p2 = indexToPoint(idx, 1000);
    expect(p1).toEqual(p2);
    for (const c of [p1.x, p1.y, p1.z]) {
      expect(c).toBeGreaterThanOrEqual(-1000);
      expect(c).toBeLessThanOrEqual(1000);
    }
  });
});
