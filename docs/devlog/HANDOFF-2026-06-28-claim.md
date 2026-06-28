# 交接 — 认领 (poem-claim) + 流星 (2026-06-28,给下一任 agent)

> 完整开发参考见同目录 `DEV-2026-06-28-claim-feature.md`;本文件是**精简交接**。

## 0. TL;DR
- **做了什么**:用户认领虚空捞到的诗 → 全站唯一**认领编号**(从 1,后端发号) → 诗定位 + 化作**彗星流星**没入银河。
  配套:里程碑徽记、右上角低调计数器、「我的认领」纪念册、留影认领分享卡、隐藏开发者工具。
- **状态**:**全在 `main` 工作树,未提交、未合并、未部署。** 本地全验证(tsc 净 + vitest 0 失败 + 后端集成 + 5188 浏览器实测)。
- **不部署也安全**:无 `VITE_CLAIM_ENDPOINT` 时认领仍本地工作,编号显示「待联网确认」,纯静态不破。

## 1. 🔴 头号任务:部署后端(可选但功能需要,turnkey)
按 **`DEPLOY.md §7`** 跑(需 prod SSH):起 `shiyun-claim.service`(`deploy/claim-server.mjs` :8788)+ nginx
`location /api/claim` + 本机 `.env.local` 设 `VITE_CLAIM_ENDPOINT="/api/claim"` + `npm run deploy:build` + rsync。
- ⚖️ **合规红线(勿违)**:后端 JSONL **每条只存 `{no, index, ts}`,绝不存诗文/文字/身份/IP/UA**。`claims.jsonl`
  IS 全局计数器 —— **备份它**(内含无文字),丢了会重置编号。

## 2. ✅ 已做 + 已验
| 模块 | 文件 | 验证 |
|---|---|---|
| 后端(原子发号 + 公开 feed) | `deploy/claim-server.mjs` | 并发唯一连号 / 重启续号 / 只存三数字 / 丢弃额外字段 全 PASS |
| 本地认领库 + 今日分类 + 合并 + 徽记 | `state/claims.ts` (+test) | 19 测试绿 |
| 彗星流星(白头→淡蓝尾,顺公转)| `three/{Meteors.tsx,meteorPath.ts(+test),meteorPick.ts}` | 着色器编译过、逻辑有测试;**视觉需 owner 真实浏览器看** |
| 文案 + 徽记 | `ui/PoemPanel.tsx` | 「这是第 N 首被诗人认领的诗」+ #N + ✦徽记 实测 |
| 右上计数器(低存在感)| `ui/ClaimCounter.tsx` | 23→24 自己认领 +1 实测 |
| 我的认领纪念册 + 本机提醒 | `ui/ClaimsViewer.tsx` | 行 + 徽记 + 底部提醒 实测 |
| 认领分享卡 | `ui/Cinema.tsx` | 留影盖章 banner 实测 |
| 开发者工具(替反馈查看器)| `ui/DevTool.tsx`(删 `FeedbackViewer.tsx`)| 面板/生成/滑块 实测 |

## 3. 本地怎么跑(看效果)
```bash
# 后端(演示,持久数据放 %TEMP%):
PORT=8788 CLAIM_FILE="$TEMP/shiyun-claims-demo.jsonl" node deploy/claim-server.mjs
# 前端:确保 .env.local 有 VITE_CLAIM_ENDPOINT="/api/claim",再起 dev(vite 代理 /api/claim → 8788):
npm run dev          # 5199;strictPort,先腾端口
```
本会话留了 5199(dev)+ 8788(后端,~24 条种子认领)在跑;重启见 `[[shiyun-auto-dev-server]]`(detached Start-Process)。
**5 连点 诗云 logo → 开发者工具**(密集生成 + 实时外观滑块)。

## 4. ⏳ 待办 / loose ends
1. **部署**(§1)。
2. **流星切向自检**:`ambientPath` 先用 `[z,0,-x]`;owner 在 5199 若见流星**逆**自转,翻成 `[-z,0,x]`(注释已标)。
3. **提交/合并**:合并前 `tsc` + `vitest`(看 **0 失败**,别看总数——worktree 副本噪声)+ owner 5199 眼测。
4. **文档未提认领**:`docs/{ARCHITECTURE,FRONTEND_GUIDE}.md` + `README` 还没写认领/流星。
5. **PM T2(未做,等 owner)**:今夜流星雨回放 / 认领编年史 / 跨设备导出·书签。**红线:不做服务器存文字/身份、不做人榜。**

## 5. 特殊 footgun
- **vitest 测试总数飘**:vitest 扫 `.claude/worktrees/*/src` 里别的分支的测试副本 → 总数 1400~1700 乱跳,**只看 0 失败**。
- **headless 预览看不到流星**:Claude 的无头预览 `requestAnimationFrame` 在后台冻结(galaxySpin 不前进 → useFrame 不跑),
  所以**流星动画 Claude 看不到**,只能验 DOM/编译/逻辑;最终视觉靠 owner。见 `[[shiyun-preview-verification]]`。
- **后端是唯一可变状态**:`claims.jsonl` = 全局计数器,务必备份;且永远只存三数字(合规)。

## 6. 锚点
- memory:`[[shiyun-claim-feature]]`、`[[shiyun-prod-deployment]]`、`[[shiyun-preview-verification]]`、`[[shiyun-maintenance-footguns]]`、`[[shiyun-auto-dev-server]]`。
- 文档:`DEV-2026-06-28-claim-feature.md`(完整开发参考)、`DEPLOY.md §7`(后端 turnkey)、`.env.example`。
