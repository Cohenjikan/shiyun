# Frontend Rebuild Guide

Everything under `src/three/*` and `src/ui/*` is a **replaceable prototype**. A new frontend
only needs the three stable interfaces below; it never touches `engine.ts` or the pipeline.

## 1. Runtime data API — `src/data/load.ts`

```ts
loadData(base = "/data"): Promise<DataManifest>
// Fetches charset.json + poets.index.json + manifest.json, builds the real
// PoetryDataset, and calls provider.setDataset() — engine math goes live.
// Call once at boot; gate the 3D scene on completion (store.loaded).

getPoets(): PoetRow[]                       // all ~32,657 poets, sorted by poemCount desc
getPoet(id): PoetRow | undefined
loadPoetPoems(id): Promise<PoemRecord[]>    // lazy — HTTP Range-fetches just this poet's slice
                                            //   (byte-offset sidecar poems/{b}.idx.json); per-poet cache.
                                            //   Falls back to the whole bucket if no sidecar / no 206.
searchPoets(query, limit?): PoetRow[]       // substring name match, ranked by output
searchByLine(query): Promise<LineHit[]>     // 诗句 search — ALL-lines index → real poems
loadGifts(): Promise<GiftEdge[]>            // 赠诗 edges [fromId,toId,weight] (lazy, cached)
getManifest(): DataManifest | null          // {n, poetCount, poemCount, buckets, dynCounts}
```
`searchByLine` now matches **ANY line** (not just openings): the pipeline indexes every line
into `public/data/lines/{bucket}.json` (256 shards, sharded by `hashStr(line)&0xff` ==
pipeline `lineBucket`). 疑是地上霜 → 李白《静夜思》 (a non-first line) now resolves. A `LineHit`
carries `{poetId, poemIdx, title, form, firstLine, poet}` → open the poet & surface `poems[i]`.
```ts
type PoetRow    = { id; name; dynasty; poemCount; clusterSize }
type PoemRecord = { t: title; f: "wujue"|"qijue"|"wulu"|"qilu"|"other"; p: lines[] }
```

## 2. Engine API — `src/engine/engineApi.ts`

```ts
pullAt(form: PullForm, [x,y,z], {lushiOnly?, commonK?}): PulledPoem  // void-pull at a point
//   PullForm = FormId | "ziyou"; form="ziyou" → variable-length 自由格式/词 (splitFree lines)
pointForBabelIndex(form, b, R?): Vec3          // 3D location of a known index (fly-to)
textBabelIndex(form, hanText): {index, digits} | null
// ↑ a REAL poem's catalog index (null unless its length matches the form & chars ∈ 字库)
halfIndex(form, han) / halfIndexAuto(han): HalfIndex | null  // 半编号 of a typed opening
babelCardinality(form) / regulatedCardinality(form): bigint

// ── 反查 (编号 → 诗): the other direction of the bijection ──
pullByIndex(form: PullForm, indexStr): IndexPoem | null   // unrank a decimal index back to its poem
//   IndexPoem = {form, lines, index, digits, inRange, cardinalityDigits}; powers the 编号反查 tab.
//   inRange=false ⇒ the number is past |catalog| (UI says "共 … 首"). SearchPanel cross-checks the
//   line index + full text and reports if the number is a REAL existing poem.
pulledFromIndex(form: PullForm, indexStr): PulledPoem | null  // rebuild a full pull at its canonical
//   scattered point (for permalink restore) — a shared #p link drops you onto the same star.
```
See [ENGINE_API.md](ENGINE_API.md). **First char = most-significant digit** ⇒ a known
opening line pins the high-order index (basis for 半编号 prefix search).

## 3. Star geometry — `src/three/PoetStars.tsx`

```ts
poetPosition(p: PoetRow): [x,y,z]   // deterministic galaxy position (dynasty shell + hash)
```
Used to place a star, a label, or a fly-to target. Dynasty layout/colour come from
`src/data/dynasties.ts` (`DYNASTIES`, `bandRadius`, `DYNASTY_BY_KEY`). Famous poets in
`src/data/famousPoets.ts` (`FAMOUS_POETS`, now incl. modern names) drive **landmark emphasis** —
those stars render at 2.4× size with a gilded glow so the cloud has named anchors.

## 4. UI state — `src/state/store.ts` (zustand)

