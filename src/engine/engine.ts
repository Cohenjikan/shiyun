// engine.ts — 诗云 (Poetry Cloud) core index engine. Pure TS, native BigInt, in-browser.
//
// Two catalogs over the same character alphabet (字库) of size N:
//   • Babel catalog   — ALL strings of L characters. index ∈ [0, N^L). Pure base-N.
//   • 格律 catalog    — only regulated-verse-valid poems, a measure-zero subset,
//                        re-indexed as a mixed-radix PRODUCT (no DFA needed, because
//                        近体诗 平仄 is positionally fixed per template).
// The 格律 catalog is NESTED inside the Babel catalog via an exact embedding e: s → g.
// A reversible BigInt Feistel scatters each catalog so neighbouring indices decorrelate.
//
// Verified rules baked into the templates: 平水韵 平声韵部; 4 基本律句 + 对/粘;
// 五/七言 = 20/28/40/56 字. (Real 平水韵 tone+rhyme data is supplied at runtime via a
// Lexicon built by the data pipeline; tests use a synthetic Lexicon fixture.)

// ───────────────────────── Types & lexicon ─────────────────────────
export type Tone = 0 | 1; // 0 = 平 (level), 1 = 仄 (oblique)
export type FormId = "wujue" | "qijue" | "wulu" | "qilu";

export interface FormDef {
  id: FormId;
  lines: number;
  cpl: number; // chars per line
  L: number; // total chars
}
export const FORMS: Record<FormId, FormDef> = {
  wujue: { id: "wujue", lines: 4, cpl: 5, L: 20 },
  qijue: { id: "qijue", lines: 4, cpl: 7, L: 28 },
  wulu: { id: "wulu", lines: 8, cpl: 5, L: 40 },
  qilu: { id: "qilu", lines: 8, cpl: 7, L: 56 },
};
export const FORM_LIST: FormDef[] = Object.values(FORMS);

// Lexicon is produced offline (data pipeline) from chinese-poetry ∪ 平水韵.
// rhymeMembers.length defines the number of 平声韵部 (real data → 30).
export interface Lexicon {
  N: number; // alphabet size (= distinct chars actually used in the corpus)
  pingList: Uint32Array; // 平-tone char-ids, sorted asc            (size Psz)
  zeList: Uint32Array; // 仄-tone char-ids, sorted asc              (size Zsz)
  pingRank: Int32Array; // global charId -> index within pingList   (-1 if not 平)
  zeRank: Int32Array; // global charId -> index within zeList       (-1 if not 仄)
  toneClass: Int8Array; // global charId -> 0|1 (matches ping/ze lists)
  rhymeOf: Int16Array; // global charId -> 平声韵部 id, or -1
  rhymeMembers: Uint32Array[]; // [韵部] sorted 平-tone char-ids in that 韵部
  rhymeRank: Int32Array[]; // [韵部] global charId -> index within rhymeMembers (-1)
}

const big = (n: number | bigint): bigint => BigInt(n);

// ───────────────── Babel catalog: base-N rank/unrank ─────────────────
// Poem = [c₀..c_{L-1}] in READING ORDER, cᵢ ∈ [0,N) a char-id.
// FIRST char is the MOST-significant digit: index = Σ cᵢ·N^(L-1-i).
// ⇒ poems sharing an opening prefix occupy a contiguous high-order index range
//   (this is what makes "半编号" prefix search work — see engineApi.prefixRange).
export function babelUnrank(L: number, N: bigint, k: bigint): number[] {
  const out = new Array<number>(L);
  for (let i = L - 1; i >= 0; i--) {
    out[i] = Number(k % N);
    k /= N;
  }
  return out;
}
export function babelRank(N: bigint, chars: number[]): bigint {
  let k = 0n;
  for (let i = 0; i < chars.length; i++) k = k * N + big(chars[i]);
  return k;
}
export function babelSize(L: number, N: bigint): bigint {
  return N ** big(L);
}

// 半编号: the smallest Babel index sharing a given leading prefix (prefix padded with
// char-id 0 in the free low positions). Because the FIRST char is the most-significant
// digit, an m-char opening line pins the top m base-N digits — i.e. fixes the high-order
// address. The N^(L-m) poems that share that opening occupy the contiguous range
// [prefixIndex, prefixIndex + prefixRange). A known line ⇒ a known half-number.
export function prefixIndex(L: number, N: bigint, prefix: number[]): bigint {
  const padded = prefix.slice(0, L);
  while (padded.length < L) padded.push(0);
  return babelRank(N, padded);
}
export function prefixRange(L: number, N: bigint, locked: number): bigint {
  return N ** big(Math.max(0, L - locked));
}

