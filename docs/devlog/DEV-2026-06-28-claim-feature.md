# 认领 (poem-claim) + 流星 — 开发文档 (2026-06-28, 第 13 代 agent)

> 用户认领虚空里捞到的诗 → 拿到一个**全站唯一、从 1 起算的认领编号**(唯一的后端) → 诗在虚空中定位、
> 化作**彗星流星**没入银河。配套:里程碑徽记、右上角低调计数器、「我的认领」纪念册、留影认领分享卡、
> 隐藏的开发者工具。**本地全验证(tsc 净 + 测试 0 失败 + 后端集成 + 5188 浏览器实测);未提交、未合并、未部署。**
> 部署 turnkey 见 `DEPLOY.md §7`(只需 owner 起后端 + 重新 build/部署)。

权威交接清单见同目录 `HANDOFF-2026-06-28-claim.md`;本文件是**完整开发参考**。

---

## 0. TL;DR

| 维度 | 实现 |
|---|---|
| 认领编号(全局,从 1) | 后端 `deploy/claim-server.mjs`(:8788,零依赖 `node:http`)。原子自增 + JSONL,重启不重号。 |
| ⚖️ **合规硬约束** | JSONL **每条只存三个数字 `{no, index, ts}`** —— **绝不存诗文/任何文字、身份、IP、UA**。客户端只发 `{index, ts}`,服务器忽略其余字段;诗由 `index`(全集编号 anyRank 双射)在前端 `pulledFromIndex` 算回,不经服务器。理由:存诗文=UGC→ICP 备案/内容审核;只存数字=数学坐标。 |
| 认领时显示(主体=诗) | 主句「**这是第 N 首被诗人认领的诗**」+ 小字「认领编号 #N」+ 副句;认领前「诗云中已有 X 首诗被认领」;离线「认领编号 · 待联网确认」。(N=认领编号,是**诗**的序号,不是人。) |
| 定位 + 流星 | 认领 → `setFlyTarget(pos)`(定位)+ `launchClaimCeremony`(从该点发一颗流星冲向银心)。 |
| 彗星流星 | `three/Meteors.tsx`:柔光头(同恒星 smoothstep)+ 屏幕空间锥形拖尾 ribbon(高斯芯);**白头→淡蓝尾**(彗星色)。ambient **顺银河公转切向**;ceremony 冲银心(奔赴感)。今日亮/往日暗(`isSameDay`,观者本地日)。 |
| 频率 | 2–10s 随机出现 1(偶尔 2)颗;开发者工具可实时调。 |
| 里程碑徽记 | `claims.claimBadge(no)`:#1 首位 / 100·1000·… 里程碑 / ≤100 早期认领者。 |
| 计数器 | 右上角「已认领 N 首」—— **故意低存在感**(小、淡、悬停才稍亮),缓动正计数;自己认领立刻 +1。 |
| 我的认领 | 更多 → 我的认领:本机纪念册(首行/#N/第 N 首/日期/徽记 + 回到那首诗),底部「仅本机」提醒。 |
| 认领分享卡 | 「留影」(cinema)对已认领的诗自动盖章「第 N 首被诗人认领的诗 · #N」→ 截图即分享。 |
| 开发者工具 | 隐藏:5 连点 诗云 logo → `ui/DevTool.tsx`(替掉旧反馈查看器)。立即生成各类流星 + 频率 + **实时外观滑块**。 |

---

## 1. 架构 / 关键决定

- **静态优先(沿用 `feedback.ts` 哲学)**:认领**永远**先写 localStorage(`state/claims.ts`,纯模块、可注入
  `Storageish`、容损,镜像 `shiyi.ts`),纯静态/离线照常工作。设了 `VITE_CLAIM_ENDPOINT` 才**同时** POST,
  服务器回的 `no` patch 回本地;离线 `no=null`→「待联网确认」。**本地额外存 `preview`(首行)做纪念册,绝不入后端。**
- **后端单独成文件**(不混进 feedback-server):feed 公开读(人人画流星),feedback 收件箱 token-gated,失败域分离。
  端口 8788,nginx `/api/claim` 同源反代。**只存 `{no,index,ts}`**(见合规硬约束)。
- **全局计数原子性**:`allocate()` 用 promise-chain mutex 串行化「读计数→写行→自增」;append 失败**不**推进计数;
  启动扫 JSONL 恢复 `counter`/`total`/`recent` 窗口。实测并发 8 路拿唯一连号 + 重启续号。
- **流星点选走 FlyControls 的 DOM onUp**(不是 R3F 对象事件,因点击路径是裸 DOM + GPU colour-pick):共享单例
  `three/meteorPick.ts`(仿 `pickTargets`/`galaxySpin`),`Meteors` 每帧写入今日(亮)流星世界坐标,`FlyControls.onUp`
  在「无 poet/poem 命中」时投影屏幕空间最近的亮流星 → `pulledFromIndex` 重建诗 → 开面板。顺序:poet/poem →
  **meteor** → 赠诗弧 → 虚空捞诗。往日流星不注册。
- **认领编号语义**:N 是**诗**在认领登记里的序号(第 N 首被认领),不是「人」的序号——一个诗人能认很多首。文案
  主体落回诗(避免「第 N 位诗人」自相矛盾)。

---

## 2. 文件清单

**新增**
- `deploy/claim-server.mjs` — 后端(全局计数 + 公开 feed,只存三数字)。
- `src/state/claims.ts` (+ `claims.test.ts`) — 本地认领库 + 今日分类 + feed∪local 合并 + `claimBadge` + 网络客户端。
- `src/three/meteorPath.ts` (+ `meteorPath.test.ts`) — 确定性流星轨迹(ambient 顺公转切向 / ceremony 俯冲)。
- `src/three/meteorPick.ts` — 亮流星点选单例。
- `src/three/Meteors.tsx` — 彗星流星渲染 + spawn 调度 + ceremony + dev 钩子。
- `src/ui/DevTool.tsx` — 开发者工具(5 连点 logo;替掉 `FeedbackViewer.tsx`,后者已删)。
- `src/ui/ClaimCounter.tsx` — 右上角低存在感计数器。
- `src/ui/ClaimsViewer.tsx` — 「我的认领」纪念册(仿 `ShiyiViewer`)。

**改动**
- `src/state/store.ts` — `meteorsOn/claimFeed/myClaims/myClaimsOpen/claimCeremony` + dev:`devToolOpen/meteorMinGap/
  meteorMaxGap/meteorSpawnReq/meteorLook` + actions。删除 `feedbackOpen/setFeedbackOpen`。
- `src/ui/PoemPanel.tsx` — 认领按钮 + 文案(定词主句/#N/副句/认领前总数/离线)+ 里程碑徽记 + 传 `preview` + ceremony。
- `src/ui/SettingsMenu.tsx` — 「流星」开关 + 「我的认领」入口;反馈框注释更新。
- `src/ui/Cinema.tsx` — 已认领的诗盖「认领分享卡」banner。
- `src/ui/HUD.tsx` — 5 连点 logo 改开开发者工具(原开反馈查看器)。
- `src/three/FlyControls.tsx` — onUp 里的流星点选分支。
- `src/App.tsx` — 挂 `<Meteors/> <ClaimCounter/> <ClaimsViewer/> <DevTool/>`(替 `<FeedbackViewer/>`)+ 启动拉公开 feed(90s 刷新)。
- `src/styles.css` — `.poem-claim/.claim-*`、`.claim-badge`、`.claim-counter`、`.myclaim-*`、`.cinema-claim`、`.devtool/.dev-*`。
- `.env.example` / `.env.local`(本机)— `VITE_CLAIM_ENDPOINT`;`vite.config.ts` — dev 把 `/api/claim` 代理到 :8788。
- **删除** `src/ui/FeedbackViewer.tsx`(被开发者工具取代;页内反馈*提交框*保留在更多)。

---

## 3. 彗星流星(经多轮 owner 调校,已定稿)

最终视觉 = **柔光头 + 锥形渐隐拖尾**,彗星色,顺公转:
- **头**:和恒星(`PoetStars`)完全相同的 `smoothstep(0.5,0.04,d)` 柔光 + 一丝 sparkle;出生闪一下(接近恒星亮度)
  再缩成恒星大小的小光点(不是白球)。
- **尾**:屏幕空间 fat-line quad,`exp(-vSide²·3)` 高斯横截面(细亮芯 + 柔辉边,不是硬线),`pow(vGrad,1.7)` 头亮尾淡;
  **头白 → 尾淡蓝**(`WHITE → PALE_BLUE=[0.6,0.78,1.0]`)。
- **轨迹**(`meteorPath.ts`,纯+测试):ambient 在发光盘内贴盘出现(`diskPoint`),沿**公转切向**短距划过
  (`ambientPath` 用 `tangent=[z,0,-x]` + 轻向心 + ±10° 抖动;**若逆自转就翻号 `[-z,0,x]`**);ceremony 从定位点俯冲银心。
- **owner 调校已烤进默认**:len .75× / width .40× / bright 2.05× / head .50×(在 `Meteors.tsx` 顶部 `PROF`/`TAIL_SPAN`);
  `store.meteorLook` 滑块仍可在此基线上实时再调。
- **演进史**(供理解):6 离散拖尾点(像光点重复/太显眼)→ 单头点 + ribbon → 调暗调慢 → 头部柔光向恒星看齐 →
  诊断"白硬线 vs 彩色柔光"(查了真实流星色谱/渲染技法)→ 彗星白→淡蓝渐变 + 缩头加长 + 顺公转切向。

---

## 4. 开发者工具(`ui/DevTool.tsx`)

5 连点 诗云 logo 打开(界面可见时)。store 字段:`devToolOpen / meteorMinGap / meteorMaxGap / meteorSpawnReq /
meteorLook`。
- **立即生成**(免等自动节流):今日·亮 / 往日·暗 / 当事人·奔赴(合成 index,无认领数据也能生成)。
- **频率**:最短/最长间隔双滑块 + 预设(密集 0.4–1.2s / 默认 2–10s)。
- **外观(实时)**:拖尾长度 / 线宽 / 亮度 / 头部大小 四个 ×倍率滑块 + 恢复默认 —— 因 headless rAF 冻结、Claude 看不到
  动画,owner 用它在真实 5199 拖到满意,定稿后把数值烤进 `PROF`。

---

## 5. 产品层(T1,全做)

- **文案**:见 §0;主体=诗。`PoemPanel.tsx` `.claim-*`。
- **里程碑/早期印记**:`claimBadge(no)`(纯+测试)→ PoemPanel 认领态 + 我的认领行的金/冷小徽记。
- **右上角计数器**:`ClaimCounter.tsx`,`已认领 N 首`,`max(feed.total, 我的no)` 缓动正计数;**低存在感**
  (opacity .5,小,muted);仅 `hasClaimServer && total>0`,截图模式随 App overlay 块隐藏。
- **我的认领**:`ClaimsViewer.tsx`(仿 `ShiyiViewer`),列 `myClaims`(本机 `{index,no,ts,preview}`),点行 → `pulledFromIndex`
  回到那首诗;底部「仅存于此浏览器 · 清缓存/换设备会丢列表;但认领编号在全站永久保留」。更多 → 我的认领 打开。
- **认领分享卡**:`Cinema.tsx` 检测 `myClaims` 里有当前 `resolved.index` → 卡上盖 `.cinema-claim` banner。复用留影系统,
  零新基建。

---

## 6. 验证(本地)

- `tsc --noEmit` 干净。`vitest run` **0 失败**(claims 纯逻辑/今日分类/合并/claimBadge + meteorPath 确定性/切向)。
  ⚠️ **测试总数有噪声**:vitest 会扫到 `.claude/worktrees/*/src` 里别的分支的测试副本,所以总数忽高忽低——**看 0 失败,别看总数**。
- **后端集成**(`scratchpad/claim-test.mjs`):顺序连号;并发 8 路唯一连号;非法 index 400;feed 形状;重启续号;
  **每行恰好 `{no,index,ts}`**;**额外字段(form/poem/ua)被丢弃、诗文不落地**。全 PASS。
- **浏览器(5188 预览,DOM 级)**:文案「这是第 24 首被诗人认领的诗」+「#24」+「✦ 早期认领者」+ 副句;右上计数器
  23→24(自己认领 +1);我的认领行 + 徽记 + 底部提醒;留影盖章 banner;无 console 报错。
- **局限**:headless 预览 `requestAnimationFrame` 在后台被冻结(galaxySpin 不前进 → useFrame 不跑),**流星动画
  跑不动、看不到**;着色器编译/逻辑已验,**最终视觉需 owner 在真实 5199 看**(rAF 正常)。见 `[[shiyun-preview-verification]]`。

---

## 7. ⏳ 待办 / loose ends(给下一任)

1. **部署后端**(最高优先,可选但功能需要):`DEPLOY.md §7` turnkey ——起 `shiyun-claim.service`(:8788)+ nginx
   `/api/claim` + `.env.local VITE_CLAIM_ENDPOINT="/api/claim"` + 重新 `deploy:build`/rsync。**不部署也安全**(编号「待联网确认」)。
2. **流星切向「顺/逆」**:`ambientPath` 先用 `[z,0,-x]`;若 owner 在 5199 看到流星逆自转,翻成 `[-z,0,x]`(已在注释标自检点)。
3. **文档未提认领**:`docs/{ARCHITECTURE,FRONTEND_GUIDE}.md`、`README` 尚未写认领/流星——要对外宣发再补。
4. **提交 / 合并**:整功能仍在 `main` 工作树未提交。合并前建议跑一遍 `tsc` + `vitest`(看 0 失败)+ owner 5199 眼测。
5. **PM 路线 T2(未做,等 owner)**:今夜流星雨回放 / 认领编年史时间线 / 跨设备**导出·书签**(缓解清缓存即丢)。
   **红线**:绝不做服务器存文字/身份、不做「人」的排行榜(合规 + 匿名)。
6. **会话流星上限**:严格「看到 ≤ 总数」,认领少时天空很快变静(设计内)。

---

## 8. 锚点

- memory:`[[shiyun-claim-feature]]`(本功能全貌)、`[[shiyun-prod-deployment]]`(部署拓扑)、
  `[[shiyun-preview-verification]]`(headless rAF 冻结、5188 预览技巧)、`[[shiyun-maintenance-footguns]]`、`[[shiyun-auto-dev-server]]`。
- 文档:`DEPLOY.md §7`(后端 turnkey)、`HANDOFF-2026-06-28-claim.md`(交接)、`.env.example`(`VITE_CLAIM_ENDPOINT`)。
- 权威红线:后端只存 `{no,index,ts}`;`claims.jsonl` IS 全局计数器(备份它,内含无文字)。
