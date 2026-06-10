# 诗云 / Poetry Cloud — HANDOFF

> Read this first, then `docs/`. This is a working, verified prototype. The engine + data +
> interfaces are stable; the `src/three` + `src/ui` frontend is a replaceable prototype.

Inspired by 刘慈欣《诗云》 + 博尔赫斯《巴别图书馆》: a roamable 3D galaxy where every real poet
is a star and the void between them is **every possible poem**, pulled out on click — *computed,
never stored* (every poem ⇄ a big-integer index, bijectively).

> **▶ Status (2026-06-10, 9th agent — orchestrated round: vite 8 · 动态 OG · v3 NO-GO):** **(1) vite 8 /
> vitest 4 / plugin-react 6** — round-5 暂缓的 P2 清账:5 个 dev 链漏洞 → `npm audit` **0**;Rollup→Rolldown
> 迁移保住 three 独立 chunk(675 KB < 700 限额);93 测试零改动;5199 strictPort / `__OG_ORIGIN__` / precompress
> 全保留。**(2) 动态 OG 分享卡** — 分享链接加 query 镜像(`/?a=…#a=…`,hash 仍正典、旧链接逐字节兼容);
> `feedback-server.mjs` 可选 `SITE_ROOT` 模式按诗人注入 og/twitter meta(`deploy/og-inject.mjs` 纯函数 + 测试;
> 不设则一切照旧),nginx 条件反代 + **DEPLOY §6** 运维照抄。**(3) 数据 v3 调研 → NO-GO**(语料源已饱和、唯一
> 大候选无作者字段;见 DATA_AUDIT.md 补记)。**(4) 留影(round 2)** — 奇迹时刻全面改名「留影」,且诗人目录
> **每行诗都能直接留影**(`store.openCinemaFor`/`cinemaPoemIdx`,显式目标 > 虚空 > 搜索命中,关闭/换诗人即
> 复位;解析抽成纯函数 `ui/cinemaResolve.ts`)——之前只能绕道编号反查。**(5) Top-8 加固(round 3,五视角
> 评审后)** — FNV 分桶哈希契约测试(管线↔前端漂移=CI 红)、字库哈希启动校验(`EXPECTED_CHARSET_HASH=
> a392703b`,错配横幅警告)、**GitHub Actions CI**(.github/workflows/ci.yml)、**拾遗**(虚空诗收藏,
> localStorage,更多菜单入口)、FlyControls useFrame 零分配(§6 旧账)、`pipeline/pack-data.mjs` 冷备一键
> 打包、`VITE_DATA_BASE` 旋钮(§6 旧账)、nginx `/data/v2/` immutable 缓存铺路(注释默认关)。
> 现在 **172 tests** 全绿。评审其余 P2/P3 发现未做,清单见 round-3 会话记录。
>
> **▶ Status (2026-06-10, 8th agent · round 5 — post-launch P0/P1/P2):** **(1) 别名搜索** — 搜「陶渊明/李太白/
> 苏东坡」命中本名行;庄子/诸葛亮/三字经 落空时给体面解释 (`src/data/poetAliases.ts` + integrity test)。
> **(2) 加载兜底** — 修了 loadPoetPoems 把网络失败缓存成"0 首"的真 bug;诗人面板/启动屏都有 错误+重试;
> index.html 加 ES5 守门(无 BigInt/WebGL → 文案而非黑屏)。**(3) 数据 v2** — sheepzh/poetry 现代层并入,
> **字库逐字节冻结**(N=12,877 不变 → 所有已分享编号链接稳定):**32,657 诗人 / 933,857 首**(余秀华249/顾城489/
> 海子323/食指43);重建管线默认 FROZEN,`REFLOW_CHARSET=1` 才重排(会废掉全部旧链接,慎用)。数据三目录已
> 同步回 main worktree(旧版保留为 `*_v1_backup`),并备份到 GitHub(见 DEPLOY §1.0)。**(4) 自建反馈后端** —
> `deploy/feedback-server.mjs`(零依赖/JSONL/不存IP/token 收件箱),DEPLOY §5 重写为自建优先,运维照抄即可。
> **(5) P1** — LICENSE/OG 分享卡(public/og.jpg)/favicon/五代十国标注「已并入唐」。93 tests 全绿。
>
> **▶ Status (2026-06-09, after the 8th agent — pre-launch review):** all prior features + this round's
> polish are DONE + verified (typecheck · 89 tests · production build). This round:
> **(1) 奇迹时刻** — removed the 画框 (it collided with 退出); the tagline no longer orphans its last char
> (`text-wrap: balance` + full-width centering); the centred poem card is now **drag-to-move + pinch/wheel/±
> zoom** (`src/ui/Cinema.tsx`). **(2) Data audit** (multi-agent + web): verdict **SHIP AS-IS** — Werneror+yuxqiu
> is the *optimal fit* (only broad+Simplified+permissive+parseable corpus), *not* the most comprehensive
> (ORCHESTRA +28% but Traditional/encumbered) and *not* complete (明/清 ceiling — no 全清诗 exists); see
> **`docs/DATA_AUDIT.md`**. Corrected stale `chinese-poetry`-overlay copy in README + DATA_CONTRACT.
> **(3) Feedback backend** — `submitFeedback` now ALSO POSTs to `VITE_FEEDBACK_ENDPOINT` if set (else stays
> 100% static); deploy guide + Cloudflare Worker in **`docs/DEPLOY.md §5`**. **(4) Fixed the latent foot-gun
> below** — the modern-corpus read now **fails loud** on a missing clone (opt out: `ALLOW_NO_MODERN=1`).
>
> **▶ Status (2026-06-09, after the 7th agent):** engine · data · galaxy · search · 赠诗网络 · **移动端/触控
> · 性能(自适应画质+dpr) · 手机面板折叠 · 奇迹时刻分享卡 · 寻路修复** are all DONE + verified (build + 89 tests).
> Feature work is effectively complete. **Next: DEPLOY** — ship it to a static host so the 永久链接/分享 features
> come alive. See §6 「⏭ Next — deploy」 + `docs/DEPLOY.md`: **decide the fuzzy-index (`linesf/`) hosting
> strategy FIRST** (simplest: drop it on deploy — it's a fallback and `load.ts` no-ops if absent).

---

## ⚠ Canonical base — READ BEFORE BRANCHING (worktree hand-off)

**`main` is the canonical, up-to-date branch.** Cut your worktree FROM `main`, and when you finish,
**fast-forward `main` onto your branch** (`git checkout main && git merge --ff-only <your-branch> &&
git push origin main`) so the NEXT agent starts from your work — not a stale commit.

*Real failure that motivated this (do not repeat):* a session left all its advanced work on a
feature branch (`claude/flamboyant-cannon-…`) and never advanced `main`. The next worktree was cut
from the stale `main` (8 commits behind) and silently lost 赠诗 / 自由格式 / bloom / 模糊搜索 /
新诗诗人 …, and poem loading was dead. **If `main`'s tip is not the latest verified work, the
hand-off is broken — fix `main` first.** Check with `git log --oneline --all --graph`.

**Heavy data is git-ignored** — `public/data/poems/` (235 MB), `lines/` (791 MB), `linesf/` (~4.4 GB fuzzy),
`search/` (~129 MB 寻诗 prefix/诗名 index). A fresh worktree has NONE, so "click a poet → 载入作品…" hangs and
诗句/寻诗 search finds nothing. Provision before you start, one of two ways:
- regenerate: `node --max-old-space-size=4096 pipeline/build-data.mjs` (needs the corpora), then
  `npm run build:lines && npm run build:sidecars && npm run build:search` (+ `npm run build:fuzzy` for 异文), **or**
- (fast, same machine) junction them from a worktree that already has them (New-Item -ItemType Junction, or
  `cmd /c mklink /J "<new>\public\data\poems" "<existing>\public\data\poems"`, and `…\lines` `…\linesf` `…\search`).

> ✅ **2026-06-09 — main's data is now COMPLETE + the canonical source.** Earlier a `build-data.mjs` run had
> dropped the 508 modern 新诗 poets (徐志摩/海子/北岛/顾城…) from `poems/`/`lines/` while git's `poets.index.json`
> kept them (the modern read is a WARN-only `try/catch`, `build-data.mjs:163`). The 6th-agent session RECOVERED
> them INTO `main/public/data` (copied the complete `poems/` + rebuilt `lines/` + `search/`) → **`missing === 0 /
> 29,808`**, 徐志摩 loads 19 poems, 寻诗 works. **So a fresh worktree should junction its data from `main`'s
> `public/data`** (`poems/` `lines/` `search/` are all good there). `linesf/` (the ~4.4 GB fuzzy) is NOT in main
> — junction it from `inspiring-bhabha-081900/public/data/linesf` or rebuild (`npm run build:fuzzy`); fuzzy is a
> fallback, so it's optional. (✅ **FIXED 2026-06-09 (8th agent):** the build-data modern read is no longer
> WARN-only — a missing `C:/corpus/modern-poetry` now **throws** so a rebuild can't silently drop the 508 modern
> poets again; set `ALLOW_NO_MODERN=1` for an intentional Werneror-only build.)

