# 数据勘误台账 (Data Errata Ledger)

> 诗云数据层的**长期勘误清单**。记录已知数据错误、文档漂移、待核实项，及其安全修复路径。
> 这是一份**活文档**：每条带稳定 ID 和「状态」，后续维护轮按 ID 跟踪至闭环。
>
> - **首次审计**：2026-06-26，分支 `claude/friendly-lovelace-e97b02`（数据库勘误轮）。
> - **审计方法**：18-agent 并行审计（7 子系统架构图 + 5 元数据扫描 + 5 对抗性复核 + 1 综合），
>   全部「发现」经独立复算确认；详见文末「§6 方法与复核」。
> - **本轮处置**：owner 决定**只审计、暂不改动**，全部条目登记在册待决策。**审计过程未修改任何文件。**
> - **权威事实源**：`public/data/manifest.json` v3 —— `N=12877`、`poetCount=32657`、`poemCount=933857`、`giftEdges=4976`、`poemSidecar=true`。任何与此冲突的数字以 manifest 为准。(2026-07-09 canonical 层后现值:N=22219、poetCount=32654 正身(索引 33458 行含 804 重定向)、poemCount=871268 独立诗(corpus 收录 970325 条零删行)、giftEdges=5051。)

**状态图例**：📋 已登记待决策 · 🔧 进行中 · ✅ 已修复 · 🧊 有意保持现状（不修） · ❓ 待核实

---

## 1. 范围与约束（先读）

- 本 worktree 仅含**已跟踪的元数据**：`public/data/{charset,lexicon,poets.index,gifts,manifest}.json`。
- **重型分片不在这里**：`poems/`、`lines/`、`search/`、`linesf/` 是 git-ignored，连同上游语料 `C:/corpus/*`
  **只在 main 主检出**。所以**真正的数据级勘误（改诗文/姓名/朝代/赠诗）必须在 main 做**，本 worktree 只能分析+校验元数据。
- 权威元数据本身**内部完全一致、互相对账**（gifts 全健康、编号双射完整、四项计数全对）。本台账的「文档漂移」类
  是**描述数据的文字过时了**，不是数据错。

---

## 2. 数据层架构速览（勘误视角）

单向离线流水线，无运行时数据库：

```
C:/corpus (仅 main)              pipeline/                  public/data/                前端 src/data/
──────────────────              ─────────                  ────────────                ─────────────
Werneror *.csv   ┐                                      ┌ charset.json (字库,冻结)  ─→ charsetHash 守卫
yuxqiu  *.json   ├─→ build-data.mjs ──┬─(tracked)──────┼ poets.index.json (32657)  ─→ load.ts
sheepzh *.pt     ┘   (唯一主构建器)    │                ├ gifts.json (4976 赠诗边)   ─→ giftGraph
Pingshui_Rhyme.json ─→ build-lexicon ──┘                └ manifest.json (v3 权威计数)
                                       │
                       从 poems/ 派生 ──┤─(git-ignored,仅main)→ poems/{bb}.json + .idx (Range 旁车)
                       sidecars/lines/  │                       lines/  search/  linesf/
                       search/fuzzy     └─→ engineApi: 编号 ↔ 诗 ↔ 3D 点
```

完整契约见 [`docs/DATA_CONTRACT.md`](DATA_CONTRACT.md)、流水线见 [`docs/PIPELINE.md`](PIPELINE.md)、
语料审计见 [`docs/DATA_AUDIT.md`](DATA_AUDIT.md)。

**勘误绝不能破坏的冻结不变量（红线）：**

1. **字库内容+顺序冻结 = 编号双射**。`charset.chars` 中每个字的下标就是它在 base-(N+1) `编号` 里的位
   （`src/engine/engine.ts:137-139`）。改内容或顺序 → 静默废掉**每一条** `#p=`/`?p=` 分享链。默认 `build-data.mjs`
   把 `charset.json` 逐字节原样重发（L309-312），含字库外字符的整首诗被**整首跳过**（L129-140）。只有
   `REFLOW_CHARSET=1` 才能重派 —— 那是显式破链的 major 版本。前端 `src/data/charsetHash.ts` 的
   `EXPECTED_CHARSET_HASH='a392703b'`（已复算确认）守这条线。
2. **`poetId = fnv32(name|dynasty)`**（`build-data.mjs:99`）。朝代是 id 的一部分 → 改名或改朝代就换 id、
   断 `#a=` 链、移星团。`MODERN_JINXIANDAI` 成员在 v1 **冻结**（L176-187）。历史教训：曾加 20 个民国名进
   该 map，把 17 个既有诗人从 dangdai 翻成 jinxiandai，断了 17 条链接，已回滚。
3. **FNV 分桶哈希有 4 处副本**（`build-data/lines/search/fuzzy` + 前端 `dynasties.ts::hashStr`）必须逐字节一致；
   由 `src/data/shardHash.contract.test.ts` 黄金值兜底。
4. **`poems[]` 数组下标 + Range 旁车字节精确**：`FirstLineRef.i` 是诗在该诗人 `poems[]` 的下标；`writeBucket`
   一趟同时算正文与 `idx[id]=[off,len]`（L350-368），`load.ts:217` 按 `bytes=off..off+len-1` 请求。
5. **`manifest` 是去规范化副本**：`dynCounts` = poets.index 朝代直方图（和=32657）、`Σ poemCount=933857`、
   `giftEdges=gifts.edges.length=4976`、`n=charset.n=lexicon.n=12877`。改一侧必须同步 manifest（最便宜的回归探针）。

---

## 3. 勘误台账总表