// ───────────────── 自由 catalog: variable-length verse (词 / 自由诗) ─────────────────
// A SEPARATE catalog from Babel/格律. The alphabet is the 字库 (size N real glyphs) PLUS a
// contiguous block of W "break" symbols (ids N..N+W-1) that all render as a line break.
// A poem is FREE_L positions over this radix-(N+W) alphabet — i.e. just a base-(N+W) Babel
// string, an exact bijection — but because ≈ W/(N+W) of positions are breaks, a random pull
// falls into VARIABLE-length lines (词-like) instead of one flat L-char run.
//   W = round(N/5)  → break prob ≈ 1/6 → mean line ≈ 5 real chars.
// Display splits the id sequence on any break id; the index is NOT canonicalized
// (consecutive / edge breaks → empty segments, dropped for display only), so the catalog
// stays a clean bijection: freeRank(freeUnrank(k)) === k. Real chars always satisfy id < N.
export const FREE_L = 28; // total positions (七绝-class length → ~23 real chars after breaks)
export function freeBreakCount(N: number): number {
  return Math.max(1, Math.round(N / 5));
}
export function freeRadix(N: number): bigint {
  return big(N + freeBreakCount(N));
}
export function freeSize(N: number, L = FREE_L): bigint {
  return freeRadix(N) ** big(L);
}
export function freeUnrank(N: number, k: bigint, L = FREE_L): number[] {
  return babelUnrank(L, freeRadix(N), k);
}
export function freeRank(N: number, ids: number[]): bigint {
  return babelRank(freeRadix(N), ids);
}
// Group an id sequence into display lines, dropping break ids (id >= N, the real-char count).
// Empty segments (consecutive / leading / trailing breaks) are dropped for display only —
// the underlying index still counts them, so the bijection is unaffected.
export function splitFree(N: number, ids: number[]): number[][] {
  const lines: number[][] = [];
  let cur: number[] = [];
  for (const id of ids) {
    if (id >= N) {
      if (cur.length) {
        lines.push(cur);
        cur = [];
      }
    } else cur.push(id);
  }
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [[]];
}

// ── Arbitrary-length 自由 catalog (bijective numeration) ─────────────────────
// freeRank/freeUnrank above are FIXED length (28). REAL variable-length poems — 新诗 / 古体 —
// are any length with any line structure, so they fit no fixed-form catalog and had no 编号.
// This enumerates EVERY finite poem: symbols = 字库 ids 0..N-1 plus a LINE-BREAK symbol = N,
// in a bijective base-(N+1) numeration: every non-empty symbol string ⇄ a unique positive
// integer (empty ⇄ 0). Lossless — the number encodes the characters AND where each line breaks.
//   anyUnrank(N, anyRank(N, s)) === s  for every s with each symbol in [0, N].
export function anyRank(N: number, syms: number[]): bigint {
  const B = big(N + 1);
  let k = 0n;
  for (const s of syms) k = k * B + big(s + 1); // digits 1..N+1 (bijective ⇒ no leading-zero clash)
  return k;
}
export function anyUnrank(N: number, index: bigint): number[] {
  const B = big(N + 1);
  const out: number[] = [];
  let k = index;
  while (k > 0n) {
    k -= 1n;
    out.unshift(Number(k % B)); // symbol in 0..N (N = line break)
    k /= B;
  }
  return out;
}

// ───────────────── Tone templates (4 基本律句 + 对/粘) ─────────────────
// 五言 4 基本律句 keyed by (起式 head, 收式 tail):
//  仄仄平平仄=ZZPPZ | 仄仄仄平平=ZZZPP | 平平平仄仄=PPPZZ | 平平仄仄平=PPZZP
function wuLine(head: Tone, tail: Tone): Tone[] {
  if (head === 1 && tail === 1) return [1, 1, 0, 0, 1]; // 仄起仄收
  if (head === 1 && tail === 0) return [1, 1, 1, 0, 0]; // 仄起平收
  if (head === 0 && tail === 1) return [0, 0, 0, 1, 1]; // 平起仄收
  return [0, 0, 1, 1, 0]; // 平起平收
}
// 七言 = 五言 prefixed by two chars of OPPOSITE tone to the 五言 head.
function makeLine(cpl: number, head: Tone, tail: Tone): Tone[] {
  const five = wuLine(head, tail);
  if (cpl === 5) return five;
  const p: Tone = (head ^ 1) as Tone;
  return [p, p, ...five];
}
const oppose = (line: Tone[]): Tone[] => line.map((t) => (t ^ 1) as Tone);

