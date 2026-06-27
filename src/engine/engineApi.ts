// App-facing wrapper around the pure engine, bound to the ACTIVE dataset (placeholder
// now, real Step-3 data after setDataset()). Single source of truth for a poem's address:
//   • babelIndex b = babelRank(poem) ∈ [0, N^L)   — THE catalog address (displayed)
//   • spatial layout of a known b = indexToPoint(scatter(b))  — scatter only places it
// Click → hash the world point to a b, unrank, place the star where clicked.
// Search → take a b, unrank, fly to its canonical scattered point.
import {
  FORMS,
  type FormId,
  type FormDef,
  babelRank,
  babelSize,
  regulatedSize,
  regulatedUnrank,
  matchVariant,
  regulatedRank,
  scatter,
  indexToPoint,
  anyRank,
  anyUnrank,
  type Vec3,
  type Lexicon,
} from "./engine";
import { getDataset, onDatasetChange } from "../data/provider";

// The 5th "form" — 自由格式 (词 / 自由诗) — is a SEPARATE variable-length catalog, not one of
// the 4 regulated FormIds. PullForm is the UI/engineApi-facing union; the pure 格律 engine
// types stay the 4 regulated forms only, so the 格律 contract is untouched.
export type PullForm = FormId | "ziyou";

const U64 = (1n << 64n) - 1n;
const BABEL_KEY = 0x9e3779b97f4a7c15n;

// Per-form cardinality caches — invalidated when the dataset is swapped.
const _babelSize = new Map<FormId, bigint>();
const _gSize = new Map<FormId, bigint>();
onDatasetChange(() => {
  _babelSize.clear();
  _gSize.clear();
});

function N(): bigint {
  return BigInt(getDataset().lexicon.N);
}

export function babelCardinality(form: FormDef): bigint {
  let v = _babelSize.get(form.id);
  if (v === undefined) {
    v = babelSize(form.L, N());
    _babelSize.set(form.id, v);
  }
  return v;
}
export function regulatedCardinality(form: FormDef): bigint {
  let v = _gSize.get(form.id);
  if (v === undefined) {
    v = regulatedSize(getDataset().lexicon, form);
    _gSize.set(form.id, v);
  }
  return v;
}

export interface PulledPoem {
  form: PullForm;
  lines: string[];
  babelIndex: string; // decimal — long on purpose (the address ≈ the poem)
  babelDigits: number;
  lushiIndex: string | null;
  valid: boolean;
  pos: [number, number, number];
}

function toLines(form: FormDef, chars: number[]): string[] {
  const { charset } = getDataset();
  const out: string[] = [];
  for (let l = 0; l < form.lines; l++) {
    let line = "";
    for (let i = 0; i < form.cpl; i++) line += charset[chars[l * form.cpl + i]];
    out.push(line);
  }
  return out;
}

// ── 唯一·全集编号 (universal) ───────────────────────────────────────────────────────────────────
// THE canonical, globally-unique address of a poem = anyRank over its (chars + LINE-BREAK symbols).
// Because every poem — 五绝/七绝/五律/七律/自由/新诗 — is just a character-and-break sequence, and anyRank
// is a bijection over those sequences, the SAME poem has the SAME number no matter which 诗体 you call it:
// a 七绝 (4×7) and the identical poem typed as 自由 produce the IDENTICAL symbol run → the IDENTICAL index.
// This dissolves both the old per-form collision (编号 1 meant a different poem in each form) AND the
// "自由 复刻 fixed-form structure → 一首诗两个编号" dedup worry — there is one number, by construction.
// (The per-form babelRank/格律 catalogs survive in the engine, but only for the void-pull's spatial
// scatter + the 格律 mode; they are NOT the displayed 编号 anymore.)
function lineBreakSyms(N: number, lineCharIds: number[][]): number[] {
  const syms: number[] = [];
  for (let l = 0; l < lineCharIds.length; l++) {
    if (l > 0) syms.push(N); // break BETWEEN lines (no trailing) — matches anyTextIndex exactly
    for (const id of lineCharIds[l]) syms.push(id);
  }
  return syms;
}
function fixedFormSyms(form: FormDef, chars: number[]): number[] {
  const lines: number[][] = [];
  for (let l = 0; l < form.lines; l++) lines.push(chars.slice(l * form.cpl, (l + 1) * form.cpl));
  return lineBreakSyms(getDataset().lexicon.N, lines);
}
/** Infer the 诗体 of a poem from its line structure (so reverse/locate can label it). */
function inferForm(lines: string[]): PullForm {
  const lens = lines.map((l) => [...l].length);
  const uniform = lens.length > 0 && lens.every((x) => x === lens[0]);
  if (uniform) {
    if (lines.length === 4 && lens[0] === 5) return "wujue";
    if (lines.length === 4 && lens[0] === 7) return "qijue";
    if (lines.length === 8 && lens[0] === 5) return "wulu";
    if (lines.length === 8 && lens[0] === 7) return "qilu";
  }
  return "ziyou";
}