| field | meaning |
|---|---|
| `loaded` | data ready |
| `form` | active poem form (五绝…七律) for void-pulls |
| `hidden: Set<key>` | dynasties filtered out (`toggleDynasty`, `showOnly`, `showAllDynasties`) |
| `selected: PulledPoem` | the last void-pull (random poem) → `PoemPanel` |
| `selectedPoet` / `poetPoems` | clicked/searched poet + their lazy-loaded poems → `PoetPanel` |
| `hoverPoetId` | poet under cursor (shows a label) |
| `speed` | camera speed multiplier (HUD readout) |
| `flyTarget` | `[x,y,z]` the camera tweens toward, then auto-clears |
| `pulls` | recent void-pull markers (`PulledStars`); each `Pull` now has a stable `id` so markers animate their own birth/death. `MAX_PULLS=24`, `PulledStars` caps ALIVE at 20 |
| `quality` | render quality `"high" \| "low"` (`toggleQuality`) — `low` halves galaxy counts (~166k→~59k) + disables bloom, for weak GPUs |
| `uiHidden` | hide ALL overlay UI for screenshots (`toggleUI`) — corner 隐藏界面 button + the **H** hotkey (`App` keydown, ignored while typing) |

Transient camera transform lives in `FlyControls` refs, NOT the store (no 60fps re-renders).

## 5. Interaction contract (current shell — reimplement as you like)

- **Pointer drag** = look; **WASD / Space / Shift** = fly; **wheel** = speed; **H** = hide/show all
  overlay UI (screenshot mode). Keys are ignored while an `<input>`/`<textarea>` is focused. The aim
  point is the **real cursor** (the centre crosshair sprite was removed — picking is at the cursor).
- **Click (no drag)** → `pickTargets.pick(x,y)` (O(1) GPU colour-ID pick, `three/gpuPick.ts`):
  - hit a poet (its dynasty not hidden, star above the size gate) → `selectPoet` + `loadPoetPoems` → `PoetPanel`.
  - else → `pullAt(form, point)` → a random poem → `PoemPanel` + a gold marker.
- **Hover** (throttled) → same GPU pick → `setHover(poetId)`.
- **Search a poet** → `selectPoet` + `setFlyTarget(poetPosition(p))`.

## 6. Direction notes (locked)

- **Default = random (Babel) generation.** No self-built 平仄/格律. A poem's number is just
  `rank` of its character order (`textBabelIndex` / `pullAt`). The engine's 格律 catalog still
  exists + is tested, but real data ships a DUMMY tone table (`load.ts::dummyLexicon`) and the
  UI runs random-only. "Good poems" come from the real corpus (search), or a future neural
  generator (needs a backend — conflicts with static hosting; deferred).
- **Filters compose in the random library**: `commonK` (常用字 = top-K freq chars, COMMON_K=2500)
  + `lushiOnly` + form, all inside one Babel catalog. 格律 (lushiOnly) currently uses a DUMMY
  tone table; activating REAL 格律 needs the 平仄 data below.
- **Picking**: O(1) **GPU colour-ID** pick (`three/gpuPick.ts`, called via `pickTargets.pick`). The poet
  field's indices are colour-encoded into an `aPickColor` attribute (shared with the visual geometry so the
  dynasty filter applies); a hover/click renders an n×n window around the cursor into an offscreen buffer and
  reads back the nearest non-background pixel → the poet, in O(1) (replaced the old O(29,808)/hover CPU scan).
  A vertex-shader size gate (== the old apparent≥2.2 CSS-px rule) keeps the void between stars pull-able, so
  clicking empty space still yields a random poem. **Clickability is decoupled from brightness** → the
  decoration can be brightened toward true fusion without breaking clicks. Names show only on hover/select.
- **Galaxy** (`three/Galaxy.tsx`, `three/galaxyParams.ts` BRANCHES/TWIST/ARM_SPREAD): a real-ish
  spiral — ~166k particles (high quality) in 3 populations: DUST + arm STARS + a dense particle
  BULGE (replaced the old hard glow-sprite → smooth core). Exponential-disk radius; value-noise
  clumping + dust gaps; HII knots; warm-core→blue-arm colour; Gaussian point falloff `exp(-4.5d²)`
  (not the old `pow(s,3.5)`). Bloom via **UnrealBloom** (`@react-three/postprocessing` v2.19 — NEW
  dependency). `PoetStars` (`three/PoetStars.tsx::poetPosition`) winds poets onto the SAME 4 spiral
  arms as the backdrop (`armDev ×0.45`), so colour is a gradient ALONG the arms (not concentric
  dynasty rings); a Gaussian radial spread blends dynasty colours and a Gaussian Y-thickness swells
  toward the centre. Headless preview can't capture the dense additive galaxy — verify
  density/brightness/framing on a real GPU.
