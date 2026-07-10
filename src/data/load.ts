// Loads the real Step-3 assets and swaps them into the engine via the provider seam.
// 格律 tone/rhyme data is intentionally absent (default = random per user direction), so
// we build a DUMMY lexicon that satisfies the engine type but is never used for authentic
// 格律 — the UI runs in random (Babel) mode.
import type { Lexicon } from "../engine/engine";
import { setDataset } from "./provider";
import { hydrateLexicon, type LexiconAsset, type FirstLineRef, type GiftEdge, type GiftsAsset } from "./contract";
import { hashStr, DYNASTY_BY_KEY } from "./dynasties";
import { checkCharset, type CharsetCheck } from "./charsetHash";
import { FAMOUS_POETS } from "./famousPoets";

const FAMOUS_NAMES = new Set(FAMOUS_POETS.map((f) => f.name)); // rank landmark poets first in 诗句 hits

// Where the data shards are served from. Defaults to the same-origin "/data" (100% static, as before).
// Override at BUILD time with VITE_DATA_BASE to point the whole fetch layer elsewhere — an absolute
// CDN/object-storage origin (egress offload, see DEPLOY.md §1.1) or a VERSIONED path like "/data/v2"
// for immutable caching (DEPLOY.md §2.1). Trailing slashes are stripped so "/data/v2/" === "/data/v2"
// (every helper builds `${base}/poems/…` etc.). This is the default for all six fetch helpers below;
// each still takes an explicit `base` param so a caller can override per-call.
const DATA_BASE = ((import.meta.env.VITE_DATA_BASE as string | undefined) || "/data").replace(/\/+$/, "");

let _realGelu = false;
/** True once a real 平仄/平水韵 lexicon is loaded (so the UI can offer the 格律 mode). */
export const hasRealGelu = (): boolean => _realGelu;

// data↔code version guard: set by loadData after recomputing the charset hash. Null until a load
// runs; non-null with ok=false means the served 字库 differs from what this build expects, so every
// shared 编号 permalink may decode to the WRONG poem. App surfaces this as a dismissible warning.
let _charsetCheck: CharsetCheck | null = null;
export const getCharsetCheck = (): CharsetCheck | null => _charsetCheck;