function bitLen(n: bigint): number {
  let b = 0;
  while (n > 0n) {
    n >>= 1n;
    b++;
  }
  return b;
}
function mix(a: bigint): bigint {
  a = (a + 0x9e3779b97f4a7c15n) & U64;
  let z = a;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64;
  return (z ^ (z >> 31n)) & U64;
}
// Deterministic big index from a world point (1/16-unit lattice), reduced mod M.
function indexFromPoint(p: [number, number, number], M: bigint): bigint {
  const q = (v: number) => BigInt(Math.round(v * 16));
  const seed = ((q(p[0]) * 73856093n) ^ (q(p[1]) * 19349663n) ^ (q(p[2]) * 83492791n)) & U64;
  let out = 0n;
  let need = bitLen(M) + 16;
  let ctr = 0n;
  while (need > 0) {
    out = (out << 64n) | mix(seed ^ (ctr++ * 0x100000001b3n));
    need -= 64;
  }
  return out % M;
}

function describe(form: FormDef, chars: number[], pos: [number, number, number]): PulledPoem {
  const lex = getDataset().lexicon;
  const matched = matchVariant(lex, form, chars);
  // displayed 编号 = the UNIVERSAL anyRank (chars+breaks), so a fixed-form poem shares ONE number with
  // its 自由 twin. (The per-form babelRank is still used internally for spatial scatter, not displayed.)
  const b = anyRank(lex.N, fixedFormSyms(form, chars));
  return {
    form: form.id,
    lines: toLines(form, chars),
    babelIndex: b.toString(),
    babelDigits: b === 0n ? 1 : b.toString().length,
    lushiIndex: matched ? regulatedRank(lex, form, matched).toString() : null,
    valid: matched !== null,
    pos,
  };
}

// 自由格式 = the ARBITRARY-LENGTH catalog (the merged 自由 ≡ former 任意长). Symbols are 字库 ids
// 0..N-1 plus a line-break = N, over the bijective base-(N+1) numeration (engine.anyRank/anyUnrank):
// EVERY finite poem — any length, any line structure — has one reversible 自由目录编号. This is the
// single catalog used for 自由 generation, 编号反查·自由, 新诗/古体's 编号, and permalinks. The break
// symbol splits the symbol run into display lines. lushi/valid never apply.
function describeAny(syms: number[], pos: [number, number, number]): PulledPoem {
  const { charset, lexicon } = getDataset();
  const N = lexicon.N; // break symbol
  const lines: string[] = [];
  let cur = "";
  for (const s of syms) {
    if (s === N) {
      lines.push(cur);
      cur = "";
    } else cur += charset[s];
  }
  lines.push(cur);
  const outLines = lines.length ? lines : [""];
  const b = anyRank(N, syms);
  return {
    // form is INFERRED from the reconstructed line structure (8×7 → 七律, 4×5 → 五绝, …) so a poem rebuilt
    // from its 全集编号 — permalink restore, 拾遗 re-pull, 定位虚空 — is labeled CONSISTENTLY with 探诗·凭编号
    // (pullByIndex, which already infers). A genuinely free/irregular poem (新诗/词) still infers "ziyou".
    // lushi/valid never apply here (no tone check), only the display label is refined.
    form: inferForm(outLines),
    lines: outLines,
    babelIndex: b.toString(),
    babelDigits: b === 0n ? 1 : b.toString().length,
    lushiIndex: null,
    valid: false,
    pos,
  };
}

// Symbols for a known 自由 index (chars + breaks), and the lines it splits into.
function anySyms(b: bigint): number[] {
  return anyUnrank(getDataset().lexicon.N, b);
}

