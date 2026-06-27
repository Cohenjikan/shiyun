# Data Contract

The boundary between the **Step-3 pipeline** (producer) and the **frontend** (consumer).
Typed in [`src/data/contract.ts`](../src/data/contract.ts) — that file is authoritative;
this doc explains the on-disk layout, the corpus, and the dynasty taxonomy.

The app loads these static assets, builds a `PoetryDataset`, and calls
`provider.ts::setDataset(real)`. Nothing server-side; everything is fetched as static files.

## Asset manifest (`public/data/`)

| File | Lazy? | ~Brotli | Shape (contract.ts) | Notes |
|---|---|---|---|---|
| `manifest.json` | initial | 1 KB | `Manifest` | versions, shard map, dynasty keys present |
| `charset.json` | initial | ~25 KB | `CharsetAsset` | 字库, ordered by freq; index = base-N digit |
| `lexicon.json` | initial | ~80–120 KB | `LexiconAsset` | tone + 平水韵 tables → `hydrateLexicon()` |
| `poets.index.json` | initial | ~0.9–1.1 MB | `PoetIndexEntry[]` | 32,657 poets (all dynasties, incl. 新诗) |
| `gifts.json` | initial | ~126 KB | `GiftsAsset` | 赠诗 edges `[fromId,toId,w]` (4,976); **tracked** (small) |
| `dynasties.json` | initial | <1 KB | (see DYNASTIES) | optional; mirrors `src/data/dynasties.ts` |
| `stars/{shard}.json` | lazy/region | ~20–60 KB ea | `StarShard` | histograms + sample refs |
| `poems/{shard}.json` | lazy/poet | ~0.9 MB ea | `PoemShard` | real poem text, ONE valid JSON object (git-ignored, ~235 MB). Fetched by HTTP **Range** (one poet's slice), not whole |
| `poems/{shard}.idx.json` | lazy/poet | ~2–4 KB ea | `Record<id,[off,len]>` | byte-offset sidecar → the Range slice for each poet's value; built in the same pass (git-ignored) |
| `lines/{shard}.json` | lazy/search | ~20–60 KB ea | `FirstLineShard` | **every** line → poem refs; 256 buckets by `fnv32(line)&0xff` (git-ignored, ~791 MB) |

**Content-search bucketing invariant:** the pipeline now indexes **every** line (not just openings),
so any interior line is searchable — 疑是地上霜 → 李白《静夜思》 resolves even though it isn't the
first line. The pipeline's `lineBucket(s) = (fnv32(s)&0xff)` and the frontend's
`lineBucket(s) = (hashStr(s)&0xff)` (`src/data/dynasties.ts::hashStr`) are the SAME FNV-1a-32, so
`searchByLine` loads the shard the pipeline wrote the line into. `FirstLineRef.i` indexes the poet's
`poems[]` array in the **same order** the poems shard was written, so a hit resolves to
`poems[poetId][i]`. **赠诗 edges** connect two corpus poets; a bare-name match must
be **same-dynasty** (precision), while a curated 号/字 **alias** (晦庵→朱熹…) may resolve a famous
reference across dynasties (the ~9% cross-dynasty edges = genuine homage, e.g. a 清人 和东坡).

**Per-poet Range fetch (egress).** Clicking a poet would otherwise download its whole ~0.9 MB
`poems/{bucket}.json` to read a few KB. Instead `pipeline/build-data.mjs` writes each bucket as ONE
valid JSON object PLUS a byte-offset sidecar `poems/{bucket}.idx.json` = `{id:[off,len]}` (the value
at `[off, off+len)` is itself a valid `PoemRecord[]`). `load.ts::loadPoetPoems` issues an HTTP
`Range: bytes=off-(off+len-1)` and `JSON.parse`s the slice (status **206**). `manifest.poemSidecar`
gates the attempt; the whole file stays valid JSON so a host that ignores Range (returns **200**) or
old data without the sidecar transparently falls back to the whole bucket. Hosts must honour byte
ranges on `poems/*.json` (nginx + most static CDNs + vite dev all do).

**First-paint budget ≤ 1.3 MB brotli.** Per-poet poem slices load only on focus (a few KB each via
Range). Star x/y/z are **computed client-side** from poet `id` + dynasty shell (zero asset
bytes) — see `src/data/dynasties.ts` (`bandRadius`, `hashStr`, `spherePoint`).

**Indices are never shipped.** A poem's Babel/格律 index is computed in-browser on demand
(`engineApi`); a 229-digit number per poem would dwarf the text.

## Corpus (all dynasties)

Locked sources (v2, verified 2026-06-10). Combined: **933,857 poems / 32,657 poets** (字库 N = 12,877,
**FROZEN** — see below). Classical layer is a raw upstream count (互见/重出 and 无名氏 collapse inflate it by a
low-single-digit %); the modern layer is content-deduped across its two sources. It is the broadest
permissively-licensed Simplified all-dynasties **open** corpus — near complete on 唐/宋 poet rosters, thinner
on 明/清 (no 全明诗/全清诗 exists anywhere). Full audit + alternatives: [docs/DATA_AUDIT.md](DATA_AUDIT.md).

> ⚠ **字库 FREEZE (production contract).** Every shared 编号 permalink encodes a poem in radix N+1 over the
> shipped charset, whose ORDER defines each char's symbol id. Changing the charset's content or order remaps
> the whole bijection and silently breaks every shared link. `build-data.mjs` therefore re-emits the existing
> `charset.json` **byte-identical** and SKIPS any poem containing an out-of-字库 char (v2 import: 1,597 sheepzh
> poems skipped). Re-deriving requires an explicit `REFLOW_CHARSET=1` and is a major, link-breaking version.

- **Backbone — [`Werneror/Poetry`](https://github.com/Werneror/Poetry)** — ~853k poems /
  ~29.3k authors (Werneror alone, before the modern merge), **先秦 → 当代**, MIT, CSV, columns
  `题目, 朝代, 作者, 内容`, **Simplified**, split by dynasty. The only large open corpus covering
  the full sweep. Author = string only; **no structured 生卒 dates**; dynasty is per-poem (`朝代`).
- **`chinese-poetry` — EVALUATED, NOT SHIPPED.** [`chinese-poetry`](https://github.com/chinese-poetry/chinese-poetry)
  was considered as a 唐宋 quality overlay but is **not read by the build** ([build-data.mjs](../pipeline/build-data.mjs)
  reads only Werneror + yuxqiu — verify: `grep -i chinese-poetry pipeline/` is empty). Its Tang/Song-shi bulk
  (~317k poems) is **Traditional**, so merging it would force a lossy OpenCC pass that perturbs the distinct-Han
  charset N = 12,877 and the 平水韵→格律 mapping; it is also narrower (no 明, no 近现代/当代). Simplified-only is
  canonical (corpus = index = search). See [docs/DATA_AUDIT.md](DATA_AUDIT.md). (Optional future supplement: its
  Simplified 词/曲 + 诗经/楚辞, after OpenCC + dedup.)
- **新诗 (现当代自由诗) — [`yuxqiu/modern-poetry`](https://github.com/yuxqiu/modern-poetry)**
  — Apache-2.0, cloned to `<corpus>/modern-poetry`; **+4,494 free-verse poems / +508 poets**
  (徐志摩《再别康桥》, 海子, 北岛, 顾城, 戴望舒…). `{author,title,paragraphs[]}`; free verse → form
  `other`; 民国 poets → **近现代** else **当代**. Their lines join the all-lines search index.
- **新诗 v2 主层 — [`sheepzh/poetry`](https://github.com/sheepzh/poetry) 汉语现代诗歌语料库** — tooling
  MIT (poem TEXTS remain author-copyrighted, repo states 非商用 — same exposure class as yuxqiu; noted in
  the in-app credits), cloned to `<corpus>/sheepzh-poetry`; **+75,980 poems / +2,849 poets** after
  content-dedup vs yuxqiu (3,016 dups dropped), junk-folder filter (125 non-Han author handles dropped) and
  the charset-frozen gate (1,597 poems with out-of-字库 chars skipped). Layout `data/<作者>_<拼音>/<诗名>.pt`;
  `.pt` = `title:`/`date:` headers + body lines. 余秀华(249) 顾城(489) 海子(323) 食指(43) 北岛(226)…
  Same 民国→近现代/else 当代 mapping (hand-set expanded by ~20 names).

Per-poet record `{name, dynasty, poemCount}` = `GROUP BY 作者, 朝代`. Dates need an external
Wikidata join (out of scope for v1).

Canonical script = **Simplified** — the corpus is already Simplified and there is **no OpenCC at
runtime** (corpus = index = search script). The 字库/index math operate on Simplified so
rank↔unrank stays a clean bijection.

## Dynasty taxonomy (canonical 15 keys)

Defined in [`src/data/dynasties.ts`](../src/data/dynasties.ts). Frontend and pipeline share
these exact keys. Time = depth (id 0 innermost/oldest → 14 outermost/newest).

```
xianqin 先秦 · qinhan 秦汉 · weijin 魏晋 · nanbeichao 南北朝 · sui 隋 · tang 唐 ·
wudai 五代十国 · song 宋 · liao 辽 · jin 金 · yuan 元 · ming 明 · qing 清 ·
jinxiandai 近现代 · dangdai 当代
```

`song/liao/jin` (916–1279) are **coexisting** regimes — overlapping year ranges are
intentional; group `song_era`. Near-empty shells (辽 ≈ 22 poems, 当代) are dimmed, not hidden.
Filtering: per-key chips + presets (全部 / 主要 / 唐宋 = tang,wudai,song); see `DynastyLegend`.

### 朝代 normalization (raw corpus string → canonical key)

Werneror emits 28 raw 朝代 values incl. transition buckets. The pipeline maps them:

```
先秦 ← 先秦,周,西周,东周,春秋,战国,诗经,楚辞
秦汉 ← 秦,汉,两汉,西汉,东汉,秦汉
魏晋 ← 魏,曹魏,三国,蜀,吴,晋,西晋,东晋,两晋,魏晋,魏晋末南北朝初
南北朝 ← 南北朝,南朝,北朝,刘宋,南齐,梁,陈,北魏,东魏,西魏,北齐,北周
隋 ← 隋,隋末唐初(→隋|唐, choose later=唐)
唐 ← 唐,初唐,盛唐,中唐,晚唐,唐末宋初(→唐),隋末唐初
五代十国 ← 五代,十国,南唐,后梁,后唐,后晋,后汉,后周,前蜀,后蜀,南汉,吴越,闽,北汉
宋 ← 宋,北宋,南宋,两宋,宋末金初(→宋),宋末元初(→宋)
辽 ← 辽,契丹
金 ← 金,金末元初(→金),宋末金初(→金 or 宋: pick 金)
元 ← 元,元末明初(→明)
明 ← 明,明末清初(→清)
清 ← 清,清末民国初(→近现代),清末近现代初(→近现代)
近现代 ← 近代,现代,近现代,民国,清末,近现代末当代初(→当代),民国末当代初(→当代)
当代 ← 当代,现当代,新中国
```

Rules: `*末*初` transition buckets map to the **later** period (gushiwen convention); check
`南北朝` substrings before `宋` (so 南朝宋 ≠ Song); 南唐/李煜 → 五代十国 (matches 2 of 3
corpora). Keep `dynasty_raw` on each poem for reversibility. Anything unmatched → `unknown`
(dim outermost "未分类" shell, off by default).

## Replacing the placeholder

`src/data/placeholderLexicon.ts` (6000 CJK chars, fake tones) is the stand-in. To go live:
1. Pipeline emits `charset.json` + `lexicon.json` (real 字库 + 平水韵).
2. App fetches them, builds `PoetryDataset = { lexicon: hydrateLexicon(asset), charset }`.
3. `setDataset(real)` — engine + engineApi pick it up, caches clear. No engine code changes.
