# 诗云 / Poetry Cloud — 开发日志 (DEVLOG)

Chronological, newest first. Each entry: commits + what changed + how it was verified. The per-area
"what works" matrix lives in [HANDOFF.md](../HANDOFF.md); this file is the running diary.

Verify gate every entry: `npm run build` (tsc + vite) + `npm test`. **The 3D scene cannot be verified
on the headless preview** (swiftshader: the additive galaxy times out / the r3f Canvas subtree stays
dormant), so all visual/interaction work is build+test-verified here and eyeballed by the user on a
real GPU. Data dirs (`poems/`, `lines/`) are git-ignored — see HANDOFF "data provisioning".

---

## 2026-06-10 — Session: 9th agent · round 3 (五视角评审 Top-8 加固)

A 5-lens read-only review (架构/运行时性能/加载网络/产品UX/数据管线运维, 5 Opus reviewers) produced a
prioritized list; the owner green-lit the Top 8. Executed as 3 conflict-isolated Opus batches (A 正确性+CI /
C 前端 / B 数据运维), orchestrator re-ran the combined gate: tsc · **172 tests** (was 138, +34) · build
(three 675.5 KB chunk intact). Commit `ddfdeaa`. 其余评审发现(P2/P3)暂不做,见会话记录。

**批次 A — 正确性防线 + CI**
- `shardHash.contract.test.ts` NEW(12):FNV-1a 分桶哈希是管线 3 处 fnv32 + 前端 hashStr 的隐形契约,
  漂移=搜索静默全空。7 组黄金值冻结 hashStr + 源码扫描绊线钉死 build-search/lines/fuzzy 的两个常量。
- `charsetHash.ts` NEW + 运行时校验:loadData 由实际 chars 重算 FNV-1a,与文件自带 hash 及冻结常量
  `EXPECTED_CHARSET_HASH=a392703b`(实测主目录 charset.json 验证)双向比对;数据↔代码错配(错部署/CDN
  串味/`*_v1_backup` 混淆)从「每个编号永久链静默错位」变成响亮报错 + App 顶部可关闭横幅
  「数据与本版本不匹配:编号链接可能错位」(仅警告不阻断,截图模式隐藏)。+7 测试。