**Backups:** private GitHub repo `github.com/Cohenjikan/shiyun` (all branches); local all-branches
bundle at `C:\Users\Cohen\Desktop\shiyun-ALL-branches-backup.bundle` (restore: `git clone <bundle>`).
Heavy-data cold backup = GitHub release assets (DEPLOY §1.0 Option A′); repack/re-upload with ONE command:
`npm run pack:data` (pipeline/pack-data.mjs — tars poems/lines/search + SHA256SUMS + prints the gh commands).

> 🖥 **Live preview is port 5199 (`vite.config` strictPort).** The user watches `http://localhost:5199`
> directly — **do NOT load the in-conversation preview MCP.** At this hand-off 5199 is served by the 7th-agent
> worktree `blissful-mestorf-a5a3a2`. To take it over from YOUR worktree: (1) provision data (junction `poems/`
> `lines/` `search/` from `main/public/data`, `linesf/` from a sibling — see the data note above); (2) free the
> port (`Get-NetTCPConnection -LocalPort 5199 -State Listen` → `Stop-Process -Id <pid> -Force` on the old vite);
> (3) `npm install` (fresh worktree has no node_modules) then `npm run dev`. Verify changes with build/tests +
> HTTP fetches against 5199, not the preview MCP.

---

## 1. Run it (works out of the box — data is already in `public/data`)

```bash
npm install
npm run dev        # vite → http://localhost:5199 (strictPort)
npm test           # vitest: 172 tests (47 engine + 6 engineApi + 4 load + 11 GPU-pick + 21 touch-gesture + 4 alias + 13 permalink + 17 og-inject + 15 cinema/留影 + 12 shardHash + 7 charsetHash + 15 拾遗)
npm run deploy:build  # build + precompress for a static host (see docs/DEPLOY.md) — Range-safe
npm run build      # tsc --noEmit && vite build  (the real verify gate)
npm run typecheck
```

Node 24, npm 11. Windows. Stack: Vite 8 + React 18 + TypeScript + @react-three/fiber 8 /
drei 9 / three 0.169 + zustand 5. **100% static + exactly ONE optional backend** —
`deploy/feedback-server.mjs` (反馈收集 + 可选 OG meta 注入, see DEPLOY §5–6) — **never add another**
(all index math + render stays client-side; the static build works with the backend absent).

---

## 2. What works (all verified this session)

