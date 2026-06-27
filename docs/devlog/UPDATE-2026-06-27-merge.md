# 更新报告 — 2026-06 维护轮合并(前端 June-maint + 数据勘误)

> **状态(2026-06-27,第12代维护)**:两条轨道已合进**本地 `main`**,门禁全过。
> **未推 origin、未部署 prod**(owner 指示「只合并代码、暂不推送」)。重建+部署见 §5,待 owner 拍板执行。
> 基线 `main 68f4d3e` → 合并后 **`main 8b52774`**(线性)。

---

## 1. 概述
- 范围:① 前端功能更新(June-maint:留影/cinema、触屏整体锁定、关随机诗、引导重做、探诗诗体 bug 修);② 数据源/勘误更新(帝王/讹名/常用名别名、OQ-02 canonical 名、UF-05 地标搜索、DD 文档计数)。
- 合并前做了 5 维度并行审查(红线/FAMOUS 存在性/别名存在性/文档计数/合并冲突),**全绿**,详见 §4。

## 2. 前端变更(轨道 A · `claude/june-maint-2026`,6 提交 ff)
1. **留影/cinema 重做** — 左下统一 ⚙ 设置(背景衬底默认关 / 无极调色 / 顶部文案开关);恒竖排;可调字体槽(拖拽+双指/滚轮缩放,字号二分自适应填满);多层暗描边保底可读。
2. **探诗诗体(真 bug 已修)** — `engineApi.describeAny` 原把 `form` 写死 `"ziyou"`,致永久链/拾遗还原的七律被误标「自由」;改用 `inferForm`,加回归测试。
3. **触屏整体锁定** — store `freeMove`(触屏默认锁定绕原点 orbit,单指转/双指·滚轮缩放;电脑默认自由飞行)。
4. **关随机诗** — store `allowRandomPoem`(默认开;关后点虚空不生成随机诗)。
5. **新手引导重做** — 分平台四步;`localStorage` key `shiyun_onboarded_v1→v2`(老用户重看一次)。

## 3. 数据/勘误变更(轨道 B · 原 `friendly-lovelace`,1 提交 `8b52774`)
- **别名**(`src/data/poetAliases.ts`,前端构建即生效):+21 帝王别名(乾隆→弘历、隋炀帝→杨广、宋徽宗→赵佶、海陵王→完颜亮…)、王禹偁→王禹称(生僻字讹名)、蔡文姬→蔡琰(常用名)+ 回归测试。
- **canonical 本名 OQ-02**(`famousPoets.ts` + `build-{search,lines,fuzzy}.mjs`):蔡文姬→蔡琰、陶渊明→陶潜(原死项,统一库内本名)。`famousPoets.ts` 部分前端构建即生效;三 `.mjs` 须重建索引才生效。
- **UF-05**(`build-search.mjs`,须重建 search/):FAMOUS +14 文学史地标(张若虚/张继/崔颢/王之涣…),修「春江花月夜搜不到题」。
- **DD 文档计数**:`README*` / `ARCHITECTURE` / `DATA_CONTRACT` / `FRONTEND_GUIDE` / `PIPELINE` / `load.ts` 注释 旧 `29808/857877/4849` → manifest v3 **`32657/933857/4976`**。
- **新增台账**:`docs/DATA_ERRATA.md`(逐条勘误)、`docs/DATA_SUPPLEMENT.md`(补录路线图)。

> ⚠️ **生效分两路**:前端类(别名 / famousPoets / 计数)随 `npm run build` 即生效;**pipeline 类(UF-05 / OQ-02 索引)须在 main 重建 `search`/`lines`/`fuzzy` 后才生效**(见 §5)。

## 4. 合并与验证(本轮已做)
- **轨道 A**:`git merge --ff-only claude/june-maint-2026`(68f4d3e→7181fa8,纯前端 ff)。
- **轨道 B**:在 worktree 提交(无 co-author)→ rebase 到 7181fa8 → main ff 到 `8b52774`。两轨道文件**零交叠**,无冲突。
- **环境修复**:main 的 `node_modules` 此前残缺(缺 `@react-three/*` 与 `.bin` shims,会卡一切构建/测试/dev),已 `npm ci` 修复(138 包)。
- **门禁**:`tsc --noEmit` **CLEAN**;`vitest run` **100 文件 / 1689 测试 全绿**。
- **审查结论(5 维并行,全 PASS)**:① 红线——无任一 diff 触及冻结字库 / `poetId=fnv32` / FNV 常量 / 分桶 / anyRank;`#p=`/`#a=` 永久链安全。② FAMOUS——15+2 名全是 poets.index 精确行(无静默 no-op);移除的 蔡文姬/陶渊明 确认本不存在。③ 别名——21 个 target 全精确命中。④ 文档计数——现时态声明已改对,残留旧值均为合法历史(DEVLOG/DEPLOY v1_backup/DATA_AUDIT 上游框定/已删 CPU 扫描)。⑤ 合并面——A∩B=∅,FNV 四副本完好。

## 5. 待执行 — 重建 + 部署(turnkey,owner 说推送时再做)
> 🔴 **头号坑**:main 的 `public/data/{poems,lines,search}` 现**全空**(只剩 `*_v1_backup` 旧 29808)。**重建/部署前必须先 provision `poems/`**。

1. **Provision `poems/`(二选一)**
   - A(快):从 prod rsync 下 `poems/`(+`lines/`)当输入。
   - B(自足,~10min):`node --max-old-space-size=4096 pipeline/build-data.mjs`(从 `C:/corpus` 重生;**别设 `REFLOW_CHARSET`**;缺上游会 loud-fail)。
2. **重建索引**(让 UF-05/OQ-02 生效):
   `npm run build:lines && npm run build:sidecars && npm run build:search && npm run build:fuzzy`
3. **对账**:`manifest.json` 应仍 **32657 / 933857 / 4976**,charset hash **`a392703b`** 不变;抽查 UF-05(搜「春江花月夜」出张若虚)、OQ-02(陶潜/蔡琰 名家排序)。
4. **前端构建**:`npm run build`(tsc + vite,自动带上别名/famousPoets/计数)。
5. 🔴 **删 `dist/data/*_v1_backup`**(vite `copyPublicDir` 会把 ~1.16GB 旧 v1 拷进 dist)→ `rsync` 清理过的 `dist/` 到 Oracle VM `/var/www/shiyun/dist`。**永不 scp public/data,只传清理过的 dist。**
6. 冒烟:首屏载入、搜「乾隆/蔡文姬/王禹偁」落本名、permalink `#a=`/`#p=` 复原、留影/触屏/引导。
- 详见 `docs/devlog/HANDOFF-2026-06-27-merge-deploy.md` §2-3、`docs/DEPLOY.md`。

## 6. 已知问题 / 未决
- 张居正两属、繁体 `證` 类残留(已在独立 corpus 修)。
- main 数据 provision 流程仍手动;UF-02/03(去重/合并动 poetId 红线类)待 owner 拍板。
- `王翰` 同名 3 人(name-keyed FAMOUS 固有局限,无害);`完颜亮` 在库归 yuan 桶(上游分类,既有)。
- 独立 `shiyun-corpus` 本轮不并入。

## 7. 回滚
- 合并未推未部署 → 本地 `git reset --hard 68f4d3e` 即复原。
- 部署后回滚:prod `*_v1_backup` / `git revert` / 重新部署上一个 dist。
