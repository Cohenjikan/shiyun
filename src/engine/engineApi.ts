// App-facing wrapper around the pure engine, bound to the ACTIVE dataset (placeholder
// now, real Step-3 data after setDataset()). Single source of truth for a poem's address:
//   • babelIndex b = babelRank(poem) ∈ [0, N^L)   — THE catalog address (displayed)
//   • spatial layout of a known b = indexToPoint(scatter(b))  — scatter only places it
// Click → hash the world point to a b, unrank, place the star where clicked.
// Search → take a b, unrank, fly to its canonical scattered point.
import {
  FORMS,
  FORM_LIST,
  type FormId,
  type FormDef,
  babelUnrank,
  babelRank,
  babelSize,
  prefixIndex,
  regulatedSize,
  regulatedUnrank,
  matchVariant,
  regulatedRank,
  scatter,
  indexToPoint,
  freeSize,
  freeUnrank,
  freeRank,
  splitFree,
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
  const b = babelRank(N(), chars);
  const matched = matchVariant(lex, form, chars);
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

// 自由格式 pull: variable-length 词/自由诗 from the radix-(realN+W) catalog (see engine.ts).
// `realN` = the real-char count drawn from (= commonK in 常用字 mode, else the full 字库 N).
// Its own catalog ⇒ the displayed 自由目录编号 is over that radix; lushi/valid never apply.
function describeFree(realN: number, ids: number[], pos: [number, number, number]): PulledPoem {
  const { charset } = getDataset();
  const lines = splitFree(realN, ids).map((seg) => seg.map((id) => charset[id]).join(""));
  const b = freeRank(realN, ids);
  return {
    form: "ziyou",
    lines,
    babelIndex: b.toString(),
    babelDigits: b === 0n ? 1 : b.toString().length,
    lushiIndex: null,
    valid: false,
    pos,
  };
}

export const COMMON_K = 2500; // "常用字" = the top-K most-frequent chars (字库 is freq-ordered)

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
    const fullN = getDataset().lexicon.N;
    const realN = opts.commonK ? Math.min(opts.commonK, fullN) : fullN;
    const k = indexFromPoint(pos, freeSize(realN));
    return describeFree(realN, freeUnrank(realN, k), pos);
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
  const radix = opts.commonK ? BigInt(Math.min(opts.commonK, getDataset().lexicon.N)) : N();
  const b = indexFromPoint(pos, radix ** BigInt(form.L));
  return describe(form, babelUnrank(form.L, radix, b), pos);
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

// 半编号: interpret a typed line/opening as the START of a form and return the high-order
// address its known chars pin (see engine.prefixIndex). `freeChars` low positions stay free,
// so prefixRange = N^freeChars poems share this opening. A known line ⇒ a known half-number.
export interface HalfIndex {
  form: FormId;
  index: string; // decimal high-order address (the prefix padded with the lowest char)
  digits: number;
  locked: number; // chars pinned by the typed opening
  freeChars: number; // remaining free positions in the form
  total: number; // form length L
}
export function halfIndex(formId: FormId, han: string): HalfIndex | null {
  const form = FORMS[formId];
  const ids = hanToIds(han);
  if (!ids || ids.length === 0 || ids.length > form.L) return null;
  const s = prefixIndex(form.L, N(), ids).toString();
  return { form: formId, index: s, digits: s.length, locked: ids.length, freeChars: form.L - ids.length, total: form.L };
}
/** 半编号 for the best-fitting form: prefer one whose LINE length divides the opening (a 5-char
 *  line ⇒ 五绝, a 7-char line ⇒ 七绝 — never 五绝), smallest L; else the smallest form it fits in. */
export function halfIndexAuto(han: string): HalfIndex | null {
  const ids = hanToIds(han);
  if (!ids || ids.length === 0) return null;
  const len = ids.length;
  for (const f of FORM_LIST) if (len % f.cpl === 0 && len <= f.L) return halfIndex(f.id, han);
  for (const f of FORM_LIST) if (len <= f.L) return halfIndex(f.id, han);
  return null; // longer than 七律 (56) — too long to pin to a single form
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
export function pullByIndex(formId: PullForm, indexInput: string): IndexPoem | null {
  const digitsOnly = (indexInput || "").replace(/[^0-9]/g, "");
  if (!digitsOnly) return null;
  let b: bigint;
  try {
    b = BigInt(digitsOnly);
  } catch {
    return null;
  }
  const idx = b.toString(); // normalize (drops leading zeros)
  if (formId === "ziyou") {
    const fullN = getDataset().lexicon.N;
    const size = freeSize(fullN);
    const inRange = b < size;
    const lines = inRange
      ? splitFree(fullN, freeUnrank(fullN, b)).map((seg) =>
          seg.map((id) => getDataset().charset[id]).join(""),
        )
      : [];
    return { form: "ziyou", lines, index: idx, digits: idx.length, inRange, cardinalityDigits: size.toString().length };
  }
  const form = FORMS[formId];
  const size = babelSize(form.L, N());
  const inRange = b < size;
  const lines = inRange ? toLines(form, babelUnrank(form.L, N(), b)) : [];
  return { form: formId, lines, index: idx, digits: idx.length, inRange, cardinalityDigits: size.toString().length };
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

// Reverse a 任意长编号 → the exact poem (chars + line structure). Any positive integer maps to
// a poem (the catalog is ALL finite poems), so there is no "out of range".
export function anyTextReverse(indexInput: string): { lines: string[]; index: string; digits: number } | null {
  const digitsOnly = (indexInput || "").replace(/[^0-9]/g, "");
  if (!digitsOnly) return null;
  let b: bigint;
  try {
    b = BigInt(digitsOnly);
  } catch {
    return null;
  }
  const { charset, lexicon } = getDataset();
  const N = lexicon.N;
  const lines: string[] = [];
  let cur = "";
  for (const s of anyUnrank(N, b)) {
    if (s === N) {
      lines.push(cur);
      cur = "";
    } else cur += charset[s];
  }
  lines.push(cur);
  const idx = b.toString();
  return { lines, index: idx, digits: idx.length };
}

// Rebuild a full PulledPoem from a known index (for permalink restore). Places it at the
// canonical scattered point so a shared link drops you onto the same star.
export function pulledFromIndex(formId: PullForm, indexStr: string): PulledPoem | null {
  const digitsOnly = (indexStr || "").replace(/[^0-9]/g, "");
  if (!digitsOnly) return null;
  let b: bigint;
  try {
    b = BigInt(digitsOnly);
  } catch {
    return null;
  }
  if (formId === "ziyou") {
    const fullN = getDataset().lexicon.N;
    if (b >= freeSize(fullN)) return null;
    const p = indexToPoint(b);
    return describeFree(fullN, freeUnrank(fullN, b), [p.x, p.y, p.z]);
  }
  const form = FORMS[formId];
  if (b >= babelSize(form.L, N())) return null;
  const p = pointForBabelIndex(formId, b);
  return describe(form, babelUnrank(form.L, N(), b), [p.x, p.y, p.z]);
}
