# 交接 — 2026-06 合并 · 部署 · 更新报告(给下一任 agent)

> **任务**:把本轮两条未合并轨道合进 `main` → 跑必要重建 → 部署 prod → 产出更新报告。
> 写于 2026-06-27(session f0ccb2f2)。基线 `main = 68f4d3e`("开源准备")。

---

## ⚡ TL;DR(5 步)
1. **先确认 owner 已真机眼测 June-maint**(合并前提,见 §1-A)。
2. **提交** friendly-lovelace 的数据修改(**现全在工作树未提交!**)→ 把两条轨道合进 `main`。
3. **🔴 provision v2 重型分片**(本地现已**全空**!从 prod rsync 下来 或 跑 build-data 从 C:/corpus 重生)→ 跑 pipeline 重建,让 UF-05 / OQ-02 生效。
4. **前端构建** `npm run build`(自动带上别名 / famousPoets / DD 文档计数修)。
5. **清 dist 里的 `*_v1_backup`** → rsync 到 Oracle VM → 冒烟 → **写更新报告**(模板见 §7)。

---

## 1. 两条未合并轨道(都基于 `main 68f4d3e`)

### 轨道 A — 前端功能更新(June-maint)✅ 已提交 · ⏳ 待眼测
- 分支 `claude/june-maint-2026`(worktree `.claude/worktrees/june-maint`),**领先 main 6 个提交**(线性):
  | commit | 内容 |
  |---|---|
  | `d37bba4` | 5 项主提交:留影/探诗诗体/触屏整体锁定/关随机诗/引导重做 |
  | `53cd256` | cinema 统一设置按钮 + 无极调色,取消横/竖排切换 |
  | `f309a11` | 引导精简为 4 步(B 版,owner 选定) |
  | `82f736d` | cinema 可调字体槽 + 字号自适应 |
  | `55a6ed7` | cinema 手柄被 overflow 裁掉 → `.cinema-clip` 修 |
  | `7181fa8` | cinema 手柄改为设置开关(默认关) |
- **功能**:① 留影/cinema 重做;② **探诗诗体 mis-classification**(七律被标"自由/词")= **真 bug 已修**(`describeAny` 改用 `inferForm`,加回归测试);③ 触屏整体锁定(store `freeMove` + orbit);④ 关随机诗(store `allowRandomPoem`);⑤ 引导重做(4 步,`localStorage` key `shiyun_onboarded_v1→v2`,老用户重看一次)。
- **门禁**:tsc clean + **vitest 217 绿** + vite build OK。**🔴 合并前提:owner 在 `localhost:5199` + 真机触屏眼测通过**(视觉/3D/触控/留影排版无法 headless 验)。逐项清单见该分支 `docs/MAINTENANCE.md`。
- **合并**:6 提交可 ff —— `git checkout main && git merge --ff-only claude/june-maint-2026`(merge 后 `main → 7181fa8`)。**未推 origin**,本轮未部署。

### 轨道 B — 数据源/勘误更新(data-fix)⚠️ **全在工作树·未提交!**
- worktree `.claude/worktrees/friendly-lovelace-e97b02`,**分支位置 = main 68f4d3e,改动未 commit**(`git rev-list main..friendly-lovelace = 0`)。先提交才能合并。
- **改动文件(13 改 + 2 新)**:

  **① 前端类(随前端构建即生效,无需数据重建)**
  - `src/data/poetAliases.ts` —— +21 帝王别名(乾隆→弘历…)+ **王禹偁→王禹称**(生僻字讹名)+ **蔡文姬→蔡琰**(常用名)
  - `src/data/poetAliases.test.ts` —— 回归断言(**vitest 214 绿**)
  - `src/data/famousPoets.ts` —— **蔡文姬→蔡琰、陶渊明→陶潜**(原死项;驱动前端诗句排序 + 名家星强调)
  - `src/data/load.ts` —— DD 注释计数(29,808→32,657)
  - **DD 文档计数**:`README.md` / `README.en.md` / `docs/{ARCHITECTURE,DATA_CONTRACT,FRONTEND_GUIDE,PIPELINE}.md` —— 旧 `29808 / 857877 / 4849` → manifest v3 **`32657 / 933857 / 4976`**

  **② pipeline 类(须在 main 跑数据重建才生效)**
  - `pipeline/build-search.mjs` —— FAMOUS +14 少产地标(张若虚/张继/崔颢…)+ 蔡琰 —— **UF-05**(春江花月夜搜不到题)
  - `pipeline/build-lines.mjs` / `pipeline/build-fuzzy.mjs` —— 蔡琰/陶潜 canonical —— **OQ-02**(三份 FAMOUS 死项统一)

  **③ 新文档(未跟踪)**
  - `docs/DATA_ERRATA.md` —— 勘误台账(UF/DE/DD/OQ 逐条 + 五轮 changelog)
  - `docs/DATA_SUPPLEMENT.md` —— 补录路线图 + 体裁体检实测(词≈86.5k 藏 form=other)
  - (另:`main` 工作树有未跟踪 `docs/CORPUS_DB_GUIDE.md` + `docs/corpus-db-PROMPT.md` —— 独立 corpus 项目设计文档,见 §6;是否并入 main 由 owner 定)

- **提交**:在 worktree `git add -A && git commit -m "…"` —— **无 co-author trailer(owner 规矩)**。

---

## 2. 合并顺序 + 🔴 关键坑

