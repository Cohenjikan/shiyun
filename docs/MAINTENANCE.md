# 诗云 / Poetry Cloud — 维护报告 (MAINTENANCE LOG)

> 诗云的常规维护记录。最新在上。每条:背景 / 改动 / 涉及文件 / 验证 / 状态。
> 架构与稳定契约见 [docs/ARCHITECTURE.md](ARCHITECTURE.md);权威数据计数以 `public/data/manifest.json` 为准
> (当前 v3:32,657 诗人 · 933,857 首 · 4,976 赠诗边 · 字库 N=12,877)。

## 维护节奏
- **本次:2026 年 6 月常规维护**(首次正式维护轮)。
- **此后:每年一次**常规维护。

## 维护方式(本轮约定)
- 在 git worktree 分支 **`claude/june-maint-2026`** 中修改,**不直接动 `main`**。
- 每项完成跑门禁:`npm run build`(tsc --noEmit && vite build)+ `npm test`(vitest)。
- 3D / 视觉 / 触屏交互**无法 headless 验证**,需 owner 在 `http://localhost:5199`(及触屏真机)眼测。
- **owner 检查通过后**,再把 `main` 快进合并到本分支(`git checkout main && git merge --ff-only claude/june-maint-2026`)。

---

## 2026-06 维护轮

### 0. 检索权重调整 —— ✅ 已完成(前序工作,记录在案)
整联(多句)搜索曾命中错误的诗。修复:
- **`lines/` 全行索引「名家优先封顶」**(`pipeline/build-lines.mjs`,`LINE_CAP` + `FAMOUS_NAMES` 排序),保证 床前明月光 之类的句子保留李白《静夜思》而非被高产小诗人挤掉。
- **前端多句整联重排**(`src/data/load.ts::searchPoems`/`searchByLine`),名家优先、每人≤2,使整句搜索命中正确的诗。

涉及:`pipeline/build-lines.mjs`、`src/data/load.ts`、`src/ui/SearchPanel.tsx`。关联提交:`1347cc8`、`4b91697`。
> 由 owner 此前完成;本报告仅登记,不重做。

---

### 第一轮 —— 前端为主

> 在 worktree 分支 `claude/june-maint-2026` 实现,**未合并 main**,待 owner 眼测。状态:🟡 设计 → 🔵 实现 → ✅ 已实现·待眼测 → 🟢 已眼测合并。
> 门禁已过:`tsc --noEmit` 干净 · `vitest` **217 全绿**(+任务2/3 新增回归测试) · `vite build` 成功。
> 3D / 触屏 / 留影排版无法 headless 验证 → 需 owner 在 `5199` 与触屏真机眼测。

#### 1. 留影(分享卡)统一设置 + 横向折叠 + 无极调色 —— ✅ 已实现·待眼测(2026-06 二次细化)
**需求(细化后):** 左下角做**统一设置按钮**(点开子菜单);**背景衬底默认关**、设置里可开;加**无极调色盘**调字体颜色;**取消横/竖排两种格式**,改为**横向折叠**——竖排列触到画面边界时自动折叠到下一行。
**实现:**
- 排版恒为竖排:`.cinema-poem` 改 `flex; row-reverse; wrap; max-width:min(92vw,1100px)`,每个 `.cinema-line` 为 `writing-mode: vertical-rl` 单列;列右→左排,触界 `flex-wrap` 折叠到下一行(长诗不再溢出)。删除旧 `cinemaLayout` 及 `.horizontal`。
- store:删 `cinemaLayout`;新增 `cinemaShowBg`(默认 `false`)+ `cinemaTextColor`(默认 `#fbf7ec`);保留 `cinemaHideTagline`。
- 可读性:多层暗描边 text-shadow **常驻**(保证亮场景基本可读);暗底 `.cinema-poem.with-bg` 仅在开「背景衬底」时加;字体颜色走内联 `style.color`(无极)。
- 左下角 `⚙ 设置` 按钮 → 弹出 `.cinema-set-menu`:背景衬底(开关,默认关)/ 字体颜色(`<input type="color">` 无极调色盘)/ 顶部文案(开关)。

涉及:`src/ui/Cinema.tsx`、`src/state/store.ts`、`src/styles.css`。
> 注:首版(自动横/竖排切换)已被本次细化取代;眼测点改为:统一设置按钮弹/收、背景开关、调色盘改色、长诗竖排是否在触界处折叠到下一行。

