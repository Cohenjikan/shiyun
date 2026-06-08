// Loads the real Step-3 assets and swaps them into the engine via the provider seam.
// 格律 tone/rhyme data is intentionally absent (default = random per user direction), so
// we build a DUMMY lexicon that satisfies the engine type but is never used for authentic
// 格律 — the UI runs in random (Babel) mode.
import type { Lexicon } from "../engine/engine";
import { setDataset } from "./provider";
import { hydrateLexicon, type LexiconAsset, type FirstLineRef, type GiftEdge, type GiftsAsset } from "./contract";
import { hashStr } from "./dynasties";

let _realGelu = false;
/** True once a real 平仄/平水韵 lexicon is loaded (so the UI can offer the 格律 mode). */
export const hasRealGelu = (): boolean => _realGelu;

export interface PoetRow {
  id: string;
  name: string;
  dynasty: string;
  poemCount: number;
  clusterSize: number;
}
export interface PoemRecord {
  t: string;
  f: string; // "wujue" | "qijue" | "wulu" | "qilu" | "other"
  p: string[]; // lines
}
export interface DataManifest {
  n: number;
  poetCount: number;
  poemCount: number;
  buckets: string[];
  dynCounts: Record<string, number>;
}

let _poets: PoetRow[] = [];
let _byId = new Map<string, PoetRow>();
let _manifest: DataManifest | null = null;
const _bucketCache = new Map<string, Record<string, PoemRecord[]>>();

export const getPoets = (): PoetRow[] => _poets;
export const getPoet = (id: string): PoetRow | undefined => _byId.get(id);
export const getManifest = (): DataManifest | null => _manifest;

function dummyLexicon(N: number): Lexicon {
  const half = N >> 1;
  const pingList = Uint32Array.from({ length: half }, (_, i) => i);
  const zeList = Uint32Array.from({ length: N - half }, (_, i) => half + i);
  const toneClass = new Int8Array(N);
  for (let i = half; i < N; i++) toneClass[i] = 1;
  const pingRank = new Int32Array(N).fill(-1);
  pingList.forEach((c, i) => (pingRank[c] = i));
  const zeRank = new Int32Array(N).fill(-1);
  zeList.forEach((c, i) => (zeRank[c] = i));
  const GROUPS = Math.min(30, Math.max(1, half));
  const per = Math.max(1, Math.floor(half / GROUPS));
  const rhymeOf = new Int16Array(N).fill(-1);
  const rhymeMembers: Uint32Array[] = [];
  const rhymeRank: Int32Array[] = [];
  for (let q = 0; q < GROUPS; q++) {
    const start = q * per;
    const end = q === GROUPS - 1 ? half : (q + 1) * per;
    const m: number[] = [];
    const rk = new Int32Array(N).fill(-1);
    for (let id = start; id < end; id++) {
      m.push(id);
      rhymeOf[id] = q;
      rk[id] = m.length - 1;
    }
    rhymeMembers.push(Uint32Array.from(m));
    rhymeRank.push(rk);
  }
  return { N, pingList, zeList, pingRank, zeRank, toneClass, rhymeOf, rhymeMembers, rhymeRank };
}

export async function loadData(base = "/data"): Promise<DataManifest> {
  const [charset, poets, manifest, lexAsset] = await Promise.all([
    fetch(`${base}/charset.json`).then((r) => r.json()),
    fetch(`${base}/poets.index.json`).then((r) => r.json()),
    fetch(`${base}/manifest.json`).then((r) => r.json()),
    fetch(`${base}/lexicon.json`)
      .then((r) => (r.ok ? (r.json() as Promise<LexiconAsset>) : null))
      .catch(() => null),
  ]);
  _poets = poets;
  _byId = new Map(poets.map((p: PoetRow) => [p.id, p]));
  _manifest = manifest;
  const chars = [...(charset.chars as string)]; // code-point split (handles astral chars)
  const lexicon = lexAsset ? hydrateLexicon(lexAsset) : dummyLexicon(charset.n);
  _realGelu = !!lexAsset;
  setDataset({ lexicon, charset: chars });
  return manifest;
}

export async function loadPoetPoems(id: string, base = "/data"): Promise<PoemRecord[]> {
  const bucket = id.slice(0, 2);
  let obj = _bucketCache.get(bucket);
  if (!obj) {
    obj = await fetch(`${base}/poems/${bucket}.json`).then((r) => r.json());
    _bucketCache.set(bucket, obj!);
  }
  return obj![id] || [];
}

// Author search: substring match on name, ranked by poemCount, capped.
export function searchPoets(q: string, limit = 40): PoetRow[] {
  const s = q.trim();
  if (!s) return [];
  const out: PoetRow[] = [];
  for (const p of _poets) {
    if (p.name.includes(s)) {
      out.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ── Content search (诗句 → 真实诗): ANY-line index, sharded by content hash (256 buckets,
//    matching the pipeline's lineBucket). 床前明月光 / 疑是地上霜 → 李白《静夜思》. Lazy, like poems/. ──
const HAN = /\p{Script=Han}/u;
const lineBucket = (s: string) => (hashStr(s) & 0xff).toString(16).padStart(2, "0");
const _flShard = new Map<string, Record<string, FirstLineRef[]>>();
async function loadFlShard(bucket: string, base: string): Promise<Record<string, FirstLineRef[]>> {
  let obj = _flShard.get(bucket);
  if (obj) return obj;
  obj = await fetch(`${base}/lines/${bucket}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  _flShard.set(bucket, obj!);
  return obj!;
}

export interface LineHit {
  poetId: string;
  poemIdx: number;
  title: string;
  form: string;
  firstLine: string;
  poet?: PoetRow;
}
/** Find real poems whose FIRST line matches the typed text (or its 5/7-char opening). */
export async function searchByLine(query: string, base = "/data"): Promise<LineHit[]> {
  const cs = [...query].filter((c) => HAN.test(c));
  if (cs.length < 2) return [];
  const han = cs.join("");
  // candidate keys: the whole input, plus common opening-line lengths if the user pasted more
  const cands = new Set<string>([han]);
  for (const k of [7, 6, 5, 4]) if (cs.length > k) cands.add(cs.slice(0, k).join(""));
  const seen = new Set<string>();
  const hits: LineHit[] = [];
  for (const key of cands) {
    const shard = await loadFlShard(lineBucket(key), base);
    for (const r of shard[key] || []) {
      const k2 = r.p + "#" + r.i;
      if (seen.has(k2)) continue;
      seen.add(k2);
      hits.push({ poetId: r.p, poemIdx: r.i, title: r.t, form: r.f, firstLine: key, poet: _byId.get(r.p) });
    }
  }
  // a longer matched opening is more specific; then prefer the more prolific (better-known) poet
  hits.sort(
    (a, b) => b.firstLine.length - a.firstLine.length || (b.poet?.poemCount || 0) - (a.poet?.poemCount || 0),
  );
  return hits.slice(0, 30);
}

// ── 赠诗 network: committed edge list [fromId, toId, weight]; loaded lazily on first toggle. ──
let _gifts: GiftEdge[] | null = null;
export async function loadGifts(base = "/data"): Promise<GiftEdge[]> {
  if (_gifts) return _gifts;
  const a: GiftsAsset | null = await fetch(`${base}/gifts.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  _gifts = a?.edges ?? [];
  return _gifts;
}