| ID | 类别 | 严重度 | 位置 | 摘要 | 状态 |
|---|---|---|---|---|---|
| **DE-01** | 数据 | 中 | `poets.index.json` | ~158 条姓名缺陷（截断括号/`?`/方块/前导空格/全角空格粘连） | 📋 |
| **DE-02** | 数据 | 中 | `poets.index`+`manifest`+`dynasties.ts` | 五代十国(`wudai`) 朝代为空：前端有过滤带但 0 诗人 | 📋 |
| **DE-03** | 数据 | 低 | `poets.index.json` | 占位/非真名记录：`666`、`《靖康小雅》作者`、26 条匿名约定 | 📋 |
| **DE-04** | 数据 | 低 | `charset.json` | 6 个未规范化字 + 3 个字形重复（康熙部首 / CJK 兼容表意） | 🧊 |
| **DD-01** | 文档 | 高 | `DATA_CONTRACT.md`、`PIPELINE.md` | 现状表把 pre-v2 旧计数当现状，与已发布 manifest 直接冲突 | ✅ 第四轮已修 |
| **DD-02** | 文档 | 中 | 多处 docs + 2×README + `load.ts` 注释 | 旧的诗人数/诗数/赠诗边数（29,808 / 857,877 / 4,849） | ✅ 第四轮已修 |
| **DD-03** | 文档 | 低 | `DATA_AUDIT.md`、`HANDOFF.md`、`DEVLOG.md` | 历史叙述中的旧计数（可作时间戳历史，一般可接受） | 🧊 |
| **OQ-01** | 待核实 | — | `DATA_CONTRACT.md:20`、README | `stars/{shard}.json`：文档/README 提及，但无构建器产、无 loader 取，且未被 gitignore | ❓ |
| **OQ-02** | 待核实 | — | `pipeline/build-{lines,fuzzy,search}.mjs` + `src/data/famousPoets.ts` | 三份 FAMOUS 名单各自副本，陶渊明 vs 陶潜 命名分歧（build-search:54 注明陶渊明「从未命中」）；第四轮另发现 **蔡文姬** 三份全死（库内本名 蔡琰） | 🔧 源码统一(蔡琰/陶潜)·待重建 |

**用户反馈勘误轮（UF · 2026-06-26 第二轮逐条调查 · 详见 §4-UF）** —— 三方比对（联网真相／已发布库／上游语料），10 条全 `high` 置信。