export const COMMON_K = 2500; // "常用字" = the top-K most-frequent chars (字库 is freq-ordered)
// Default 虚空捞诗 alphabet cutoff: pulls weight (Zipf) over the top ~POEM_PULL_K common chars so a random
// pull reads like poetry. The 22k charset's long rare tail stays addressable (造诗 / #p= / search) but is
// excluded from random pulls — otherwise the ~9k never-in-a-poem CJK chars would turn pulls into noise.
export const POEM_PULL_K = 3200;
const FREE_GEN_L = 30; // max symbols a 自由 void-pull generates (chars + breaks) — keeps 词 readable

// A 格律 lexicon restricted to common chars (ids < K), so 格律 × 常用字 composes into
// tone-valid poems that use only everyday characters. Shares the global tone/rhyme arrays;
// only the pick-lists shrink. Cached per K, cleared on dataset swap.
const _commonLex = new Map<number, Lexicon>();
onDatasetChange(() => _commonLex.clear());
function commonLexicon(K: number): Lexicon {
  let lx = _commonLex.get(K);
  if (lx) return lx;
  const full = getDataset().lexicon;
  const k = Math.min(K, full.N);
  const N = full.N;
  const pingList = full.pingList.filter((id) => id < k);
  const zeList = full.zeList.filter((id) => id < k);
  const rhymeMembers = full.rhymeMembers.map((m) => m.filter((id) => id < k));
  const pingRank = new Int32Array(N).fill(-1);
  pingList.forEach((c, i) => (pingRank[c] = i));
  const zeRank = new Int32Array(N).fill(-1);
  zeList.forEach((c, i) => (zeRank[c] = i));
  const rhymeRank = rhymeMembers.map((m) => {
    const r = new Int32Array(N).fill(-1);
    m.forEach((c, i) => (r[c] = i));
    return r;
  });
  lx = {
    N,
    pingList,
    zeList,
    pingRank,
    zeRank,
    toneClass: full.toneClass,
    rhymeOf: full.rhymeOf,
    rhymeMembers,
    rhymeRank,
  };
  _commonLex.set(K, lx);
  return lx;
}

// ── 虚空捞诗 字频加权 (Zipf) ──────────────────────────────────────────────────────────────────
// 字库按频率排序(index 0 = 最常用),所以 charId ≈ 频率排名。按 Zipf 律 P(id) ∝ 1/(id+1)^s 加权抽样,
// 让随机捞诗偏向常用字("像诗"),稀有字低概率而非不可能(契合"穷尽一切"且不退化成乱码)。
// 只改"随机选哪个字";#p= 仍由 describe 的 anyRank 从符号算出 → 解码/permalink 双射不变,round-trip 一致。
// weight(rank i) = 1/(i + OFFSET)^S. OFFSET flattens the head so the top few-hundred common chars are
// near-equal (classical variety — 月/山/风/花, not a 的/我 particle-flood from the modern层), while the
// long tail stays rare (rare chars possible but unlikely → "穷尽一切" without lapsing into noise).
const ZIPF_S = 1.15, ZIPF_OFFSET = 350;
const _zipfCDF = new Map<number, Float64Array>();
onDatasetChange(() => _zipfCDF.clear());
function zipfCDF(K: number): Float64Array {
  let c = _zipfCDF.get(K);
  if (c) return c;
  c = new Float64Array(K);
  let sum = 0;
  for (let i = 0; i < K; i++) { sum += 1 / Math.pow(i + ZIPF_OFFSET, ZIPF_S); c[i] = sum; }
  for (let i = 0; i < K; i++) c[i] /= sum; // normalize to a [0,1] CDF
  _zipfCDF.set(K, c);
  return c;
}
function pickZipf(cdf: Float64Array, u: number): number {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (u <= cdf[m]) hi = m; else lo = m + 1; }
  return lo;
}
// mulberry32 — tiny deterministic PRNG seeded from the (quantized) void point, so a given point still
// pulls the SAME poem (stable as the galaxy turns) — now weighted instead of uniform.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const posSeed = (pos: [number, number, number], salt = 0) =>
  (Number(indexFromPoint(pos, 0x7fffffffn) % 0x7fffffffn) ^ salt) >>> 0;