1. **先 June-maint**(待眼测通过)→ `git merge --ff-only claude/june-maint-2026`。
2. **再 data-fix**:在 friendly-lovelace 提交工作树改动 → 合进 main(已 ff 到 7181fa8,故此处是 merge-commit 或先 rebase 再 ff)。两轨道改**不同文件**,冲突风险低(June-maint 不动 README/docs 计数,data-fix 不动 cinema/touch src)。
3. **🔴 坑 1 — main 的 v2 重型分片现已全空**:`public/data/{poems,lines,search}` = **0**(只剩 `*_v1_backup` 的旧 29,808 数据)。v2 真数据(933,857 首)只在 **prod**(Oracle VM `/var/www/shiyun/dist/data`)和/或 GitHub 数据备份。**任何 pipeline 重建/部署前必须先 provision**:
   - **选项 A(快)**:从 prod rsync 下 `poems/`(+`lines/`+`search/`)当 build 输入。
   - **选项 B(自足)**:`node --max-old-space-size=4096 pipeline/build-data.mjs` 从 `C:/corpus`(Werneror+modern+sheepzh,均在)重生 `poems/`+`lines/`，~10+ 分钟,frozen-charset 安全。
4. **🔴 坑 2 — worktree↔main 的 pipeline 源码是两份**:friendly-lovelace 改的 `build-*.mjs` **不会自动进 main**。必须 merge/commit 进 main,重建才会用到改后的脚本(UF-05 当初就卡在这)。
5. **跑 pipeline 重建**(让 UF-05/OQ-02 生效;FAMOUS 只改 search/lines/fuzzy **索引**、不动 `poems/`):
   - 选项 A(已有 poems/):`npm run build:lines && npm run build:sidecars && npm run build:search && npm run build:fuzzy`
   - 选项 B:`node --max-old-space-size=4096 pipeline/build-data.mjs && npm run build:lines && npm run build:sidecars && npm run build:search && npm run build:fuzzy`
   - **别设 `REFLOW_CHARSET`**(默认冻结);build-data 缺任一上游会 **loud fail**(防 poems/index desync)。
6. **前端构建**:`npm run build`(tsc + vite)—— 自动带上 poetAliases / famousPoets / DD / load.ts。

---

## 3. 部署 prod
- prod = **Oracle VM <prod-host>**(ubuntu)behind Cloudflare;serve `/var/www/shiyun/dist`。
- 流程:本地 build `dist/` → **🔴 删 `dist/data/*_v1_backup`**(vite `copyPublicDir` 会把 ~1.16GB 旧 v1 拷进 dist!不删 = 把陈旧数据推上 prod)→ `rsync` 清理过的 `dist/` 到 `/var/www/shiyun/dist`。**永不 `scp public/data`,只从清理过的 dist 传。**
- 详见 `docs/DEPLOY.md` + `docs/devlog/DEPLOY-2026-06-13-search-fix.md`(R7 = v1 备份坑)。

---

## 4. 验证门禁
- **合并前**:`tsc --noEmit`、vitest(data **214** + frontend **217**)、`npm run build`。
- **重建后**:`manifest.json` 计数对账(应仍 **32,657 / 933,857 / 4,976**;**charset hash `a392703b` 不变**);抽查 **UF-05**(搜「春江花月夜」应出张若虚)、**OQ-02**(陶潜/蔡琰 名家排序)。
- **部署后冒烟**:首屏载入、搜「乾隆 / 蔡文姬 / 王禹偁」落到本名、permalink `#a=`/`#p=` 可复原、留影/触屏/引导(June-maint)。

---

## 5. 🔴 红线(任何时候别碰)
- **冻结字库** N=12,877(hash `a392703b`)—— **绝不设 `REFLOW_CHARSET`**(改→破所有 `#p=` 永久链)。
- **`poetId = fnv32(name|dynasty)`** —— 别改名/朝代(破 `#a=`、移星团)。
- **FNV 分桶哈希** 4 处副本须一致(`shardHash.contract.test` 守)。
- 古典层**不去重**;`poems[]` 顺序载荷(`FirstLineRef.i` 平行于分片)。

---

## 6. 相关:独立 `shiyun-corpus`(本轮**不并入**诗云)
- `Desktop/shiyun-corpus`,GitHub `Cohenjikan/shiyun-corpus`,已独立 push 干净(单提交 `a5d881c`,**970,324 首**,带 provenance 标注,公开层全 PD)。是诗云**未来上游候选**,本轮不动它,也不并入 main 的数据流。详见 memory `[[shiyun-corpus-db]]` + `docs/CORPUS_DB_GUIDE.md`。

---

## 7. 更新报告模板(部署后产出)
1. **概述** —— 版本/日期/范围(前端 June-maint + 数据勘误)。
2. **前端变更** —— 5 功能逐条(截图 + owner 眼测结论)。
3. **数据/勘误变更** —— UF-05/UF-06 + OQ-02 + 帝王/王禹偁/蔡文姬别名 + DD 计数;附 `DATA_ERRATA.md` changelog。
4. **部署** —— 重建链 + dist 清理 + rsync + 冒烟结果。
5. **已知问题/未决** —— 张居正两属、繁体 `證` 类残留(已在独立 corpus 修)、main 数据 provision 流程、UF-02/03 红线类待 owner 拍板。
6. **回滚** —— prod `*_v1_backup` / `git revert` / 重新部署上一个 dist。

---

## 8. 锚点 + memory
- **memory**:`[[shiyun-june-maint-2026]]`(前端轮)、`[[shiyun-data-errata-2026]]`(数据 r1-r5)、`[[shiyun-corpus-db]]`(独立库)、`[[shiyun-prod-deployment]]`、`[[shiyun-maintenance-footguns]]`、`[[shiyun-worktree-data-split]]`。
- **台账**:`docs/DATA_ERRATA.md`(逐条 + changelog)、`docs/DATA_SUPPLEMENT.md`(补录路线 + 体裁体检)。
- **权威计数**:`public/data/manifest.json`(v3)—— 非文档散落值。
