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
  regulatedSize,
  regulatedUnrank,
  matchVariant,
  regulatedRank,
  scatter,
  indexToPoint,
  type Vec3,
  type Lexicon,
} from "./engine";
import { getDataset, onDatasetChange } from "../data/provider";

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
  form: FormId;
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
  formId: FormId,
  pos: [number, number, number],
  opts: { lushiOnly?: boolean; commonK?: number } = {},
): PulledPoem {
  const form = FORMS[formId];
  if (opts.lushiOnly) {
    const lex = opts.commonK ? commonLexicon(opts.commonK) : getDataset().lexicon;
    const s = indexFromPoint(pos, regulatedSize(lex, form));
    return describe(form, regulatedUnrank(lex, form, s).chars, pos);
  }
  const radix = opts.commonK ? BigInt(Math.min(opts.commonK, getDataset().lexicon.N)) : N();
  const b = indexFromPoint(pos, radix ** BigInt(form.L));
  return describe(form, babelUnrank(form.L, radix, b), pos);
}

// Canonical scattered position of a known babel index (for search / permalink).
// This is the universe's single "preset coordinate" map: index → a fixed point in
// the void. Same map for fly-to, permalinks, and search-locate.
export function pointForBabelIndex(formId: FormId, b: bigint, R = 1000): Vec3 {
  const form = FORMS[formId];
  return indexToPoint(scatter(babelCardinality(form), BABEL_KEY, b), R);
}

// Spread searched poems across the galaxy volume (vs the default tight R=1000 core).
const LOCATE_R = 1800;

// Fully describe a poem from a KNOWN catalog index, positioned at its canonical void
// coordinate. This is what content/number search drops you onto: the exact star a
// poem occupies in the void, with its real text + 全集编号 (round-trips with pullAt's
// indexFromPoint is NOT implied — the index pins the poem and its canonical point).
export function pullByIndex(formId: FormId, b: bigint, R = LOCATE_R): PulledPoem {
  const form = FORMS[formId];
  const pt = pointForBabelIndex(formId, b, R);
  return describe(form, babelUnrank(form.L, N(), b), [pt.x, pt.y, pt.z]);
}

export type LocateResult = { form: FormId; index: bigint } | { error: string };

// Resolve a free-text query to a locatable poem: a decimal string is a catalog index
// under the active form; otherwise it's treated as poem text and matched to the form
// whose length fits (20/28/40/56 字), then mapped to its index. Returns an error
// string the UI can show verbatim.
export function locateQuery(active: FormId, query: string): LocateResult {
  const q = query.trim();
  if (!q) return { error: "请输入诗句或编号" };
  if (/^\d+$/.test(q)) {
    const b = BigInt(q);
    if (b < 0n || b >= babelCardinality(FORMS[active]))
      return { error: "编号超出该诗体的目录范围" };
    return { form: active, index: b };
  }
  const han = [...q].filter((c) => HAN.test(c));
  const byLen = FORM_LIST.find((f) => f.L === han.length);
  const form = byLen?.id ?? active;
  const hit = textBabelIndex(form, q);
  if (!hit) return { error: "需 20/28/40/56 字（五绝/七绝/五律/七律）且每字在字库内" };
  return { form, index: BigInt(hit.index) };
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
/** Catalog index of a real poem's text, IF it is exactly one of the 4 forms' length
 *  and every char is in the 字库. Returns null otherwise (古体/其它 → no fixed index). */
export function textBabelIndex(formId: FormId, han: string): { index: string; digits: number } | null {
  const form = FORMS[formId];
  const chars = [...han].filter((c) => HAN.test(c));
  if (chars.length !== form.L) return null;
  const map = charToId();
  const ids: number[] = [];
  for (const c of chars) {
    const id = map.get(c);
    if (id === undefined) return null;
    ids.push(id);
  }
  const b = babelRank(N(), ids);
  const s = b.toString();
  return { index: s, digits: s.length };
}