- **画质 toggle**: HUD 画质·高/低 (`store.quality`, `toggleQuality`). `low` halves the galaxy
  particle counts (~166k→~59k) and disables bloom in `App.tsx` — for weak GPUs.
- **Void-pull markers** (`three/PulledStars.tsx`, full rewrite): small twinkling captured-light
  spots (not giant balls), each with a `Pull.id`; lifecycle = fade-in, cap 20 ALIVE (oldest
  flickers out + self-destructs), distance-cull. A void click glide-focuses the camera
  (`FlyControls` fly-to is now camera-relative). `MAX_PULLS=24`.
- **赠诗 arcs** (`three/GiftLines.tsx`): cubic Bézier with control points pulled toward galaxy
  centre → bundled flows (poor-man's hierarchical edge bundling, `BUNDLE=0.3`); a custom shader
  sends a soft pulse along each arc giver→receiver (flow direction); endpoints fade. Ambient shows
  weight≥3; selecting a poet draws a clean ego-network.

- **格律 is REAL** (done): `pipeline/build-lexicon.mjs` → `public/data/lexicon.json` (平水韵
  via charlesix59, MIT + pinyin-pro tail) → `load.ts` `hydrateLexicon` → real Lexicon;
  `hasRealGelu()` gates the HUD 格律 toggle. **格律 × 常用字 compose** via
  `engineApi.commonLexicon(K)` → tone-valid poems in common chars.
- **自由格式 / 词** (done): a 5th `PullForm="ziyou"` over a radix-(N+W) catalog — see
  ENGINE_API.md. HUD 自由 button; PoemPanel shows 自由目录编号 (no 格律 row); composes with 常用字.
- **Consolidated search panel** (done): `SearchPanel` is ONE collapsible panel with tabs **诗人 / 诗句 /
  造诗 / 朝代** (the old floating `DynastyLegend` was merged into the 朝代 tab and deleted). 诗人/诗句
  inputs act on **Enter** (fly to / open the top hit). 诗句 → `searchByLine` (ANY line, 真实诗人
  highlighted via `store.poetFocus`) + `halfIndexAuto` (半编号).
- **造诗 (compose) tab** (done): form chips + a `填字→编号 / 凭编号→诗` toggle. **填字→编号** is the
  intuitive forward path — a fill-in **grid** of single-char inputs for 五/七绝·律, or a **textarea**
  (回车换行) for 自由 — and the engine reports the catalog 编号 live (`textBabelIndex` / `anyTextIndex`),
  no number math by the user; `findReal` flags if the typed poem is a real corpus poem. **凭编号→诗** is
  the reverse lookup (`engineApi.pullByIndex`, full untruncated numbers + copy).
- **PoetPanel = title drawer / accordion** (done): poem **titles** only (50/page + 显示更多), each with a
  lazy 复制编号; click a title to expand its content + full 编号. The 编号 (large BigInt) is ranked
  **lazily per poem** on expand/copy (`idxCache` ref), not for the whole list.
- **Permalinks** (done): `src/state/permalink.ts` — `#a=<poetId>` / `#p=<form>.<index>`; `ShareButton`
  (🔗 分享, in `CopyButton.tsx`) in the poem + poet panels; `engineApi.pulledFromIndex` rebuilds a
  poem from a link; `App` restores the selection on load (`applyHash`) and keeps the hash in sync.
- **赠诗 network** (done): `three/GiftLines` (curved/bundled Bézier arcs from `loadGifts`), HUD 赠诗
  toggle, `store.showGifts`; selecting a poet lights up their ego-network, others dim.
- **Product-grade poem UI** (done): `--serif` (Kaiti/Songti stack) for poem text; gradient cards +
  gold accent.
- **Modern 新诗** (done): yuxqiu/modern-poetry contemporary set imported (+4,494 free-verse poems /
  +508 poets — 徐志摩《再别康桥》, 海子, 北岛, 顾城, 戴望舒…). Free verse → form `"other"`; their lines
  are searchable.
- **Still TODO**: true visual fusion (brighten decoration now that picking is brightness-independent —
  tune on a real GPU); deploy (static + brotli, host must honour byte ranges); thicker 赠诗 lines via
  `Line2`; 无名氏 collapse; modern-poet dynasty refinement (date table).