export interface PoetRow {
  id: string;
  name: string;
  dynasty: string;
  poemCount: number;
  clusterSize: number;
  /** canonical 别名层 (Wikidata-style redirect, G2): set ONLY on an alias row (poemCount:0/clusterSize:0)
   *  emitted by build-data.mjs from the corpus's poets.jsonl `mergedInto` rows — the id of the CANONICAL
   *  PoetRow this name was merged into (e.g. 唐温如 → 唐珙|yuan). Absent on every normal poet row. Callers
   *  that resolve a poet by id (permalink #a=, search) should redirect through this to the canonical row;
   *  renderers (PoetStars/gpuPick) must treat poemCount:0 rows as invisible/unpickable regardless. */
  mergedInto?: string;
  // ── 收录状态标注层 (collection status): 把库里各种「不全/特殊」从暗坑变成界面明说。全部 build-data.mjs 只在
  //    正身诗人行上写的 **可选加法式** 键(别名/redirect 行不带)——loader 不校验、store 不裁剪,老数据缺这些键零感知。
  //    渲染逻辑集中在 collectionStatus.ts(灰字)+ PoetPanel(存目条目/头部计数)。这些键 **不参与** 编号/星位/搜索。
  /** 结构性「不全」的策展文案(corpus 无法自动测出的:整部御制诗集只传三百余首 / 作品仍在版权期)。k=copyright
   *  会抑制前端「现当代通用」子句。仅弘历/毛泽东/叶嘉莹等极少数正身行带。 */
  collection?: { k: "partial" | "copyright"; note: string }[];
  /** 该诗人 ≥1 首散曲(genre=qu)入库 → 前端提示「散曲存世文献电子化极少,收录不完整」(元散曲十不存一,~118 位)。 */
  quGap?: 1;
  /** 该诗人全部入库诗的 s 都是 "restricted"(全库仅存目,现仅叶嘉莹)→ 头部把「N 首真实作品」改「存目 N 条」。 */
  restrictedOnly?: 1;
  /** 零汉字诗存目:正文经 onlyHan 切分后无汉字句(全 □ 缺字 lacuna / 全外文·数字 nonhan)的诗进不了 p/编号/搜索,
   *  这里保留题目 + 类别,PoetPanel 作品列表末尾渲染为不可展开的「存目」条目,避免静默消失。 */
  lost?: { t: string; k: "lacuna" | "nonhan" }[];
}
export interface PoemRecord {
  t: string;
  f: string; // "wujue" | "qijue" | "wulu" | "qilu" | "other"
  p: string[]; // lines — 汉字真值:编号(#a=)/星位/搜索/格律 一切计算的唯一依据
  /** 原貌展示句,含 □(U+25A1,古籍缺字符号)。仅当正文含 □ 时由 build-data.mjs 写入(否则缺省),且满足
   *  「d 逐句去 □ 去空句 === p」。**仅供人眼展示**(正文渲染用 `d ?? p`);一切计算严格用 `p`,绝不用 d。 */
  d?: string[];
  /** 收录状态(仅 corpus additions 带 collection 的极少数诗带):disputed = 真伪存疑 / restricted = 版权存目。
   *  PoetPanel + 留影卡据此加一行灰注(防存疑诗被截图外传时丢掉警示)。**不参与** 编号/搜索/格律,纯展示元数据。 */
  s?: "disputed" | "restricted";
  /** 收录状态注文(与 s 配套,直接可展示的短句,如「轶闻类记载,未见《张太岳集》,真伪存疑」)。 */
  sn?: string;
}
export interface DataManifest {
  n: number;
  poetCount: number;
  poemCount: number;
  buckets: string[];
  dynCounts: Record<string, number>;
  poemSidecar?: boolean; // poems/{bucket}.idx.json byte-offset sidecars exist → Range-fetch per poet
  pullK?: number; // informational: count of chars that ACTUALLY appear in the corpus (freq-ordered head);
                  // the rest of N is CJK-basic-block padding (addressable but never in a real poem). The
                  // void-pull cutoff is engineApi.POEM_PULL_K (a tighter poetic-common set), not this.
}

let _poets: PoetRow[] = [];
let _byId = new Map<string, PoetRow>();
let _manifest: DataManifest | null = null;
const _bucketCache = new Map<string, Record<string, PoemRecord[]>>(); // whole-bucket fallback cache
const _poemCache = new Map<string, PoemRecord[]>(); // per-poet cache (Range path returns one record)
const _idxCache = new Map<string, Record<string, [number, number]> | null>(); // bucket byte-offset sidecar
let _rangeUnsupported = false; // a host that ignores Range (200, not 206) → stop attempting it

export const getPoets = (): PoetRow[] => _poets;
export const getPoet = (id: string): PoetRow | undefined => _byId.get(id);
export const getManifest = (): DataManifest | null => _manifest;

/** canonical 别名层: resolve a possibly-alias PoetRow to its canonical row. Returns `{canonical}` when
 *  `row` has no `mergedInto` (the common case — pass through unchanged), or `{canonical, aliasName}`
 *  when it redirected (aliasName = the alias's OWN name, for a "「X」已并入「Y」" notice). If the
 *  mergedInto target id isn't in the loaded index (a data-provisioning desync), falls back to `row`
 *  itself rather than losing the selection. Pure — takes the row/lookup so it's unit-testable without
 *  loadData()/fetch. */
