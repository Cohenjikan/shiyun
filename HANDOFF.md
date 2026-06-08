# 诗云 / Poetry Cloud — HANDOFF

> Read this first, then `docs/`. This is a working, verified prototype. The engine + data +
> interfaces are stable; the `src/three` + `src/ui` frontend is a replaceable prototype.

Inspired by 刘慈欣《诗云》 + 博尔赫斯《巴别图书馆》: a roamable 3D galaxy where every real poet
is a star and the void between them is **every possible poem**, pulled out on click — *computed,
never stored* (every poem ⇄ a big-integer index, bijectively).

---

## 1. Run it (works out of the box — data is already in `public/data`)

```bash
npm install
npm run dev        # vite → http://localhost:5173
npm test           # vitest: 34 engine round-trip tests (must stay green)
npm run build      # tsc --noEmit && vite build  (the real verify gate)
npm run typecheck
```

Node 24, npm 11. Windows. Stack: Vite + React 18 + TypeScript + @react-three/fiber 8 /
drei 9 / three 0.169 + zustand 5. **100% static, no backend — never add one** (it's the one
thing that breaks the hosting model; all index math + render is client-side).

---

## 2. What works (all verified this session)

| Area | State |
|---|---|
| **Index engine** (`src/engine/engine.ts`) | Babel base-N + 格律 mixed-radix-product rank/unrank, nested dual index, reversible BigInt Feistel, + **自由 variable-length catalog** + **prefixIndex (半编号)**. **44/44 tests**. First char = most-significant digit. **The 全集编号 IS a true 正序 rank** (`babelRank` = the poem's lexicographic position over the freq-ordered 字库) — `babelUnrank` reverses it (`engineApi.pullByIndex`), so 诗⇄编号 is an exact bijection (NOT a hash; the Feistel scatter is used only for spatial layout, never for the displayed number). |
| **Real data** | Werneror corpus → **29,300 poets · 853,383 poems · 字库 N=12,783** (Simplified). In `public/data/`. |
| **Real 格律** | 平水韵 lexicon (charlesix59, MIT + pinyin-pro tail): 平 5708 / 仄 7075 / 30 韵部. `公式 格律 toggle` produces tone-valid, rhyming poems. |
| **Galaxy** | Realistic spiral: **~166k two-layer particles** (soft dim dust + sparse bright arm stars) + a **dense particle bulge** on an exponential profile (no hard glow-sprite → smooth core), **Gaussian point falloff** `exp(-4.5d²)` (continuous nebulosity, not dots), value-noise clumping + dust gaps, HII knots, warm-core→blue-arm colour, **`UnrealBloom`** for HDR glow. **画质·高/低 toggle** (`store.quality`) halves counts + drops bloom for weak GPUs. |
| **Poets woven into the arms** | `poetPosition`: gaussian radial spread (blends dynasty colours) + concentrated onto the **same 4 spiral arms** as the backdrop (`armDev ×0.45`) → colour reads as a gradient ALONG the arms, not concentric rings; gaussian Y-thickness swells toward the centre (depth). **Famous poets** (`famousPoets.ts`) → 2.4× size + gilded glow (李白/杜甫/苏轼/徐志摩… are visible landmark "明星"). |
| **Void-pull markers** | Small twinkling captured-light spots (not giant balls), lifecycle: fade-in, cap 20 ALIVE (oldest flickers out + self-destructs), distance-culled; a void click **glide-focuses** the camera on the captured point. `three/PulledStars`. |
| **赠诗 arcs** | Soft **curved Bézier**, control points pulled toward the centre → **bundled flows**; a shader sends a **pulse giver→receiver** (flow direction); endpoint-faded; ambient = weight≥3, selected poet = clean ego-net. |
| **编号反查 (reverse)** | Paste a 全集编号 + 诗体 → `pullByIndex` reconstructs the exact poem (full numbers, copy buttons), and reports if it's a **real** poem (loop closure: 静夜思's 编号 → "正好对应李白《静夜思》"). |
| **Permalinks** | Address bar stays shareable: `#a=<poetId>` / `#p=<form>.<index>` (`state/permalink.ts`); 🔗 分享 buttons; restore on load. |
| **Product-grade UI** | Elegant 楷/宋 serif (`--serif`) for poem text; gradient cards + gold accent rules. |
| **诗句 content search** | ANY line (not just openings) — `疑是地上霜 → 静夜思` — via an all-lines inverted index (`lines/`, 256 shards). |
| **Interaction** | 6-DOF fly cam + speed HUD; **screen-space + brightness-gated pick** (click a bright star → poet; click void → random poem); names only on hover/select. |
| **Search** | Author search → fly-to → poet's real poems + each poem's 全集编号. |
| **Filters compose** | 诗体 × **常用字** (top-2500 freq chars, avoids 生僻乱码) × **格律**. e.g. 格律+常用字 → "思伦要锁馆/窟置右黎刍/肆昧家谐变/霜辉化铁驹" (valid + readable). |
| **Dynasty filter** | 15-dynasty legend (先秦→当代) + presets (全部/主要/唐宋). |
| **自由格式 / 词** (5th form) | A separate variable-length catalog: alphabet = 字库 N real glyphs + a block of W≈N/5 "break" glyphs (radix N+W, length 28). Random pulls split into 词-like variable lines (~4.6 行 × ~5 字). Own 自由目录编号; composes with 常用字; never 格律. `engine.freeUnrank/freeRank/splitFree`. |
| **诗句 content search** | 诗句 tab: type a line → **真实诗人** hit via the first-line index (床前明月光 → 李白《静夜思》, surfaced + highlighted in PoetPanel) **AND** the **半编号** — the high-order address the opening pins (verified: 静夜思's 81-digit 全集编号 *starts with* the 5-char 半编号). `engineApi.halfIndex/halfIndexAuto`, `load.searchByLine`. |
| **赠诗网络** | HUD 赠诗 toggle → 3,397 dedication edges (寄/赠/和/次韵… title-parsed; greedy-longest name match + 号/字 alias 晦庵=朱熹; one edge per 兼寄 recipient). 元稹→白居易, 苏辙→苏轼, 黄庭坚→苏轼…. **Soft curved Bézier arcs** (endpoint-faded, thin additive); ambient view shows weight≥2; selecting a poet → a clean lit ego-network. Committed `gifts.json` (86 KB). `three/GiftLines`. |
| **编号反查 (reverse)** | 3rd search tab: paste a 全集编号 + pick a 诗体 → `pullByIndex` (`babelUnrank`) reconstructs the exact poem. **Full numbers, no ellipsis** + copy buttons everywhere. Verified round-trip: 床前明月光 → 81-digit 编号 → 静夜思. |

Three pull modes to feel the project: plain random「牛蝛茙漂綵」→ 格律「趰㵎憣烔岆」→ 格律+常用字
「思伦要锁馆」; plus 自由格式 for 词-like变行, and the 诗句 tab to find a real poem from one line.

---

## 3. Docs map (read in this order)

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, what's stable vs replaceable, data flow.
- [docs/ENGINE_API.md](docs/ENGINE_API.md) — engine + engineApi surface, invariants, MSB convention.
- [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) — static-asset schemas, corpus, dynasty taxonomy + normalization map.
- [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) — **rebuild contract**: the 4 stable interfaces a new frontend uses (load.ts / engineApi / poetPosition / store), interaction model, locked direction notes.
- [docs/PIPELINE.md](docs/PIPELINE.md) — how the data + lexicon are built.

`src/data/contract.ts` is the typed source-of-truth for every data asset.

---

## 4. Data & regeneration

`public/data/` **tracked in git**: `charset.json` (38 KB), `poets.index.json` (2.5 MB),
`lexicon.json` (146 KB), `gifts.json` (110 KB, 赠诗 edges), `manifest.json`.
**git-ignored** (regenerate as below): `poems/*.json` (231 MB, 256 buckets, real poem text)
and `firstline/*.json` (75 MB, 256 buckets, the 诗句 content-search index). So a fresh
`git worktree` has the galaxy + author search + 格律 + 自由格式 + 半编号 + **赠诗网络** working;
only "click a poet → read their poems" and "诗句 search → the real poem" need the two heavy
dirs regenerated.

**Corpora already cloned on this machine** (external, not in the repo):
- `C:\corpus\Werneror-Poetry` — all-dynasties corpus (MIT). Used by `pipeline/build-data.mjs`.
- `C:\corpus\Pingshui_Rhyme.json` — 平水韵 (charlesix59, MIT). Used by `pipeline/build-lexicon.mjs`.

Regenerate (scripts now write into *this* project's `public/data` via relative paths):
```bash
node --max-old-space-size=4096 pipeline/build-data.mjs     # charset + poets.index + poems
node pipeline/build-lexicon.mjs                            # lexicon.json (needs opencc-js, pinyin-pro — devDeps)
```

---

## 5. Verifying changes (important gotchas)

- **The verify gate is `npm run build` (tsc) + `npm test`.** Keep the 34 engine tests green.
- **The headless preview GPU (swiftshader) CANNOT screenshot the dense additive galaxy** — it
  times out (not a crash; the page is alive). Verify visuals on a real GPU, or drive the DOM
  with the preview MCP's `preview_eval` (read `.poem-panel` / `.poet-panel` text, dispatch
  synthetic clicks). Reduce galaxy point counts in `src/three/Galaxy.tsx` if you need a shot.
- **Synthetic clicks fired right after page load don't stick** (pre-hydration) — click, wait a
  tick, re-verify.
- **Rapid HMR edits** can trip the r3f ErrorBoundary transiently — restart the dev server for a
  clean mount; the production build is the source of truth.

---

## 6. Remaining work (next, roughly in priority)

**DONE this session** (all verified — `npm run build` + 44/44 tests + browser DOM checks):
1. ✅ **自由格式 / 词** (5th form) — done as a radix-(N+W) catalog with a *block* of W≈N/5
   break glyphs (a single N+1 separator is ~never hit at N=12,783, so it gives no line breaks;
   the W-block makes breaks emergent: mean ~4.6 行 × ~5 字). `engine.freeUnrank/Rank/splitFree`,
   `engineApi` ziyou branch of `pullAt`, HUD 自由 button, PoemPanel 自由目录编号.
2. ✅ **Content search** — first-line index `firstline/{bucket}.json` (256 shards by
   `fnv32(firstLine)&0xff`) + `load.searchByLine` (真实诗人) **and** `engine.prefixIndex` /
   `engineApi.halfIndex` (半编号, pure, always-on). 床前明月光 → 李白《静夜思》 verified.
3. ✅ **赠诗 network** — `build-data.mjs` title parse (markers + greedy-longest name match with a
   2-char completeness guard; bare names **same-dynasty only**, 号/字 **aliases** resolve across
   dynasties; one edge per distinct 兼寄 recipient) → committed `gifts.json` (3,397 edges) →
   `three/GiftLines` + HUD toggle.

**Still TODO:**
4. **Polish** — GPU-pick at scale; per-poet (not per-bucket) poem fetch to cut egress.
   ~~bloom~~ DONE (`@react-three/postprocessing` v2.19, R3F-8 compatible, `App.tsx` `<Bloom>`).
   ~~galaxy density~~ DONE (166k two-layer particles + particle bulge + Gaussian falloff). Galaxy
   counts (`Galaxy.tsx` DUST/STARS/BULGE) + bloom params are perf/taste knobs — tune on the
   target GPU. 赠诗 lines are 1px (WebGL `lineWidth` cap) — soft curved arcs; for thicker lines
   use `Line2`/`meshline`.
5. **Deploy** — static build → `shiyun.<domain>` subdomain, nginx `brotli_static`, precompress
   assets. See DATA_CONTRACT.md §deploy notes. No backend.

**Search index follow-ups** (optional): the first-line index covers *opening* lines only (the
床前明月光 case); whole-poem / non-opening-line search would need an all-lines inverted index
(~4M lines). 赠诗 matching is name-only (misses 字/号 like 元美=王世贞) by design — a 字号→poet
table (e.g. from Wikidata) would raise recall.

### Locked decisions (don't relitigate without reason)
- **Default = random (Babel) generation; no further self-built 平仄 research** — the 格律
  product engine + the charlesix59 平水韵 data cover it. "Good poems" = real-corpus search;
  neural generation needs a backend (conflicts with static) — deferred.
- **Simplified** is canonical (corpus = index = search script; no OpenCC at runtime).
- **Index convention: first char = most-significant digit.**
- **Filters compose inside one Babel catalog**; the displayed 全集编号 is always the full-catalog
  address.