export interface Variant {
  qiPing: boolean;
  rhymeFirst: boolean;
  tones: Tone[];
}

// Build the full L-length tone string for one (起式, 首句入韵) variant via 对 + 粘.
export function buildVariant(form: FormDef, qiPing: boolean, rhymeFirst: boolean): Variant {
  const { lines, cpl } = form;
  const head: Tone = qiPing ? 0 : 1;
  const lineArr: Tone[][] = [];
  lineArr.push(makeLine(cpl, head, rhymeFirst ? 0 : 1)); // 首句: 入韵⇒平收, 否则仄收
  let prev = lineArr[0];
  for (let l = 1; l < lines; l++) {
    let cur: Tone[];
    if (l % 2 === 1) {
      // 对句 (even line): oppose 出句, force 平收 (rhyme)
      cur = oppose(prev);
      cur[cur.length - 1] = 0;
    } else {
      // new couplet's 出句: 粘 prev 对句's 2nd-char tone, 仄收
      const stick = prev[1] as Tone;
      cur = makeLine(cpl, stick, 1);
    }
    lineArr.push(cur);
    prev = cur;
  }
  return { qiPing, rhymeFirst, tones: ([] as Tone[]).concat(...lineArr) };
}

const _variantCache = new Map<FormId, Variant[]>();
export function variantsFor(form: FormDef): Variant[] {
  let vs = _variantCache.get(form.id);
  if (vs) return vs;
  vs = [];
  for (const qiPing of [false, true])
    for (const rhymeFirst of [false, true]) vs.push(buildVariant(form, qiPing, rhymeFirst));
  _variantCache.set(form.id, vs);
  return vs;
}

// 韵脚 positions = last char of even lines, plus line-1 if 首句入韵.
export function rhymePositions(form: FormDef, rhymeFirst: boolean): number[] {
  const r: number[] = [];
  const { lines, cpl } = form;
  for (let l = 0; l < lines; l++) {
    if ((l + 1) % 2 === 0 || (l === 0 && rhymeFirst)) r.push(l * cpl + (cpl - 1));
  }
  return r;
}

// ───────────────── 格律 catalog = mixed-radix product ─────────────────
// Position kind: 0 = 仄 (free in zeList), 1 = 平 non-rhyme (free in pingList),
//                2 = 韵脚 (in the chosen 韵部's rhymeMembers).
function classifyPositions(v: Variant, rhymePos: Set<number>): Int8Array {
  const kind = new Int8Array(v.tones.length);
  for (let i = 0; i < v.tones.length; i++) {
    if (rhymePos.has(i)) kind[i] = 2;
    else kind[i] = v.tones[i] === 1 ? 0 : 1;
  }
  return kind;
}
function countKinds(kind: Int8Array): { z: number; pf: number; rh: number } {
  let z = 0,
    pf = 0,
    rh = 0;
  for (const k of kind) {
    if (k === 0) z++;
    else if (k === 1) pf++;
    else rh++;
  }
  return { z, pf, rh };
}

// |G_form| = Σ_variant Σ_韵部 ( Zsz^z · Psz^pf · r_q^rh )
export function regulatedSize(lex: Lexicon, form: FormDef): bigint {
  const Psz = big(lex.pingList.length),
    Zsz = big(lex.zeList.length);
  let total = 0n;
  for (const v of variantsFor(form)) {
    const rp = new Set(rhymePositions(form, v.rhymeFirst));
    const { z, pf, rh } = countKinds(classifyPositions(v, rp));
    const base = Zsz ** big(z) * Psz ** big(pf);
    let rhymeSum = 0n;
    for (const members of lex.rhymeMembers) rhymeSum += big(members.length) ** big(rh);
    total += base * rhymeSum;
  }
  return total;
}

// Mixed-radix codec (LSB-first).
function mixedDecode(k: bigint, radices: bigint[]): bigint[] {
  const d: bigint[] = [];
  for (const r of radices) {
    d.push(k % r);
    k /= r;
  }
  return d;
}
function mixedEncode(digits: bigint[], radices: bigint[]): bigint {
  let k = 0n;
  for (let i = radices.length - 1; i >= 0; i--) k = k * radices[i] + digits[i];
  return k;
}

