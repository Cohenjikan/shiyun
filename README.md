<div align="center">

<img src="docs/assets/hero.jpg" alt="诗云 · Poetry Cloud —— 把中国三千年的诗放进一片三维星系" width="100%" />

# 诗云 · Poetry Cloud

**中文** · [English](README.en.md)

### 把中国全历史的诗，放进一片可以漫游的三维星系。<br/>每位诗人是一颗星，每首诗都有自己的坐标 —— 星与星之间的虚空，是「一切可能的诗」。

*灵感来自刘慈欣《诗云》与博尔赫斯《巴别图书馆》：诗不被储存 —— 给一个编号就能算出第几首诗，反之亦然。*

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-orange.svg?style=flat-square)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-r169-000000.svg?style=flat-square&logo=three.js&logoColor=white)](https://threejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![100% Static](https://img.shields.io/badge/100%25-Static-15803d.svg?style=flat-square)](#-快速开始)
[![Stars](https://img.shields.io/github/stars/Cohenjikan/shiyun?style=flat-square&logo=github)](https://github.com/Cohenjikan/shiyun/stargazers)

<br/>

[![在线体验 · shiyun.cohenjikan.com](https://img.shields.io/badge/▶_在线体验-shiyun.cohenjikan.com-e9b850?style=for-the-badge)](https://shiyun.cohenjikan.com)

<img src="docs/assets/galaxy.jpg" alt="诗云主界面：一整片由真实诗人构成的星系，顶栏可按诗体 / 朝代 / 格律筛选" width="92%" />

<sub>▶ 介绍视频：<a href="docs/assets/promo.mp4">docs/assets/promo.mp4</a>　·　<a href="https://b23.tv/5lPqfvm">哔哩哔哩</a>　·　<a href="https://v.douyin.com/ZOGhSElhG-4/">抖音</a>　·　<a href="http://xhslink.com/o/5FNxYo4EDPh">小红书</a></sub>

</div>

---

## 这是什么

**32,657 位诗人、933,857 首诗**，我把中国全历史的诗歌放进了一片三维星系。灵感来自刘慈欣的短篇《诗云》—— 那本书讲述了一个想用穷举写尽所有诗的超级文明，我做的这个也叫「诗云」。

每位诗人是一颗星，每首诗都有自己的空间坐标，可以缩放、漫游整片星空，随手点开一颗星就是一首诗，还能看到诗人之间的关系网络。从《诗经》到近现代，三千年的诗都在这一片宇宙里。**李白是很亮的一颗星，但更多的是那些你从没听过名字的人，也各自占着一个坐标。**

而星与星之间的**虚空**，藏着比这更大的东西 —— 它是「一切可能的近体诗」。点一下空处，就从噪声里 `unrank` 出一首诗，并显示它在「全集目录」里那个长达 **82–229 位**的编号：地址几乎和诗本身一样长（目录即图书馆）。诗不被储存，给一个编号就能算出它是第几首诗，反之亦然 —— 杰作只是噪声海里的零测度亮点。

> 🖥 **PC 端体验最完整。** 移动端可用（触控漫游 + 自适应画质），但飞行、拾取与关系网在大屏鼠标下最舒服。

<div align="center">

### ▶ [打开 shiyun.cohenjikan.com，到星海里捞一首诗](https://shiyun.cohenjikan.com)

</div>

---

## 截图

<table>
<tr>
<td width="50%"><img src="docs/assets/poem.jpg" alt="点开一颗星：李白《望庐山瀑布》竖排呈现，并显示它在全集目录里的完整编号" /><br/><sub><b>随手点开一颗星，就是一首诗</b> —— 连同它在「全集目录」里那个长长的唯一地址。</sub></td>
<td width="50%"><img src="docs/assets/network.jpg" alt="选中李白：金色弧线汇出他与其他诗人的赠答网络，右侧列出全部作品" /><br/><sub><b>赠诗网络</b> —— 解析诗题与字号别名连出 4,976 条赠答弧线，选中一位即勾出其往来。</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/compose.jpg" alt="探诗：左侧填字成诗实时算出编号，右侧可凭编号反查回一首诗" /><br/><sub><b>探诗</b> —— 填字成诗实时算出编号，或凭一串编号反查回唯一的那首诗。</sub></td>
<td width="50%"><img src="docs/assets/poet.jpg" alt="选中杜甫：他的作品系统与赠答关系在星系中点亮" /><br/><sub><b>每位诗人都是一个小星系</b> —— 作品越多，星系越大；点定位即可飞到任意一首。</sub></td>
</tr>
</table>

---

## 它能做什么

| 能力 | 说明 |
|---|---|
| **全朝代 + 新诗** | 先秦 → 当代，15 个朝代同心壳，可按朝代筛选；并收入**现代新诗**（徐志摩《再别康桥》、海子、北岛、顾城、戴望舒…，自由体归入「其它」）。 |
| **五种诗体** | 五绝 / 七绝 / 五律 / 七律，外加**自由格式 / 词**（变长断句，换行也由编号决定）；**格律开关**让你只在「合律子目录」里漫游。 |
| **寻诗 · 逐句搜索** | 输入任意一句（不限开头）→ 它在「真实诗人」里属于谁（疑是地上霜 → 李白《静夜思》，非首句也命中），同时给出「纯随机」目录里那个被诗句锁定的**半编号**。 |
| **探诗 · 编号反查** | 把一个长编号 `unrank` 回它的诗，核对行索引与全文，告诉你这串数字是否对应一首**真实存在**的诗 —— 目录 ↔ 诗的闭环，全程显示未截断的完整编号，一键复制。 |
| **赠诗网络** | 解析诗题（寄 / 赠 / 和 / 次韵…）与 ~250 条字号别名（少陵 → 杜甫、子瞻 → 苏轼、香山 → 白居易…）连出 **4,976** 条赠答弧线，束状汇向银心，沿弧涌动柔光脉冲。 |
| **可分享的永久链接** | `#a=<诗人id>` / `#p=<诗体>.<编号>`，诗与诗人面板均有 🔗 分享，打开即从链接重建那首诗、复位那片星空。 |
| **纯静态** | 所有索引运算与渲染都在浏览器里完成，服务器只发静态文件，**永不加后端**（唯一可选后端是匿名反馈收集）。 |

**三种 pull 模式，感受这个项目：** 纯随机「牛蝛茙漂綵」→ 格律「趰㵎憣烔岆」→ 格律+常用字「思伦要锁馆」；再加自由格式的词式变行，以及「寻诗」从一句话找回一首真实的诗。

---

## 背后的想法

诗云不存诗 —— 它存的是一个**双射**。每一首近体诗，都对应一个巨大的整数编号；给定编号能精确还原出诗，给定诗也能算回编号（base-N「巴别」进制 + 格律混合基数 rank/unrank，叠加可逆的 BigInt Feistel 置乱做空间散布）。索引引擎是**纯 TypeScript、零依赖**的，往返可逆，单元测试全绿。

于是「写出所有可能的诗」不是收藏，而是**计算**：星海里的每一个坐标都是一首诗，绝大多数是噪声，偶尔一颗恰好是李白。真实诗人的真实作品，则是这片噪声海里被点亮的、有名有姓的亮点。

更多细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（分层架构）、[docs/ENGINE_API.md](docs/ENGINE_API.md)（引擎接口与不变量）、[docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md)（数据契约）。

---

## 🚀 快速开始

```bash
npm install
npm run dev      # 开发预览（Vite）
npm test         # 引擎往返 + 数据加载等单元测试
npm run build    # 类型检查 + 静态构建 → dist/
```

> Node 20+。技术栈：**Vite + React 18 + TypeScript + three.js / @react-three（fiber · drei · postprocessing）+ zustand**。

仓库自带轻量数据（星系、作者搜索、格律、半编号、赠诗网络都能跑）；**逐首诗的全文**与**逐句搜索索引**是体量很大的衍生数据（git-ignore），需要时按 [docs/PIPELINE.md](docs/PIPELINE.md) 从开放语料重新生成。部署到静态主机的完整教程见 **[docs/DEPLOY.md](docs/DEPLOY.md)**（注意 `poems/*.json` 必须以 RAW 提供，HTTP Range 取片依赖它）。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层架构，哪些稳定 / 哪些是可替换的前端原型，数据流。 |
| [docs/ENGINE_API.md](docs/ENGINE_API.md) | 引擎与 engineApi 接口、不变量、最高位约定。 |
| [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) | 静态资源 schema、语料来源、朝代归一化。 |
| [docs/DATA_AUDIT.md](docs/DATA_AUDIT.md) | 语料选型审计：为什么是现在这套开放语料。 |
| [docs/PIPELINE.md](docs/PIPELINE.md) | 数据与格律字库是怎么构建的。 |
| [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) | 重写前端的契约：4 个稳定接口、交互模型。 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 静态部署（nginx + 压缩 + poems/ Range 注意事项）。 |
| [docs/DEVLOG.md](docs/DEVLOG.md) · [docs/devlog/](docs/devlog/) | 开发日记（迭代编年史）+ 历史会话交接 / 单次变更运维单归档。 |

---

## 关于

诗云是一个 **vibecoding** 作品：由我（[Cohen](https://cohenjikan.com)）设计并把关方向，主要的代码骨架与迭代由 **Claude** 编写处理 —— 仓库里完整保留了这段人机协作的开发日记（[docs/DEVLOG.md](docs/DEVLOG.md) 与 [docs/devlog/](docs/devlog/)）。

它在抖音 / 小红书 / 哔哩哔哩等平台**累计获得约 60 万点赞**，也是我一系列**非商业、源码公开**项目中的一个。代码以 **PolyForm Noncommercial 1.0.0** 许可发布，欢迎学习、自建与**非商业**二次创作；诗歌语料（尤其现当代新诗文本）的版权属于原作者，请勿用于商业用途。

更多项目见我的主页 **[cohenjikan.com](https://cohenjikan.com)** 与 GitHub **[@Cohenjikan](https://github.com/Cohenjikan)**。

---

## 开源致谢

**站在这些开源工作之上：**

- **渲染 / 框架** —— [three.js](https://threejs.org)、[@react-three/fiber · drei · postprocessing](https://github.com/pmndrs/react-three-fiber)、[React](https://react.dev)、[Vite](https://vitejs.dev)、[zustand](https://github.com/pmndrs/zustand)；格律字库构建用到 [opencc-js](https://github.com/nk2028/opencc-js) 与 [pinyin-pro](https://github.com/zh-lx/pinyin-pro)。
- **诗歌语料** —— 以 [Werneror/Poetry](https://github.com/Werneror/Poetry)（MIT，先秦→当代，简体）全历代为骨，叠加 [sheepzh/poetry](https://github.com/sheepzh/poetry) 与 [yuxqiu/modern-poetry](https://github.com/yuxqiu/modern-poetry)（Apache-2.0）的现当代新诗；格律用 [charlesix59 平水韵](https://github.com/charlesix59/chinese_word_rhyme)（MIT）。各语料保留其上游许可，详见 [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) 与 [docs/DATA_AUDIT.md](docs/DATA_AUDIT.md)。
- **灵感** —— 刘慈欣《诗云》、博尔赫斯《巴别图书馆》。
- **开发协作** —— 主要代码骨架由 **Anthropic 的 Claude** 编写处理（vibecoding）。

---

## 许可

代码以 **[PolyForm Noncommercial 1.0.0](LICENSE)** 许可发布 —— **源码公开、仅限非商业使用**；商用授权请联系作者（截至提交 `0a64a5d` 的旧版本仍按 MIT 授权，对那些版本继续有效）。诗云自有的整理性元数据（标注 / 索引）以 **CC BY-NC 4.0** 提供；诗歌语料各自保留上游许可与权利，尤其现 / 当代诗歌**文本**的版权归原作者所有，仅作**非商业**使用。详见 [LICENSE](LICENSE) 与 [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md)。

<div align="center">
<sub>从《诗经》到近现代，三千年的诗都在这一片宇宙里。</sub>
</div>