- `.github/workflows/ci.yml` NEW:push(main/claude/**)+PR → ubuntu·node24·npm 缓存 → ci/build/test;
  重数据无依赖(测试全为纯函数/自带 fixture)。九任 agent 的手跑验证门从此机器化。
- 清理 PoemOrbits/engine 三处无 eslint 可依的失效 disable 注释。

**批次 C — FlyControls 零分配 + 拾遗**
- FlyControls useFrame 三条热路径(锁定/飞向/WASD)每帧 ~10 个 THREE 对象分配全部上提为模块级临时量
  (§6 挂账清掉);锁定与飞向两块因各自提前 return 互斥而安全复用同组临时量,数学与求值顺序逐字不变。
- **拾遗** NEW:虚空诗不可复现、失之永逝,现可一键收存。纯模块 `state/shiyi.ts`(localStorage
  `shiyun_shiyi_v1`,以全集编号去重、最新置顶、上限 200、容损坏 JSON,+15 测试);PoemPanel 分享/留影旁
  「收进拾遗/已在拾遗 ✓」;更多菜单「拾遗 — 我捞起的诗」面板,行点击经 `pulledFromIndex` 重建+飞回
  (复刻 permalink `#p=` 还原路径),逐行删除 +「仅存于此浏览器」脚注。独立 zustand 切片,刻意置于
  跨域重置纪律之外。本轮仅虚空诗(真实诗经诗人可再寻,扩展应改存 poetId+poemIdx,已注明)。

**批次 B — 数据运维**
- `pipeline/pack-data.mjs` NEW + `npm run pack:data`:冷备打包从手工 tar/校验/传 201 资产收敛为一条命令
  (流式 SHA-256、缺目录告警不崩、打印 gh release 命令);微型 fixture 全 round-trip 验证;顺手修掉
  GNU tar 把 `C:\…` 绝对路径误判为远程 host:path 的真实坑(改相对 -f,bsdtar/GNU 通吃)。
- `VITE_DATA_BASE` 旋钮落地(§6 挂账):load.ts 六个 fetch 助手默认参数统一指 `DATA_BASE`(默认 /data,
  不设零变化);vite-env.d.ts/.env.example 补齐;grep 确认 src 无其它 /data 直连。
- 版本化数据缓存铺路:nginx.conf 注释版两条同级 `^~ /data/v2/` location(poems 子块照搬 RAW+Range 规则,
  immutable 一年),默认仍 /data 86400;DEPLOY §2.1 说明开启时机与三项验证 curl。

---

## 2026-06-10 — Session: 9th agent · round 2 (留影直达 + 改名)

Owner report: 搜索诗人后,目录里无法对某一首诗单独开分享卡,只能绕道编号反查;并要求改名 奇迹时刻→留影.
Root cause: Cinema 取诗只认 虚空 `selected` 或 `focus.poemIdx`(后者只有行星点击/诗句命中才设),
目录的"展开"是 PoetPanel 本地状态,Cinema 看不见 —— 面板按钮旧提示「展开一首诗后可框住那首」名不副实。
Opus 4.8 执行,orchestrator 复核门禁:tsc · **138 tests**(+15)· build。Commit `b3d32ba`.

- **留影目录直框**(`store.ts` + `Cinema.tsx` + `PoetPanel.tsx`):诗人目录每一行新增「留影」按钮(与
  定位/复制编号 并排,传原始索引 `i`,与定位同源,排序不影响),点一下即把那首框成分享卡。
- **显式留影目标**(`store.cinemaPoemIdx` + `openCinemaFor`):优先级高于虚空 `selected` 与搜索 `focus`;
  关闭留影 / 换诗人 / 虚空捞诗 / 清空 都复位,绝不残留上一首。`selected`/`selectedPoet` 在 store 里本就
  互斥(双向确认),显式分支放最前是防御性设计。
- **解析抽纯函数**(`ui/cinemaResolve.ts` NEW):`resolveCinemaPoem` 把「显式 idx > 虚空 > 搜的这首」三级
  优先级独立出来,注入 indexer → 无 Canvas、无数据集可单测。
- **奇迹时刻 → 留影**:用户可见文案全部改名(诗人/虚空面板按钮、退出标题、面板按钮提示改为实情:
  「留影当前搜中的那首;目录里每一行也有单独的留影」);代码标识(`cinema*`/`.cinema-btn`)与历史
  DEVLOG/HANDOFF 条目不动。README/index.html 无出现(grep 验证)。
- 样式:`.pi-cinema` 行内按钮(金色点缀,随 `.pi-locate` 尺寸),并入 coarse-pointer ≥40px 触控规则。
- 测试 +15(123→**138**):openCinemaFor / 关闭复位 / 换诗人清空 / 互斥 / 解析优先级 / 越界与 idx=0。

---

## 2026-06-10 — Session: 9th agent (orchestrated — vite 8 升级 · 动态 OG 分享卡 · 数据 v3 调研 NO-GO)

Orchestrator-only main loop (fable-5); all execution delegated to Opus 4.8 sub-agents (成本嘱咐).
Verify gate independently re-run by the orchestrator on the combined tree: tsc · **123 tests** (was 93,
+30 new) · build · deploy:build. Commits `f723db8` (vite 8) + `85cac49` (OG) + this docs commit.

**1 — 依赖升级 P2 清账:vite 8 / vitest 4 / plugin-react 6** (`f723db8`)
- 清掉全部 5 个安装期 npm-audit 漏洞(1 critical:vitest-UI 任意文件读取 + 4 moderate:esbuild/vite
  dev-server),全在 vite≤6 dev 链上(round-5 P2 暂缓项)。生产依赖一字未动(react 18 / three 0.169 /
  fiber 8 / drei 9 / zustand 5 / postprocessing 2.19)。`npm audit` → **0**;依赖树 182→139 包。
- **Rollup→Rolldown 迁移**:vite 8 弃用对象式 `manualChunks`,且会把"唯一引用方"chunk 合并(three+r3f
  塌成 ~950 KB 触发 700 KB 警告)。改用 `rolldownOptions.output.codeSplitting.groups` + `priority`
  (three=2 / r3f=1)→ 恢复 vite-5 同款三段切分(three 675.5 KB / r3f 276.9 KB / index 181.7 KB),无警告。
- **tsconfig `types` 补 `"node"`**:vite 8 的 `vite/client` 不再间接引用 `@types/node`,`*.test.ts` 里
  `node:fs`/`node:url` 报 TS2307。
- **测试零改动**:vitest 2→4,6 个既有测试文件只用 `describe/it/expect/beforeAll` —— 93/93 未改一行。
- 保留项全部验证:5199 strictPort、`__OG_ORIGIN__` 构建期替换(built dist 0 残留)、chunk 警告限额注释、
  precompress(容忍轻量 data 目录)。冒烟走 5198 端口(不碰用户在看的 5199,未用 preview MCP)。

**2 — 动态 OG 分享卡** (`85cac49`, `permalink.ts` + `deploy/og-inject.mjs` NEW + `feedback-server.mjs` + nginx + DEPLOY §6)
- **问题**:分享链接是纯 hash(`#a=`/`#p=`),爬虫看不见 fragment → 每条分享都预览同一张通用 og.jpg。
- **Query 镜像**:`permalink.ts` 把目标镜像进 query(`/?a=…#a=…`),hash 仍是权威还原机制;boot 时无 hash
  则回退读 query;清空选择剥离 a/p 但保留无关参数(utm…);旧纯 hash 链接逐字节兼容。纯函数
  `buildShareUrl`/`parseTarget` 抽出 + 13 单测。
- **服务端注入(可选,零依赖)**:复用唯一后端 `feedback-server.mjs` —— 设 `SITE_ROOT` 后 `GET /?a=/?p=`
  返回按目标改写 og/twitter 标题+描述的 index.html(诗人卡:「李白 — 诗云 · Poetry Cloud / 唐 · 1107 首 ·
  在三维诗云星图中漫游他的星团」;`?p=` 服务端无法 unrank(引擎在客户端 BigInt)→ 通用卡 + 编号截断)。
  index.html + poets.index.json 启动时一次载入,绝无逐请求 I/O;`Cache-Control: public, max-age=3600`。
  **不设 `SITE_ROOT` → 路由照旧 404,`/api/feedback` 字节不变;不部署/不改 nginx → 纯静态行为与今天完全一致。**
- **安全(round-6 教训延续)**:注入值全 HTML 转义(敌意名 fixture 验证);query 先封顶(诗人 id≤64 hex、
  编号≤4000 位)再查表;锚定正则只改写已知 meta 的 content,绝不回显输入;Host-DoS 仍 400 不崩(冒烟复测)。
- **nginx**:`location = /` 仅当 `$arg_a`/`$arg_p` 存在时反代 127.0.0.1:8787(if-safe proxy_pass),否则静态。
  DEPLOY 新 §6:systemd `Environment=SITE_ROOT=…`、og-inject.mjs 一并拷贝、nginx 片段、验证 curl。
- 测试:og-inject 纯函数单测 + 1 spawn 冒烟(随机端口 + tmp SITE_ROOT:注入 200 / Host-DoS 400 /
  反馈 POST 仍可用)。合计 **123 全绿**。

**3 — 数据 v3(当代诗人扩充)调研 → NO-GO**(只读调研,无代码变更;详见 DATA_AUDIT.md 补记)
- 当代/现代语料源已饱和:所有可寻候选都追溯到 v2 已吃下的上游(sheepzh / yuxqiu / poemwiki)。
- 唯一更大候选 HF `Iess/chinese_modern_poetry` 是 sheepzh 二次抓取重塑的 LLM 训练对,**无作者字段** →
  挂不上"每诗人一颗星"模型,去重后净增≈0,字库跳过率预计更高(3–6%),版权暴露更差。
- 收益≈0(当代名家 v2 已全在)vs 成本(数小时重建 + main 镜像 + ~201 资产冷备重传)→ **维持 v2**。

---

## 2026-06-10 — Session: 8th agent · round 6 (adversarial review of round 5 — fixes)

A multi-agent adversarial review of round 5's commit (2508b5a) ran in the cloud; it surfaced a critical
DoS + a real data regression I'd introduced. All confirmed findings fixed + verified (commit `faf11f9`).

- **CRITICAL — feedback-server unauth DoS:** a malformed `Host: a b` header made `new URL` throw in the
  async handler → unhandled rejection → process exit (one-line crash, reproduced). Guarded the URL parse
  (400) + wrapped the whole handler in try/catch. Re-smoke-tested: Host-DoS → 400 + server alive.
- **SECURITY — feedback-server token:** moved the owner-inbox token from the query string (leaks to nginx
  access logs) to `Authorization: Bearer`, compared via `crypto.timingSafeEqual` over sha256 (was `!==`);
  GET path rate-limited too. DEPLOY §5 updated.
- **REGRESSION (real, mine) — 17 broken `#a=` permalinks:** round 5 added 20 民国 names to
  `MODERN_JINXIANDAI`, which flipped **17 EXISTING** poets dangdai→jinxiandai → new `poetId` → broken
  shared links + moved star clusters (poet-id is the sibling of the charset-permalink contract). Reverted
  the additions (set FROZEN at v1 membership + documented); full rebuild restored **17/17** to their v1
  dangdai ids; charset/lexicon stay byte-identical. Totals unchanged (32,657 / 933,857).
- **ROBUSTNESS — cache poisoning:** the failure-as-success cache bug fixed for `poems/` in round 5 still
  bit `lines/` `linesf/` `search/` `gifts.json` (a transient 5xx/network failure latched empty → search/
  gifts silently dead until reload). Now only `r.ok`/genuine-404 is cached; the sidecar idx cache no longer
  latches null on 5xx.
- **UX/robustness:** SearchPanel clears the alias/miss note on select + tab-switch; the 五代十国 info row
  drops its clickable hover; the no-WebGL gate now sets `window.__SHIYUN_UNSUPPORTED__` so `main.tsx` skips
  the React mount (was black-screening over the gate message).
- Corrected heavy data mirrored to the main worktree + the GitHub backup release refreshed to match.

---

## 2026-06-10 — Session: 8th agent · round 5 (post-launch P0/P1/P2 — alias search, error fallbacks, data v2, 自建反馈后端)

Post-launch hardening per the owner's prioritized list. Verify gate green: tsc · **93 tests** (4 new) ·
vite build; every UI path also exercised live in the preview browser.

**P0-1 — 诗人别名搜索 + 落空文案** (`src/data/poetAliases.ts` NEW + test, `SearchPanel`)
- ~230-entry 字号/别称→语料本名 alias layer over poet search: 搜「陶渊明」→ 陶潜 (语料本名!), 李太白→李白,
  苏东坡→苏轼, with a 「X」即「Y」 note. `NOT_POETS` explains prose-master misses (庄子/诸葛亮/三字经…) and
  points 探诗 at their 虚空编号; generic miss line otherwise.
- **The integrity test caught real corpus traps**: 王右丞/李义山/晦庵/柳三变/元遗山/元美/文衡山/祝枝山/天随子
  exist as their own duplicate-attribution rows, **方回 is a real distinct 元代 poet** (alias→贺铸 would have
  hidden him), and **王羲之 has real 兰亭诗** (removed from NOT_POETS). Runtime rule: a real row always wins.
- Fixed the SAME dead-target bug in the pipeline: `GIFT_ALIAS` mapped 渊明-family → "陶渊明" (no such row) →
  those dedication edges never resolved. Now → 陶潜; gift edges 4,849 → **4,976**. build-search FAMOUS also
  fixed (陶渊明→陶潜) + modern famous added (食指/余秀华/西川…).

**P0-2 — 加载失败兜底 + 浏览器守门** (`load.ts`, `poetPoemsLoader.ts` NEW, `store`, `PoetPanel`, `App`, `index.html`)
- **Found + fixed a real production bug while verifying**: `loadPoetPoems` CACHED FAILURES as successes —
  `.catch(() => ({}))` latched an empty bucket on any network hiccup, so the poet rendered "0 poems" forever
  (no error, retry impossible). Failures now THROW and are never cached; 404 vs network-failure are
  distinguished for the sidecar cache.
- Central `fetchPoetPoems` (replaces 5 copy-pasted call sites) reports failure → PoetPanel shows
  作品载入失败 + 重试 (verified: simulated offline → error row; healed + retry → 李白 1107 首 render).
- Boot failure → loading screen shows 星图数据载入失败 + 重新载入 (was an eternal spinner).
- `index.html` gains a plain-ES5 capability gate: no BigInt / no WebGL → a human message instead of a black screen.

**Data v2 — sheepzh/poetry modern layer, charset-FROZEN** (`pipeline/build-data.mjs`)
- 字库 freeze is now the DEFAULT build behavior (production contract): existing `charset.json` re-emitted
  **byte-identical**, any poem with an out-of-字库 char is skipped → N=12,877 unchanged → **every existing
  编号 permalink survives**. `REFLOW_CHARSET=1` for a deliberate breaking rebuild.
- Imported [sheepzh/poetry](https://github.com/sheepzh/poetry) (汉语现代诗歌语料库, `data/作者_拼音/诗名.pt`):
  **+75,980 poems / +2,849 poets** after content-dedup vs yuxqiu (3,016), junk-folder filter (125 non-Han
  handles), charset gate (1,597 skipped). New totals **32,657 poets / 933,857 poems**. 余秀华 249 · 顾城 489 ·
  海子 323 · 徐志摩 19→65 · 食指 43. Full chain rebuilt (poems/lines/sidecars/search); git-tracked
  charset/lexicon byte-identical (verified via git diff), poets.index/gifts/manifest updated.
- Modern poem TEXTS remain author-copyrighted (repo: 非商用) — same exposure class as yuxqiu; noted in
  credits (* footnote) + DATA_CONTRACT.

**自建反馈后端** (`deploy/feedback-server.mjs` NEW + DEPLOY §5 rewrite)
- Owner's direction: **our own backend, no third-party**. Zero-dep node collector (~100 lines): POST
  /api/feedback → JSONL append; token-protected GET inbox; coarse rate limit; **no IP stored** (privacy by
  design). Smoke-tested (POST ok / empty 400 / no-token 403 / token list / health).
- DEPLOY §5 rewritten to lead with self-hosted (systemd unit + nginx same-origin location → no CORS) +
  client wiring `VITE_FEEDBACK_ENDPOINT="/api/feedback"`. Worker/Formspree demoted to no-server fallback.
  The 🟡 ACTION-FOR-运维 callout updated accordingly.

**P1 — LICENSE / OG 卡 / favicon / 五代十国**
- `LICENSE` (MIT + data-rights note) — README claimed MIT but the file was missing.
- Share preview: full og/twitter meta in `index.html`; `public/og.jpg` (1200×630 星海 wordmark card,
  canvas-generated) + `public/favicon.png`; `__OG_ORIGIN__` build-time replacement from `VITE_SITE_ORIGIN`
  (vite.config inline plugin; unset → root-relative).
- 五代十国 dynasty chip → non-interactive 「已并入唐」 note (the shell is empty by data design; 李煜 lives
  under 唐).

**P2 — dev vulns / chunk**
- `npm audit` (prod deps): **0 vulnerabilities**. The 5 install-time vulns (1 critical) are ALL dev-chain
  (esbuild dev-server GHSA via vite≤6/vitest); the fix is vite 8 — a breaking major NOT taken pre-launch.
  Revisit post-launch. Production static output is unaffected.
- three.js chunk warning resolved via `chunkSizeWarningLimit: 700` + rationale comment (the app IS the
  canvas; splitting three out of the critical path buys nothing).

---

## 2026-06-09 — Session: 8th agent (pre-launch review — UI polish, data audit, feedback backend, deploy)

Final pre-launch pass. Verify gate green every round: `tsc --noEmit` + `vite build` + **89 tests**; UI
changes additionally eyeballed via `preview_eval` DOM measurement (screenshots time out on the WebGL canvas).
Commits `0ac0bd7`→`140dc3b` on `main`.

**Round 1 — 奇迹时刻 polish + data audit + feedback backend + deploy** (`9e70d8a`)
- **画框 removed** (`ui/Cinema.tsx` + CSS): the gold frame + corner brackets collided with the 退出 button — gone.
- **Tagline no longer orphans its last char**: `.cinema-tag-text { text-wrap: balance }` + auto-margin full-width
  centering (was `left:50%`-anchored, capping the box at half-width). 1-line on desktop, balanced 2–3 on mobile.
- **Poem card pan + zoom**: the centred card is drag-to-move + pinch/wheel/± zoom (+ reset) so the user composes
  the shot. Pointer-events opt-in; `setPointerCapture` wrapped in try/catch.
- **Data audit** (`docs/DATA_AUDIT.md` NEW, multi-agent web survey + adversarial verify): verdict **SHIP AS-IS**.
  Werneror+yuxqiu is the *optimal fit* (only broad+Simplified+permissive+parseable corpus); *not* the most
  comprehensive (ORCHESTRA-simple-1M +28% but Traditional/encumbered); *not* complete (明/清 ceiling — no 全清诗
  exists anywhere). Corrected stale `chinese-poetry`-as-live-overlay copy in README + DATA_CONTRACT (the build
  reads only Werneror + yuxqiu); reframed 857,877 as a raw upstream count.
- **Feedback backend** (`state/feedback.ts`, `vite-env.d.ts` NEW, `.env.example` NEW): `submitFeedback` now ALSO
  POSTs `{source,message,ts}` to `VITE_FEEDBACK_ENDPOINT` when set (fire-and-forget, keepalive); localStorage
  stays the source of truth; unset ⇒ 100% static. Both paths verified in-browser.
- **Build hardening** (`pipeline/build-data.mjs`): a missing `C:/corpus/modern-poetry` now **fails loud** (was a
  WARN-only `try/catch` that silently dropped the 508 modern poets and desynced the index). Opt out: `ALLOW_NO_MODERN=1`.

**Round 2 — data loading fix** (no code change; `f03b437` docs)
- A fresh worktree shows a poet's poem COUNT (from git-tracked `poets.index.json`) but can't LOAD poems: the
  `public/data/{poems,lines,search}` buckets are git-ignored. Provisioned them by junctioning from the main
  worktree (李白 → 1107 poems load, bucket `206` raw). Rewrote `docs/DEPLOY.md §1` to lead with **provisioning the
  git-ignored data FIRST** (copy/junction the existing complete copy vs regenerate) + a 运维 Quickstart.

**Round 3 — 搜的这首 + emoji + button size** (`140bd → 140dc3b`)
- **`搜的这首` hit badge → its own line** (`.pi-hit { display:block }`): a 1-char title (秋/句) is no longer
  squeezed/truncated by it (verified: badge sits a line below the title).
- **Removed all decorative emojis** → clean monochrome text (🔗📷💬🌟🛸🎯⚙⌨ gone; kept clean ✓ ✕ ⟲).
- **统一大小**: 分享 (`.copy-btn.share`) and 奇迹时刻 (`.cinema-btn`) now share one size (11px / 3px 10px / radius 6px).
- **Cinema zoom** uses a clean `−` (U+2212) / `+` instead of full-width `＋／－`.

**Round 4 — long-poem clipping + wording + 开源致谢 + deploy callout** (this entry)
- **Long poems no longer clipped** (`.cinema-poem`): dropped `overflow:hidden` + `max-width:88vw` + `max-height:58vh`
  so the poem renders at FULL length (may extend past the viewport) — the user zooms out with `−` + drags to
  compose, instead of the left columns being occluded. (Verified: `overflow:visible; max-width:none; max-height:none`.)
- **Less "technical" wording** (`ui/HUD.tsx`, `PoemPanel`, `SearchPanel`): 生成→捕捉, 随机→虚空 ("点击虚空时捕捉的
  诗体", "只捕捉合平仄、押韵的诗", "非格律 · 虚空目录", "虚空 · 半编号"). Zero 生成/随机 left in the rendered UI.
- **开源致谢 modal** (`ui/SettingsMenu.tsx` `Credits` + CSS): a third link beside GitHub opens an acknowledgements
  modal thanking **15 open-source projects** across 渲染/工具链/语料 (three.js, R3F fiber/drei/postprocessing, React,
  Zustand, Vite, TypeScript, Vitest, opencc-js, pinyin-pro, Werneror/Poetry, yuxqiu/modern-poetry,
  chinese_word_rhyme, chinese-poetry) with links + licenses, plus the 刘慈欣《诗云》/博尔赫斯《巴别图书馆》 inspiration.
- **Deploy doc** (`docs/DEPLOY.md`): added a 🟡 **ACTION FOR 运维** callout — the server-side feedback store is NOT
  set up (no table/KV); stand one up + set `VITE_FEEDBACK_ENDPOINT` only if cross-device feedback is wanted (§5).

---

## 2026-06-09 — Session: 7th agent · round 3 (UI polish — 竖排分享卡 + 设置→更多 + 个人链接 + 页内反馈)

Mostly UI, per the user's screenshots. Verify gate green: tsc + vite build + **89 tests**.

- **奇迹时刻 → classical 竖排** (`ui/Cinema.tsx` + CSS): the share card poem was clipping long poems and the
  copy ran together. The poem now renders **vertical, right-to-left, one column per line**
  (`writing-mode: vertical-rl; text-orientation: upright`; `.cinema-line { white-space: nowrap }`) so a long
  poem spreads sideways instead of being truncated at the bottom; the card is centred like a hanging scroll.
  The exit button moved to the **top-left corner in red** (`截好图 · 退出 ✕`) — out of the shot but easy to find.
- **设置 → 更多** (`ui/HUD.tsx`, `ui/SettingsMenu.tsx`): the HUD button + the panel title are renamed 更多
  (it now also holds 关于/反馈, so 设置 was too narrow).
- **关于 + 个人链接** (`SettingsMenu`): at the bottom of 更多 — 个人主页 `cohenjikan.com` + `GitHub` (Cohenjikan).
- **页内反馈** (`state/feedback.ts` NEW, `SettingsMenu` FeedbackBox, `ui/FeedbackViewer.tsx` NEW): a 反馈
  box in 更多 stores messages in **localStorage** (capped 5000 汉字, oldest drop first). The OWNER reads them
  via a hidden gesture — **5 taps on the 诗云 logo within 10 s** → `store.feedbackOpen` → a FeedbackViewer
  overlay listing each message + timestamp (+ 清空). ⚠ **localStorage is per-device**: the owner only sees
  feedback typed on the same browser. A cross-visitor inbox needs a serverless form (Formspree / Google
  Forms / a Cloudflare Worker) — `submitFeedback` is the single seam to repoint; wire it at DEPLOY if wanted.

---

## 2026-06-09 — Session: 7th agent · round 2 (奇迹时刻 share card + 手机面板默认折叠 + 寻路修复/增强)

Follow-ups on the same worktree after the user tested on a real phone. Verify gate green: tsc + vite build
+ **89 tests**. (Commits: `8acb449` mobile-collapse; this round's cinema + gift-path on top.)

### 1 — 手机端面板默认折叠成底部提示条 (`ui/useSheet.ts` NEW)
- On a phone a selection (诗人 / 虚空诗) or search result opened a FULL-screen bottom sheet that covered the
  galaxy. Now on coarse-pointer devices the data panels default to a slim **bottom peek bar** (one-line
  summary + 「▲ 展开」); tap to open the full sheet, 「▾ 收起」 to re-collapse. `useSheet(resetKey)` re-collapses
  on each new selection. SearchPanel starts collapsed to its tab row (tapping a tab expands). Desktop
  unchanged (peek only renders on `COARSE`). `PoetPanel` / `PoemPanel` / `SearchPanel` + the `.sheet-peek` CSS.

### 2 — 奇迹时刻 / cinema share card (`ui/Cinema.tsx` NEW)
- A 📷 button (poem + poet panels) enters a **framed share card over the FROZEN scene** to guide a screenshot.
  `store.cinema` pauses ALL auto-animation — the galaxy spin (`Galaxy` skips `advanceSpin`), the void-pull
  lifecycle (`PulledStars` early-returns → markers never dissipate, per the user's ask), the highlight
  flash/fade (`PoemOrbits` freezes `poemClock`), and the gravity co-rotation (`FlyControls`). The overlay is
  a gold 相框 (border + corner ornaments + vignette) + a concept TAGLINE (5 options, cycled with ‹ ›,
  emphasising the 诗云 / 巴别图书馆 idea) + the framed poem with its full 全集编号 (「它在诗云里的唯一住址」) +
  the 诗云 brand. It is `pointer-events:none` except its controls, so you can still drag the camera THROUGH
  it to compose, then shoot. Manual camera input stays live during the freeze; only auto-motion stops.

### 3 — 寻路 (path-find) bug fix + bidirectional + 100 hops (`data/giftGraph.ts`, `three/GiftTrail.tsx`, `ui/GiftRoam.tsx`)
- **The reported bug** (李白↔王安石 連線 looked wrong): two real issues — (a) BFS was **direction-sensitive**
  (李白→王安石 returned a different intermediary than 王安石→李白, both valid 2-hops → felt random), and (b) the
  gold 足迹 (manual roaming breadcrumb) and the cyan 路径 line coexisted and contradicted each other on screen.
  Verified against the data: 王安石 has NO 韩愈 edge (the screenshot 足迹 was actually 王安石→俞律, a real
  neighbour) — so the path-find itself was already correct; the confusion was the asymmetry + the two lines.
- **Fix**: `giftPath` is now **deterministic + symmetric** — it searches from the canonical (smaller-id)
  endpoint with a weight-sorted expansion order, so A→B and B→A return the SAME chain (oriented to the
  caller) and a stronger relationship wins ties. Verified on real data: 李白↔王安石 = 李白→黄庭坚→王安石 both
  ways; 纳兰性德→李白 = 纳兰性德→李之仪→苏轼→李白 (3 hops). The gold 足迹 line is now **suppressed while a 路径
  result is shown** (cyan path is the focus) and only ever draws **real edges** (`giftAdjacent` guard → never
  a fake straight line between unconnected poets).
- **Task 3**: path budget **10 → 100 hops** (already UNDIRECTED — any 赠诗 relationship connects regardless of
  giver/receiver; confirmed). >100 hops → 无法链接 as before. The 足迹/return-line MEMORY stays a separate,
  unchanged ≤10 cap (`store.hopToPoet`).

---

## 2026-06-09 — Session: 7th agent (性能优化 + 移动端适配 — touch-fly/pinch, auto-quality, dpr cap, responsive bottom-sheets)

Cut from `main` @ `59103ed`. Provisioned `poems/`+`lines/`+`search/` via junction to `main/public/data`
(now the canonical source per the 6th-agent recovery) + `linesf/` from `nifty-kirch`; `npm install`; TOOK
OVER port 5199 (stopped the 6th-agent's stale vite, restarted from this worktree). Worked the whole round
behind two multi-agent passes: a 6-dimension **audit** (touch / responsive CSS / render-perf / load-perf /
mobile-platform gotchas / deploy) → one prioritized plan, then an **adversarial review** (4 finders → each
finding independently verified) that surfaced 20 confirmed issues, all of which are folded in below.

The app was desktop-only (mouse-drag look, WASD fly, wheel speed) with zero `@media`/`touch-action` and a
manual-only 画质 toggle. This round makes it usable + performant on phones/tablets. **No new data, no
backend; engine/data untouched.** Verify gate green: `npm run build` (tsc + vite) + **89 tests** (was 68;
+21 new pure touch-gesture tests). *(Real-device touch can't be exercised headlessly — multi-touch logic is
covered by the pure `touchGesture.ts` unit tests + the verified state machine; the user eyeballs on a real
phone.)*

### 1 — One shared device signal — `src/three/detectQuality.ts` (NEW)
- `COARSE` = `matchMedia("(pointer: coarse)")` (touch primary). `WEAK` = `detectWeakGPU()`, evaluated ONCE
  at module load (before the Canvas mounts, so the galaxy is built at the right size — no high→low rebuild
  flash). **Heuristic: any coarse PRIMARY pointer ⇒ weak** — robust to the iPadOS-on-Mac-UA case (an iPad
  sends a *Macintosh* UA + reports >768px, so a UA/screen test misses it; `pointer:coarse` does not) and to
  large Android tablets; a touchscreen LAPTOP keeps a fine primary pointer so it stays high. Secondary
  desktop low-end: `deviceMemory≤2`, or `cores≤2 && mem≤4` (the `&&` avoids false-downgrading a
  privacy-clamped `hardwareConcurrency`). Consumed by store / App / FlyControls / SettingsMenu / Onboarding.

### 2 — Auto quality + dpr cap (the biggest mobile FPS levers)
- `store.quality` now defaults `WEAK ? "low" : "high"` (manual 画质 toggle still wins). `low` already halves
  particle counts + drops bloom.
- `App` caps Canvas `dpr={[1, WEAK ? 1.5 : 2]}` — dpr 1→2 quadruples the additive-fragment fill that
  dominates cost on a phone. Keyed to the **initial** WEAK seed, NOT the live toggle (changing a live Canvas
  dpr forces a GL context resize/flash); `gpuPick` reads `gl.getPixelRatio()` at pick time so the cap never
  breaks picking. Bloom stays gated on the reactive `quality` (mount/unmount is safe).
- **行星·全部** (the ~857k-point additive layer) is gated OFF on weak devices (`toggleAllPoems` can turn it
  off but not on; SettingsMenu shows it disabled「弱设备已禁用,避免卡死」) — a phone flipping it on froze/OOM'd.

### 3 — Touch input — `src/three/FlyControls.tsx` + `src/three/touchGesture.ts` (NEW)
- `index.html` viewport: dropped `maximum-scale` (WCAG 1.4.4) + added `viewport-fit=cover` (notch insets).
  `canvas { touch-action: none }` + `body { overscroll-behavior: none }` — THE gate for touch (else the
  browser eats one-finger drag as scroll, fires pointercancel mid-gesture, and pull-to-refresh reloads).
- **Gesture scheme (user-chosen): 1-finger drag = look; 2-finger drag = fly; 2-finger pinch = speed/zoom;
  tap = pick.** All reuse the exact desktop camera math (`BASE_SPEED·speedMul`, the wheel's 0.1..80 clamp).
  Forward thrust is an analog **joystick** (centroid displacement off the gesture origin → hold to cruise),
  clamped to unit magnitude (a diagonal drag isn't faster than a cardinal one). A 2-finger gesture releases
  any lock (so touch users can leave a locked view). Pinch speed telescopes (per-move ratio product = total
  spread) → frame-rate independent.
- Input is a `pointers` Map state machine (1 = look/orbit, 2-both-touch = fly/pinch). Hover-pick (a
  synchronous GPU readback) is skipped entirely on `COARSE` (touch has no hover). `pointercancel` handled.
  Touch-aware tap slop (14px vs 6px). The desktop single-pointer path is unchanged.
- `touchGesture.ts` holds the pure, unit-tested math: `centroid`, `pinchDistance`, `thrustFromDrag`,
  `pinchSpeed`, `classifyGesture`. **Mode-lock** (`classifyGesture`): a 2-finger gesture commits to pan XOR
  pinch once it moves enough, so a one-handed pinch (centroid drifts ~½ the spread) can't leak thrust.

### 4 — Responsive layout — `src/styles.css` (one `@media (max-width:600px)` block)
- Transient overlays (诗/诗人/设置/赠诗漫游) → full-width **bottom sheets** (slide-up; `transform:none`, NOT
  `!important`, so the keyframe still animates; `!important` only on left/right/top/bottom/width to beat the
  Settings inline drag style). 搜索 stays at TOP, full-width, positioned below the LIVE wrapped HUD height
  (`HUD.tsx` publishes `--hud-h` via a `ResizeObserver` incl. the notch — no fragile magic constant).
- HUD top bar `flex-wrap` + trims desktop-only chrome (title-en / stat / 隐藏界面); HUD bottom hides the
  WASD/wheel hint (wrong on touch — Onboarding step 3 now shows a COARSE-specific touch hint instead).
- Inputs forced to 16px (iOS won't zoom-on-focus); ≥40px tap targets under `(pointer:coarse)`; `vh`→`dvh`
  cascade on the 7 panel max-heights (iOS dynamic-toolbar safe); safe-area padding throughout.

### 5 — Review fixes folded in (the 20 confirmed findings)
- **DQ-1 (high)** iPad/tablet false-negative → the COARSE-primary rule above. **F1/F2/F4** finger-transition
  bugs (onCancel view-jump; a 3→2 lift killing the last finger's look; stale 3→2 gesture baseline) →
  unified `reseedAfterLift` + onUp only finalizes a tap at zero fingers. **TG-2** one-handed-pinch thrust
  leak → `classifyGesture` mode-lock. **TG-1** `pinchDist` was dead code (2-finger unlocks) → deleted +
  its misleading tests. **F5** mouse+finger on a 2-in-1 tripping the gesture → arm only when both pointers
  are touch. **TG-3** diagonal-faster → unit-clamp the thrust. **DQ-4** privacy-clamped-cores false
  positive, **TG-4** test gaps, **settings-drag** no-op grab cursor on mobile → all fixed.
- Consciously DEFERRED (verified low / intended): the joystick "hold = cruise" (documented + onboarding
  hint + the top search panel flies you back), per-frame `useFrame` allocation hoist (GC; do as a focused
  follow-up to avoid colliding with this round's touch edits), `prefers-reduced-motion`, `webglcontextlost`
  (iOS backgrounding — needs a real device), lexicon lazy-load, no dedicated vertical-touch gesture
  (pitch-up + forward-thrust climbs since thrust is camera-space), and the whole deploy/fuzzy-hosting track.

## 2026-06-09 — Session: 6th agent (徐志摩 data recovery + 寻诗/探诗 rename + 寻诗 prefix/title search + cluster-centering + guide-line coverage)

Cut from `main` @ `27d3ec5`. A fresh worktree has no heavy data; provisioned poems/lines via junction to the
known-good `epic-sinoussi` worktree + linesf from `inspiring-bhabha`, then TOOK OVER port 5199 (stopped the
5th-agent's stale dev server, restarted from this worktree) per the user. main/other worktrees left untouched.

### 1 — 徐志摩 (and the whole 新诗 set) data LOSS — recovered
- **Symptom**: clicking 徐志摩 loaded no poems (panel still said 「19 首真实作品」 from poets.index).
- **Scope (it was systematic)**: exactly the **508 modern poets** (475 当代 + 33 近现代 = the entire
  yuxqiu/modern-poetry import: 徐志摩/海子/北岛/顾城/戴望舒/洛夫/芒克…) were missing their poem TEXT from BOTH
  `poems/*.json` AND `lines/*.json`, while their `poets.index.json` rows (committed in git) survived. All 29,300
  classical poets + every committed asset (charset/gifts/lexicon/manifest/poets.index) were intact.
- **Root cause**: `build-data.mjs` reads the modern corpus inside a `try/catch` that only WARNS on failure
  (`build-data.mjs:163`). A `poems/` rebuild that didn't ingest modern produced poems/ + lines/ without it,
  while git's `poets.index.json` kept modern from an earlier good build → the two diverged. `inspiring-bhabha`
  (the live 5199) **junctions main's `poems/`**, so main + bhabha were broken identically.
- **Fix (this worktree)**: junctioned `poems/`+`lines/` from `epic-sinoussi` (a COMPLETE copy — all 29,808
  poets incl. modern, with sidecars) → `missing = 0 / 29,808`. Verified live on 5199: 徐志摩 Range-fetch → `206`,
  19 poems《雪花的快乐》; 诗句「轻轻的我走了」→ 徐志摩《再别康桥》. **The source corpus is intact**, so a
  full `build-data.mjs` rerun also recovers it. ⚠ **main's `poems/`/`lines/` are STILL broken** (left untouched
  per the user) — the NEXT worktree cut from main must provision from a good source or regenerate.

### 2 — 诗句 → 寻诗, 造诗 → 探诗 (display rename, logic unchanged)
- The two tab names overlapped in meaning. 「诗句」(find a real poem) → **寻诗**; 「造诗」(compute a poem from an
  index) → **探诗**. Display-only: the internal `Tab` ids stay `"line"`/`"compose"`. (`SearchPanel`, `Onboarding`.)

### 3 — 寻诗 prefix + 诗名 search (incremental) — `pipeline/build-search.mjs` (`npm run build:search`)
- The old 诗句 search keyed only WHOLE lines (hash-bucketed) → a mid-line like 「举头望明月」 found nothing until
  the full line, and there was NO title search. New `search/` index (sharded by `hashStr(key)&0xff`, 256 shards):
    • **EXACT full TITLE for every poem** → 诗名搜索 for ANYONE, incl. an obscure poet's famous piece
      (张若虚《春江花月夜》) — found when the whole title is typed.
    • **len-≤3 PREFIX of a FAMOUS poet's lines + title** → incremental: a single 字, a half line, or a title
      prefix matches as you type. `举头望` → 李白《静夜思》 (mid-line!); `静` → 静夜思; capped 12 famous-first.
  - **Size discipline**: prefix-expanding ALL poems was 0.8–2.9 GB. A poemCount bar can't bound it (prolific
    poets own most poems). Gating PREFIX keys to the 48-name FAMOUS set (≈30 K poems) + exact-title-for-all
    lands **129 MB / 256 shards (~0.5 MB each)** — local-rich, deploy-curatable (lever = FAMOUS list / PREFIX_MAX).
  - **Wiring**: `load.ts::searchByHead` (prefix+title) + `searchPoems` (merges searchByHead with the exact-line
    `searchByLine` + fuzzy, dedups, ranks famous-first, caps ≤2/poet for variety, top 10). 寻诗 tab calls
    `searchPoems`; 探诗's `findReal` still uses `searchByLine`. 纯随机 半编号 section unchanged.
  - Limitation: incremental (prefix) only surfaces the 48 famous poets; a non-famous poem appears via exact
    TITLE (full) or exact LINE (full)/fuzzy. Widen `FAMOUS` in build-search.mjs + rerun to broaden.

### 4 — cluster centering (4a) + guide-line coverage (4b)
- **4a 恒星系偏上**: `positions.poemOffset` tied the planet RADIUS to the poem index (`pow((i+0.5)/P,…)`) while
  the LATITUDE `yd` was also monotonic in the index → small radius at the +y pole, large at the −y pole → a
  lopsided teardrop hanging BELOW the poet, so the cluster centre read as offset toward the TOP of the frame.
  Replaced the radial quantile with a HASHED uniform (same density, decorrelated from latitude) → symmetric
  cloud centred on the poet. Same function backs render/pick/locate/guides → clicks stay aligned.
- **4b 指引线漏诗**: `PoemGuides` drew the FIRST `MAX_LINES=4000` poems → for a >4000-poem poet it dropped the
  outermost planets (the ones most needing a guide). Now SAMPLES uniformly across the whole range (`poemIndexOf`)
  so guides span the entire cluster; ≤4000-poem poets are unchanged (every poem still gets a line).

Verify gate: `npm run typecheck` clean, `npm test` **66/66**, `npm run build` ✓. Data + search HTTP-verified on
5199. **4a/4b are visual — the user eyeballs them on a real GPU (no in-conversation preview, per the user).**

### 5–7 — 产品优化: 行星指引常驻 + 赠诗漫游 (跳跃 / 足迹 / 路径)
After GitHub backup + **syncing main's data** (copied the complete `poems/` into main, rebuilt main `lines/`+`search/`
→ `missing 0/29808`, main no longer broken), built three coupled features. **All build + 66/66; the 3D
interactions need a real-GPU pass (no preview).**

- **5 — 行星指引线常驻 (HUD 指引)**: new `store.guideHold` + HUD toggle. ON → the selected poet's `PoemGuides`
  lines hold full brightness instead of the ~10 s auto-fade; only ONE poet's guides show at a time (they follow
  `selectedPoet`, so picking/hopping to another poet switches them). OFF = the existing one-shot flash.
- **6 — 飞跃赠诗线 (hop to the linked poet)** [user chose 新面板+3D点线]: new **`GiftRoam`** panel (docked
  bottom-left, shown when 赠诗 on) lists the selected poet's 赠答往来 (赠出→/←收到 · 对方 · 对应赠诗) — click a
  row to fly across to that poet. ALSO **3D**: clicking a 赠诗 arc in the scene hops along it — `FlyControls`
  CPU-projects the selected poet's ego-net arcs (same bundled Bézier as `GiftLines`) and picks the nearest within
  16 px on a void click (cheap, click-only). Hopping = `store.hopToPoet` (select + lock-follow + APPEND to trail).
- **7 — 赠诗漫游升级 (breadcrumb + return + path search)**:
    • **足迹/返回线**: `store.giftTrail` = the poets you hopped through; **`GiftTrail.tsx`** draws PERSISTENT
      bright-GOLD return lines between consecutive nodes (≤10 edges; trail capped at 11 nodes), with a pulse. Click
      a 足迹 node (panel) or re-hop to return (the trail trims back). Cleared only on 赠诗 off / 清除 / selecting an
      UNRELATED poet (`selectPoet` resets the trail to `[that poet]`).
    • **对应赠诗标注**: for an out-edge, `giftGraph.dedicationPoemIdx` finds the giver's poem whose title contains
      the recipient's name (best-effort; 字号 aliases like 子由→苏辙 may miss → shows the link without a poem).
      Clicking it flares that planet (`pulseAt`, no lock change).
    • **路径查找**: set 起点/终点 (from the selected poet) → `giftGraph.giftPath` BFS shortest path ≤10 hops over
      the 4 849-edge graph (microseconds; budget raisable) → CYAN path highlight in 3D (`GiftTrail`) + clickable
      result chips to fly along. Verified on real data: 苏轼→苏辙 1跳, 苏轼→纳兰性德 2跳 (苏轼→李之仪→纳兰性德,
      跨宋清), 李白↔徐志摩 无连接 (古典/新诗为不连通分量).
  New: `data/giftGraph.ts` (adjacency + BFS + dedication finder), `three/GiftTrail.tsx`, `ui/GiftRoam.tsx`; store
  gains `giftTrail`/`pathStart`/`pathEnd`/`pathResult` + `hopToPoet`/`clearTrail`/`setPath`; HUD 指引 toggle.

### 8 — 设置菜单 + 指引设置 + 漫游易用性 (+ 编号唯一性 discussion)
**编号唯一性 (discussion only, no change)**: the user noticed `编号 N` means DIFFERENT poems under different 诗体
(五绝=20字 vs 七律=56字 — each form is a SEPARATE fixed-length catalog whose index starts at 0 → overlap → the
same number collides). Verdict: **solvable, no new math needed.** All poems form a countable set, so a single
`ℕ↔诗` bijection exists — and the project ALREADY has one: `engine.anyRank/anyUnrank` (the 自由/任意长 全集编号 over
字库∪break) gives every poem (any form/length) a UNIQUE number. The per-form numbers are convenience sub-catalogs.
Fundamental tradeoff: either the number is longer (a universal length-aware encoding) OR a short per-form number is
only unique WITH its 诗体 tag — length info must live somewhere. Recommended (deferred): treat the 自由 全集编号 as
the canonical id, or always show 编号 with its form. Recorded for a future engine decision.

Then 7 product items (all build + 66/66; visual/interaction need a real-GPU pass):
- **1 指引设置**: `guideHold`→`guideMode`(off/flash/hold) + `guideCoverage`(all/optimized) + `guideSeconds`. 'all' =
  a line to EVERY poem (一首不漏; uncapped — max poet ~8k = cheap); 'optimized' = the round-9 sampled cap. flash =
  show `guideSeconds`s then fade; hold = 常驻. 恢复默认 = flash/optimized/10. (`PoemGuides`, `store`.)
- **2 诗云设置菜单**: new `ui/SettingsMenu.tsx` (⚙设置 in HUD) collects 指引(全套) / 行星 / 赠诗 / 引力, each with
  恢复默认 (+ a 全部恢复默认). The 4 toggles moved OUT of the HUD top bar. 赠诗漫游 stays a separate panel.
- **3 路径查找手填**: GiftRoam path endpoints can be TYPED (reuse `searchPoets` autocomplete) or set 选中, not only
  click-picked.
- **4 弱化往来线**: `store.pathDimEgo` + GiftRoam checkbox → `GiftLines` dims the ego arcs (×0.16) so the cyan path
  /gold trail dominate when finding a route.
- **5 滑动条统一**: shared thin gold `::-webkit-scrollbar` + `scrollbar-color` across all overlay panels.
- **6 赠诗线好点**: hover-highlight — `FlyControls` hover-projects the ego arcs; nearest within 26px sets
  `store.giftHoverId` → `GiftLines` lights that arc (×2.8); the click range is the same generous threshold (22px)
  and clicking the highlighted arc hops. So you SEE what you'll click + hit it easily (was pure luck).
- **7 行星更好点 + 诗名 + 提亮(仅选中)**: the selected poet's cluster now HOLDS the highlight for the WHOLE selection
  (was ~10s) at brighter+larger (`bright 3.4`, `sizeScale 860`, `maxPx 44`) → bigger GPU pick target = easier to
  click; hovering one of its planets shows the poem 《title》 near the cursor (`store.hoverPoem` + `ui/PoemHoverLabel`,
  via hover poem-pick gated to the selected poet). (`PoemOrbits`, `FlyControls`.)

### 9 — 唯一全集编号 (SOLVED) + 真实诗定位 + 设置可拖/亮度 + 搜索宽度
- **唯一全集编号 (the headline fix)**: the per-form catalogs collided (`编号 N` was a DIFFERENT poem in each
  诗体, because each fixed form is its own `[0, N^L)` catalog → overlapping ranges). Unified on the
  **universal `anyRank`** over (chars + LINE-BREAK symbols) as THE displayed 编号 for EVERY poem. Because
  any poem is just a char-and-break sequence and `anyRank` is a bijection over those, a 七绝 and its 自由
  twin are the IDENTICAL symbol run → the IDENTICAL number — so the **dedup is automatic** (no detection
  needed; the user's "自由 复刻 fixed-form → 一首诗两个编号" worry dissolves). Verified on real data: 李白
  《赠汪伦》 → a 127-digit number, identical via the 七绝 path and the 自由 path, reverses to the exact poem,
  and differs from the old 114-digit per-form babelRank. Changes (`engineApi`): `describe` (void-pull),
  `pullByIndex` (reverse — now form-agnostic, infers 诗体 from structure, always in-range), `pulledFromIndex`,
  `halfIndexAuto` (now `anyRank(opening)` — a TRUE prefix of the universal number, kept). UI: 探诗 填字/凭编号,
  PoetPanel 目录, PoemPanel, `permalink` (`#p=<index>`, form dropped) all use the universal index. The per-form
  babelRank/格律 catalogs survive in the engine for spatial scatter + 格律 mode only. **+2 engineApi tests
  (dedup + form-agnostic reverse) → 68 total.** The number is long on purpose ("越长越贴合原著").
- **1 真实诗定位**: when a composed / reverse-looked-up poem IS a real corpus poem (`findReal` now returns
  poetId+poemIdx), its 定位 button flies to that poet's ACTUAL orbiting planet (李白's 赠汪伦) — not a random
  void-scatter point. (`SearchPanel.goReal`; cyan button.)
- **2 设置可拖动**: `SettingsMenu` is now drag-by-header (default below the bar, left of the right-side panels)
  so it never traps behind the 诗人/诗 panels and you can watch the effect live.
- **3 搜索宽度**: 寻诗/探诗 panel `width: min(384px, 100vw-36px)` + overflow-x hidden — fills the space, no
  sideways scroll.
- **4 指引线亮度可调**: `store.guideBrightness` (default 0.7×, lower) + a settings slider (0.2..2×); `PoemGuides`
  scales its colour by a `uBright` uniform.

### Round 8 — fuzzy LINE index (mid-line 异文) + orbit-lock + sustained highlight + guide lines
- **诗句 mid-line variant search (item 1)** — round-7's `findReal` fuzzy only covered COMPOSE; 诗句 search of a
  variant line (「举头望明月」) still missed. New `pipeline/build-fuzzy.mjs` (`npm run build:fuzzy`) builds a
  delete-1 / SymSpell skeleton index `linesf/` (4096 shards, disk-staged so it doesn't OOM): a same-length
  1-substitution shares the (L-1) skeleton with the differing char dropped. `searchByLine` adds a fuzzy
  fallback (when exact = 0, len 4..10) via `lineSkeletons` + `loadFzShard`. `lineSkeletons` has 4 unit tests.
  **Large local index (~4.4 GB, 41 M keys, git-ignored); a DEPLOY needs a curated/server-side fuzzy** (noted).
  - `fb2ad58` **fix**: the per-skeleton cap ranked by poemCount → 李白《静夜思》(1107首) was EVICTED from the shared
    skeleton 举头望月 by hyper-prolific minor poets (王世贞 8009首), so 举头望明月 found noise. Now the cap scores the
    48 landmark poets (`FAMOUS`) far above poemCount (never evicted) + `searchByLine` ranks landmark poets first.
    Verified: 举头望明月 → 李白《静夜思》 #1. **Limitation/lever**: only the 48 landmark poets are protected — a famous
    poem by a non-landmark poet (《春江花月夜》/张若虚, 2首) can still be evicted from a shared skeleton. Widen `FAMOUS`
    in `build-fuzzy.mjs` (+ re-run `npm run build:fuzzy`) to cover more, or move to a curated名篇 table for deploy.
- **Orbit-lock (item 2)** — the lock is now an orbit camera: closer default distance (was too far), DRAG
  rotates the locked view (yaw/pitch, no release), WHEEL zooms (distance); movement keys still release.
  (`FlyControls` `lock` ref + handlers.)
- **Sustained highlight (item 3)** — the highlight now holds FULL brightness (`HOLD_FLARE`) for the whole
  ~10 s then weakens (was flash-then-dim); brighter/larger so the cluster stays legible in the spread field.
- **行星指引 / guide lines (item 4)** — new `three/PoemGuides.tsx`: selecting a poet emits a line to EVERY
  poem it wrote (赠诗-style), self-rotating with the cloud, one-shot ~10 s (grow→hold→fade) then auto-deletes.
- Verified: build + 66/66.

### Round 7 — bigger irregular self-rotating clusters + 10s highlight + camera lock + fuzzy findReal
`874cbba`
- **Clusters too small/local/uniform** (user) → `positions.poemSystemRadius` ~6× (35+13√P; 杜甫→~555);
  `poemOffset` clumpy power-law radius + WIDE jitter (non-uniform) + per-poet ELLIPSOID axes (irregular
  shapes: sphere/ellipse/oblate).
- **Self-rotation**: `poemOmega` + shared `poemClock`; each cloud rotates around its poet. Mirrored in the
  visual shader, the GPU pick shader (clicks still land), and the time-aware `poemPosition` (locate tracks).
- **Highlight (item 1)**: selecting a poet ALWAYS flashes its whole cluster in for ~10 s regardless of the
  行星 toggle (flash-in → hold → fade-out); selected poet star also enlarged ×1.8.
- **Camera lock-follow (item 3)**: `store.lockPoetId/lockPoemIdx` + FlyControls — selecting a poet/planet
  centres + follows it (decoration's faster spin streams past = motion); released by any movement key or a
  look-drag. Wired from 3D click / 诗人 / 诗句 / 目录.
- **Search (item 4)**: `findReal` relaxed to a same-length ≤2-char (≥85%) near-match → popular 静夜思
  「举头望明月」 (corpus「山月」) now flagged as 异文. Mid-line variant *search* still needs the fuzzy line index.
- Verified: build + 62/62.

### Round 6 — clickable planets + 群星 v1 (soft 3D clusters, fade, emphasis)
`05ca09f` (clickable) · `9f57d11` (群星 v1)
- **Click a planet → open its poem**: `gpuPick` renders a 2nd pick layer (poem ids offset by
  `POEM_PICK_BASE`) in the same offscreen pass (depth-tested), click-only; `PickResult={kind:poet|poem}`;
  PoemOrbits registers `pickTargets.poemLayer` + `resolve`. +5 vitest (→62).
- **De-blockify v1**: flat disc → soft near-spherical cluster; selecting flashes/fades the cluster in/out.
  (User then said still too small/blocky-when-all-on → Round 7.)

### Round "planets" — 行星 feature (poems orbit their poet) + 目录/搜索 locate
`60a34a7`
- `three/positions.ts` (poetPosition moved here + poemPosition/poemOffset). `three/PoemOrbits.tsx` + HUD
  **行星** toggle (`store.showAllPoems`): OFF = selected poet's poems; ON = all 857,877. 目录定位 (PoetPanel
  🛸定位) + 诗句 search fly to the exact planet (`store.pulseAt`). Verified build + 57/57 + DOM e2e.

### Fix — dead 诗句 search / real-poem detection (missing `lines/`)
`20a55dd`
- `public/data/lines/` was absent → `searchByLine` found nothing → no real hits + `findReal` failed +
  the void/planet double-location. `pipeline/build-lines.mjs` (`npm run build:lines`) rebuilds it from
  `poems/` (no corpus; per-line cap keeps the most-prolific author). 256 buckets / 9.18M refs. Verified:
  床前明月光 → 李白《静夜思》 → flies to the planet (same spot as 目录).

### Fix — dormant Range egress
`3596841`
- `manifest.poemSidecar:true` but `poems/*.idx.json` absent → whole-bucket (~0.9MB) fetch per poet.
  `pipeline/build-sidecars.mjs` (`npm run build:sidecars`) re-emits each bucket + sidecar. Verified live:
  206 `bytes 12-9787/890706` (~98.9% saved).

### Round 5 — UX: placeholder, centre cross dissolve, fixed port
`17242a3`
- 造诗 placeholder simplified; `poetPosition` centreBlur 0.42→0.5 + coreScat 0.15→0.22; Galaxy disk
  azimuthal+core fill; BULGE 42k→64k. `vite` fixed port 5199 strictPort. Centre confirmed by user on a real GPU.