| Area | State |
|---|---|
| **Index engine** (`src/engine/engine.ts`) | Babel base-N + 格律 mixed-radix-product rank/unrank, nested dual index, reversible BigInt Feistel, + **自由/universal variable-length catalog (`anyRank`)** + **半编号** + **编号反查 (pullByIndex)**. **47/47 engine tests**. First char = most-significant digit. **The displayed 全集编号 is now the UNIVERSAL `anyRank`** over (chars + line-breaks) — ONE unique number per poem across all 诗体 (a 七绝 ≡ its 自由 twin), reversed by `anyUnrank` (`engineApi.pullByIndex`, form-agnostic) → 诗⇄编号 is an exact bijection. (Per-form `babelRank`/格律 catalogs survive for spatial scatter + 格律 mode only; the Feistel scatter never IS the displayed number.) |
| **Real data** | Werneror corpus + modern 新诗 → **29,808 poets · 857,877 poems · 字库 N=12,877** (Simplified). In `public/data/`. |
| **Real 格律** | 平水韵 lexicon (charlesix59, MIT + pinyin-pro tail): 平 5758 / 仄 7119 / 30 韵部. `公式 格律 toggle` produces tone-valid, rhyming poems. |
| **Galaxy** | Realistic spiral: **~166k two-layer particles** (soft dim dust + sparse bright arm stars) + a **dense particle bulge** on an exponential profile (no hard glow-sprite → smooth core), **Gaussian point falloff** `exp(-4.5d²)` (continuous nebulosity, not dots), value-noise clumping + dust gaps, HII knots, warm-core→blue-arm colour, **`UnrealBloom`** for HDR glow. **画质·高/低 toggle** (`store.quality`) halves counts + drops bloom for weak GPUs. |
| **Poets woven into the arms** | `poetPosition`: gaussian radial spread (blends dynasty colours) + concentrated onto the **same 4 spiral arms** as the backdrop (`armDev ×0.45`) → colour reads as a gradient ALONG the arms, not concentric rings; gaussian Y-thickness swells toward the centre (depth). **Famous poets** (`famousPoets.ts`) → 2.4× size + gilded glow (李白/杜甫/苏轼/徐志摩… are visible landmark "明星"). |
| **Void-pull markers** | Small twinkling captured-light spots (not giant balls), lifecycle: fade-in, cap 20 ALIVE (oldest flickers out + self-destructs), distance-culled; a void click **glide-focuses** the camera on the captured point. `three/PulledStars`. |
| **赠诗 arcs** | Soft **curved Bézier**, control points pulled toward the centre → **bundled flows**; a shader sends a **pulse giver→receiver** (flow direction); endpoint-faded; ambient = weight≥3, selected poet = clean ego-net. |
| **编号反查 (reverse)** | Paste a 全集编号 + 诗体 → `pullByIndex` reconstructs the exact poem (full numbers, copy buttons), and reports if it's a **real** poem (loop closure: 静夜思's 编号 → "正好对应李白《静夜思》"). |
| **Permalinks** | Address bar stays shareable: `#a=<poetId>` / `#p=<form>.<index>` (`state/permalink.ts`); 🔗 分享 buttons; restore on load. |
| **Product-grade UI** | Elegant 楷/宋 serif (`--serif`) for poem text; gradient cards + gold accent rules. |
| **寻诗 search** (was 诗句) | Renamed tab. ANY line (not just openings) via the all-lines index (`lines/`, 256 shards) + **incremental prefix/诗名** via `search/` (`build-search.mjs`, 256 shards, ~129 MB): a single 字, a half line, or a TITLE matches as you type — `举头望 → 静夜思` (mid-line), `静夜思`/`春江花月夜` (诗名). `load.ts::searchPoems` merges prefix+title (`searchByHead`) with exact-line+fuzzy (`searchByLine`), ranks famous-first, ≤2/poet. |
| **探诗** (was 造诗) | Renamed tab (compute a poem from a fill-grid / 编号; logic unchanged). |
| **Interaction** | 6-DOF fly cam + speed HUD; **O(1) GPU colour-ID pick** (`three/gpuPick.ts` — poet index → offscreen buffer, read the cursor pixel; replaced the old O(29,808)/hover CPU scan): click a star → poet, click void → random poem; names only on hover/select. |
| **Per-poet egress (#12)** | Clicking a poet HTTP **Range**-fetches just that poet's slice of its `poems/{bucket}.json` (a few KB) via the byte-offset sidecar `poems/{bucket}.idx.json`, not the whole ~0.9 MB bucket. Whole-file stays valid JSON → transparent fallback when the sidecar is absent or the host ignores Range (200 not 206). `load.ts::loadPoetPoems`. |
| **Search** | Author search → fly-to → poet's real poems + each poem's 全集编号. |
| **Filters compose** | 诗体 × **常用字** (top-2500 freq chars, avoids 生僻乱码) × **格律**. e.g. 格律+常用字 → "思伦要锁馆/窟置右黎刍/肆昧家谐变/霜辉化铁驹" (valid + readable). |
| **Dynasty filter** | 15-dynasty legend (先秦→当代) + presets (全部/主要/唐宋). |
| **自由格式 / 词** (5th form) | A separate variable-length catalog: alphabet = 字库 N real glyphs + a block of W≈N/5 "break" glyphs (radix N+W, length 28). Random pulls split into 词-like variable lines (~4.6 行 × ~5 字). Own 自由目录编号; composes with 常用字; never 格律. `engine.freeUnrank/freeRank/splitFree`. |
| **半编号 (half-index)** | 诗句 tab also yields the **半编号** — the high-order address the opening line pins (verified: 静夜思's 全集编号 *starts with* the 5-char 半编号). Pure, always-on: `engineApi.halfIndex/halfIndexAuto`. |
| **赠诗网络** | HUD 赠诗 toggle → **4,849 dedication edges** (寄/赠/和/次韵… title-parsed; greedy-longest name match + ~250-entry 字号 alias table — 少陵→杜甫, 子瞻→苏轼, 香山→白居易; one edge per 兼寄 recipient). 元稹→白居易, 苏辙→苏轼, 黄庭坚→苏轼…. Committed `gifts.json` (~126 KB). `three/GiftLines`. |
| **新诗 / modern** | yuxqiu/modern-poetry contemporary set (Apache-2.0) folded in: +4,494 free-verse poems / +508 poets (徐志摩《再别康桥》, 海子, 北岛, 顾城, 戴望舒…). Free verse → form `other`; 民国→近现代 else 当代; their lines are searchable. |
| **诗云设置菜单** | HUD **⚙设置** (`store.settingsOpen`) → `ui/SettingsMenu.tsx` collects 指引 / 行星 / 赠诗 / 引力 (moved out of the top bar) + 恢复默认. |
| **行星指引线设置** | `store.guideMode` (off/flash/hold) × `guideCoverage` (all=每首不漏 / optimized=采样) × `guideSeconds` (flash 时长). In the settings menu. `three/PoemGuides.tsx`. |
| **赠诗漫游** | `ui/GiftRoam.tsx` (when 赠诗 on): **往来** list (click → fly across) + **3D arc click** (`FlyControls` ego-net CPU pick, hover-highlights `store.giftHoverId` + 22–26px generous range → easy to hit) + **足迹** breadcrumb with PERSISTENT gold **return lines** (`three/GiftTrail.tsx`, ≤10) + **路径查找** (typed `searchPoets` or 选中 endpoints; BFS **≤100 hops, undirected, deterministic+symmetric** — 7th-agent fix: A→B == reverse(B→A), stronger edge wins ties; cyan 3D highlight that suppresses the gold 足迹 line while shown; `store.pathDimEgo` 弱化往来线). Hop = `store.hopToPoet`. Graph/BFS/dedication = `data/giftGraph.ts`. |
| **选中诗人增强** | Selected poet's planets HOLD the bright/large highlight for the whole selection (easier GPU pick) + hover a planet → 《title》 tooltip (`store.hoverPoem`, `ui/PoemHoverLabel`). `three/PoemOrbits.tsx`. |
| **移动端 / 触控** (7th) | `FlyControls` `pointers`-Map state machine: 1-finger drag = 转向, **2-finger drag = 飞行, 2-finger pinch = 调速/缩放**, tap = 选中 — reuses the desktop camera math. `canvas{touch-action:none}` + `viewport-fit=cover` + `overscroll-behavior:none`. Pure gesture math + pan/pinch mode-lock in `three/touchGesture.ts` (unit-tested). Hover-pick skipped on touch (no hover + a GPU stall). `pointercancel` + finger-transition reseed handled. |
| **自适应画质 / 性能** (7th) | `three/detectQuality.ts` (`COARSE`/`WEAK`, evaluated once at load): weak/touch devices default `画质·低` + cap `dpr` to 1.5 + bloom off, and the ~857k-point `行星·全部` layer is gated off (manual 画质 toggle still forces 高). |
| **响应式布局** (7th) | One `@media(max-width:600px)`: transient panels → 全宽 bottom-sheets; 搜索 stays top tracking a live `--hud-h` (ResizeObserver); HUD wraps/trims; 16px inputs (no iOS zoom-on-focus); `dvh` + `env(safe-area-inset-*)`; ≥40px tap targets on coarse pointers. |
| **手机面板折叠** (7th) | On touch, 诗人/虚空诗 panels + 搜索 default to a bottom **peek bar** (一行摘要 + 「▲ 展开」); tap to open, 「▾ 收起」 back. Re-collapses per new selection. Never auto-covers the galaxy. `ui/useSheet.ts` + `.sheet-peek`. Desktop unchanged. |
| **留影 / 分享卡** (7th; renamed from 奇迹时刻 + per-poem 目录直达, 9th) | 留影 button (诗/诗人面板) **+ 诗人目录每行的「留影」** (`store.openCinemaFor(i)`, explicit target wins over void/focus, resets on close/poet-change — `ui/cinemaResolve.ts`) → a framed share card over the **FROZEN** scene (spin + void-pull + highlight lifecycles paused; manual camera still composable) with a cyclable concept tagline (5) + the poem rendered **竖排 right-to-left, one column per line** (`writing-mode: vertical-rl` — long poems never clip) + its 全集编号; exit is a **red top-left** button. `ui/Cinema.tsx`, `store.cinema`. |
| **拾遗** (9th) | Void poems are non-reproducible by design — 拾遗 keeps them: PoemPanel 「收进拾遗」 stores {全集编号, preview, ts} in localStorage (`shiyun_shiyi_v1`, dedupe by index, cap 200, corrupt-tolerant — pure module `state/shiyi.ts`, 15 tests); 更多 menu → 「拾遗 — 我捞起的诗」 panel re-pulls via `pulledFromIndex` + fly-back (mirrors the `#p=` permalink path). Void poems only (real poems are re-findable via their poet). `ui/ShiyiViewer.tsx`. |
| **更多 菜单 + 关于/反馈** (7th) | HUD 设置→**更多** (`ui/SettingsMenu.tsx`): + 个人主页 `cohenjikan.com` / `GitHub` links + an in-page **反馈** box (localStorage, ≤5000 汉字). Owner reads via a hidden gesture — **5 taps on the 诗云 logo in 10 s** → `ui/FeedbackViewer.tsx`. ⚠ localStorage = per-device; `state/feedback.ts::submitFeedback` is the seam to repoint at a form service for cross-visitor collection at deploy. |

Three pull modes to feel the project: plain random「牛蝛茙漂綵」→ 格律「趰㵎憣烔岆」→ 格律+常用字
「思伦要锁馆」; plus 自由格式 for 词-like变行, and the 诗句 tab to find a real poem from one line.

---

## 3. Docs map (read in this order)

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, what's stable vs replaceable, data flow.
- [docs/ENGINE_API.md](docs/ENGINE_API.md) — engine + engineApi surface, invariants, MSB convention.
- [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) — static-asset schemas, corpus, dynasty taxonomy + normalization map.
- [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) — **rebuild contract**: the 4 stable interfaces a new frontend uses (load.ts / engineApi / poetPosition / store), interaction model, locked direction notes.
- [docs/PIPELINE.md](docs/PIPELINE.md) — how the data + lexicon are built.
- [docs/DEVLOG.md](docs/DEVLOG.md) — running development diary (newest first): per-round commits + what changed + verify.
- [docs/DEPLOY.md](docs/DEPLOY.md) — static deploy (nginx + brotli + the poems/ Range gotcha).

`src/data/contract.ts` is the typed source-of-truth for every data asset.

---

## 4. Data & regeneration

`public/data/` **tracked in git**: `charset.json` (38 KB), `poets.index.json` (2.5 MB),
`lexicon.json` (147 KB), `gifts.json` (~126 KB, 赠诗 edges), `manifest.json`.
**git-ignored** (regenerate as below): `poems/*.json` (235 MB, 256 buckets, real poem text)
and `lines/*.json` (791 MB, 256 shards, the **all-lines** content-search index — every line,
not just openings; renamed from `firstline/`). So a fresh `git worktree` has the galaxy +
author search + 格律 + 自由格式 + 半编号 + **赠诗网络** working; only "click a poet → read their
poems" and "诗句 search → the real poem" need the two heavy dirs regenerated.

**Corpora already cloned on this machine** (external, not in the repo):
- `C:\corpus\Werneror-Poetry` — all-dynasties corpus (MIT). Used by `pipeline/build-data.mjs`.
- `C:\corpus\modern-poetry` — yuxqiu/modern-poetry 新诗 set (Apache-2.0). Also read by `build-data.mjs`.
- `C:\corpus\Pingshui_Rhyme.json` — 平水韵 (charlesix59, MIT). Used by `pipeline/build-lexicon.mjs`.

Regenerate (scripts now write into *this* project's `public/data` via relative paths):
```bash
node --max-old-space-size=4096 pipeline/build-data.mjs     # charset + poets.index + poems + lines/ + gifts
node pipeline/build-lexicon.mjs                            # lexicon.json (needs opencc-js, pinyin-pro — devDeps)
npm run build:search                                      # search/ — 寻诗 prefix + 诗名 index (from poems/, no corpus)
npm run build:sidecars                                    # poems/*.idx.json Range sidecars (from poems/, no corpus)
npm run build:fuzzy                                       # linesf/ — 异文 fuzzy line index (large; LOCAL only)
```
`build-data.mjs` now also reads the modern corpus + carries the expanded ~250-entry `GIFT_ALIAS`
字号 table. When 字库 N changes, `lexicon.json` must be rebuilt too (it indexes 平/仄 by glyph).

---

## 5. Verifying changes (important gotchas)

- **The verify gate is `npm run build` (tsc) + `npm test`.** Keep the 47 engine tests green.
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

**DONE — 行星 / poem-orbits feature (latest; verified: build + 57/57 + DOM e2e on 5199; orbit *aesthetics* need a real-GPU pass):**
- ✅ **Poems are now first-class objects orbiting their poet** — resolves the "click star=poet / click void=poem"
  asymmetry the user flagged. New **`three/positions.ts`** holds the shared deterministic layout: `poetPosition` (moved
  here from PoetStars, re-exported for back-compat) + `poemPosition`/`poemOffset` — a poem sits on a golden-angle,
  area-uniform disc around its poet star, system radius ∝ √poemCount (李白/杜甫 = a full system; a 1-poem poet = a
  single satellite). The SAME function backs render + 目录 locate + 诗句 search, so a poem-planet is at ONE canonical spot.
- ✅ **`three/PoemOrbits.tsx`** renders planets; two modes via the HUD **行星** toggle (`store.showAllPoems`, like 赠诗,
  default OFF — 兼顾高/普通机器):
    • OFF (普通机器): only the SELECTED poet's poems orbit (≤~3.6k pts, brighter + twinkling) — an on-demand 彩蛋 on poet click.
    • ON (高性能机器): EVERY poet's poems orbit — ONE 857,877-point Points layer (dim/small), built once when toggled on,
      disposed when off. Positions need NO new asset (computed from poets.index poemCount; poem TEXT still lazy-loads on click).
  The layer spins with the shared `galaxySpin.angle` (locked to PoetStars). Verified it builds + renders w/o error in the
  headless preview; **fps + orbit radius/brightness are the user's real-GPU call** (knobs: `PoemOrbits` `planetMaterial`
  args + `positions.poemSystemRadius`).
- ✅ **目录定位** — every poem row in PoetPanel has a 🛸定位 button → flies to that poem's planet + lights a flare
  (`store.pulseAt` = a flare WITHOUT changing selection, so the panel stays open). Works for the 八大家 and everyone.
- ✅ **诗句 search → planet** — a 诗句 hit flies to the EXACT poem-planet in the poet's system (not just the poet centre)
  + flares it (`SearchPanel.goHit`).
- ✅ **Clicking a planet opens its poem** — `gpuPick` renders a SECOND pick layer (PoemOrbits' geometry + `aPickColor`,
  poem ids offset by `POEM_PICK_BASE = 0x800000`) in the SAME offscreen pass as the poets (depth-tested → front-most
  wins), CLICK-only (hover stays at just the 29k poets, cheap). A picked planet → `selectPoet(poet, {poemIdx})` (PoetPanel
  opens focused on that poem) + flares it. `pickTargets.pick` now returns `PickResult = {kind:"poet"|"poem"}`; PoemOrbits
  registers the active layer + a `resolve(localId)→{poet,poemIdx}` map via `pickTargets.poemLayer`. encode/decode + the
  poet/poem id split have 5 new vitest cases (**62 total**). *(GPU pick can't run on the headless preview — the whole r3f
  Canvas subtree is dormant on swiftshader; verify CLICKING a planet on a real GPU.)*

**DONE — round 8 (latest; verified build + 66/66; visual/interaction need a real-GPU pass — no preview):**
- ✅ **诗句 mid-line variant search (FUZZY LINE INDEX)** — round-7's `findReal` fuzzy only covered the COMPOSE tab;
  searching a variant line in 诗句 (「举头望明月」 vs corpus「举头望山月」) still missed. **`pipeline/build-fuzzy.mjs`**
  (`npm run build:fuzzy`) builds a **delete-1 / SymSpell** skeleton index `public/data/linesf/` (**4096** shards,
  disk-staged in `_fztmp` so it doesn't OOM — the in-RAM build did). A same-length 1-substitution shares the (L-1)
  skeleton formed by dropping the differing position. `load.ts::searchByLine` adds a fuzzy fallback (only when EXACT=0,
  Han len 4..10) via `lineSkeletons` (4 unit tests) + `loadFzShard` (`fzBucket` = `hashStr&0xfff`). No-op if `linesf/`
  absent. **⚠ The index is LARGE (~GBs, git-ignored) → fine for LOCAL; a DEPLOY needs a curated/server-side fuzzy.**
  Re-run `npm run build:fuzzy` on a fresh worktree.
- ✅ **Orbit-lock (item 2)** — the camera lock is now an orbit: **closer** default distance (was too far), **drag rotates**
  the locked view (yaw/pitch, does NOT release), **wheel zooms** (distance). Movement keys still release. (`FlyControls`
  `lock` ref + drag/wheel handlers + useFrame spherical orbit.)
- ✅ **Sustained highlight (item 3)** — the selected cluster now holds FULL brightness (`HOLD_FLARE`) for the whole ~10 s
  then weakens (was flash-then-dim) + brighter/larger, so it stays legible against the spread field. (`PoemOrbits`.)
- ✅ **行星指引 / guide lines (item 4)** — `three/PoemGuides.tsx`: selecting a poet emits a 赠诗-style line to EVERY poem
  it wrote, self-rotating with the cloud (same `aCenter`/`aOmega` shader), one-shot ~10 s (grow→hold→fade) then
  auto-deletes (no permanent clutter). Mounted in `App`.

**DONE — round 7 (verified build + 62/62; visual/interaction need a real-GPU pass — no preview):**
- ✅ **Bigger, irregular, SELF-ROTATING clusters** (round-6 was too small/local/uniform/blocky) — `poemSystemRadius`
  ~6× (35+13√P; 杜甫→~555); `poemOffset` = clumpy power-law radius + WIDE jitter + per-poet **ELLIPSOID axes**
  (sphere/ellipse/oblate). Each cloud SELF-ROTATES around its poet (`poemOmega` + shared `poemClock`), mirrored in the
  visual shader, the GPU pick shader (clicks still land), and the time-aware `poemPosition` (locate/flare track it).
- ✅ **10-second highlight regardless of 行星 toggle (item 1)** — selecting a poet ALWAYS flashes its whole cluster in
  (flash→hold→fade ≈10 s) even in 行星-ON mode; selected poet star also ×1.8. (`PoemOrbits` timed highlight layers.)
- ✅ **Camera lock-follow (item 3)** — `store.lockPoetId/lockPoemIdx`; selecting a poet (or planet) centres + follows it
  (time-aware target → tracks galaxy spin + planet orbit; decoration's faster `DECOR_RATE` streams past = motion sense).
  Released by any movement key or a look-drag. Wired from 3D click / 诗人 / 诗句 / 目录. (`FlyControls` useFrame lock block.)
- ✅ **findReal fuzzy (item 4, cheap half)** — same-length ≤2-char (≥85%) near-match → the popular 静夜思「举头望明月」
  (corpus「山月」) is now flagged as 异文. `SearchPanel.nearMatch`.
- **Real-GPU knobs**: `positions.poemSystemRadius` / `poemOffset` (ellipsoid+jitter+power) / `poemOmega` (spin rate);
  `PoemOrbits` highlight `makeLayer(bright/sizeScale/maxPx)` + `HOLD`/`FADE_*`; `FlyControls` lock `dist`/`k`.

### ✅ DONE — mobile / touch + performance (7th agent — verified build + 89 tests; real-device touch is the user's eyeball)
- **Mobile / touch** — `FlyControls` now drives a `pointers`-Map state machine: 1-finger drag = look, **2-finger
  drag = fly, 2-finger pinch = speed/zoom**, tap = pick (reuses the desktop camera math). `canvas{touch-action:none}`
  + `viewport-fit=cover` (dropped `maximum-scale`) + `overscroll-behavior:none` gate it. Pure gesture math +
  mode-lock in `src/three/touchGesture.ts` (unit-tested). See DEVLOG 7th-agent §3.
- **Auto-quality + dpr** — `src/three/detectQuality.ts` (`COARSE`/`WEAK`, module-load) → `store.quality` defaults
  `low` on weak/touch devices, `dpr` caps at 1.5, bloom off, and the 857k-point 行星·全部 layer is gated off on
  weak devices (the manual 画质 toggle still forces high). DEVLOG §1–2.
- **Responsive** — one `@media(max-width:600px)`: bottom-sheet panels, top search tracking a live `--hud-h`,
  wrapped/trimmed HUD, 16px inputs, dvh + safe-area. DEVLOG §4.

### ⏭ Next — deploy (the remaining productization phase)
- **Fuzzy index for DEPLOY (decide FIRST)** — `linesf/` is ~GBs (delete-1 over all lines) — fine locally, too big
  to host. Options: drop it on deploy (it's a fallback; `load.ts` no-ops if absent), build a CURATED set (唐诗三百首 /
  高频名篇), OR ship `linesf/` brotli'd behind a flag. `lines/` 791 MB + `search/` 129 MB + `poems/` 235 MB also need a
  host plan (object storage / CDN — `loadData(base)` + the `load.ts` fetch helpers are already `base`-parameterized,
  ✅ the `VITE_DATA_BASE` knob EXISTS as of round 3 (load.ts `DATA_BASE`, .env.example); watch CORS + that the host honours **Range** on raw `poems/*.json`).
- **Feedback inbox (optional)** — the in-page 反馈 (更多 menu) stores to localStorage = per-device only. If you
  want to actually RECEIVE visitor feedback after deploy, repoint `state/feedback.ts::submitFeedback` at a
  serverless form (Formspree / Google Forms / a Cloudflare Worker) — the only seam to change. Static-friendly.
- **Deploy** — `npm run deploy:build` kit is ready (brotli + Range on `poems/*.json` kept RAW); pick a host that honours
  byte ranges (nginx/Caddy/Cloudflare Pages+R2 over GH-Pages/Netlify). Decide the fuzzy strategy first.

### ⏭ Also worth a focused follow-up (deferred from the 7th-agent perf round, all low-risk)
- ✅ **DONE (9th agent, round 3)** — `FlyControls` `useFrame` allocation hoist: all per-frame `new THREE.*` on the
  lock/flyTarget/WASD hot paths hoisted to module-level temps (math/order byte-identical; lock & flyTarget blocks
  are mutually exclusive so they share the temps safely).
- **`prefers-reduced-motion`** on the perpetual galaxy spin (battery/a11y) + optional `frameloop="demand"`.
- **`webglcontextlost`/`restored`** (iOS drops the GL context on backgrounding → black galaxy on return) — needs a
  real device to reproduce + a forced rebuild-key.
- **No dedicated vertical-touch gesture** — climbing out of the disc works via pitch-up + forward-thrust (thrust is
  camera-space), but there's no straight up/down touch control. Add a 3rd-finger axis or HUD up/down if wanted.

**DONE — UX iteration round 5 (verified: build + 57/57 + DOM mount; centre confirmed 够散/漂亮 by the user on a real GPU):**
- ✅ **造诗 placeholder simplified** — the long hint clipped in the 320px panel; placeholder is now 「粘贴整首诗…」 and the
  拼音/标点 detail moved to the (wrapping) dim helper line so no info is lost. (`SearchPanel`.)
- ✅ **Centre cross dissolved HARDER (rounds 3–4 were still "太保守")** — `poetPosition` centreBlur range 0.42→0.5 and
  coreScat 0.15→**0.22** (range 0.4→0.5): the bright POET cross (poets are the ×2.3 stars → the dominant shape) fills into
  a round disc. Galaxy backdrop disk also gets full azimuthal randomisation + absolute in-plane core scatter + a
  noise-floor lift toward the core (kills the inter-arm dark wedges); BULGE 42k→**64k**, wider (cap 0.34R→0.42R), modest
  brightness-floor lift. *(Knobs: `PoetStars.tsx` coreScat `0.22` + centreBlur `0.5`; `Galaxy.tsx` disk `cb`/`coreFill` + BULGE.)*
- ✅ **Fixed dev port** — `vite.config` `server.port:5199 strictPort` so a sibling worktree's stale server can't silently
  shadow the preview (`.claude/launch.json` already has shiyun-gpupick on 5199).

### ✅ FIXED — 诗句 search + real-poem detection were DEAD (missing `lines/`)
`public/data/lines/` (the all-lines content-search index, ~791 MB, git-ignored) was ABSENT, so
`searchByLine` returned nothing → the 诗句 tab showed no real hits AND `findReal` (compose "this is a
real poem" detector) silently failed; a 诗句 search of a real poem could then only offer the void
"半编号" button, so the SAME poem landed in the void via search but on a planet via the directory.
**Fix:** `pipeline/build-lines.mjs` (`npm run build:lines`) rebuilds `lines/` from the existing
`poems/*.json` (no corpus; same key/bucket/ref format as `build-data.mjs`; per-line cap now keeps the
most-prolific author so 床前明月光 always retains 李白《静夜思》). Built: 256 buckets / 9.18 M refs.
Verified: 诗句 床前明月光 → 李白《静夜思》 top hit → flies to the **planet** (same spot the 目录 uses, so the
double-location is gone); findReal flags the corpus-exact 静夜思. *(Note: the corpus stores 「举头望**山**月」,
so the popular 「举头望明月」 won't exact-match findReal — correct, not a bug.)* **Re-run on fresh worktrees.**

### ✅ FIXED — Range egress was DORMANT, now LIVE
`manifest.poemSidecar:true` but `public/data/poems/*.idx.json` sidecars were **ABSENT** (the committed data predated the
sidecar pass), so `loadPoetPoems` fell through to a whole-bucket (~0.9 MB) fetch on **every** poet click. **Fix:**
`pipeline/build-sidecars.mjs` (`npm run build:sidecars`) re-emits each `poems/{bucket}.json` canonically + its byte-offset
sidecar in one pass (same logic as `build-data.mjs::writeBucket`; no corpus needed, ~seconds). Verified live on 5199:
`/data/poems/00.idx.json` is JSON; a poet Range-fetch → `206 content-range: bytes 12-9787/890706` (9.7 KB of 890 KB,
≈98.9% egress saved), slice parses to that poet's poems. Sidecars are git-ignored data, so **re-run `npm run build:sidecars`
on any fresh worktree** (or it falls back to whole-bucket). This is the prerequisite for the orbiting-poems "cheap per-poet" path.

**DONE — UX iteration round 4 (verified: build + 57/57 + e2e DOM, GPU-pick after a clean restart):**
- ✅ **造诗 grid input fixed (was the big bug)** — the fixed-form grid was per-cell `<input maxLength=2>`
  that kept only the last char → IME (拼音) and multi-char paste were impossible. Now ONE normal input
  drives the grid; it keeps only 汉字 (`hanChars`, drops pinyin/标点/latin) and the grid cells are
  read-only DISPLAY divs. Paste 「床前明月光,疑是地上霜,举头望ab明月…」 → grid fills 床前明月光…故乡,
  81-位 编号. (`SearchPanel`.)
- ✅ **自由 punctuation filter** — 自由 now splits on newlines OR 标点/空白 and keeps only 汉字, so pasting
  「轻轻的我走了,正如我轻轻的来,…」 (commas, no Enter) splits into clean lines. ("只识别文字本身".)
- ✅ **Centre dissolved further** — `poetPosition` adds a strong ABSOLUTE in-plane x/z scatter that peaks
  at the core and fades by t≈0.4 (on top of the round-3 azimuthal `centerBlur`), so the centre reads as a
  diffuse round cloud, not a concentrated shape. *(Tune `coreScat` 0.15 on a real GPU.)*
- ✅ **PoetPanel rows no longer fold** — `.pi-row` is a `<div>` (was a `<button>` nesting the copy
  `<button>` — invalid HTML, caused the fold); long titles wrap in a `flex:1; min-width:0` column while the
  form badge + 复制编号 stay `flex:none; white-space:nowrap` (the button was wrapping to two lines).
- ✅ **Search panel docked LEFT** (`top:64px; left:20px`) so it never covers the centre crosshair / 定位.

**DONE — UX iteration round 3 (verified: build + 57/57 + e2e DOM, GPU-pick 6/6 after a clean restart):**
- ✅ **Round centre (less obvious shape)** — the bright central CROSS was the POET stars: near the core the
  4 spiral arms converge into an X. `poetPosition` now spreads poets fully azimuthally near the centre
  (`centerBlur`, strong at the core → 0 by t≈0.42) so the core reads as a ROUND bulge blended into the
  diffuse galaxy haze (= the visual-fusion ask). Arms stay intact further out. *(Tune on a real GPU.)*
- ✅ **Filter tabs no longer wrap** — `.stab` is `flex:1; white-space:nowrap`; panel 280→320px (造诗/朝代
  were breaking to two lines).
- ✅ **朝代 全部 is a toggle** — when all dynasties are shown the button reads **全不选** (deselect all);
  when some are hidden it reads **全部** (show all). (`SearchPanel`, `showOnly([])` hides all.)
- ✅ **造诗 自由 example** = 再别康桥's opening 5 lines (was an English/Claude example).
- ✅ **造诗 grid feedback** — a cell whose char is outside the 字库 turns red (`inCharset` → `.cell.bad`),
  so you see WHY the 编号 isn't computing.
- ✅ **诗人 search ignores digit/latin queries** — typing "1"/"2" used to surface the corpus's same-name
  disambiguation suffixes (张生1/张生2 …, only 13 such names + one junk "666"); now a non-Han query returns
  nothing. (`load.ts::searchPoets`; the names are a corpus artifact, left as-is — they ARE distinct poets.)
- ✅ **隐藏界面 moved into the HUD top bar** (was overlapping the bottom speed readout). Still + the H hotkey.
- ✅ **First-run onboarding** (`ui/Onboarding.tsx`) — a 3-step skippable guide, shown ONCE per browser
  (`localStorage shiyun_onboarded_v1`; clearing site data shows it again). Pure client-side.
- ✅ **Deploy kit** (`deploy/nginx.conf` + `deploy/precompress.mjs` + [docs/DEPLOY.md](docs/DEPLOY.md),
  `npm run deploy:build`) — static host, brotli/gzip for assets but **poems/*.json served RAW** so the
  per-poet HTTP Range slice stays valid (the one deploy gotcha). lines/ compress normally.
- ✅ **Compose round-trip tests** — `engineApi.test.ts` (4): grid `textBabelIndex`→`pullByIndex` and 自由
  `anyTextIndex`→`pullByIndex("ziyou")` reproduce the exact poem; `inCharset`; rejects wrong-length input.
- **CONSULTED, not built:** mobile/touch (PM4 — feasible, deferred to next agent; see notes); narrative
  guided-tours (PM5 — dropped, too much copywriting); same-pass poet/decoration draw (dev — the visual
  fusion goal is met by `centerBlur`; the literal single-draw merge stays optional). 内嵌 share-card +
  find-real "奇迹时刻" (PM2/PM3 — approved, not yet built).

**DONE — UX iteration round 2 (verified: build + 53/53 + e2e DOM):**
- ✅ **造诗 (compose) tab** — the intuitive forward direction: pick a form → for 五/七绝/律 a **fill-in
  grid** of single-char cells, for **自由** a textarea (回车换行), and the engine reports the catalog
  编号 as you type (`textBabelIndex` / `anyTextIndex`) — no number-guessing. A `填字→编号 / 凭编号→诗`
  toggle keeps the old reverse lookup. It even flags when your poem is a REAL corpus poem (`findReal`).
  e2e: 静夜思 grid → 81-位 全集编号; `你/我/爱世界/…` → `你，我，爱世界，…。` + 102-位 自由编号.
- ✅ **Enter to act** — 诗句 / 诗人 inputs fly to / open the top hit on Enter.
- ✅ **UI consolidation + screenshot mode** — the floating dynasty legend is gone; it's now the **朝代
  tab** inside the one search panel (collapsible via ▴/▾). A corner **隐藏界面** button + the **H** hotkey
  hide ALL overlay UI for clean screenshots (`store.uiHidden`, `App` keydown). 
- ✅ **PoetPanel = title drawer / accordion** — shows poem **titles** only (50/page, 显示更多), each with a
  lazy **复制编号**; click a title to expand its content + full 编号. The (large-BigInt) 编号 is computed
  **lazily per poem** (`idxCache` ref) on expand/copy — not for the whole list. Much lighter + cleaner.
- ✅ **Diffuse galaxy core** — the central bulge is now a wider, jittered, noise-clumped, **softer/dimmer**
  particle cloud (+ a stronger smooth halo) so the centre reads as blurred, disordered white haze (real-
  galaxy core) instead of a regular dot-ball; the ORDERED poet/arm layer outside carries the map's logic.
  `Galaxy.tsx` bulge params — *tune on a real GPU.*
- ✅ **Void-pull marker is findable** — a fresh pull now **flashes large + bright** (like a nearby
  decoration star) the instant you click, then shrinks/dims to the quiet marker (`PulledStars` `aFlare`
  size-flare + brighter birth); 定位虚空 reuses it. The misleading centre **crosshair sprite was removed**
  (it conflicted with the real cursor — picking is at the cursor, not screen centre).

**DONE — GPU-pick + Range-fetch session (verified: build + 53/53 + e2e DOM on a real GPU):**
- ✅ **GPU colour-ID picking (#0, top priority)** — `three/gpuPick.ts`. Each poet's index is colour-encoded
  into an `aPickColor` vertex attribute (shared on the PoetStars geometry, so the dynasty-filter aSize
  writes exclude hidden poets from picks for free). On a hover/click the picker renders ONLY an n×n window
  of the poet field around the cursor (`camera.setViewOffset`) into a tiny offscreen RT, reads the pixels
  back, and decodes the nearest-to-centre non-background pixel → the poet in **O(1)**. Replaced the
  O(29,808)/hover CPU scan + apparent-size heuristic in `FlyControls.screenPick` (now a one-liner calling
  `pickTargets.pick`). A vertex-shader gate (`sz < uGate`, == the old apparent≥2.2 CSS-px gate) keeps the
  void between stars pull-able; depthTest keeps the front-most star per pixel. **Clickability is now
  decoupled from brightness**, so the decoration can be brightened toward true fusion without breaking
  clicks (the next visual step — see below). Pure helpers (`encodePickColor`/`nearestPoetIndex`) have 6
  vitest cases; a DEV-only `window.__shiyunPickTest(i)` round-trips a projected poet through the GPU path
  (verified 10/10 on a real GPU: 陆游/王世贞/屈大均/刘克庄…).
- ✅ **Per-poet Range fetch (#12, egress)** — `pipeline/build-data.mjs` now writes each `poems/{bucket}.json`
  as ONE valid JSON object PLUS a byte-offset sidecar `poems/{bucket}.idx.json` (`{id:[off,len]}`, built in
  the same pass so offsets always match the bytes). `load.ts::loadPoetPoems` HTTP **Range**-fetches just the
  poet's slice (the slice is itself valid JSON → `JSON.parse` directly), caching per-poet. Falls back to the
  whole bucket when the sidecar is absent (old data) or the host returns 200 not 206. `manifest.poemSidecar`
  gates the attempt. Verified on the vite dev server: `206`, `content-range: bytes 72297-1230612/2068787`
  for 苏轼, slice parsed to all 3596 poems (≈44–99% egress saved depending on the poet's share of its bucket).
- ✅ **Cleanups** — deleted the orphan `engineApi.anyTextReverse` (编号反查·自由 uses `pullByIndex("ziyou",…)`);
  `PoetPanel` now memoizes its rows + the (large-BigInt) 全集/自由编号 in a `useMemo` keyed on `[poems, focus]`
  so a long-新诗 `anyTextIndex` (O(n²) rank) runs once per poet load, not every render.

**DONE — 自由-merge / gravity-differential session (verified: build + 47/47 + e2e DOM):**
- ✅ **自由 ≡ ONE arbitrary-length catalog** — merged the former fixed-28 自由 AND 任意长 into a
  single bijective base-(N+1) catalog over (字库 ∪ line-break) (`engine.anyRank/anyUnrank`). It now
  backs 自由 generation (词-like via M+W sampling, breaks collapsed to the unified break so it
  round-trips), 编号反查·自由 (any number → a poem; always in-range), 新诗/古体 自由编号 (PoetPanel),
  and permalinks. The separate 任意长 UI is gone. e2e verified: 徐志摩《雪花的快乐》→ 764-digit
  自由编号 → 编号反查·自由 → EXACT same poem. (`engineApi` ziyou paths; `freeRank/freeUnrank/...`
  stay in `engine.ts` + tests but are no longer used by the app.)
- ✅ **Backdrop differential + gravity illusion** — `galaxySpin.decorAngle` (DECOR_RATE 0.019)
  turns the backdrop FASTER than the poet layer (`angle`, SPIN_RATE 0.012). With 引力 ON the camera
  co-rotates with the POETS (frozen → clickable) while the diffuse haze keeps flowing past → the
  galaxy still looks like it's spinning (no rigid freeze). Also a gentle differential when 引力 OFF.

**DONE — fusion / gravity / 任意长编号 session (verified: build + 47/47 + DOM):**
- ✅ **Star fusion** — the backdrop is now mostly diffuse haze (DUST 90k→120k) with few, dim,
  small decoration STARS (34k→9k); poets brightened (×1.9→×2.3). The bright DISCRETE points you
  fly past are predominantly clickable poets, not "invalid" decoration. `Galaxy.tsx`. *(Still
  tunable — if it reads too sparse, raise STARS / DUST.)*
- ✅ **No more wall** — `poetPosition` adds in-plane x/z scatter (pow 2.2 × 0.22·r). `PoetStars.tsx`.
- ✅ **Heavier galaxy** — bloom 0.85→1.4 (intensity) + radius 0.85 (`App.tsx`); `GALAXY.THICKNESS`
  0.07→0.11 (less razor-flat). *(Tradeoff: rotation is rigid/uniform — restoring differential spin
  would re-introduce the layer mismatch; left rigid on purpose. Tune THICKNESS/bloom on a real GPU.)*
- ✅ **引力 (gravity) toggle** (default ON) — inside the galaxy sphere (<1.15·R) FlyControls orbits
  the camera WITH the spin (same Δ/frame) + turns the heading, so stars hold still on screen and
  stay clickable. `store.gravity`, HUD 引力, `FlyControls`. Outside → watch it turn.
- ✅ **任意长编号** — `engine.anyRank/anyUnrank`: a bijective base-(N+1) numeration over (字库 ∪
  {line-break}) gives EVERY variable-length poem (新诗/古体) a reversible 全集编号 (they had none).
  `engineApi.anyTextIndex` (reverse via `pullByIndex("ziyou",…)`); PoetPanel shows a 诗云编号 for `other`
  poems; 编号反查 has a **任意长/自由** mode. +3 tests. *(The standalone `anyTextReverse` was later deleted
  as an orphan — `pullByIndex` covers reverse.)*
- ✅ **Long lines wrap** — 自由/词/任意长 poems wrap (`.poem-line.wrap`) instead of clipping.

**DONE — rotation-merge + locate session (verified: build + 44/44 + DOM):**
- ✅ **One unified galaxy spin** (`galaxyParams.galaxySpin` + `advanceSpin`/`spinXZ`/`unspinXZ`).
  The backdrop used to spin in its own shader (with an x/z reflection) while poets/arcs/markers
  never rotated → layers wound against each other. Now Galaxy points, the PoetStars group, the
  赠诗 `GiftLines` object, and the void markers ALL rotate by one shared `rotation.y`, advanced
  once/frame in Galaxy. CPU side (`screenPick`, fly-to, void-click) converts LOCAL↔WORLD with
  `spinXZ`/`unspinXZ`, so picking/labels/markers stay aligned as it turns.
- ✅ **Void click no longer moves the camera** (removed the inaccurate glide-focus); the marker
  gets a **bright birth flare → hold → linear settle** to a quiet base, kept SMALL (brightness,
  not size — bloom does the glow). `PulledStars.tsx`.
- ✅ **定位虚空 (fixed-coordinate locate)** — 编号反查 + 半编号 get a "🛸 定位虚空" button that flies
  to the index's ONE canonical void point (`engineApi.pulledFromIndex → pointForBabelIndex`) and
  lights the star with the flare marker. A number / opening is now a *place*. `SearchPanel.tsx`.
- ✅ **Pick perf** — hoisted `cos/sin` out of the 29,808-poet `screenPick` loop (was a per-poet
  `spinXZ` → 29k×2 trig per hover). `FlyControls.tsx`.

**DONE — galaxy/features session** (all verified — `npm run build` + 44/44 tests + browser DOM checks):
1. ✅ **Galaxy realism** — Gaussian point falloff `exp(-4.5d²)` (continuous nebulosity, not
   dots); ~166k particles in 3 populations (DUST + arm STARS + a dense particle **BULGE**
   replacing the old hard glow-sprite → smooth core); exponential-disk radius, value-noise
   clumping + dust gaps, HII knots, warm-core→blue-arm colour; `UnrealBloom` via
   `@react-three/postprocessing` v2.19 (**new dep**). `src/three/Galaxy.tsx`.
2. ✅ **Quality toggle** — HUD 画质·高/低 (`store.quality`); 低 halves galaxy counts
   (~166k→~59k) and disables bloom (`App.tsx`). For weak GPUs.
3. ✅ **Poets woven into the arms** — `PoetStars.tsx poetPosition`: gaussian radial spread
   blends dynasty colours; `armDev ×0.45` concentrates poets onto the **same 4 spiral arms** as
   the backdrop (colour = gradient ALONG arms, not concentric rings); gaussian Y-thickness swells
   toward centre. **Famous poets** (`src/data/famousPoets.ts`, now incl. modern) → 2.4× size +
   gilded-glow landmarks.
4. ✅ **Void-pull markers** (`PulledStars.tsx`, full rewrite) — small twinkling captured-light
   spots (not giant balls); lifecycle fade-in, cap 20 ALIVE (oldest flickers out + self-destructs),
   distance-cull. `store.Pull` has an id; `MAX_PULLS=24`. *(Later session: the void-click
   glide-focus was REMOVED — clicking the void now lights the star in place without a camera move;
   markers gained the birth flare. See the rotation-merge block above.)*
5. ✅ **赠诗 arcs** (`GiftLines.tsx`) — cubic Bézier, control points pulled toward centre →
   **bundled flows** (poor-man's hierarchical edge bundling, `BUNDLE=0.3`); a custom shader sends
   a soft pulse giver→receiver (flow direction); endpoint-faded; ambient = weight≥3, selecting a
   poet draws a clean ego-network.
6. ✅ **编号反查 reverse search** (3rd search tab) — `engineApi.pullByIndex(form, indexStr)` unranks
   a number back to its poem; full untruncated numbers everywhere + copy buttons
   (`src/ui/CopyButton.tsx`); loop closure: checks the line index + full text and reports if the
   number is a **real** poem.
7. ✅ **Permalinks** (`src/state/permalink.ts`) — `#a=<poetId>` / `#p=<form>.<index>`; 🔗 分享
   buttons in the poem + poet panels; `engineApi.pulledFromIndex` rebuilds a poem from a link; App
   restores on load.
8. ✅ **Product-grade poem UI** — `--serif` (楷/宋 stack) for poem text; gradient cards + gold accent.
9. ✅ **Any-line content search** — pipeline now indexes **EVERY** line (not just openings) →
   `public/data/lines/{bucket}.json` (256 shards, ~791 MB, git-ignored — renamed from
   `firstline/`). 疑是地上霜 → 李白《静夜思》 (a non-first line) now works; `load.ts` reads `lines/`.
10. ✅ **Modern 新诗 poets** — imported yuxqiu/modern-poetry (Apache-2.0, `C:/corpus/modern-poetry`):
    +4,494 free-verse poems / +508 poets (徐志摩, 海子, 北岛, 顾城, 戴望舒…). Free verse → form
    `other`; 民国→近现代 else 当代; their lines are searchable.
11. ✅ **字号 alias table** expanded to ~250 entries (~120 poets) in `build-data.mjs GIFT_ALIAS` →
    4,849 赠诗 edges (少陵→杜甫, 子瞻→苏轼, 香山→白居易…).

**Still TODO (recommended order for the NEXT agent):**
1. **True visual fusion (now UNBLOCKED by GPU picking)** — picking no longer depends on poets being the
   brightest discrete points, so the decoration brightness-juggling in `Galaxy`/`PoetStars` (DUST 120k /
   dim STARS 9k / poets ×2.3) can be rebalanced so poets sit in / among the decoration and the cloud reads
   as one continuous field. *Must be tuned on a real GPU* (headless can't screenshot the additive galaxy).
   Optional next step: draw poets in the SAME pass as the decoration (the pick buffer keeps them clickable).
   Start by raising `Galaxy` STARS/brightness and lowering the poet `×2.3` until the seam disappears.
2. **Deploy** — static build → `shiyun.<domain>` subdomain, nginx `brotli_static`, precompress assets.
   See DATA_CONTRACT.md §deploy notes. **Range matters here**: the per-poet fetch needs the host to honour
   byte ranges on `poems/*.json` (nginx/most static CDNs do; `brotli_static` serving a `.br` still supports
   ranges on the precompressed file). No backend.
3. **Polish** — thicker 赠诗 lines (`Line2`/`meshline` — current arcs are 1px, WebGL `lineWidth` cap);
   无名氏 collapse; modern-poet **dynasty refinement** (date table to split 近现代/当代 more finely than
   民国-only); pre-compute the per-bucket `poems/*.idx.json` into a single sidecar if 256 tiny fetches add up.
4. **True round-trip void coords** — `pullAt` (click→`indexFromPoint`) and the locate/permalink map
    (`pointForBabelIndex`) are NOT inverses, so clicking a located poem's exact spot won't reproduce
    it. A clean bijection over continuous space ↔ a 10⁸²-index catalog is impossible at float
    precision; either accept it (clicks = local noise sampling; locate = the canonical address) or
    document it in-UI. Not a bug — a design choice to make explicit.

### Residual watch items (low priority)
- **装饰差速莫尔条纹** — the backdrop turns FASTER than the poet layer (`DECOR_RATE 0.019` vs
  `SPIN_RATE 0.012`, `galaxyParams.ts`). It's a deliberate "still spinning" cue and reads as nebula flow
  because the backdrop is dim haze. If a real GPU ever shows ghosting / a second arm set, lower
  `DECOR_RATE` toward `SPIN_RATE`. (GPU picking already keeps poets clickable regardless of this drift.)
- **256 sidecar fetches** — the Range path fetches one `poems/{b}.idx.json` per visited bucket (cached).
  Negligible in practice; collapse into a single index if it ever matters (see TODO 3).

### Locked decisions (don't relitigate without reason)
- **Default = random (Babel) generation; no further self-built 平仄 research** — the 格律
  product engine + the charlesix59 平水韵 data cover it. "Good poems" = real-corpus search;
  neural generation needs a backend (conflicts with static) — deferred.
- **Simplified** is canonical (corpus = index = search script; no OpenCC at runtime).
- **Index convention: first char = most-significant digit.**
- **Filters compose inside one Babel catalog**; the displayed 全集编号 is always the full-catalog
  address.
- **全集编号 is now the UNIVERSAL `anyRank` (one unique number per poem)** — RESOLVED 2026-06-09 (was: each
  诗体 a separate overlapping catalog → the same number meant a different poem per form). The displayed 编号
  everywhere (探诗 填字/凭编号, 目录, 虚空诗, permalink) = `anyRank` over (chars + line-breaks). A fixed-form
  poem and its 自由 twin are the SAME symbol run → the SAME number, so reverse is unambiguous AND duplicates
  are impossible by construction. `pullByIndex` is form-agnostic (infers 诗体 from structure). The per-form
  babelRank/格律 catalogs remain ONLY for the void-pull's spatial scatter + the 格律 mode — NOT displayed.
  半编号 = `anyRank(opening)`, still a true high-order prefix of the full number. (DEVLOG round 9.)
