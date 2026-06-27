# 独立标注语料库 — 项目指南（CORPUS DB）

> 一个**独立的、完整的、带 provenance(来源)标注**的简体中文古典诗词语料库,作为它**自己的 GitHub 项目**
> 存在。它坐在「上游父库」(Werneror / yuxqiu / sheepzh…) 与「下游消费者」(诗云等) 之间:把多个上游
> **统一、清洗、标注**成一个干净完整的库。**诗云只是下游之一**,摄取快照时自己过滤(字库、poetId、去标点),
> 本库**不受诗云的冻结字库/编号约束**。**标注是库内元数据,不进任何前端。**
>
> 状态:设计稿(2026-06-27)。本库与诗云仓**解耦**,应建在诗云之外的独立目录/仓库(如 `C:/poetry-corpus`)。

---

## 0. 定位(对照诗云)

| | 诗云 (下游) | 本库 (独立项目) |
|---|---|---|
| 目的 | 3D 星图可视化 | **干净、完整、可复用的标注语料** |
| 字库 | 冻结 12877 字,库外整首跳过 | **不删字**——含生僻字、词、曲 |
| 标点 | 去标点(只存断句) | **保留原始标点** |
| 编号/poetId | 永久链双射,红线 | 无此约束(消费者自理) |
| 标注 | 无 | **每条带 provenance** |
| 关系 | **消费本库的一个快照** | 上游父库 → 本库 → 诗云/其他 |

> 解耦红利:本库追求"完整 + 正确",诗云吃的时候自己过滤(跳库外字、按 `fnv32(name\|dynasty)` 聚合、
> 去标点、冻结编号)——诗云的历史约束**不再绑架**语料质量。

---

## 1. 设计原则

1. **完整不删字**:收录不受任何下游字库限制(含诗云字库外的字、以及词/曲等体裁);**不静默丢弃**。
2. **保留原文**:保留原始**标点**(断句信息不丢);保留**原始朝代串**(`dynasty_raw`)。
3. **简体唯一**:繁体上游须转简(OpenCC t2s)后入库,转换在构建期完成、可追溯。
4. **provenance-first**:每条都标「来自哪个上游 / 我方新增 / 我方订正」——**可审计、可回滚、可筛选**。
5. **不破坏式**:互见/重出**不删**,标 `dup_group` 让消费者自行决定是否去重(诗云正是因为"刻意不去重"
   才有陆游 10565 虚高——本库把判断权交给消费者,而不是替它做)。

---

## 2. 记录 schema（`data/poems.jsonl`,一行一首,UTF-8）

```jsonc
{
  "id": "sha1(author|dynasty|title|body)[:16]",   // 内容寻址,稳定、跨重建不变、便于去重
  "title": "念奴娇·赤壁怀古",
  "author": "苏轼",
  "dynasty": "song",            // 规范化 canonical key（15 键,见 §下）
  "dynasty_raw": "宋",          // 原始朝代串,可逆
  "body": "大江东去，浪淘尽、千古风流人物。…",   // 含标点的完整正文
  "genre": "ci",                // 诗 shi / 词 ci / 曲 qu —— 派生,可选但建议(见 §6)
  "provenance": {
    "type": "upstream",         // "upstream" | "curated"
    "source": "Werneror/宋_1.csv",   // upstream: 哪个父库文件; curated: 权威出处
    "license": "PD",            // "PD" | "Apache-2.0" | "non-commercial" | "⚠in-copyright(2074)"
    "note": "",                 // curated 必填:为何新增/订正
    "corrected_from": null      // 仅订正:原(错)正文,留底可审计
  }
}
```

- **朝代 15 canonical key**:`xianqin qinhan weijin nanbeichao sui tang wudai song liao jin yuan ming qing
  jinxiandai dangdai`(沿用诗云 `DYN` 映射表,但本库**可启用 `wudai`**——诗云那边是空带,本库不必受限)。
- 另建 `data/poets.jsonl`(可选聚合):`{id, name, dynasty, poemCount, genres:[...], has_curated:bool}`。

---

## 3. provenance 标注方案（核心诉求）

- `provenance.type`:
  - **`upstream`** —— 来自父库,`source` 记**具体文件**(`Werneror/元.csv` / `yuxqiu/…json` / `sheepzh/…pt`)。
  - **`curated`** —— **我方新增或订正**,`source` 记**权威出处**,`note` 记原因。
- 订正(改错字)记 **`corrected_from`**(原错正文)——留底,任何时候可回退、可对比。
- 这样:消费者可以"只要上游"、"只要我方校勘"、"列出我们改过的每一处",一切透明、可撤。

---

## 4. 项目结构（GitHub 独立仓）