export function resolveCanonicalPoet(
  row: PoetRow,
  byId: Map<string, PoetRow> = _byId,
): { canonical: PoetRow; aliasName?: string } {
  if (!row.mergedInto) return { canonical: row };
  const target = byId.get(row.mergedInto);
  if (!target) return { canonical: row }; // dead target — degrade to the alias row itself, don't vanish
  return { canonical: target, aliasName: row.name };
}

/** Display-name pair for an alias→canonical notice. When the two share the SAME display name
 *  (唐珙|ming → 唐珙|yuan) the bare copy would be self-referential (「唐珙」已并入「唐珙」), so BOTH get a
 *  dynasty-label suffix — 唐珙(明) / 唐珙(元) — labels read from DYNASTIES (dynasties.ts), never a
 *  hardcoded map here. Different names pass through unchanged (the common case: 唐温如 → 唐珙). */
export function aliasNoticeNames(alias: PoetRow, canonical: PoetRow): [string, string] {
  if (alias.name !== canonical.name) return [alias.name, canonical.name];
  const label = (key: string) => DYNASTY_BY_KEY[key]?.label ?? key;
  return [`${alias.name}(${label(alias.dynasty)})`, `${canonical.name}(${label(canonical.dynasty)})`];
}

/** The low-key "「唐温如」已并入「唐珙」" notice PoetPanel shows after a #a= redirect (permalink.ts's
 *  applyHash) — centralised here (not inlined at the call site) so the ONE format string is what
 *  load.test.ts actually exercises. null when `row` isn't an alias (the common case). */
export function poetAliasRedirectNote(row: PoetRow, byId: Map<string, PoetRow> = _byId): string | null {
  const { canonical, aliasName } = resolveCanonicalPoet(row, byId);
  if (!aliasName) return null;
  const [a, c] = aliasNoticeNames(row, canonical);
  return `「${a}」已并入「${c}」`;
}

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

export async function loadData(base = DATA_BASE): Promise<DataManifest> {
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
  // data↔code guard: recompute the charset hash from the actual chars (don't trust the file's own
  // hash field alone) and compare to BOTH that field and this build's frozen EXPECTED_CHARSET_HASH.
  // A mismatch means the served 字库 differs from what the code expects → shared 编号 permalinks decode
  // to the WRONG poem. We DON'T hard-block (the cloud still renders), but we log + flag for the UI.
  _charsetCheck = checkCharset(charset.chars as string, typeof charset.hash === "string" ? charset.hash : undefined);
  if (!_charsetCheck.ok) {
    console.error(
      `[诗云] 字库与本版本不匹配:编号链接可能错位。computed=${_charsetCheck.computed} ` +
        `expected=${_charsetCheck.expected} file=${_charsetCheck.fileHash ?? "(none)"}`,
    );
  }
  const chars = [...(charset.chars as string)]; // code-point split (handles astral chars)
  const lexicon = lexAsset ? hydrateLexicon(lexAsset) : dummyLexicon(charset.n);
  _realGelu = !!lexAsset;
  setDataset({ lexicon, charset: chars });
  return manifest;
}

// Failures THROW and are NEVER cached. The old `.catch(() => ({}))` silently latched an empty
// object into the cache on any transient network hiccup — that poet then rendered as "0 poems"
// forever (no error, no retry could help). A thrown rejection instead reaches fetchPoetPoems's
// catch → the PoetPanel error + 重试 row.
async function loadBucketWhole(bucket: string, base: string): Promise<Record<string, PoemRecord[]>> {
  let obj = _bucketCache.get(bucket);
  if (!obj) {
    const r = await fetch(`${base}/poems/${bucket}.json`);
    if (!r.ok) throw new Error(`poems bucket ${bucket} → HTTP ${r.status}`);
    obj = (await r.json()) as Record<string, PoemRecord[]>;
    _bucketCache.set(bucket, obj); // only SUCCESS is cached
  }
  return obj;
}

