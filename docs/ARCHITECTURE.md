# 诗云 / Poetry Cloud — Architecture

A roamable 3D star map where **real historical poets are real-corpus star clusters**
and the **void between them is the space of all possible 近体诗**, pulled out on click
via an index↔poem bijection — *computed, never stored* (the trick from libraryofbabel.info).

## Layering (and what is durable vs replaceable)

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND  (REPLACEABLE — rebuild freely)                         │
│  src/three/*  3D scene (StarField, Landmarks, PulledStars, Fly)  │
│  src/ui/*     overlay (HUD, PoemPanel, DynastyLegend)            │
│  src/state/store.ts   zustand UI state                           │
└───────────────┬─────────────────────────────┬───────────────────┘
                │ calls                         │ reads
                ▼                               ▼
┌───────────────────────────────┐   ┌──────────────────────────────┐
│  ENGINE API  (STABLE)         │   │  DATA  (STABLE CONTRACT)      │
│  src/engine/engineApi.ts      │   │  src/data/contract.ts  types │
│  app-facing: pullAt, …        │   │  src/data/provider.ts  seam  │
│  src/engine/engine.ts         │   │  src/data/dynasties.ts taxon │
│  pure BigInt math (zero deps) │   │  placeholder ↔ real dataset  │
└───────────────────────────────┘   └──────────────────────────────┘
```

**The two stable boundaries a new frontend must respect:**

1. **Engine API** (`src/engine/engineApi.ts`, backed by pure `engine.ts`). The UI never
   does index math itself — it calls `pullAt()`, `pointForBabelIndex()`, etc. See
   [ENGINE_API.md](ENGINE_API.md).
2. **Data contract** (`src/data/contract.ts`). The Step-3 pipeline emits static assets in
   these exact shapes; the app loads them and calls `setDataset()`. See
   [DATA_CONTRACT.md](DATA_CONTRACT.md).

Everything under `src/three` and `src/ui` is a **prototype shell** — expected to be
rewritten. Because it only touches the two boundaries above, a rewrite cannot break the
math or the data.

## Data flow (a void-pull)

```
click (FlyControls)
  → world point P
  → engineApi.pullAt(form, P, lushiFilter)
      → getDataset().lexicon / charset        (provider seam)
      → indexFromPoint(P) → babel index b      (engine.babelUnrank / regulatedUnrank)
      → describe(): lines[], babelIndex, lushiIndex?, valid
  → store.selectPoem(poem)
  → PoemPanel renders; PulledStars adds a marker
```

## The dataset seam (how real data plugs in)

`engineApi` reads the active dataset through `src/data/provider.ts::getDataset()`.
At boot it is the **placeholder** (`src/data/placeholderLexicon.ts`: 6000 real CJK chars,
fake tones/rhymes). When the Step-3 assets load, the app builds a real `PoetryDataset`
(`hydrateLexicon(asset)` + charset) and calls `setDataset(real)` — **no engine edits**.
`engineApi` clears its cardinality caches via `onDatasetChange`.

## Stack

Vite + React 18 + TypeScript · `@react-three/fiber` 8 / `@react-three/drei` 9 / three 0.169
· `@react-three/postprocessing` 2.19 (UnrealBloom on the galaxy) · zustand 5. Vitest for the
engine. 100% static build — **no backend** (see DEPLOY notes in DATA_CONTRACT.md). All index
math + rendering is client-side.

## Build / run

```
npm run dev        # vite dev server (preview)
npm run build      # tsc --noEmit && vite build  → dist/ (static)
npm test           # vitest: engine round-trip suite
npm run typecheck  # tsc --noEmit
```

## Status

- **Step 2** ✅ engine + 44 round-trip tests green (MSB index convention for 半编号).
- **Step 3** ✅ data SHIPPED: real Werneror corpus → **32,657 poets · 933,857 poems · 字库
  N=12,877** (`pipeline/build-data.mjs`, see [PIPELINE.md](PIPELINE.md)). Loaded via
  `data/load.ts` → `provider.setDataset`. Now includes **新诗 modern poets** (yuxqiu/modern-poetry,
  Apache-2.0: +4,494 free-verse poems / +508 poets — 徐志摩, 海子, 北岛, 顾城, 戴望舒…) as form
  `other`, dated 近现代/当代; their lines are searchable.
- **Step 4** ✅ real galaxy: `three/Galaxy` (procedural core+disk+dome), `three/PoetStars`
  (29k real poets, dynasty disk, hover/click-pick), `three/FlyControls` (slow 6-DOF + speed
  HUD + fly-to + **O(1) GPU colour-ID pick** poet/void, `three/gpuPick.ts`), `ui/SearchPanel` (author search→fly), `ui/PoetPanel`
  (real poems + indices), `ui/DynastyLegend` (filter). Default = random; 格律 dummy/gated.
  See [FRONTEND_GUIDE.md](FRONTEND_GUIDE.md).
- **Step 5** ✅ three more features SHIPPED (44/44 tests, verified in-browser):
  **自由格式/词** (5th `PullForm`, radix-(N+W) variable-length catalog — `engine.freeUnrank`);
  **诗句 content search** (line index → 床前明月光→李白《静夜思》, + `engine.prefixIndex`
  半编号, always-on); **赠诗 network** (`gifts.json`, 元稹→白居易/苏辙→苏轼 → `three/GiftLines`).
- **Step 6** ✅ realism + polish + reverse-loop SHIPPED (44/44 tests):
  **galaxy realism** (`three/Galaxy` — ~166k particles in 3 pops: DUST + arm STARS + a dense
  particle BULGE replacing the old glow-sprite → smooth core; Gaussian point falloff
  `exp(-4.5d²)`; exponential-disk radius, value-noise clumping + dust gaps, HII knots,
  warm-core→blue-arm colour; UnrealBloom via `@react-three/postprocessing`);
  **画质 toggle** (`store.quality` high/low — low halves counts to ~59k + drops bloom, for weak GPUs);
  **poets woven into the galaxy** (`three/PoetStars` — gaussian radial spread + armDev ×0.45 sets
  poets on the SAME 4 spiral arms, colour gradient ALONG the arms, gaussian Y-thickness; FAMOUS
  poets in `data/famousPoets.ts`, now incl. modern, render 2.4× as gilded landmarks);
  **void-pull markers rewritten** (`three/PulledStars` — small twinkling captured-light spots, cap 20
  alive with oldest flickering out + self-destruct, distance-cull; a void click glide-focuses the
  camera; `store.Pull` now carries an id, `MAX_PULLS=24`);
  **bundled + flowing 赠诗 arcs** (`three/GiftLines` — cubic Bézier pulled toward galaxy centre
  (`BUNDLE=0.3`, poor-man's hierarchical edge bundling) + a shader pulse flowing giver→receiver,
  endpoint-faded; ambient = weight≥3, selecting a poet draws a clean ego-network);
  **编号反查 reverse search** (3rd search tab → `engineApi.pullByIndex` unranks a number back to its
  poem, checking line index + full text and reporting whether the number is a REAL poem) with full
  untruncated numbers + `ui/CopyButton`;
  **permalinks** (`state/permalink.ts` — `#a=<poetId>` / `#p=<form>.<index>`, 🔗 分享 buttons via
  `engineApi.pulledFromIndex`, restored on load);
  **product-grade poem UI** (`--serif` Kaiti/Songti stack, gradient cards + gold accent);
  **ANY-line content search** (pipeline now indexes EVERY line → `public/data/lines/{bucket}.json`,
  256 shards, ~791 MB, git-ignored, renamed from `firstline/`; 疑是地上霜→李白《静夜思》 now resolves);
  **赠诗 recall** boosted to **4,976 edges** via a ~250-entry 字号 alias table (~120 poets:
  少陵→杜甫, 子瞻→苏轼, 香山→白居易…) in `build-data.mjs::GIFT_ALIAS`.
- **Step 7** ✅ SHIPPED (53/53 tests — 47 engine + 6 GPU-pick — + build + e2e DOM on a real GPU):
  **O(1) GPU colour-ID picking** (`three/gpuPick.ts` — poet index → `aPickColor` attribute → offscreen
  n×n window read at the cursor → decode; replaced the O(29,808)/hover CPU scan in `FlyControls`;
  brightness-independent → unblocks true fusion); **per-poet HTTP Range fetch** (`pipeline/build-data.mjs`
  writes a byte-offset sidecar `poems/{b}.idx.json`; `load.ts::loadPoetPoems` Range-fetches one poet's
  slice, whole-bucket fallback); deleted the orphan `anyTextReverse`; memoized `PoetPanel`'s index column.
- **Next** ⏳ true visual fusion (brighten decoration — real GPU); deploy (static + brotli, host honours
  byte ranges); thicker 赠诗 lines (Line2); 无名氏 collapse; modern-poet dynasty refinement (date table).

> Legacy `three/StarField.tsx` + `three/Landmarks.tsx` are the Step-4a placeholder field,
> superseded by `PoetStars`/`Galaxy` — kept for reference, not mounted.