// L Zipf-weighted char ids in [0,K) — fixed-form void-pull.
function weightedSyms(pos: [number, number, number], L: number, K: number): number[] {
  const rnd = prng(posSeed(pos));
  const cdf = zipfCDF(K);
  const out = new Array<number>(L);
  for (let i = 0; i < L; i++) out[i] = pickZipf(cdf, rnd());
  return out;
}
// 自由: each of L slots is a line-break (= N, ~1/6 prob) or a Zipf char in [0,M) → 词-like 变长.
function weightedFreeSyms(pos: [number, number, number], L: number, M: number, N: number): number[] {
  const rnd = prng(posSeed(pos, 0x9e3779b9));
  const cdf = zipfCDF(M);
  const out: number[] = [];
  for (let i = 0; i < L; i++) out.push(rnd() < 1 / 6 ? N : pickZipf(cdf, rnd()));
  return out;
}

// Pull a poem out of the void at a clicked world point. Filters compose inside the random
// library: `commonK` shrinks the alphabet to common chars; `lushiOnly` constrains tone/rhyme.
// The displayed 全集编号 is always the FULL-catalog address (a common-char poem is a real
// point in the full Babel catalog), so filters change WHICH poem you land on, not its number.
export function pullAt(
  formId: PullForm,
  pos: [number, number, number],
  opts: { lushiOnly?: boolean; commonK?: number } = {},
): PulledPoem {
  if (formId === "ziyou") {
    // generate a 词-like variable-length poem, then express it in the unified 自由 catalog.
    // Sampling uses a base-(M+W) alphabet (M chars drawn from + W "break" glyphs, W≈M/5 ⇒ break
    // prob ≈ 1/6 ⇒ ~5-char lines); 常用字 shrinks M. EVERY break glyph collapses to the single
    // unified break (= N), so the displayed 自由编号 (and its 编号反查) live in the one full-N
    // catalog and round-trip exactly. A bounded length keeps a click readable, not a 500-char wall.
    const N = getDataset().lexicon.N;
    const M = opts.commonK ? Math.min(opts.commonK, N) : N;
    return describeAny(weightedFreeSyms(pos, FREE_GEN_L, M, N), pos); // Zipf-weighted; break → N
  }
  const form = FORMS[formId];
  if (opts.lushiOnly) {
    const lex = opts.commonK ? commonLexicon(opts.commonK) : getDataset().lexicon;
    const size = regulatedSize(lex, form);
    if (size > 0n) {
      const s = indexFromPoint(pos, size);
      return describe(form, regulatedUnrank(lex, form, s).chars, pos);
    }
    // 格律 sub-catalog is empty under this (form × commonK) — no valid tone/rhyme picks left;
    // fall through to the random library rather than dividing by zero.
  }
  const K = opts.commonK ? Math.min(opts.commonK, getDataset().lexicon.N) : Number(N());
  return describe(form, weightedSyms(pos, form.L, K), pos); // Zipf-weighted random pull (was uniform)
}

// Canonical scattered position of a known babel index (for search / permalink).
export function pointForBabelIndex(formId: FormId, b: bigint, R = 1000): Vec3 {
  const form = FORMS[formId];
  return indexToPoint(scatter(babelCardinality(form), BABEL_KEY, b), R);
}

// char → 字库 id, cached per dataset (cleared on swap above).
let _charToId: Map<string, number> | null = null;
onDatasetChange(() => {
  _charToId = null;
});
function charToId(): Map<string, number> {
  if (!_charToId) {
    _charToId = new Map();
    getDataset().charset.forEach((c, i) => _charToId!.set(c, i));
  }
  return _charToId;
}

const HAN = /\p{Script=Han}/u;
/** Is a single character present in the active 字库? (per-cell 造诗 grid validation feedback.) */
export function inCharset(ch: string): boolean {
  return !!ch && charToId().has(ch);
}
/**
 * Unique glyphs in `text` that are NOT in the 字库 — so the text has no fixed 编号. Code-point aware,
 * de-duplicated, order preserved. Drives the 自由填诗 "which char is unsupported" hint (the grid mode
 * shows this per-cell via inCharset; the textarea mode uses this). 诗云's 字库 is Simplified + frozen,
 * so 繁体/异体/生僻字 land here by design.
 */