#### 2. 探诗诗体归类(七律被判为「词」)—— ✅ 真 bug · 已修
**判定:** **是真 bug(非误报)。** 设计阶段子代理曾判 FALSE_REPORT,我直接核查后推翻:`探诗·凭编号`(`pullByIndex`)本就调 `inferForm` 推断诗体,显示正确(七律);**但 `describeAny` 把 `form` 写死为 `"ziyou"`**,而 `pulledFromIndex`(永久链接还原 / 拾遗 / 「定位虚空」)直接用它 → 同一首七律,反查面板显示「七律」,一旦定位/分享/拾遗就被重标成「自由」,前后不一致 = 用户看到的「归类有误」。
**修复:** `describeAny` 改为用现成的 `inferForm(outLines)` 推断诗体(8×7→七律…),与 `pullByIndex` 一致;真正的自由/新诗仍推断为「自由」。`lushi/valid` 不变(不做格律校验,只修显示标签)。新增 `engineApi.test.ts` 回归用例(`pulledFromIndex` 七绝不再被标自由,且与 `pullByIndex` 一致)。

涉及:`src/engine/engineApi.ts`、`src/engine/engineApi.test.ts`。

#### 3. 触屏交互重做(只能拖、不能缩放)—— ✅ 已实现·待真机眼测(本轮改动最大)
**根因:** 旧版双指 = 调**速度**(非缩放),且双指还会**解除锁定** → 触屏用户无法缩放整体。
**实现:**
- 新增 store `freeMove`(触屏默认 `false` 锁定整体,电脑默认 `true` 自由飞行)。
- `FlyControls` 新增「整体锁定」分支:`freeMove=false` 时绕**原点**(诗云整体,星系仍在内自转)orbit —— 单指拖 = 转 yaw/pitch,双指捏合 / 滚轮 = 缩放(orbit 距离,新纯函数 `orbitZoom` + 单测)。点诗人/诗歌 = 把锁定目标换成它(复用既有 poet-lock orbit)。
- 双指仅在 `freeMove=true` 时解除锁定;锁定模式下双指改为缩放。orbit 进入时按当前视角 seed(无跳变),fly/free-fly 会让 seed 失效以便重入重新 seed。
- 「更多 · 漫游 · 交互」新增「自由移动」开关;电脑关掉它也进入整体锁定(拖动转、滚轮缩放)。

涉及:`src/three/FlyControls.tsx`、`src/three/touchGesture.ts`(+`orbitZoom`/测试)、`src/state/store.ts`、`src/ui/SettingsMenu.tsx`。

#### 4. 「更多」允许关闭随机诗 —— ✅ 已实现
**实现:** 新增 store `allowRandomPoem`(默认 `true`)。`FlyControls` 虚空点击的 `pullAt` 分支前置 gate:关闭后点虚空不再生成随机诗(且锁定模式下顺手解除锁定回到整体),点诗人/诗歌/赠诗弧不受影响。「更多 · 漫游 · 交互」加开关。

涉及:`src/three/FlyControls.tsx`、`src/state/store.ts`、`src/ui/SettingsMenu.tsx`。

#### 5. 新手引导重做 —— ✅ 已实现·待眼测
**实现:** 重写 `Onboarding` 四步,**分平台**(`COARSE`)说清:概念 → 怎么逛(触屏单指转/双指缩放/更多开自由移动;电脑 WASD/拖转/滚轮/更多关自由移动锁整体)→ 点星看真诗·点虚空捞诗·换锁定目标·更多里关随机诗 → 探诗/寻诗/留影(左下角横竖排+文案)。localStorage 键 `shiyun_onboarded_v1 → v2`,老用户重看一次。

涉及:`src/ui/Onboarding.tsx`。

---

### 验证门禁(每项必过)
```bash
npm run build     # tsc --noEmit && vite build  —— 本轮已过
npm test          # vitest 217 全绿
```
触屏 / 视觉项 + 留影排版另需 owner 在 5199 与触屏真机眼测。

### 待 owner 眼测清单(合并前)
- 留影:亮场景诗句是否清晰;长诗自动横排是否完整入图;左下角「排版 / 文案」开关。
- 触屏(真机):单指转、双指缩放整体;点诗人锁定+跟随、再点换目标;「更多」开「自由移动」恢复自由飞行。
- 电脑:默认 WASD 不变;「更多」关「自由移动」→ 拖动转 + 滚轮缩放整体。
- 关「生成随机诗」后点虚空无随机诗、点诗人正常。
- 引导四步文案分平台正确(可清 localStorage 或无痕窗口重看)。
