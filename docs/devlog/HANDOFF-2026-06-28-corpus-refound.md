# 交接 — 2026-06-28 字库再奠基 + 换源(给下一任 agent)

> 本轮 = 诗云史上最大改动。**已合并 `main` + 推 origin;PROD 未部署。** 下一任的头号任务 = 部署(见 §2)。

## 0. TL;DR
- **做了什么**:① 字库再奠基(N 12,877→**22,219**,全 CJK 基本块超集,**原字 0 丢失**);② 换源(C:/corpus 原始仓 → 独立标注库 **shiyun-corpus**,诗 **970,319** / 诗人 **33,458**);③ 虚空捞诗 **Zipf 字频加权**(修扩容后乱码);④ 许可 **MIT→PolyForm Noncommercial 1.0.0** + 数据 CC BY-NC;⑤ README 计数/数据源/播放量(1000万播放·150万赞)对齐。
- **状态**:`main` tip ≈ `b17073b`(已推 origin)。Phases 1–3 全验证(tsc clean + vitest **1689 绿** + 5190 浏览器实测)。**prod 仍是旧版(a392703b/12877),未部署。**
- **新红线(已在 main,prod 部署后才上线)**:charset hash **`a9cde1f2`** / N **22,219** / 计数 **33,458 · 970,319 · 5,165**。

## 1. 关键背景(为什么动红线)
owner 指出旧 12,877 冻结字库 = "常用字子集",连 锂/钠/镁/全元素/方言 都无坐标,违背"巴别图书馆/穷尽一切"概念;判定 `#p=` 是数学概念非营销,**可一次性重置**。故主动 REFLOW 扩字库到全 CJK 基本块(任何真实汉字可寻址),并换到带 provenance/体裁的 shiyun-corpus。详见 `docs/devlog/{CORPUS-SWITCH-2026-06-27-dryrun,CHARSET-GAP-2026-06-27}.md`。

## 2. 🔴 头号任务:PROD 部署(turnkey,本会话 SSH 公钥被拒)
按 **`docs/devlog/DEPLOY-2026-06-28-corpus-refound.md`** 跑(需 prod SSH):
```bash
npm run deploy:build && rm -rf dist/data/*_v1_backup
rsync -avz --delete dist/ ubuntu@<prod-host>:/var/www/shiyun/dist/
```
- ⚠️ **部署即一次性重置线上全部 `#p=`**(已认可);`#a=` 不变(32,652/32,657 保留)。
- linesf/异文**维持关**(404 guard 不动 —— 4.4GB + 2026-06-13 封禁事故根源)。
- 冒烟:无字库横幅、搜春江花月夜出张若虚、点虚空捞诗"像诗"、锂/镁可造诗、杜甫载诗正常。

## 3. 已做 + 已验(本轮提交链,均在 main)
| commit | 内容 |
|---|---|
| `d16cc5d` | build-data 换源 + REFLOW 超集字库 + NFC |
| `8e9eedb` | 重建数据(charset v2/poems/lines/search/lexicon/poets.index/gifts/manifest) |
| `d002626` | manifest.pullK(语料实际字数,信息用) |
| `f406cd7` | 虚空捞诗 Zipf 加权(`engineApi.POEM_PULL_K=3200`,plateau+taper) |
| `39b02f7` | 部署 turnkey 文档 |
| `b17073b` | README 计数/数据源/播放量 |
| (更早) `749c290` | 许可 MIT→PolyForm NC |
- 验证:原 12,877 字 0 丢失(超集);#a= 32,652 保留,5 消失=`释證悟`/`释了證`(證→证修正)+`无名氏`/`贺怜怜`/`裴维安`;`#p=` 一次性重置(设计内,1 首勘误另位移);tsc + 1689 测试;5190 实测(33,458 诗人载入、杜甫1593首、连横在册、捞诗像诗、无横幅)。

## 4. ⏳ 待办 / 已知 loose ends
1. **PROD 部署**(§2)—— 最高优先。
2. **文档残留旧计数**:`docs/{ARCHITECTURE,DATA_CONTRACT,FRONTEND_GUIDE,PIPELINE}.md` 仍是 **32,657 / 933,857 / 4,976**(present-tense),需改 **33,458 / 970,319 / 5,165**;字库 **12,877→22,219**(注意区分历史叙述,别误改 devlog 的过去态)。README 本轮已改。
3. **`[[shiyun-maintenance-footguns]]` 记忆**:hash a392703b→a9cde1f2、N 12877→22219、counts 待更新(**prod 部署后**才与线上一致;现 main 已是新值)。
4. **体裁(诗/词/曲/新诗)过滤 UI**:corpus 自带 genre,数据在,但前端过滤器**未做**(可选新功能)。
5. **linesf/异文**:关闭中;若要恢复需重建 4.4GB linesf + 改 nginx 404 guard(慎,见事故史)。
6. **5 消失诗人** 的老 `#a=` 会断(可接受;如在意可加 redirect 别名)。

## 5. 🔴 当前状态的特殊 footgun
- **`main` 工作树 = refound**(tracked charset a9cde1f2 + 磁盘 gitignored poems = refound,已同步)。**切到任何旧分支/旧 commit 会令 tracked charset 与磁盘 poems desync** —— 停在 main;若要重建 refound 数据:
  ```bash
  CORPUS_SOURCE=shiyun-corpus REFLOW_CHARSET=1 node --max-old-space-size=6144 pipeline/build-data.mjs
  # 新 hash 写进 src/data/charsetHash.ts；再 build-lexicon + build:lines/sidecars/search
  ```
  (全链脚本 + 自动写 hash:`scratchpad/refound-rebuild.sh`)
- build-data 默认仍读 C:/corpus;**换源走 `CORPUS_SOURCE=shiyun-corpus`**(否则会构建旧源!)。

## 6. 锚点 + memory
- memory:`[[shiyun-corpus-refound-2026]]`(本轮全程)、`[[shiyun-corpus-db]]`(独立库)、`[[shiyun-prod-deployment]]`、`[[shiyun-maintenance-footguns]]`(待更新)、`[[shiyun-open-source]]`(许可已转)。
- 文档:`DEPLOY-2026-06-28-corpus-refound.md`(部署)、`CORPUS-SWITCH-2026-06-27-dryrun.md`(可行性)、`CHARSET-GAP-2026-06-27.md`(字库缺口分析)。
- 权威计数:`public/data/manifest.json`(n 22219 / pullK 13564 / poetCount 33458 / poemCount 970319 / giftEdges 5165)。