export function outOfCharset(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ch of text) {
    if (!seen.has(ch) && !inCharset(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}
/** Han chars of `han` → 字库 ids, or null if any char is outside the 字库. */
function hanToIds(han: string): number[] | null {
  const map = charToId();
  const ids: number[] = [];
  for (const c of han) {
    if (!HAN.test(c)) continue;
    const id = map.get(c);
    if (id === undefined) return null;
    ids.push(id);
  }
  return ids;
}

/** Catalog index of a real poem's text, IF it is exactly one of the 4 forms' length
 *  and every char is in the 字库. Returns null otherwise (古体/其它 → no fixed index). */
export function textBabelIndex(formId: FormId, han: string): { index: string; digits: number } | null {
  const form = FORMS[formId];
  const ids = hanToIds(han);
  if (!ids || ids.length !== form.L) return null;
  const b = babelRank(N(), ids);
  const s = b.toString();
  return { index: s, digits: s.length };
}

// 半编号 (universal): the opening's chars are the MOST-significant symbols of the universal anyRank, so
// anyRank(opening) IS the high-order prefix that EVERY poem starting with this opening shares — a true
// prefix of the full 全集编号. No form needed: one catalog, the same opening pins the same high-order.
export interface HalfIndex {
  index: string; // the high-order prefix (universal catalog) the opening pins
  digits: number;
  locked: number; // chars pinned by the typed opening
}
export function halfIndexAuto(han: string): HalfIndex | null {
  const ids = hanToIds(han);
  if (!ids || ids.length === 0) return null;
  const s = anyRank(getDataset().lexicon.N, ids).toString();
  return { index: s, digits: s.length, locked: ids.length };
}

// ── 反查 (reverse): 编号 → 诗 — the other direction of the bijection. unrank a decimal index
//    back into the poem at that catalog position. Proves the number IS the poem (and vice-versa).
export interface IndexPoem {
  form: PullForm;
  lines: string[]; // empty if out of range
  index: string; // the normalized decimal index
  digits: number;
  inRange: boolean; // index < |catalog| for this form
  cardinalityDigits: number; // length of |catalog| (so the UI can say "共 … 首")
}
export function pullByIndex(_formId: PullForm, indexInput: string): IndexPoem | null {
  const digitsOnly = (indexInput || "").replace(/[^0-9]/g, "");
  if (!digitsOnly) return null;
  let b: bigint;
  try {
    b = BigInt(digitsOnly);
  } catch {
    return null;
  }
  const idx = b.toString(); // normalize (drops leading zeros)
  // UNIVERSAL reverse: every number maps to EXACTLY ONE poem (the anyRank bijection), so the same
  // number is the same poem regardless of 诗体. The form is INFERRED from the line structure for display.
  const lines = describeAny(anySyms(b), [0, 0, 0]).lines;
  return { form: inferForm(lines), lines, index: idx, digits: idx.length, inRange: true, cardinalityDigits: 0 };
}

// ── 任意长编号 (arbitrary-length 自由 catalog) — gives REAL variable-length poems (新诗/古体)
//    a reversible 全集编号 they otherwise had none. Encodes the poem's chars + line breaks into
//    one big integer via the engine's bijective numeration. Han-only (the 字库 is Han); a poem
//    with any glyph outside the 字库 returns null (like the 4-form index).
export interface AnyIndex {
  index: string;
  digits: number;
  chars: number; // real chars encoded
  lines: number; // line count
}
export function anyTextIndex(lines: string[]): AnyIndex | null {
  const map = charToId();
  const N = getDataset().lexicon.N; // break symbol = N
  const syms: number[] = [];
  let chars = 0;
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) syms.push(N); // line break between lines
    for (const ch of lines[li]) {
      const id = map.get(ch);
      if (id === undefined) return null; // glyph not in 字库 → no fixed 编号
      syms.push(id);
      chars++;
    }
  }
  if (chars === 0) return null;
  const s = anyRank(N, syms).toString();
  return { index: s, digits: s.length, chars, lines: lines.length };
}

// Rebuild a full PulledPoem from a known index (for permalink restore). Places it at the
// canonical scattered point so a shared link drops you onto the same star.
export function pulledFromIndex(_formId: PullForm, indexStr: string): PulledPoem | null {
  const digitsOnly = (indexStr || "").replace(/[^0-9]/g, "");
  if (!digitsOnly) return null;
  let b: bigint;
  try {
    b = BigInt(digitsOnly);
  } catch {
    return null;
  }
  // UNIVERSAL: any number → its one poem (anyRank bijection), placed at a canonical scattered point.
  const p = indexToPoint(b);
  return describeAny(anySyms(b), [p.x, p.y, p.z]);
}