| ID | 问题 | 根因桶 | 状态 |
|---|---|---|---|
| **UF-01** | 毛泽东《到韶山》「敢叫」错字 + 89 首疑不全 | upstream-typo（+ 子问题 upstream-missing） | ✅错字已修(2026-07-08,双桶副本)·缺篇仍📋 |
| **UF-02** | 唐温如《题龙阳县青草湖》裂成 3 身／误作《过洞庭》 | upstream-duplication（+ 次生 朝代／命名） | ✅全闭环:讹字已修+三身经 canonical 层归并(唐温如|tang、唐珙|ming → mergedInto 唐珙|yuan,旧 #a= 重定向不断链) |
| **UF-03** | 陆游 10565 首计数虚高（应 ≈9344） | upstream-duplication（+ 古典「刻意不去重」设计） | ✅经 canonical 别名层解决:组诗总题行标 canonical:false 出统计(数据层零删行),陆游 10565→9612 |
| **UF-04** | 蔡琰朝代标 `qinhan` | **not-an-error**（汉→qinhan 正确） | 🧊 |
| **UF-05** | 张若虚《春江花月夜》搜不到题 | frontend-search | 🔧 源码已改(build-search FAMOUS+14)·待 main `build:search` 重建 |
| **UF-06** | 「乾隆」搜不到（库内为「弘历」305 首） | naming-no-alias | 🔧 已加别名(poetAliases +21 帝王)·随前端部署生效 |
| **UF-07** | 叶嘉莹未收录 | upstream-missing | ✅已补1首《浣溪沙》(restricted,版权至2074) |
| **UF-08** | 兰楚芳未收录（散曲家） | upstream-missing | ✅已补1首散曲《四块玉·风情》 |
| **UF-09** | 李白《王昭君·汉家秦地月》疑缺 | **not-an-error**（已完整在库） | 🧊 |
| **UF-10** | 袁枚《所见》疑缺 | upstream-missing | ✅已补录(corpus additions,袁枚 81 首) |
| **UF-11** | 高适《别董大》「十里黄云」讹字(用户反馈第二批) | upstream-typo | ✅已修(千里,expectHits=2 双记录) |
| **UF-12** | 张居正缺《咏竹》《闻警》《述怀》(用户反馈第二批) | upstream-missing | ✅咏竹已补(轶闻类注记)·闻警/述怀考据不过不收(孤证/仅节选) |
| **UF-13** | 「竟」显示成「竞」(用户反馈第二批) | not-an-error | 🧊 owner 确认误报,关闭(2026-07-09) |

> **流水线自证清白**：`pipeline-dedup = 0`、`pipeline-charset-skip = 0` —— 用户反馈的问题**没有一条**是我方去重或字库跳过造成。详见 §4-UF。

---

## 4. 详细条目

### A. 数据勘误（需 main + 重建，多数会动 poetId / 破永久链接 → 须 owner 拍板）

#### DE-01 — `poets.index.json` 姓名字段缺陷 ~158 条（约 0.48%） 📋
全部源自上游语料摄入；结构/计数无损（双射、计数对账均正常）。去重并集 **158** 条，分布：

- **75 条** 截断的「姓名（字号」注记，全角左括号 `（` 未闭合（`）`=0）。
  例：idx 493 `王佐（汝学`、idx 5841 `邓氏（文太青继室`。显示名应取 `（` 之前部分。
- **54 条** 含字面 ASCII `?` 作丢字占位。例：idx 1186 `赵必?`、idx 2546 `李?媖`、idx 6877 `陈?`。
  **真字不可从本文件恢复**，需对上游源核字（可能无法恢复）。
- **24 条** 含 `■`/`□`/`�` 方块/替换占位。例：idx 4590 `释今■（艹黾`（**双重缺陷**：方块 + 未闭合括号）。
- **3 条** 前导空格：idx 2069 ` 裴维安`、idx 4654 ` 无名氏`、idx 21777 ` 贺怜怜`（应 trim）。
- **3 条** 用全角空格 U+3000 把两人粘成一条记录：idx 3710 `道镜　善导`、idx 12754 `芙蓉古丈夫　毛女`、
  idx 27301 `李　鄂`（疑似源端把共同署名并成一行 → 当成**一个星**渲染）。

**影响**：UI 渲染出悬挂括号/问号/方块；粘连记录把两位诗人当一颗星。
**修复路径**：在 `build-data.mjs` 的 `parseCSV/splitLines` 之后、`addPoem` 之前做规范化（trim + 剥离悬挂
`（…` 后缀 + 拆 U+3000 粘连）；`?`/`■` 类需对上游核字。
**红线**：`poetId=fnv32(name|dynasty)` —— trim/改名会**改 id、断 `#a=` 链、移星团**。低风险首选是
**仅前端渲染层清洗、保持底层 name/id 不变**（不破链）。
**本轮处置**：📋 登记，暂不处理（owner 决定）。

#### DE-02 — 五代十国(`wudai`) 朝代为空 📋
`manifest.dynCounts` 只有 14 键、缺 `wudai`；`poets.index.json` 同样 `wudai=0`（manifest 忠实镜像其源，
非 manifest 内部失同步）。但 `src/data/dynasties.ts:17-33` 把 `{id:6, key:'wudai', label:'五代十国'}`
声明为前端**会渲染的一等过滤带**（`DYNASTY_COUNT=15`）。
→ 画廊里有一条**真实存在但永远为空**的五代过滤带（李煜/李璟所属时代）。五代诗人现被 `DYN` map 归入 tang/song。

**影响**：一个主要朝代在画廊里无任何星点。
**修复路径**：在上游语料/`poets.index` 构建里把五代诗人正确归类（不在 manifest 改）。
**红线**：改某诗人朝代 → 改 `poetId` → 断 `#a=` 链 + 移星团，且需评估李煜等连锁影响（gifts 边、星团）。
**低成本替代**：前端对空 `wudai` 带做优雅降级（暗显/提示），不动数据。
**本轮处置**：📋 登记，暂不处理。

#### DE-03 — 占位 / 非真实姓名记录 📋
- **`666`**（idx 12570，dangdai，poemCount=4）：唯一纯 ASCII、无 CJK 的「名」，明显垃圾句柄 → 应删/标记。
- **`《靖康小雅》作者`**（idx 5468，song，poemCount=14）：描述性占位而非人名（含书名号 `《》`）。
- **26 条匿名约定**：无名氏×13、佚名×7、阙名×4、失撰人名×1、作者未详×1（每朝代一个匿名桶）。
  很可能是**合法语料设计**，但 UI 名称呈现时应知晓；其中 idx 4654 ` 无名氏` 与 DE-01 前导空格项重叠。

**本轮处置**：📋 登记，暂不处理。

#### DE-04 — `charset.json` 未规范化字 6 个 + 字形重复 3 个 🧊
经全字库 NFKC/NFC 扫描独立复算确认。`build-data.mjs` 在冻结字库前**未做任何 NFKC/NFC 规范化**，
留下 6 个 `NFKC(ch)!==ch` 的字：

| idx | 字 | 码位 | 规范化目标 | 备注 |
|---|---|---|---|---|
| 8583 | `⽟` | U+2F5F | 玉 | 康熙部首；与规范 `玉`(idx 60) **字形重复** |
| 10534 | `⾙` | U+2F99 | 貝 | 康熙部首 |
| 8888 | `隣` | U+F9F1 | 隣 | CJK 兼容表意；连 **NFC** 都会变 |
| 8889 | `兀` | U+FA0C | 兀 | CJK 兼容；连 NFC 都变；与规范 `兀`(U+5140, idx 1580) **字形重复** |
| 9072 | `裏` | U+F9E7 | 裏 | CJK 兼容；连 NFC 都变 |
| 12876 | `里` | U+F9E9 | 里 | CJK 兼容；连 NFC 都变；与规范 `里`(U+91CC, idx 43) **字形重复** |

**判定**：码位级双射仍完整（6 个都是不同码位），都在频率稀疏尾部，`charset` hash `a392703b` 已确认匹配。
**修复属于已冻结的 build-data 构建**，重派会触发 `REFLOW_CHARSET`、破坏每条编号永久链接。
**本轮处置**：🧊 **有意保持现状**（影响极小）。行动项：把「冻结字库前先做 NFKC（至少 NFC）规范化」
记入**下一次有意 REFLOW 的 checklist**，避免再生新逃逸字。

### B. 文档漂移（纯文档/注释，零运行时风险，可独立于任何数据决策先修）

> 运行时不受影响：`src/App.tsx:185` 硬编码了正确的 32,657；`HUD.tsx:108` 动态读 manifest。
> 以下是把 pre-v2（2026-06-10 sheepzh 导入前）旧数字当成现状的文字。

#### DD-01 — 现状契约文档自相矛盾、与已发布 manifest 直接冲突（高） ✅
- `docs/DATA_CONTRACT.md:17` 资产表写「29,808 poets」（同文档 L53 又写 32,657）→ 应 **32,657**。
- `docs/PIPELINE.md`「Output (actual)」表：L68「29,808 poets」、L69「4,849 赠诗 edges」、L72「857,877 poems」
  （L67 `charset n:12877` 正确）→ 应 **32,657 / 4,976 / 933,857**。

#### DD-02 — 其余现状文档/代码注释里的旧计数（中） ✅
- `docs/DATA_CONTRACT.md:18`「4,849」赠诗边 → **4,976**。
- `docs/PIPELINE.md:81-82` 逐朝代诗人数为 pre-v2 分布（当代 684 vs 实际 3532，差 2848；近现代 967 vs 968）。
- `docs/PIPELINE.md:115`「4,849 edges … tracked in git」当作当前产出 → **4,976**。
- `docs/ARCHITECTURE.md:80/117`「29,808 poets · 857,877 poems」「4,849 edges」（标为 ✅ SHIPPED）。
- `docs/FRONTEND_GUIDE.md:14`「all ~29,808 poets」→ **~32,657**。
- `README.md:55/73` 与 `README.en.md:55/73`「4,849 条赠答弧线 / 4,849 arcs」（公开落地页，能见度最高；
  其标题诗人/诗总数 L34=32,657/933,857 已正确）→ **4,976**。
- `src/data/load.ts:256` 注释「…13 such names in 29,808」是对全诗人集大小的**活计数声明** → 应 **32,657**。

> 修复时统一以 `manifest.json` 为单一事实源。这一项也对应 `docs/devlog/HANDOFF.md:45` 仍挂着的
> 「文档计数漂移修正」任务。
>
> **✅ 第四轮已修(工作树)**：DD-01 + DD-02 全部落点改为 manifest v3 值（**32,657 / 933,857 / 4,976**；
> PIPELINE 逐朝代 当代 684→3532、近现代 967→968 并重排）。**有意保留**:DD-03 🧊 历史叙述、`O(29,808)`
> 性能注释(`gpuPick.ts`/`FlyControls`)、`devlog/HANDOFF.md` 历史档(如需连档案一并扫可另说)。
> ⚠️ 公开 `README.md`/`README.en.md` 须本分支落入 main 并 push 后才在 GitHub 生效。

#### DD-03 — 历史叙述类（一般可接受为时间戳历史） 🧊
`DATA_AUDIT.md:26`（把 857,877/29,808 直接归给 manifest.json，下文 L55/L62 已自我纠正）；
`HANDOFF.md:150/168`；`DEVLOG.md:614` 与 `DEVLOG.md:506`（「4 849」用空格分隔）。

> **不是漂移**（已核实正确/动态/冻结历史，列出以免误判）：`App.tsx:185`、`HUD.tsx:108`（动态读 manifest）、
> 所有 `N=12,877` 引用、`O(29,808)` 性能历史注释（`FlyControls.tsx:86`、`gpuPick.ts:7&27` —— 已替换的
> CPU 扫描算法复杂度）、`DEPLOY.md:67`（给 v1 备份集打的标签）。

### C. 待核实 / 开放问题

#### OQ-01 — `stars/{shard}.json` 文档与现实不符 ❓
`docs/DATA_CONTRACT.md:20` 与 README 把 `stars/{shard}.json` 列为 lazy region 资产（`StarShard`），但：
`pipeline/` 里**没有任何构建器产它**、`src/` 里**没有任何 loader fetch `data/stars/`**（src 中的 "stars"
命中均为 Three.js 渲染：`PoetStars`/`GiftLines`/`Galaxy`），且它**未被 gitignore**。
→ 很可能是规划/遗留资产，或浏览器端运行时从 poets.index/gifts 现算（星坐标本就客户端算）。**需确认**并据此修文档。

#### OQ-02 — 三份 FAMOUS 名单副本 + 陶渊明/陶潜 命名分歧 🔧
`build-lines.mjs:41-46`（用 `陶渊明`）、`build-fuzzy.mjs:37-42`（`陶渊明`）、`build-search.mjs:53-60`
（用 `陶潜` + 额外现代诗人）是三份独立副本，本应都镜像 `src/data/famousPoets.ts`。`build-search.mjs:54`
明确注明语料 canonical 行是 `陶潜` 不是 `陶渊明` → `build-lines/fuzzy` 里的 `陶渊明` 条目**从未命中**（死项）。
**第四轮已修(源码)**：三份名单 + `src/data/famousPoets.ts` 统一为语料 canonical 本名 `陶潜`、`蔡琰`。
扫描另发现 **蔡文姬** 在三份 FAMOUS + `famousPoets.ts` 全为死项（库内本名 `蔡琰`，5 首，qinhan）；且
`famousPoets.ts` 还驱动前端 `load.ts:12` 诗句排序与 `PoetStars` 名家星强调（`Landmarks` 组件已成死代码、未挂载），
故一并修。`vitest` 214 绿、`node --check` OK。⚠️ 前端部分随前端构建生效；`build-{search,lines,fuzzy}`
需 main 重建分片后生效。「三份合一为共享模块」的根治可另开一轮。

#### OQ-03 — corpus deriveGenre 把「宫调前缀的词牌」误判为散曲(qu) 🔧(shiyun 已兜底)
`shiyun-corpus/scripts/build.mjs` 的 deriveGenre 以宫调前缀(中吕/双调/南吕…)判 qu、词牌头判 ci,但宋前
词集常以宫调标注词牌(贺铸《**中吕宫**丑奴儿二首》实为词),致 **14 位宋前诗人**(贺铸/吴文英/李贺/唐彦谦…)
带上 genre=qu。收录状态标注轮(2026-07-10)实测暴露:这些人若挂「散曲收录不完整」灰字即为事实错误。
**shiyun 侧已兜底**:`build-data.mjs` quGap 加朝代守卫 `QU_DYNS = {jin,yuan,ming,qing,jinxiandai,dangdai}`
(散曲起于金元,更早的 qu 必为误标)。**根修在 corpus**:deriveGenre 词牌表判定应优先于宫调前缀,另开一轮。

#### OQ-04 — □ 之外的占位符(?/�/■)13,393 行未入展示层白名单 ❓
缺字展示层 d(2026-07-09)白名单仅收 □(U+25A1)。corpus `_build_report.json` placeholderRecords=13,393
(正文含 ?/�/■/□),其中非 □ 占位符在 shiyun 摄入时仍被 onlyHan 静默剔除(丢字不丢句居多;零汉字整首的
已被 lost 存目兜住)。需评估:哪些该并入 `onlyHanBox` 白名单、哪些是上游编码垃圾该在 corpus 清洗。

---

## 4-UF. 用户反馈勘误轮（第二轮逐条调查 · 2026-06-26）

> 来源：用户多日反馈的「数据/收录」具体勘误共 10 条。方法：每条派一 agent 走**三方比对**（联网 ground-truth ↔ 已发布 `poems/` 实读 ↔ 上游 `C:/corpus` 原文），凡判定指向「我方流水线」者再加一道对抗性复核。**本轮只查不修**，10 条均 `high` 置信，关键证据已独立复算（12/12 poetId 的 fnv32 命中、毛泽东上游作者列精确 89 行、build-search `MAXREF=12`/`if(!famous)continue` 与 build-data `DYN`/`poetId=fnv32(name|dynasty)`/`modernSeen` 仅现代源去重 均经源码核对）。

### 逐条根因

| ID | 真相（联网） | 我方现状（已发布库） | 上游现状（C:/corpus） | 根因 |
|---|---|---|---|---|
| **UF-01** 毛泽东 | 定本作「敢**教**日月换新天」；名篇齐全 | `06.json[0627eeb0]` 89 首，《到韶山》该句逐字=「敢**叫**」，与上游一致；名篇零丢失 | `近现代.csv:476` 原文即「敢叫」；作者列恰 89 行 | **upstream-typo**（错字源在上游）；「不全」=上游仅 89 首（upstream-missing 子问题） |
| **UF-02** 唐温如 | 《题龙阳县青草湖》作者唐珙（字温如），元末明初，首句「**西风**吹老洞庭波」 | 同一人裂成 3 身：唐温如 `4a282690`(tang,1)／唐珙 `28a217e3`(yuan,2)／唐珙 `1c8a158b`(ming,1)；《过洞庭》版首二字讹作「**玉箫**」 | 唐.csv／元.csv／明_1.csv 各署不同(名,朝代,题)，古典源不去重全落库 | **upstream-duplication**（叠加 次生 朝代映射 + 命名未合并） |
| **UF-03** 陆游 | 权威存世 ≈9344／9138 首 | `1c.json[1ca4256c]` 10565 首 = 上游行数 100% 透传，字库 0 跳过 | 上游恰 10565 行，含约 1142「序列诗总题行+其N」双列重出；10565−1142≈**9423**≈权威 | **upstream-duplication** + 古典「刻意不去重」设计 |
| **UF-04** 蔡琰 | 东汉末才女，权威归两汉/东汉 | `9a9135b7` qinhan（区间含汉）；改 weijin 则 id 变 `a35bd828` | 汉.csv 5 行朝代列均「汉」，无歧义 | **not-an-error**（DYN 汉→qinhan 忠实且唯一恰当；改 weijin 反失真） |
| **UF-05** 张若虚 | 唐人，仅存 2 首（pc=2 正确） | `54.json[54af8764]` 2 首数据完整；但全题键被 `MAXREF=12` 按 famous/poemCount 淘汰（16 家同名 pc=2 垫底），前缀键又 FAMOUS-only | 唐.csv 原文齐全 | **frontend-search**（索引截断 + 前缀键仅名家） |
| **UF-06** 乾隆 | 乾隆=年号，弘历=名，同一人 | 「乾隆」0 命中；以本名「弘历」`0ee47e54`(qing,305) 在库 | 清_1+清_2 作者列恒为「弘历」305 行 | **naming-no-alias**（库内有数据，缺年号→本名别名） |
| **UF-07** 叶嘉莹 | 真诗人，《迦陵诗词稿》收诗 450+ | 0 命中；含「叶嘉莹」字样的两首词已正确归入寇梦碧 `d7b3ec52`（证未被丢弃） | 三源作者列均无叶嘉莹，仅作题中人名出现 | **upstream-missing** |
| **UF-08** 兰楚芳 | 元代**散曲**家，存世为曲非诗 | 4 种名变体均 0 命中 | 全 corpus 4 变体 grep 0 文件；Werneror 是诗语料、不含散曲 | **upstream-missing**（体裁覆盖缺口） |
| **UF-09** 李白王昭君 | 确为李白真作，首句「汉家秦地月」 | `82.json[82a5851c]` 已收「相和歌辞 王昭君二首 其二」10 句完整，lines 可反查 | 唐.csv 对应行齐全 | **not-an-error**（误报；附带乐府题序前缀致搜不到的体验问题） |
| **UF-10** 袁枚《所见》 | 确为袁枚真作 | `97.json[97cc074f]` 80 首无此诗，四句 lines 全空（非错挂他人） | 全 CSV 对诗句/标题 0 命中；袁枚作者行精确 80 = 我方 80 | **upstream-missing**（注：「樾」字在字库内，已排除 charset-skip） |
| **UF-11** | 高适《别董大》「十里黄云」讹字(用户反馈第二批) | upstream-typo | ✅已修(千里,expectHits=2 双记录) |
| **UF-12** | 张居正缺《咏竹》《闻警》《述怀》(用户反馈第二批) | upstream-missing | ✅咏竹已补(轶闻类注记)·闻警/述怀考据不过不收(孤证/仅节选) |
| **UF-13** | 「竟」显示成「竞」(用户反馈第二批) | not-an-error | 🧊 owner 确认误报,关闭(2026-07-09) |

### 根因分布（10 条）

| 根因桶 | 条数 | issueIds |
|---|---|---|
| upstream-missing（上游根本没有） | 3 | UF-07、UF-08、UF-10（+ UF-01「不全」子问题） |
| upstream-duplication（上游互见/序列重出透传） | 2 | UF-02、UF-03 |
| upstream-typo（上游原文错字） | 1 | UF-01 |
| not-an-error（误报） | 2 | UF-04、UF-09 |
| naming-no-alias（在库但缺别名搜不到） | 1 | UF-06 |
| frontend-search（索引/检索逻辑） | 1 | UF-05 |
| **pipeline-dedup** | **0** | —（全部排除） |
| **pipeline-charset-skip** | **0** | —（全部排除） |
| dynasty-mapping | 0 | —（UF-02/UF-04 仅次生/误报，DYN 表本身健康） |

### 关联分组

- **家族 A · 上游互见/序列重出透传**：UF-03 陆游（总题行+其N双列）、UF-02 唐珙同诗 3 身、UF-09 李白王昭君其一/其二/合并 3 行。共因：古典 Werneror「每行=一首、刻意不去重」（`build-data` 无条件 `addPoem`），`modernSeen` 只去重现代源。↔ 关联 **OQ-02**（构建侧重复未收敛）、`shiyun-maintenance-footguns`「poems 计数透传」。
- **家族 B · 上游缺收录**：UF-07 叶嘉莹、UF-08 兰楚芳、UF-10 袁枚《所见》、UF-01「不全」。共因：`poetId=fnv32(name|dynasty)` 只能由上游作者列派生，上游没有则无从生成；已排除我方丢弃（含字样行未被删）。
- **家族 C · 命名/搜索（数据在库、是「找不到」非「没有」）**：UF-06 乾隆→弘历（无别名）、UF-05 张若虚（`MAXREF` 截断 + 前缀键仅名家）、UF-09 乐府题序前缀。↔ 关联 **OQ-02**（谁进 FAMOUS 决定 UF-05 可搜性）、**DE-01/DE-03**（命名层大族）。
- **家族 D · 朝代映射（与 DE-02 对照）**：UF-04 汉→qinhan 映射正确（误报）；UF-02 唐温如被上游标「唐」(应元末明初)是上游标注+无别名合并的次生问题。**本轮无 DE-02 式映射缺陷** —— 问题不在映射函数，而在上游对个别朝代/人物的归类粒度与署名。

### 直接回答：去重 bug 还是上游问题？

**主要是上游语料问题，不是我方去重 bug。** 10 条里：属上游 **6 条**（缺失 3 + 互见重出 2 + 错字 1）、误报 **2 条**、前端/命名 **2 条**；我方流水线「去重 bug」与「字库跳过误删」**各 0 条**。
关键澄清：**陆游 10565 虚高不是「去重把谁删错了」，恰恰相反——是古典语料按设计「每行=一首、刻意不去重」，上游又有序列诗「总题行+其N」双列重出，原样透传所致**（剔除约 1142 总题重出 ≈9423 ≈权威 9344）。即问题是「没去重（设计如此）+ 上游重复」，而非「去重出错」。

### 处置分类（本轮不修，供后续轮决策）

- **A. 真该修·低风险（不碰冻结红线）**：
  - **UF-06**（最低风险）：`src/data/poetAliases.ts` 加 `乾隆: 弘历`（target「弘历」是真实 poet 行，不成 dead target；不动底层 id，**不破链**）。← 推荐为下一轮首个可立即落地项。
  - **UF-05**：`build-search.mjs` 三选一（张若虚入 FAMOUS／全题键给招牌之作保底席／前端交叉补全）；改 search/ 索引不触 poetId 红线，但须 main 重建。
  - **UF-01 错字**：`敢叫→敢教`，可在 build-data 加文本勘误 map（须先校验「教」在冻结字库内）；须 main 重建。
- **B. 受冻结红线约束（改名/改朝代/去重 → 动 poetId、破 `#a=`/`#p=`，须 owner 拍板）**：UF-02 合并唐珙三身、UF-03 陆游序列去重（属设计变更非 bug 修复）。
- **C. 需上游补录（非代码可修）**：UF-07 叶嘉莹《迦陵诗词稿》、UF-08 兰楚芳散曲（须引入散曲语料源）、UF-10 袁枚《所见》、UF-01 毛泽东缺篇；补录文本须全字落在冻结字库内，均须 main 重建 poems/lines/search。
- **D. 无需动作**：UF-04、UF-09（误报）。

---

## 5. 勘误机制与安全重建流程

### 5.1 可用的「纠正面」—— 今天没有数据驱动的勘误层
对全部 7 个流水线文件的 `readFileSync/readdirSync/import/env` 站点穷举：**没有任何数据驱动的
correction/override/patch/allowlist/blocklist/alias 文件被读取**。所有「纠正」都是 `build-data.mjs` 源码里的
**硬编码常量**：`DYN`（朝代→规范键，L36-51）、`GIFT_ALIAS`（号/字→本名，L397-480；含 4 个渊明系别名→陶潜
的修复 L400）、`MODERN_JINXIANDAI`（L182-187，v1 冻结）、`GIFT_STOP`/`NAME_END`/`GIFT_MARKERS`/`HONORIFIC`。

→ **任何已发布的服务文件都不能手改**，下次重建会覆盖。一处勘误只能从两个口进入：
(a) 改 `C:/corpus` 上游原文，或 (b) 改 `build-data.mjs` 硬编码 map，**然后在 main 重跑流水线**。

> **建议（待 owner 决策，本轮未做）**：引入一个版本化的 `public/data/errata.json`，由 `build-data.mjs`
> 在语料摄入后施加（trim/剥括号/别名/朝代映射），使姓名/朝代/别名修正成为**数据编辑**而非源码编辑。

### 5.2 重建依赖顺序（改了诗文/标题/朝代/赠诗后）
```
(1) build-data.mjs  ← 必须最先；需 C:/corpus 三套语料全部在场（生产环境绝不用 ALLOW_NO_*）
        重产 poems/ + .idx, lines/，刷新 gifts.json + manifest.json
(2) 针对新 poems/ 重跑（顺序任意）：
        build:sidecars（仅当 build-data 用过 SKIP_HEAVY）· build:lines · build:search · build:fuzzy
(3) build:lexicon  ← 仅当 charset 内容/顺序变了（重大破链事件，非常规勘误）
```
注意：`lines/`、`search/`、`linesf/`、`poems/*.idx.json` 全部从 `poems/` 派生 —— 只重跑 build-data 而不重跑派生器
会让它们**静默陈旧**。另：`build-data.mjs` 与 `build-lexicon.mjs` **无 npm script**（须 `node --max-old-space-size=… pipeline/…`
直接跑），其余 sidecars/lines/search/fuzzy/pack 有。

### 5.3 按勘误类别的入口 / 重建 / 红线

| 勘误类别 | 入口 | 重建什么 | 红线 |
|---|---|---|---|
| 诗文/标题/格律 文本 | 上游语料原文 | build-data → sidecars/lines/search/fuzzy | 引入字库外新字 → 该诗**整首静默跳过**（预期安全失败） |
| 诗人姓名 | 上游 / 渲染层 | 改 name→改 poetId→重新分桶+断 `#a=`+移星团+失效该 id 全部 gifts 边 | 等于「故意破该诗人链接」，须当版本化变更 |
| 朝代规范 | `DYN` map | 同上（朝代是 poetId 的一部分） | **绝不可为「修归属」而改朝代** → 17-链接回归覆辙 |
| 赠诗关系 | `GIFT_ALIAS`/`GIFT_STOP` | 重跑 build-data（gifts.json 在那里产） | alias 目标必须是真实诗人行，否则别名全解析为空 |
| 声调/韵 | `lexicon.json` 经 build-lexicon | 仅重跑 build-lexicon（独立于 poems/） | 保持 ping∪ze 划分、rhymeOf↔rhymeMembers 互逆 |
| 字库 reflow | `REFLOW_CHARSET=1` | 重分片全部带永久链接的数据 + 同提交 bump `EXPECTED_CHARSET_HASH` | 破坏每条分享编号链 —— 非常规勘误、重大版本 |

### 5.4 安全操作骨架（最常见的「内容/排序」类）
1. 在 **main 主检出**（语料 + 重型分片所在）改上游原文或 `build-data` map；
2. 三套语料全部在场重跑 build-data（**绝不用** `ALLOW_NO_*`），再重跑受影响的派生索引；
3. 校验 `manifest` 四项计数 + `charsetHash`（仍应为 `a392703b`）**未变**才能部署；
4. 跑契约测试 `shardHash.contract.test.ts` + `poetAliases.test.ts`；
5. 完整 `npm run deploy:build`（重打 `.gz`/`.br`），**从清理过的 dist/ 传输**；
6. 修正后回镜像到 GitHub 备份 release，防漂移。

### 5.5 备份层（勘误出错时的恢复保障）
1. `*_v1_backup` 本地回滚目录（dev 机，约 1.16 GB，2026-06-10 前的 29808-诗人旧数据）；
2. GitHub release `data-v2-2026-06-10` tarball + SHA256SUMS；
3. `npm run pack:data` 冷备归档（如 `shiyun-data-v3-2026-06-13.tar.gz`）；
4. all-branches git bundle。

> **部署级陷阱**（`docs/devlog/DEPLOY-2026-06-13-search-fix.md`）：(R7) vite `copyPublicDir` 会把 `*_v1_backup`
> 拷进 `dist/`，必须**从清理过的 dist/ 传输**，否则推 1.16 GB 旧数据到 prod；(R2) `gzip_static` 按文件名发
> `.gz`/`.br`，改 JSON 不重打压缩件会**永久发陈旧内容** —— 务必跑完整 `npm run deploy:build`；(R3) `poems/`
> 必须 RAW 且 Range 服务、**绝不可 gzip**；(R1) `linesf/` 不部署，nginx 须保留 `location ^~ /data/linesf/ { return 404; }`。

---

## 6. 方法与复核

本台账由 2026-06-26 的 18-agent 并行审计产出：
- **Map（7）**：分别精读 `build-data.mjs`、派生构建器、`src/data/contract.ts`、前端消费层、5 个元数据文件、
  docs/footguns、勘误机制。
- **Scan（5）**：用 `node -e` 对 `poets.index`/`gifts`/`charset+lexicon`/`manifest`/doc-drift 做一致性计算。
- **Verify（5）**：每个 Scan 的头部结论由独立 agent **重新计算**确认/推翻（默认推翻除非可复现）。
- **Synthesize（1）**：汇总成报告。

复核纠正示例（说明本台账数字可信）：`charset` 未规范化字原扫描报 2 个、复核确认 **6** 个（其中 4 个连 NFC 都变）；
姓名缺陷原扫描 ~157、复核去重并集 **158**；`666`/匿名约定/`《靖康小雅》作者` 为复核新增（原扫描漏报整类）。
所有「健康」结论（gifts 全健康、双射完整、四项计数对账）已确认，不在本台账重复。

---

## 变更记录

- **2026-06-26**（`claude/friendly-lovelace-e97b02`）：首次创建。登记 DE-01..04、DD-01..03、OQ-01..02。
  本轮只审计、未改动任何代码/数据。
- **2026-06-26**（同分支，第二轮）：新增 §4-UF「用户反馈勘误轮」，逐条三方比对登记 UF-01..UF-10。
  结论：用户反馈问题以**上游语料**为主（缺失/互见重出/录入错字），我方「去重 bug」「字库跳过」各 0 条。只查不修。
- **2026-06-26**（同分支，第三轮）：执行非数据库修复 —— UF-06（`poetAliases.ts` 加 21 条帝王别名 乾隆→弘历…，`vitest` 213 绿）+ UF-05（`build-search.mjs` FAMOUS +14 地标少产诗人，待 main `build:search` 重建生效）。
  新增 [`docs/DATA_SUPPLEMENT.md`](DATA_SUPPLEMENT.md)「语料补录路线图」（corpus-coverage 类别）：头号缺口=元散曲/宋词体裁，P0=用随附 `cipai_2.txt` 做零破链体裁(genre)标注层；与 UF-08/UF-10、DE-02 交叉引用。
- **2026-06-27**（同分支，第四轮）：执行 **OQ-02 + 名家讹名/常用名零破链修**。① `poetAliases.ts` +2 别名:**王禹偁→王禹称**（生僻字「偁」U+5041 未入字库、上游同音替代；= SUPPLEMENT P0-4）、**蔡文姬→蔡琰**（极常用名原无别名、搜不到）。② OQ-02:`build-{search,lines,fuzzy}.mjs` 三份 FAMOUS + `src/data/famousPoets.ts` 统一为 canonical 本名 `蔡琰`/`陶潜`（原 蔡文姬/陶渊明 皆死项，且 `famousPoets.ts` 驱动前端诗句排序+名家星强调）。③ 方法:对 169 名 canon × 字库做讹名/缺失扫描 —— 字库（12877）够全，讹名类仅 **王禹偁** 一例；别名表 120 target 全在库、0 shadow，回归通过。`vitest` **214 绿**、`node --check` OK。⚠️ 前端随前端构建生效；pipeline 三份须 main 重建分片（`build:search`+`build:lines`+`build:fuzzy`）后生效。④ **DD-01/DD-02 文档旧计数修**:7 文件(含公开 README×2 + `load.ts` 注释)旧计数 29808/857877/4849 → manifest v3 **32657/933857/4976**(PIPELINE 逐朝代 当代684→3532/近现代967→968);有意保留 DD-03 🧊 历史叙述与 `O(29808)` 性能注释。⑤ **P0-1 体裁体检(只读)** 见 [`DATA_SUPPLEMENT.md`](DATA_SUPPLEMENT.md) 「P0-1 实测」——全库 **词≈86.5k(9.3%)** 藏于 form=other 无标签、曲≈0(仅 540 宫调粗检)、词散于 清24k/宋20k/近现代+当代30k/元5k。
- **2026-07-08**(勘误执行轮,fork):corpus 校勘层落地 —— ① build.mjs 给 yuxqiu/sheepzh 现代路径接 applyCorrection(保桶保层,防「毛泽东|dangdai」改桶断链);② validate.mjs 订正命中改声明式 expectHits(缺省 1=原铁律,findMiss 升 err);③ 三处错字:UF-11 高适 十里→千里(applied=2)、UF-02 唐珙 玉箫→西风、UF-01 毛泽东 敢叫→敢教(applied=2 双桶);④ UF-12 补录张居正《咏竹》(《闻警》《述怀》考据不过不收);⑤ shiyun 全链重建 poemCount 970,319→970,320,charset 冻结未动(a9cde1f2),vitest 1518 绿;⑥ 「敢叫日月」残留(付慧/柏桦引用)与「玉箫吹老」残留(虞堪)核实为他人作品合法原文,不动;⑦ UF-13 竟/竞 待定位。
- **2026-07-09**(canonical 别名层,15代):owner 定调 Wikidata 模式落地——corpus 诗级 canonical:false 标注(精确重复 34,264 + 组诗总题行 64,788 下界)+ curated/merges.jsonl 诗人合并(唐温如|tang、唐珙|ming→唐珙|yuan;毛泽东|dangdai→jinxiandai,裁决依据入 note);shiyun 统计层只走正身:poemCount 970,320→871,268、陆游 9612、高适 257;poets.index 33,458 行=32,654 正身+804 mergedInto 别名行(801 跨桶重复自动判正身多数票+3 手工),#a= 零断链、前端重定向+同名朝代消歧文案;赠诗裸名解析引入近现代↔当代同区,giftEdges 5,165→5,051(去重净值,含 22 条断边找回+18 条历史漏边);探诗 inferForm 两句连写标签(2×10/2×14/4×10/4×14,编号零影响);叶嘉莹存目化(仅首句)。门禁 tsc+vitest 1555 绿,charset a9cde1f2 未动。毛泽东缺篇补全排期 2027-01(进公有领域)。
- **2026-07-09**(缺字展示层,16代):□(U+25A1)缺字符号原被 `onlyHan` 静默剔除致丢句丢字(刘克庄《□□□□ 其一》8句只剩5句)。修法=PoemRecord 可选展示层 `d`(5,895 首,硬不变量「d 去□去空句===p」违反即构建 throw),渲染 `d ?? p` + 灰注「□ 为原文缺字」;p/编号/字库/搜索零变动,#a= 实测逐位不差。独立第三方(GPT 5.6 sol,codex exec 只读)全量审查:256 分片/87万首逐条核验,裁决可上生产;同时确认全 □ 诗 2 首(贺铸/刘克庄)历史即不可见(非回归)→ 转入下一轮存目化。另 Q/E 滚转方向翻号(Q 左倾)。vitest 1555 绿。
- **2026-07-10**(收录状态标注层,16代):把「不全/特殊」从暗坑变界面明说。**corpus**:诗行可选 `collection{status:disputed|index-only,note}`(咏竹=disputed、叶嘉莹浣溪沙=index-only),record()/additions 显式透传+validate 三规(白名单/note 必填/index-only⊂in-copyright),VALIDATE PASS、970,325 行不变。**shiyun**:poets.index 四个可选键——`collection[]` 策展文案 3 位(弘历「御制诗集四万余首,开源语料仅传三百余首」/毛泽东 2027-01/叶嘉莹 2074)、`quGap` **97** 位(散曲缺口;朝代守卫 QU_DYNS 兜掉 14 位宋前误伤→OQ-03)、`restrictedOnly` 1 位(叶嘉莹头部改「存目 N 条」)、`lost` 4 位 5 首零汉字诗存目(2 lacuna+3 nonhan,0 孤儿);PoemRecord 可选 `s/sn`(恰 2 条);前端 collectionStatus.ts 纯函数拼灰字(现当代通用句 dynasty 级,k=copyright 抑制)+ 存目条目 + 留影卡透传 s/sn(防截图外传丢警示)。验证:charset/manifest/lines/gifts git 干净逐字节不变、poets.index 加性 diff 脚本 0 违例、poems 结构审计 871,268/d 5,895/s 恰 2/杂键 0/p 零 □、锚点 poemIdx 不移。门禁 tsc + vitest **1564** 绿(+9 collectionStatus 单测)。方案经 Sonnet 对抗审查修订(乾隆去「策展」叙事/charset-skip 实测 0 砍 UI 留日志/词头部覆盖实测扎实不标词人——六月「词 30-70%」评估对头部不成立,辛 633/苏 371/李 54 与通行存词一致)。新登记 OQ-03/OQ-04。
