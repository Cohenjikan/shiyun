# 诗云 · Poetry Cloud

**[中文](#中文) · [English](#english)**

A roamable 3D star map where real historical poets are real-corpus star clusters, and the
void between them is the space of *all possible* regulated-verse poems — pulled out on click
via an index↔poem bijection that is **computed, never stored**.

> 灵感来自刘慈欣《诗云》与博尔赫斯《巴别图书馆》。诗不被储存——给一个编号就能算出第几首诗,
> 反之亦然。杰作只是噪声海里的零测度亮点。

![status](https://img.shields.io/badge/engine-44%2F44_green-success) ![status](https://img.shields.io/badge/build-static-blue)

---

## 中文

一张可在其中飞行的三维星图:**每位历史诗人是一团真实星**(他真实写过的诗),星团之间的**虚空是一切可能的近体诗**。点击虚空,就从噪声里 `unrank` 出一首诗,并显示它在"全集目录"里那个长达 82–229 位的编号——地址几乎和诗本身一样长(目录即图书馆)。

- **全朝代 + 新诗**:先秦 → 当代,15 个朝代同心壳,可按朝代筛选;并收入 **现代新诗**(徐志摩《再别康桥》、海子、北岛、顾城、戴望舒…,自由体归入"其它")。语料以 [Werneror/Poetry](https://github.com/Werneror/Poetry)(MIT,先秦→当代,简体)全历代为骨,叠加 [yuxqiu/modern-poetry](https://github.com/yuxqiu/modern-poetry) 的现代新诗。共 **29,808 位诗人 / 857,877 首诗 / 字库 N = 12,877**(上游原始计数)。这是现有体量最大的"全朝代 · 简体 · 宽松许可 · 可机读"开放语料;唐宋诗人名录近乎齐备,明清因无《全明诗》《全清诗》而偏薄。数据审计与替代方案见 [docs/DATA_AUDIT.md](docs/DATA_AUDIT.md)。
- **五种诗体**:五绝/七绝/五律/七律,外加 **自由格式 / 词**(变长断句,换行也由编号决定);**格律开关**:在"合律子目录"里漫游(嵌套于纯随机目录内)。
- **逐句搜索**:输入任意一句(不限开头) →「真实诗人」里它属于谁(疑是地上霜 → 李白《静夜思》,非首句也能命中),同时给出「纯随机」目录里那个被诗句锁定的 **半编号**(诗的全集编号正以这串高位开头)。
- **编号反查**:把一个长编号 `unrank` 回它的诗,核对行索引与全文,告诉你这串数字是否对应一首**真实存在**的诗——目录↔诗的闭环。全程显示未截断的完整编号,附一键复制。
- **赠诗网络**:解析诗题(寄/赠/和/次韵…)与 ~250 条字号别名(少陵→杜甫、子瞻→苏轼、香山→白居易…)连出 **4,849** 条赠答弧线;束状汇向银心(类层次边捆绑),沿弧涌动柔光脉冲(赠者→受者),选中一位即勾出其往来自我网。
- **可分享的永久链接**:`#a=<诗人id>` / `#p=<诗体>.<编号>`,诗与诗人面板均有 🔗 分享,打开即从链接重建那首诗、复位那片星空。
- **纯静态**:所有索引运算与渲染都在浏览器,服务器只发静态文件,**永不加后端**。

运行:
```bash
npm install
npm run dev     # 开发预览
npm test        # 引擎往返测试
npm run build   # 静态构建 → dist/
```

文档:[架构](docs/ARCHITECTURE.md) · [引擎接口](docs/ENGINE_API.md) · [数据契约](docs/DATA_CONTRACT.md) · [数据管线](docs/PIPELINE.md)

---

## English

A 3D star map you fly through: **each historical poet is a cluster of real stars** (poems
they actually wrote); the **void between clusters is every possible regulated-verse poem**.
Click the void and a poem is `unrank`ed out of the noise, shown with its 82–229-digit address
in the "complete catalog" — the address is nearly as long as the poem itself (the catalog
*is* the library).

- **All dynasties + modern verse** 先秦→当代, 15 concentric shells, filterable; now including
  **modern free verse** (徐志摩's 《再别康桥》, 海子, 北岛, 顾城, 戴望舒… — free forms folded
  into "other"). Corpus = Werneror (full history, MIT, Simplified) backbone + yuxqiu/modern-poetry
  modern overlay. **29,808 poets / 857,877 poems / charset N = 12,877** (raw upstream count) — the
  broadest permissively-licensed Simplified all-dynasties *open* corpus; near-complete on Tang/Song
  poet rosters, thinner on 明/清 (no complete 全明诗/全清诗 exists). Audit: [docs/DATA_AUDIT.md](docs/DATA_AUDIT.md).
- **Five forms** (5/7-char quatrains & regulated verse) **+ free-verse / 词** (variable line
  lengths — the line breaks are part of the index too) + a 格律 toggle that roams only the
  valid sub-catalog (nested inside the random one).
- **Search by any line** — type *any* line, not just openings: find the real poem it belongs
  to (疑是地上霜 → 李白's 《静夜思》, a non-first line, now resolves) *and* the **half-number**
  that line pins (the poem's full address starts with it). The whole corpus is line-indexed.
- **Reverse lookup by index** — `unrank` a long address back to its poem; it checks the line
  index and full text and tells you whether that number is a *real* poem — the catalog↔poem
  loop closed. Full untruncated numbers everywhere, with one-click copy.
- **Dedication network** — titles (寄/赠/和/次韵…) plus ~250 courtesy-name aliases (少陵→杜甫,
  子瞻→苏轼, 香山→白居易…) parsed into **4,849** poet-to-poet arcs: bundled toward the galactic
  core (poor-man's hierarchical edge bundling), a soft pulse flowing giver→receiver; select a
  poet to draw their ego-network.
- **Shareable permalinks** — `#a=<poetId>` / `#p=<form>.<index>`; a 🔗 share button on every
  poem and poet panel rebuilds the poem from the link and restores the view on load.
- **Fully static** — all index math + rendering run client-side; the server only serves
  files. No backend, ever.

```bash
npm install && npm run dev
```

Docs: [Architecture](docs/ARCHITECTURE.md) · [Engine API](docs/ENGINE_API.md) ·
[Data Contract](docs/DATA_CONTRACT.md) · [Pipeline](docs/PIPELINE.md)

---

*Engine math: base-N (Babel) + mixed-radix-product (格律) rank/unrank, reversible BigInt
Feistel scatter. Pure TypeScript, zero-dependency core, 44 round-trip tests. Rendering atop
three.js / @react-three (fiber · drei · postprocessing v2.19 for UnrealBloom). MIT.*