export interface RegPoem {
  form: FormId;
  variant: number;
  rhyme: number; // 韵部 index
  chars: number[];
}

// s layout (peeled MSB→LSB): [variant] [韵部 q] [per-position free digits].
export function regulatedUnrank(lex: Lexicon, form: FormDef, s: bigint): RegPoem {
  const variants = variantsFor(form);
  const Psz = big(lex.pingList.length),
    Zsz = big(lex.zeList.length);
  let vIdx = -1,
    rem = s;
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const rp = new Set(rhymePositions(form, v.rhymeFirst));
    const { z, pf, rh } = countKinds(classifyPositions(v, rp));
    const base = Zsz ** big(z) * Psz ** big(pf);
    let vsize = 0n;
    for (const members of lex.rhymeMembers) vsize += base * big(members.length) ** big(rh);
    if (rem < vsize) {
      vIdx = vi;
      break;
    }
    rem -= vsize;
  }
  if (vIdx < 0) throw new RangeError("s out of range");
  const v = variants[vIdx];
  const rp = new Set(rhymePositions(form, v.rhymeFirst));
  const kind = classifyPositions(v, rp);
  const { z, pf, rh } = countKinds(kind);
  const base = Zsz ** big(z) * Psz ** big(pf);

  let q = -1;
  for (let qi = 0; qi < lex.rhymeMembers.length; qi++) {
    const block = base * big(lex.rhymeMembers[qi].length) ** big(rh);
    if (rem < block) {
      q = qi;
      break;
    }
    rem -= block;
  }
  if (q < 0) throw new RangeError("rhyme index overflow");

  const Rsz = big(lex.rhymeMembers[q].length);
  const radices: bigint[] = [];
  for (let i = 0; i < form.L; i++)
    radices.push(kind[i] === 0 ? Zsz : kind[i] === 1 ? Psz : Rsz);
  const digits = mixedDecode(rem, radices);

  const chars = new Array<number>(form.L);
  for (let i = 0; i < form.L; i++) {
    const d = Number(digits[i]);
    chars[i] =
      kind[i] === 0 ? lex.zeList[d] : kind[i] === 1 ? lex.pingList[d] : lex.rhymeMembers[q][d];
  }
  return { form: form.id, variant: vIdx, rhyme: q, chars };
}

export function regulatedRank(lex: Lexicon, form: FormDef, poem: RegPoem): bigint {
  const variants = variantsFor(form);
  const v = variants[poem.variant];
  const rp = new Set(rhymePositions(form, v.rhymeFirst));
  const kind = classifyPositions(v, rp);
  const { z, pf, rh } = countKinds(kind);
  const Psz = big(lex.pingList.length),
    Zsz = big(lex.zeList.length);
  const base = Zsz ** big(z) * Psz ** big(pf);
  const q = poem.rhyme,
    Rsz = big(lex.rhymeMembers[q].length);

  const radices: bigint[] = [],
    digits: bigint[] = [];
  for (let i = 0; i < form.L; i++) {
    const c = poem.chars[i];
    if (kind[i] === 0) {
      radices.push(Zsz);
      digits.push(big(lex.zeRank[c]));
    } else if (kind[i] === 1) {
      radices.push(Psz);
      digits.push(big(lex.pingRank[c]));
    } else {
      radices.push(Rsz);
      digits.push(big(lex.rhymeRank[q][c]));
    }
  }
  let inner = mixedEncode(digits, radices);
  for (let qi = 0; qi < q; qi++) inner += base * big(lex.rhymeMembers[qi].length) ** big(rh);

  let off = 0n;
  for (let vi = 0; vi < poem.variant; vi++) {
    const vv = variants[vi];
    const rp2 = new Set(rhymePositions(form, vv.rhymeFirst));
    const ck = countKinds(classifyPositions(vv, rp2));
    const b2 = Zsz ** big(ck.z) * Psz ** big(ck.pf);
    for (const members of lex.rhymeMembers) off += b2 * big(members.length) ** big(ck.rh);
  }
  return off + inner;
}

// ───────────────── Nested embedding: 格律 ⟶ Babel ─────────────────
export function embedToGlobal(lex: Lexicon, form: FormDef, s: bigint): bigint {
  return babelRank(big(lex.N), regulatedUnrank(lex, form, s).chars);
}
export function globalToRegulated(lex: Lexicon, form: FormDef, g: bigint): bigint | null {
  const chars = babelUnrank(form.L, big(lex.N), g);
  const poem = matchVariant(lex, form, chars);
  return poem ? regulatedRank(lex, form, poem) : null;
}