/** Read a Response body to a UTF-8 string while reporting download progress (received/total bytes).
 *  `total` = Content-Length; for a 206 that's the SLICE size — exactly the per-poet download worth a
 *  progress bar (大诗人切片可达 2.6MB,poems/ 不压缩、首访回源). ALL bytes are buffered then decoded ONCE,
 *  so a multi-byte UTF-8 char split across chunk boundaries is never corrupted. Falls back to res.text()
 *  when the body isn't a readable stream (older runtimes / test stubs). */
export async function readWithProgress(
  res: Response,
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body?.getReader?.();
  if (!reader) {
    const txt = await res.text();
    onProgress?.(total, total); // no incremental stream available → report completion only
    return txt;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress?.(received, total);
    }
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(buf);
}

// Egress saver (#12): a poet's poems are a few KB, but a bucket is ~0.9 MB. With the byte-offset
// sidecar (poems/{bucket}.idx.json), fetch ONLY this poet's slice via an HTTP Range request. The
// .json stays one valid JSON object, so we transparently fall back to the whole bucket when the
// sidecar is absent (old data) or the host ignores Range (returns 200 instead of 206).
export async function loadPoetPoems(
  id: string,
  base = DATA_BASE,
  onProgress?: (received: number, total: number) => void,
): Promise<PoemRecord[]> {
  const cached = _poemCache.get(id);
  if (cached) return cached;
  const bucket = id.slice(0, 2);

  if (_manifest?.poemSidecar && !_rangeUnsupported) {
    let idx = _idxCache.get(bucket);
    if (idx === undefined) {
      try {
        const r = await fetch(`${base}/poems/${bucket}.idx.json`);
        // 404 genuinely means "no sidecar in this dataset" → latch null (whole-bucket from now on).
        // A 5xx / other non-ok status is transient and must NOT be latched — next attempt retries.
        // A NETWORK failure must NOT be latched either — next attempt should try the sidecar again.
        if (r.ok) {
          const fetched = (await r.json()) as Record<string, [number, number]>;
          _idxCache.set(bucket, fetched);
          idx = fetched;
        } else if (r.status === 404) {
          _idxCache.set(bucket, null); // genuinely no sidecar → whole-bucket from now on
          idx = null;
        } else {
          idx = null; // transient (5xx etc.) — skip Range this attempt, don't poison the cache
        }
      } catch {
        idx = null; // transient — skip Range this attempt, don't poison the cache
      }
    }
    const ent = idx?.[id];
    if (ent) {
      const [off, len] = ent;
      try {
        const res = await fetch(`${base}/poems/${bucket}.json`, {
          headers: { Range: `bytes=${off}-${off + len - 1}` },
        });
        if (res.status === 206) {
          const txt = await readWithProgress(res, onProgress);
          try {
            const poems = JSON.parse(txt) as PoemRecord[]; // the slice IS valid JSON
            _poemCache.set(id, poems);
            return poems;
          } catch {
            // 206 but the bytes don't parse — e.g. the host serves Range over a gzip stream, so the
            // offsets (computed on the uncompressed file) are meaningless. Stop trying Range and use
            // the whole (transparently-decompressed) bucket from here on.
            _rangeUnsupported = true;
          }
        } else if (res.ok) {
          // host ignored Range → it sent the whole bucket; use it + stop trying Range from now on.
          _rangeUnsupported = true;
          const obj = JSON.parse(await res.text()) as Record<string, PoemRecord[]>;
          _bucketCache.set(bucket, obj);
          const poems = obj[id] || [];
          _poemCache.set(id, poems);
          return poems;
        }
      } catch {
        /* transient network hiccup → fall back to the whole bucket below (don't latch off Range) */
      }
    }
  }

  const obj = await loadBucketWhole(bucket, base);
  const poems = obj[id] || [];
  // a VALID bucket without this id = index↔buckets desync (the data-provisioning bug class)
  if (!poems.length) console.warn(`poet ${id}: bucket ${bucket} loaded but has no entry (data desync?)`);
  _poemCache.set(id, poems);
  return poems;
}

