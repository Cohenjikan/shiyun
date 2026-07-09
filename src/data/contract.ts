// ============================================================================
// DATA CONTRACT — the typed boundary between the Step-3 pipeline (producer) and
// the frontend (consumer). The pipeline emits static JSON/binary assets that
// conform to these interfaces; any frontend consumes ONLY these shapes. Keep this
// file authoritative: if a shape changes, the pipeline and docs/DATA_CONTRACT.md
// change with it. See docs/DATA_CONTRACT.md for the on-disk layout + sizes.
// ============================================================================
import type { Lexicon, FormId } from "../engine/engine";

/** Top-level manifest, loaded first; versions + shard maps. */
export interface Manifest {
  version: number;
  n: number; // 字库 size = engine radix N
  charsetHash: string;
  poetCount: number;
  shardSize: number; // poets per shard
  shardCount: number;
  dynasties: string[]; // canonical dynasty keys present
}

/** 字库: the ordered character alphabet. Index in `chars` = base-N digit. */
export interface CharsetAsset {
  version: number;
  n: number;
  hash: string;
  chars: string; // concatenated chars (use codePointAt; may include astral chars)
}

/**
 * Lexicon tables (tone + 平水韵 rhyme), built offline, consumed by the engine.
 * Serialized as plain arrays in JSON; rehydrated into the typed-array `Lexicon`.
 * This is the REAL replacement for src/data/placeholderLexicon.ts.
 */
export interface LexiconAsset {
  version: number;
  n: number;
  pingList: number[];
  zeList: number[];
  toneClass: number[]; // length n, 0=平 1=仄
  rhymeOf: number[]; // length n, 韵部 id or -1
  rhymeMembers: number[][]; // [韵部][charIds]
}

/** One poet row in poets.index.json (first-paint). Positions are client-derived. */
export interface PoetIndexEntry {
  id: string; // sha1(name|dynasty).slice(0,12)
  name: string;
  dynasty: string; // canonical dynasty key (see DYNASTIES)
  dynastyRaw?: string; // original 朝代 string, for reversibility
  poemCount: number;
  clusterSize: number; // ∝ √poemCount
}

/** Per-poet star metadata shard (lazy, by region). */
export interface StarShardEntry {
  id: string;
  name: string;
  dynasty: string;
  poemCount: number;
  clusterSize: number;
  /** TF/IDF style-seed histogram: idx[] into global charset, w[] uint8 weights. */
  hist: { k: number; idx: number[]; w: number[] };
  samples: { t: string; ref: string }[];
}
export type StarShard = StarShardEntry[];

/** Per-poet real poems shard (lazy, on poet focus). */
export interface PoemRecord {
  t: string; // title
  f: FormId | "other"; // detected form (or non-近体诗)
  p: string[]; // paragraphs (bare chars, punctuation stripped) — the CANONICAL text: 编号/星位/搜索/格律 all read p
  /** 原貌展示句,含 □(U+25A1 古籍缺字符号)。仅当正文含 □ 时 build-data.mjs 才写入,满足「d 去 □ 去空句 === p」。
   *  展示专用(正文渲染 `d ?? p`);所有计算仍只读 p。 */
  d?: string[];
}
export interface PoemShard {
  poets: Record<string, PoemRecord[]>; // poetId -> poems
}

/** One match in the content-search index (lines/{2-hex content bucket}.json). The index keys
 *  EVERY line of every poem (not just openings), so any line is searchable — 疑是地上霜 → 静夜思. */
export interface FirstLineRef {
  p: string; // poetId
  i: number; // poem index within the poet's poems[] (parallel to the poems shard)
  t: string; // title
  f: FormId | "other"; // detected form ("other" = 古体 / 自由诗 / 新诗)
}
export type FirstLineShard = Record<string, FirstLineRef[]>; // line -> matching poems

/** 赠诗 dedication edge: [fromPoetId, toPoetId, weight]. Both endpoints are corpus poets. */
export type GiftEdge = [string, string, number];
export interface GiftsAsset {
  version: number;
  edgeCount: number;
  edges: GiftEdge[];
}

/** What the engine layer needs at runtime to operate. Produced from the assets. */
export interface PoetryDataset {
  lexicon: Lexicon; // tone/rhyme tables (radix N lives inside)
  charset: string[]; // charId -> character (display)
}

/** Rehydrate a LexiconAsset (plain arrays) into the engine's typed-array Lexicon. */
export function hydrateLexicon(a: LexiconAsset): Lexicon {
  const n = a.n;
  const pingList = Uint32Array.from(a.pingList);
  const zeList = Uint32Array.from(a.zeList);
  const toneClass = Int8Array.from(a.toneClass);
  const rhymeOf = Int16Array.from(a.rhymeOf);
  const pingRank = new Int32Array(n).fill(-1);
  const zeRank = new Int32Array(n).fill(-1);
  pingList.forEach((c, i) => (pingRank[c] = i));
  zeList.forEach((c, i) => (zeRank[c] = i));
  const rhymeMembers = a.rhymeMembers.map((m) => Uint32Array.from(m));
  const rhymeRank = rhymeMembers.map((m) => {
    const r = new Int32Array(n).fill(-1);
    m.forEach((c, i) => (r[c] = i));
    return r;
  });
  return { N: n, pingList, zeList, pingRank, zeRank, toneClass, rhymeOf, rhymeMembers, rhymeRank };
}