// Independent validator + variant matcher (used by reverse search AND tests).
export function matchVariant(lex: Lexicon, form: FormDef, chars: number[]): RegPoem | null {
  const variants = variantsFor(form);
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    let ok = true;
    for (let i = 0; i < form.L && ok; i++) if (lex.toneClass[chars[i]] !== v.tones[i]) ok = false;
    if (!ok) continue;
    const rps = rhymePositions(form, v.rhymeFirst);
    const q0 = lex.rhymeOf[chars[rps[0]]];
    if (q0 < 0) continue;
    if (!rps.every((p) => lex.rhymeOf[chars[p]] === q0)) continue; // 押韵
    return { form: form.id, variant: vi, rhyme: q0, chars };
  }
  return null;
}
export function isRegulated(lex: Lexicon, form: FormDef, chars: number[]): boolean {
  return matchVariant(lex, form, chars) !== null;
}

// ───────────────── Reversible scatter (BigInt Feistel + cycle-walk) ─────────────────
const U64 = (1n << 64n) - 1n;
function splitmix64(x: bigint): bigint {
  x = (x + 0x9e3779b97f4a7c15n) & U64;
  let z = x;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64;
  return (z ^ (z >> 31n)) & U64;
}
function roundFn(half: bigint, round: bigint, key: bigint, mask: bigint): bigint {
  return splitmix64(half ^ round ^ key) & mask;
}
function feistelEnc(x: bigint, b: bigint, key: bigint, rounds = 4): bigint {
  const mask = (1n << b) - 1n;
  let L = (x >> b) & mask,
    R = x & mask;
  for (let i = 0n; i < big(rounds); i++) {
    const t = L ^ roundFn(R, i, key, mask);
    L = R;
    R = t;
  }
  return (L << b) | R;
}
function feistelDec(y: bigint, b: bigint, key: bigint, rounds = 4): bigint {
  const mask = (1n << b) - 1n;
  let L = (y >> b) & mask,
    R = y & mask;
  for (let i = big(rounds) - 1n; i >= 0n; i--) {
    const t = R ^ roundFn(L, i, key, mask);
    R = L;
    L = t;
  }
  return (L << b) | R;
}
function halfBits(M: bigint): bigint {
  let bits = 0n,
    n = M - 1n;
  while (n > 0n) {
    bits++;
    n >>= 1n;
  }
  return (bits + 1n) / 2n; // ceil(bitlen/2)
}
export function scatter(M: bigint, key: bigint, x: bigint): bigint {
  if (M <= 1n) return x;
  const b = halfBits(M);
  let y = feistelEnc(x, b, key);
  while (y >= M) y = feistelEnc(y, b, key); // cycle-walk
  return y;
}
export function unscatter(M: bigint, key: bigint, y: bigint): bigint {
  if (M <= 1n) return y;
  const b = halfBits(M);
  let x = feistelDec(y, b, key);
  while (x >= M) x = feistelDec(x, b, key);
  return x;
}

// ───────────────── Index → 3D coordinate ─────────────────
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
function hashUnit(x: bigint, salt: bigint): number {
  const h = splitmix64(x ^ (salt * 0x100000001b3n));
  return Number(h & ((1n << 53n) - 1n)) / Number(1n << 53n); // [0,1)
}
export function indexToPoint(scatteredIndex: bigint, R = 1000): Vec3 {
  return {
    x: (hashUnit(scatteredIndex, 1n) * 2 - 1) * R,
    y: (hashUnit(scatteredIndex, 2n) * 2 - 1) * R,
    z: (hashUnit(scatteredIndex, 3n) * 2 - 1) * R,
  };
}

// ───────────────── Test helpers ─────────────────
export function randBig(maxExclusive: bigint): bigint {
  if (maxExclusive <= 0n) return 0n;
  let bits = 0n,
    n = maxExclusive;
  while (n > 0n) {
    bits++;
    n >>= 1n;
  }
  const bytes = Number((bits + 7n) / 8n);
  while (true) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    let r = 0n;
    for (const x of buf) r = (r << 8n) | big(x);
    r &= (1n << bits) - 1n;
    if (r < maxExclusive) return r;
  }
}
export function hamming(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