```
poetry-corpus/
  README.md            # 是什么 / 来源 / 许可 / schema / provenance 方案
  LICENSE
  SOURCES.md           # 上游父库清单 + 各自许可 + 同步方法
  data/
    poems.jsonl        # 完整标注语料(或按朝代分片 poems.<dyn>.jsonl)
    poets.jsonl        # 可选:诗人聚合
  curated/
    additions.jsonl    # 我方补录(新诗/新诗人)
    corrections.jsonl  # 我方订正(带 corrected_from)
  scripts/
    build.mjs          # 上游父库 → data/*.jsonl(+ 套用 curated 层)
    validate.mjs       # schema / 朝代 / 编码 / 去重报告 / provenance / 许可 检查
```

---

## 5. 构建流程（`scripts/build.mjs`,可重复运行 = 与父库同步)

1. 读各上游父库(Werneror CSV `题目,朝代,作者,内容` / yuxqiu JSON / sheepzh `.pt`)。
2. 规范化:朝代→canonical key(留 `dynasty_raw`);繁体→简体(OpenCC t2s);**保留标点**;`body` 原样。
3. 标 `provenance.type="upstream"` + `source=<文件>` + `license=<该源许可>`。
4. 派生 `genre`(§6)。
5. 套用 `curated/` 层(additions/corrections),标 `type="curated"`。
6. 算 `id`(内容哈希)、检测 `dup_group`(同 author+body 归一组,不删)。
7. 输出 `data/*.jsonl`。

---

## 6. genre 派生（诗/词/曲）

- **词**:`title` 词牌头命中 `cipai` 词典(用上游随附 `Werneror-Poetry/cipai_2.txt`,1664 词牌)→ `genre="ci"`。
- **曲**:含宫调标记(正宫/中吕/南吕/双调/越调/仙吕…)或命中曲牌表 → `genre="qu"`。
- **诗**:其余 → `genre="shi"`(可再细分近体/古体)。
- 实测参考(诗云体检):当前父库里 **词 ≈ 86,500、曲 ≈ 0**——所以"曲"基本要靠**新增父库**(全元散曲等)补。

---

## 7. 自验证（`scripts/validate.mjs`,构建后 / CI 必跑;同时是验收清单)

1. schema 完整(必填字段齐、类型对)。
2. `dynasty` ∈ 15 canonical key。
3. 编码:`body` 为简体(无残留繁体 / 无乱码 / 无 `?■□�` 占位)。
4. 去重报告:列出 `dup_group` 规模(供人工/消费者决策,不自动删)。
5. provenance:每条 `type`/`source` 非空;`curated` 必有 `note`;订正必有 `corrected_from`。
6. 许可:现代/在册作者条目必须有非空 `license`(供公开仓合规放行)。
7. curated 引用完整性:`corrections` 的 `matchFirstLine`/`find` 在底库唯一命中。

---

## 8. 与父库同步（定期)

`git -C <每个上游> pull` → 跑 `validate`(若上游变更命中某 correction → 报警,人工重核) → 重跑 `build`
(curated 自动复用) → 跑全 `validate` + 计数 diff → commit。**我方校勘永不随上游重拉丢失。**

---

## 9. 许可 / 版权（公开仓必读 ⚠）

- **古典文本**(唐宋元明清…):基本公有领域,可自由收录发布。
- **现代/当代**:`yuxqiu`(Apache-2.0)、`sheepzh`(**非商用**、文本仍受作者著作权)、以及在册作者
  (life+50,如叶嘉莹 2074、赵朴初 2050、毛泽东 2027)——**逐条标 `license`**;在册条目默认**隔离 / 标注**,
  **是否纳入公开仓由 owner 决定**(公有领域优先,如章太炎 d.1936 已 PD)。
- README 必须**诚实声明混合许可**;最稳的公开姿态:classical 全开 + modern 标注/可剥离 + 非商用声明。

---

## 10. 诗云作为下游(解耦说明)

诗云摄取本库某个快照时,在它**自己的** `build-data` 里:过冻结字库门(跳库外字)、按 `fnv32(name|dynasty)`
聚合、去标点、冻结编号。**本库不做这些**——它保持完整,诗云各取所需。(这也意味着:本库的 `provenance`
标注**不会进诗云前端**,符合你的要求。)

---

## 相关锚点
上游父库:`C:/corpus/Werneror-Poetry/*.csv`(+`cipai_2.txt`)、`C:/corpus/modern-poetry`、`C:/corpus/sheepzh-poetry`。
诗云侧参考:`pipeline/build-data.mjs`(朝代 `DYN` 映射 L36 / 断句 L78 / classifyForm L87)、`docs/DATA_ERRATA.md`
(逐条根因台账)、`docs/DATA_SUPPLEMENT.md`(补录路线图 + 体裁体检实测)。
新 agent 提示词:`docs/corpus-db-PROMPT.md`。