// Author search: substring match on name, ranked by poemCount, capped. Poet names are Han, so a
// digit/latin-only query is ignored — otherwise typing "1"/"2" surfaces the corpus's same-name
// disambiguation suffixes (张生1 / 张生2 …, 13 such names in 32,657) as noise.
const HAN_CHAR = /\p{Script=Han}/u;
export function searchPoets(q: string, limit = 40): PoetRow[] {
  const s = q.trim();
  if (!s || !HAN_CHAR.test(s)) return [];
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
const fzBucket = (s: string) => (hashStr(s) & 0xfff).toString(16).padStart(3, "0"); // 4096 fuzzy shards
const _flShard = new Map<string, Record<string, FirstLineRef[]>>();
async function loadFlShard(bucket: string, base: string): Promise<Record<string, FirstLineRef[]>> {
  const cached = _flShard.get(bucket);
  if (cached) return cached;
  // Only cache a SUCCESS (r.ok) or a genuine 404 (shard absent in this dataset). A 5xx / network
  // failure returns empty for THIS call but stays uncached so the next call retries (else search
  // silently returns nothing until reload).
  try {
    const r = await fetch(`${base}/lines/${bucket}.json`);
    if (r.ok) {
      const obj = (await r.json()) as Record<string, FirstLineRef[]>;
      _flShard.set(bucket, obj);
      return obj;
    }
    if (r.status === 404) _flShard.set(bucket, {});
  } catch {
    /* transient — leave cache unset so the next call retries */
  }
  return {};
}

// fuzzy (delete-1 skeleton) shards — linesf/{bucket}.json — for mid-line 异文 search (build-fuzzy.mjs).
// Absent on a worktree that hasn't run `npm run build:fuzzy` → fetch returns {} → fuzzy simply no-ops.
const _fzShard = new Map<string, Record<string, FirstLineRef[]>>();
// Session-level "linesf/ is absent" latch. The fuzzy index is sharded by skeleton hash, so ONE user
// query fans a delete-1 lookup across many DISTINCT buckets — and linesf/ is intentionally not deployed
// in prod (~4.4 GB), so every one of those is a certain 404. The per-bucket cache above can't collapse
// them (each bucket is its own miss), so a single session would otherwise emit dozens of guaranteed-404
// round-trips — the dominant share of prod 404 noise + needless CF origin pulls. Once we've ACTUALLY
// observed a 404 we know the whole prefix is unserved → latch and stop probing linesf/ for the session.
// Latched on a real observed 404 only (never hard-coded): the day linesf/ ships, the first request
// succeeds and the latch never trips, so fuzzy comes back automatically.
let _linesfUnavailable = false;
async function loadFzShard(bucket: string, base: string): Promise<Record<string, FirstLineRef[]>> {
  if (_linesfUnavailable) return {}; // a 404 was already observed this session → don't re-probe linesf/
  const cached = _fzShard.get(bucket);
  if (cached) return cached;
  try {
    const r = await fetch(`${base}/linesf/${bucket}.json`);
    if (r.ok) {
      const obj = (await r.json()) as Record<string, FirstLineRef[]>;
      _fzShard.set(bucket, obj);
      return obj;
    }
    // A genuine 404 = linesf/ isn't served at all (not built / not deployed): cache this bucket empty AND
    // latch the session so no further bucket is even attempted. A 5xx / network error is transient — it
    // returns empty for THIS call but does NOT latch or cache, so the next call still retries.
    if (r.status === 404) {
      _fzShard.set(bucket, {});
      _linesfUnavailable = true;
    }
  } catch {
    /* transient — leave the latch off + cache unset so the next call retries */
  }
  return {};
}
/** All "drop one code point" skeletons of a line's Han chars (SymSpell-style 1-edit lookup key set). */
export function lineSkeletons(cps: string[]): string[] {
  const out = new Set<string>();
  for (let i = 0; i < cps.length; i++) out.add(cps.slice(0, i).concat(cps.slice(i + 1)).join(""));
  return [...out];
}

export interface LineHit {
  poetId: string;
  poemIdx: number;
  title: string;
  form: string;
  firstLine: string;
  poet?: PoetRow;
  /** Plan C: how many DISTINCT typed lines this poem matched — set only for multi-line (整联) queries
   *  (undefined ⇒ 0 in ranking, so single-line / incremental search is left exactly as before). */
  lineMatches?: number;
}

/** Split a raw query into candidate LINES — maximal runs of 汉字 between punctuation/whitespace. Corpus
 *  line keys are pure Han, so 「行到水穷处，坐看云起时」 → ["行到水穷处","坐看云起时"]; a single line → one. */
function splitHanLines(query: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of query) {
    if (HAN.test(ch)) cur += ch;
    else if (cur) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Find real poems containing the typed line — EXACT (any line / opening), then a FUZZY 1-edit
 *  fallback (linesf/) so a mid-line variant like 「举头望明月」 still finds 李白《静夜思》 (corpus「山月」). */
export async function searchByLine(query: string, base = DATA_BASE): Promise<LineHit[]> {
  const cs = [...query].filter((c) => HAN.test(c));
  if (cs.length < 2) return [];

  // ── Plan C — multi-line (整联) re-rank ───────────────────────────────────────────────────────────
  // If the user typed ≥2 punctuation-separated lines (行到水穷处，坐看云起时), look up EACH line in the
  // whole-line index and rank a poem by HOW MANY distinct typed lines it holds. Without this, a complete
  // couplet resolved to whichever sharing poem was more prolific: 《终南别业》(holds both lines) lost to
  // 《春山》(holds only 行到水穷处) because 王安石 ≫ 王维 by poemCount. Exact whole-line only — the fuzzy /
  // prefix layers stay on the single-line path below (they power the incremental 单字/半句/异文 search).
  const segs = [...new Set(splitHanLines(query).filter((l) => [...l].length >= 2))];
  if (segs.length >= 2) {
    // Fetch each DISTINCT content-bucket once (two lines can hash to the same bucket), then resolve every
    // line against its loaded shard — so a couplet whose lines collide doesn't double-fetch lines/ on this
    // egress-sensitive path. loadFlShard returns the whole bucket, so one fetch serves every line in it.
    const shards = new Map<string, Record<string, FirstLineRef[]>>();
    await Promise.all(
      [...new Set(segs.map(lineBucket))].map(async (b) => void shards.set(b, await loadFlShard(b, base))),
    );
    const byPoem = new Map<string, { hit: LineHit; matched: Set<string> }>();
    for (const key of segs) {
      for (const r of shards.get(lineBucket(key))?.[key] || []) {
        const k = r.p + "#" + r.i;
        let e = byPoem.get(k);
        if (!e) {
          e = {
            hit: { poetId: r.p, poemIdx: r.i, title: r.t, form: r.f, firstLine: key, poet: _byId.get(r.p) },
            matched: new Set(),
          };
          byPoem.set(k, e);
        }
        e.matched.add(key);
        if ([...key].length > [...e.hit.firstLine].length) e.hit.firstLine = key; // longest matched line (code points)
      }
    }
    if (byPoem.size) {
      const famML = (h: LineHit) => (h.poet && FAMOUS_NAMES.has(h.poet.name) ? 1 : 0);
      const ranked: LineHit[] = [];
      for (const { hit, matched } of byPoem.values()) {
        hit.lineMatches = matched.size;
        ranked.push(hit);
      }
      ranked.sort(
        (a, b) =>
          (b.lineMatches || 0) - (a.lineMatches || 0) ||
          famML(b) - famML(a) ||
          (b.poet?.poemCount || 0) - (a.poet?.poemCount || 0),
      );
      return ranked.slice(0, 30);
    }
    // none of the typed lines hit the exact index → fall through to the single-line heuristic below.
  }

  const han = cs.join("");
  const seen = new Set<string>();
  const hits: LineHit[] = [];
  const add = (r: FirstLineRef, firstLine: string) => {
    const k2 = r.p + "#" + r.i;
    if (seen.has(k2)) return;
    seen.add(k2);
    hits.push({ poetId: r.p, poemIdx: r.i, title: r.t, form: r.f, firstLine, poet: _byId.get(r.p) });
  };
  // EXACT: the whole input + common opening-line lengths if the user pasted more
  const cands = new Set<string>([han]);
  for (const k of [7, 6, 5, 4]) if (cs.length > k) cands.add(cs.slice(0, k).join(""));
  for (const key of cands) {
    const shard = await loadFlShard(lineBucket(key), base);
    for (const r of shard[key] || []) add(r, key);
  }
  // FUZZY fallback: only when exact found nothing and the input is a plausible single line (len 4..10).
  // Drop each char of the query → skeletons; a 1-substitution corpus line shares the skeleton that
  // drops the differing position. (No-op if linesf/ wasn't built.) Skipped once the session has latched
  // linesf/ as unavailable — every skeleton would 404, so we don't even compute them (loadFzShard would
  // no-op anyway; this avoids the wasted skeleton work + keeps the certain-404 traffic at zero).
  if (hits.length === 0 && cs.length >= 4 && cs.length <= 10 && !_linesfUnavailable) {
    for (const sk of lineSkeletons(cs)) {
      const shard = await loadFzShard(fzBucket(sk), base);
      for (const r of shard[sk] || []) add(r, han);
    }
  }
  // a longer matched opening is more specific; then landmark poets (so a fuzzy 静夜思 beats a prolific
  // minor poet who happens to share a skeleton); then the more prolific (better-known) poet.
  const fam = (h: LineHit) => (h.poet && FAMOUS_NAMES.has(h.poet.name) ? 1 : 0);
  hits.sort(
    (a, b) =>
      b.firstLine.length - a.firstLine.length ||
      fam(b) - fam(a) ||
      (b.poet?.poemCount || 0) - (a.poet?.poemCount || 0),
  );
  return hits.slice(0, 30);
}

// ── 寻诗 prefix + 诗名 index (search/, built by build-search.mjs) — INCREMENTAL: a single char, a half
//    line, or a poem TITLE matches the moment you type it, instead of only a whole exact line. Two key
//    kinds live in each shard: an EXACT full title (any poem) + a len≤PREFIX_MAX PREFIX of a famous poem's
//    line/title. Sharded by hashStr(key)&0xff (== build-search's fnv32). No-op if search/ wasn't built. ──
const PREFIX_MAX = 3; // mirror build-search.mjs (the client keys on the query's first ≤3 汉字)
const sxBucket = (s: string) => (hashStr(s) & 0xff).toString(16).padStart(2, "0");
const _sxShard = new Map<string, Record<string, FirstLineRef[]>>();
async function loadSxShard(bucket: string, base: string): Promise<Record<string, FirstLineRef[]>> {
  const cached = _sxShard.get(bucket);
  if (cached) return cached;
  // Only cache a SUCCESS or a genuine 404 (search/ not built in this dataset). A 5xx / network
  // failure returns empty for THIS call but stays uncached so the next call retries.
  try {
    const r = await fetch(`${base}/search/${bucket}.json`);
    if (r.ok) {
      const obj = (await r.json()) as Record<string, FirstLineRef[]>;
      _sxShard.set(bucket, obj);
      return obj;
    }
    if (r.status === 404) _sxShard.set(bucket, {});
  } catch {
    /* transient — leave cache unset so the next call retries */
  }
  return {};
}

/** 寻诗 incremental hits: looks up the FULL query (an exact poem title, e.g. 静夜思 / 春江花月夜) AND its
 *  first ≤PREFIX_MAX chars (a line/title prefix, e.g. 举头望 / a single 字) in the prefix index. */
export async function searchByHead(query: string, base = DATA_BASE): Promise<LineHit[]> {
  const cs = [...query].filter((c) => HAN.test(c));
  if (!cs.length) return [];
  const keys = new Set<string>([cs.join(""), cs.slice(0, PREFIX_MAX).join("")]);
  const seen = new Set<string>();
  const hits: LineHit[] = [];
  for (const key of keys) {
    const shard = await loadSxShard(sxBucket(key), base);
    for (const r of shard[key] || []) {
      const k = r.p + "#" + r.i;
      if (seen.has(k)) continue;
      seen.add(k);
      hits.push({ poetId: r.p, poemIdx: r.i, title: r.t, form: r.f, firstLine: key, poet: _byId.get(r.p) });
    }
  }
  return hits;
}

/** The 寻诗 tab search. Merges EXACT-line + fuzzy hits (searchByLine — precise whole-line / 异文) with the
 *  PREFIX + 诗名 hits (searchByHead — single char / half line / title), dedups, ranks famous-first then
 *  poemCount, and caps each poet to ≤2 so one prolific poet can't fill all 10 on a one-char query. */
export async function searchPoems(query: string, base = DATA_BASE): Promise<LineHit[]> {
  const cs = [...query].filter((c) => HAN.test(c));
  if (!cs.length) return [];
  const [head, line] = await Promise.all([
    searchByHead(query, base),
    cs.length >= 2 ? searchByLine(query, base) : Promise.resolve([] as LineHit[]),
  ]);
  const seen = new Set<string>();
  const merged: LineHit[] = [];
  for (const h of [...line, ...head]) {
    // exact-line hits first → they win the dedupe (their firstLine is the precise matched line)
    const k = h.poetId + "#" + h.poemIdx;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(h);
  }
  const fam = (h: LineHit) => (h.poet && FAMOUS_NAMES.has(h.poet.name) ? 1 : 0);
  // Plan C first: a poem matching MORE of the typed lines (整联 query) outranks one matching fewer — ahead
  // of the famous→poemCount tie-break, else a more prolific poet who shares ONE line wins wrongly. On a
  // single-line query no hit carries lineMatches → this term is 0 for all and the old order is preserved.
  merged.sort(
    (a, b) =>
      (b.lineMatches || 0) - (a.lineMatches || 0) ||
      fam(b) - fam(a) ||
      (b.poet?.poemCount || 0) - (a.poet?.poemCount || 0),
  );
  const perPoet = new Map<string, number>();
  const out: LineHit[] = [];
  for (const h of merged) {
    const n = perPoet.get(h.poetId) || 0;
    if (n >= 2) continue; // ≤2 per poet → variety on a single-char query
    perPoet.set(h.poetId, n + 1);
    out.push(h);
    if (out.length >= 10) break;
  }
  return out;
}

// ── 赠诗 network: committed edge list [fromId, toId, weight]; loaded lazily on first toggle. ──
let _gifts: GiftEdge[] | null = null;
export async function loadGifts(base = DATA_BASE): Promise<GiftEdge[]> {
  if (_gifts) return _gifts;
  // Only latch a SUCCESS or a genuine 404 (no gift network in this dataset). A 5xx / network
  // failure returns empty for THIS call but stays uncached so the next call retries.
  try {
    const r = await fetch(`${base}/gifts.json`);
    if (r.ok) {
      const a = (await r.json()) as GiftsAsset;
      _gifts = a?.edges ?? [];
      return _gifts;
    }
    if (r.status === 404) {
      _gifts = [];
      return _gifts;
    }
  } catch {
    /* transient — leave _gifts null so the next call retries */
  }
  return [];
}
