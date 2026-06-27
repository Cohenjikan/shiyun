# 提示词 — 给「语料库 agent」(新窗口直接粘贴下方 `===` 之间全文)

> 用法:开一个新 agent 窗口(可在任意目录,但**产物建在诗云之外**,如 `C:/poetry-corpus`),粘贴下文。
> 完整规格见诗云仓的 `docs/CORPUS_DB_GUIDE.md`(同机可读)。产出后由诗云维护方按该指南 §7 校验。

===

你的任务:**从零搭建一个独立、完整、带 provenance 标注的简体中文古典诗词语料库项目**,最终 push 到 GitHub
作为独立项目。它把多个上游父库统一、清洗、标注成一个干净完整的库。**这不是某个前端的内挂层——标注只是
库内元数据。** 完整规格见 `C:/Users/Cohen/Desktop/shiyun/docs/CORPUS_DB_GUIDE.md`,**先读它**,以下是要点。

## 铁律
1. **完整不删字**:收录**不受任何字库限制**(含生僻字、词、曲);**不静默丢弃**任何上游诗。
2. **保留原文**:`body` **保留原始标点**;保留 `dynasty_raw`。
3. **简体唯一**:当前上游(Werneror/yuxqiu/sheepzh)**本就是简体**,无需转换;**将来**接入繁体父库时才用
   OpenCC `t2s`,转换在构建期完成。
4. **provenance-first**:每条都标来源(upstream 哪个文件 / curated 我方新增·订正),**可审计可回滚**。
5. **不破坏式**:互见/重出**不删**,标 `dup_group`,把去重判断交给消费者。
6. **不杜撰**:curated 的每首诗/每处订正必须来自**权威出处**,逐条写 `source`;拿不准的进 REPORT 存疑区。
7. **不碰诗云**:产物建在诗云仓**之外**(如 `C:/poetry-corpus`),**不要**改 `C:/Users/Cohen/Desktop/shiyun/**`。

## 上游父库(读这些,在本机)
- `C:/corpus/Werneror-Poetry/*.csv` —— 古典,CSV 列 `题目,朝代,作者,内容`(`内容`含标点)。+ 随附
  `cipai_2.txt`(1664 词牌,用于 genre 派生)。
- `C:/corpus/modern-poetry/**` —— 现代新诗(yuxqiu,Apache-2.0)。
- `C:/corpus/sheepzh-poetry/data/**` —— 现代诗(sheepzh,**非商用**、文本受作者著作权)。

## 朝代规范化(15 canonical key,沿用诗云映射)
`先秦→xianqin｜秦/汉→qinhan｜魏晋/魏晋末南北朝初→weijin｜南北朝→nanbeichao｜隋→sui,隋末唐初→tang｜
唐/唐末宋初→tang｜宋/宋末金初/宋末元初→song｜辽→liao｜金/金末元初→jin｜元→yuan,元末明初→ming｜
明/明末清初→qing｜清→qing,清末民国初/清末近现代初→jinxiandai｜近现代→jinxiandai,近现代末当代初/民国末当代初→dangdai｜当代→dangdai`
（**本库可启用 `wudai`**:若能可靠识别五代十国诗人/作品,归 `wudai`,不必像诗云那样空带。）

## 记录 schema（`data/poems.jsonl`,一行一首)
```jsonc
{ "id":"sha1(author|dynasty|title|body)[:16]", "title":"…", "author":"…",
  "dynasty":"song", "dynasty_raw":"宋", "body":"含标点的完整正文", "genre":"shi|ci|qu",
  "provenance":{ "type":"upstream|curated", "source":"Werneror/宋_1.csv | 《…》权威出处",
    "license":"PD|Apache-2.0|non-commercial|⚠in-copyright(YYYY)", "note":"", "corrected_from":null } }
```
- genre:title 词牌头∈`cipai_2.txt`→`ci`;含宫调标记/曲牌→`qu`;否则`shi`。
- 另产 `data/poets.jsonl`(可选聚合)。

## 要交付的项目（建在 `C:/poetry-corpus`)
```
README.md  LICENSE  SOURCES.md
data/poems.jsonl         scripts/build.mjs      scripts/validate.mjs
curated/additions.jsonl  curated/corrections.jsonl
```
1. **`scripts/build.mjs`**:读上游→规范化(朝代/保留标点)→标 `provenance=upstream`+`source`+`license`→派生
   genre→套用 `curated/` 层→算 id/`dup_group`→输出 `data/*.jsonl`。**可重复运行**(= 与父库同步)。
2. **`curated/` 层**:见下「校勘工作清单」。
3. **`scripts/validate.mjs`**:schema / 朝代键 / 简体编码(无 `?■□�`)/ 去重报告 / provenance 齐全 /
   现代条目有 license / corrections 唯一命中。**构建后必跑,全过才算完成。**
4. **README/SOURCES/LICENSE**:诚实声明**混合许可**(古典 PD + 现代非商用),列上游来源与各自许可。
5. 跑 build+validate,产出 `data/poems.jsonl`,在 `REPORT.md` 给统计(总数、按朝代、按 genre、dup_group 数、
   curated 条数、因许可隔离的条数)。

## 校勘工作清单（`curated/`,逐条带风险标 —— 守铁律)
| 类型 | 条目 | 处理 |
|---|---|---|
| corrections | **毛泽东《七律·到韶山》「敢叫」→「敢教」** | `matchFirstLine:"别梦依稀咒逝川"`,`corrected_from` 留原句。license:毛 2027 前在册,note 标。 |
| additions | **袁枚《所见》**(qing) | 「牧童骑黄牛/歌声振林樾/意欲捕鸣蝉/忽然闭口立」,PD,`source` 标《小仓山房诗集》。 |
| additions | **毛泽东缺篇** | 对照权威全集补真作;license 同上。 |
| additions | **叶嘉莹**(jinxiandai) | 🔴 著作权到 2074。**默认隔离**:进 `curated` 但 `license:"⚠in-copyright(2074)"`,在 REPORT 列出交 owner 决定是否纳入公开仓。 |
| additions | **兰楚芳**(yuan,散曲) | `genre:"qu"`;散曲多俗字,但本库**不删字**,照收并标来源;若无权威简体文本则进存疑区。 |

> 清单外发现的"上游确实缺/确实错"高价值条目,可按同 schema 增补,同样守铁律 + 进 REPORT。
> **绝不做**:改诗人姓名、改朝代归并、合并"同一人不同条目"——这类只在 REPORT 里写给 owner,不动数据。

## 自检(完成前必做)
对 `data/poems.jsonl` 跑 `validate.mjs` 全过;REPORT.md 末尾附自检结论 + 上面那张统计。

===
