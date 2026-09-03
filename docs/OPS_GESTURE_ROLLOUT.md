# 诗云 · 手势控制 v2 上线手册（运维）

适用：把 `main` 上的「手势控制 v2」更新发布到 https://shiyun.cohenjikan.com 。
配套：给运维 AI 的提示词见 [OPS_GESTURE_ROLLOUT_PROMPT.md](OPS_GESTURE_ROLLOUT_PROMPT.md)；功能与原理见 [GESTURE_CONTROLS.md](GESTURE_CONTROLS.md)；通用部署流程仍以 [DEPLOY.md](DEPLOY.md) 为准，本手册只讲这次更新的增量。

## 0. 一句话

这次更新只新增一个**默认关闭**的展会功能（浏览器摄像头手势），不改语料数据、不改任何后端接口、不新增服务进程；正常按 `DEPLOY.md` 重新构建并发布 `dist/` 即可。需要额外留意的只有两点：**新增 5 个静态资源文件**（约 32 MB）和**摄像头必须走 HTTPS**（现网已是）。

## 1. 变更清单

| 类型 | 路径 | 说明 |
|---|---|---|
| 新增（git 跟踪） | `public/gesture_recognizer.task` | MediaPipe 手势模型，8.0 MB。sha256 = `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482` |
| 新增（git 跟踪） | `public/gesture-worker.js` | 识别 Worker 脚本，1.7 KB |
| 构建时生成（不进 git） | `public/mediapipe-vision.js` | 从 `node_modules/@mediapipe/tasks-vision@1.0.1` 复制，152 KB |
| 构建时生成（不进 git） | `public/mediapipe-wasm/vision_wasm_internal.{js,wasm}` | 同上，SIMD 版，11.3 MB |
| 构建时生成（不进 git） | `public/mediapipe-wasm/vision_wasm_nosimd_internal.{js,wasm}` | 同上，无 SIMD 回退版，10.5 MB |
| 新增脚本 | `deploy/sync-mediapipe.mjs` | 上面三行的复制脚本；`npm run build` / `npm run dev` 会自动先跑 |
| 新增依赖 | `@mediapipe/tasks-vision@1.0.1`（package.json / package-lock.json） | 纯前端库，构建产物随 `dist/` 静态托管 |
| 新增源码 | `src/gesture/*` | 引擎、几何、滤波、界面；均在浏览器内运行 |
| 修改 | `src/App.tsx` `src/state/store.ts` `src/styles.css` `src/three/*` `src/ui/SettingsMenu.tsx` | 挂载手势组件、设置项、事件接入；对现有交互无行为改变 |
| 文档 | `docs/GESTURE_CONTROLS.md`、`手势交互方法论.md` | 方法论 |

以上均通过 `npm run build`（`tsc --noEmit` + `vite build`）与 `npm test`（357 项）验证。

## 2. 安全边界（发布前请确认理解）

- **摄像头只在用户手动打开「更多 → 手势控制」后申请**，关闭开关立即停止摄像头与识别线程；首次进入站点不会弹权限。
- **所有识别在访客浏览器本地完成**（WebAssembly + Web Worker），不上传图像、坐标或任何统计；站点没有因此新增任何请求、接口、日志或存储。
- **没有第三方脚本**：模型、wasm、JS 全部由我们自己的域名静态托管，不从 Google/CDN 加载。
- **不需要放宽任何安全头**：不需要 COOP/COEP、不需要 SharedArrayBuffer。若站点配置了 Content-Security-Policy，需要保证 `worker-src 'self'` 与 `script-src` 含 `'wasm-unsafe-eval'`（第 6 节有检查命令）。
- **模型文件校验**：发布前后都核对 sha256（第 4、7 节），防止传输损坏或被替换。
- 发布本身对现有访客零影响：功能默认关闭，`index.html` 与 `assets/` 的内容哈希机制不变。

## 3. 前置检查

```bash
node -v        # 需要 Node 20 及以上（开发机为 24.x）
npm -v
cd <repo>      # 主工作区（含完整 public/data，约 6.9 GB）
git status     # 应干净；本地有未提交改动先停下确认
git pull       # 快进到含本次更新的 main；期望看到 commit 标题含「feat(gesture)」
df -h .        # dist/ 会再占一份约 7 GB，确认磁盘余量
```

## 4. 构建

```bash
npm ci
npm run deploy:build    # = sync-mediapipe → tsc --noEmit → vite build → precompress
```

构建后必须核对以下 5 个文件都在 `dist/` 里，且模型校验值一致：

```bash
ls -l dist/gesture-worker.js dist/gesture_recognizer.task dist/mediapipe-vision.js \
      dist/mediapipe-wasm/vision_wasm_internal.js dist/mediapipe-wasm/vision_wasm_internal.wasm \
      dist/mediapipe-wasm/vision_wasm_nosimd_internal.js dist/mediapipe-wasm/vision_wasm_nosimd_internal.wasm
sha256sum dist/gesture_recognizer.task
# 期望 97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482
ls dist/mediapipe-wasm/*.br | wc -l   # 期望 4（precompress 已为 .js/.wasm 生成 .br/.gz；.task 不压缩，正常）
```

`sync-mediapipe` 输出形如 `@mediapipe/tasks-vision 1.0.1 → public/ (5 copied, 0 already current)`；若报 `node_modules/@mediapipe/tasks-vision is missing`，说明 `npm ci` 没跑成功。

## 5. 发布

与 `DEPLOY.md` 一致，先备份再同步，**不要加 `--delete`**（服务器上可能有仓库不含的数据目录）：

```bash
ssh user@host 'cp -a /var/www/shiyun/dist /var/www/shiyun/dist.bak-$(date +%Y%m%d-%H%M)'
rsync -a dist/ user@host:/var/www/shiyun/dist/
```

数据目录 `dist/data/` 内容未变，rsync 只会传输本次新增/变化的文件（约 32 MB 资源 + 新的 `assets/` 包 + `index.html`）。

## 6. nginx（可选，但建议做一次）

不改 nginx 也能正常运行：新增文件都落在 `location /` 的 `try_files` 下。建议核对两点：

1. **wasm 的 MIME 类型**。浏览器用 `application/wasm` 才走流式编译（快约 1 秒）；否则退回普通编译，功能不受影响。

   ```bash
   curl -sI https://shiyun.cohenjikan.com/mediapipe-wasm/vision_wasm_internal.wasm | grep -i content-type
   # 期望 application/wasm；若是 application/octet-stream，在 server{} 内加：
   #   types { application/wasm wasm; }   （或升级 nginx 自带的 mime.types）
   ```

2. **缓存头**。这几个文件不带内容哈希，只随 `@mediapipe/tasks-vision` 版本变化，给一周缓存即可（可加进 [deploy/nginx.conf](../deploy/nginx.conf) 的 `server{}`）：

   ```nginx
   location ^~ /mediapipe-wasm/ { add_header Cache-Control "public, max-age=604800"; }
   location = /mediapipe-vision.js { add_header Cache-Control "public, max-age=604800"; }
   location = /gesture_recognizer.task { add_header Cache-Control "public, max-age=604800"; }
   location = /gesture-worker.js { add_header Cache-Control "no-cache"; }
   ```

   改完 `sudo nginx -t && sudo systemctl reload nginx`。

3. **如有 CSP**：`curl -sI https://shiyun.cohenjikan.com/ | grep -i content-security-policy`。有输出才需要看：`worker-src 'self'`（或 `child-src 'self'`）与 `script-src ... 'wasm-unsafe-eval'` 缺一则手势功能在浏览器控制台报 CSP 错误、其余站点功能不受影响。没有 CSP 头则跳过。

## 7. 上线后验收

命令行（任意机器）：

```bash
for f in gesture-worker.js gesture_recognizer.task mediapipe-vision.js \
         mediapipe-wasm/vision_wasm_internal.js mediapipe-wasm/vision_wasm_internal.wasm; do
  printf '%-45s ' "$f"; curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "https://shiyun.cohenjikan.com/$f"
done
# 期望全部 200；wasm 约 11.7 MB，task 约 8.4 MB
curl -s https://shiyun.cohenjikan.com/gesture_recognizer.task | sha256sum
# 期望 97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482
```

浏览器（Chrome/Edge，带摄像头的电脑，3 分钟）：

1. 打开站点，确认**没有**摄像头权限弹窗，站点一切如常（点诗人、拖拽、滚轮、WASD）。
2. 「更多」→ 勾选「手势控制」→ 浏览器弹权限 → 允许。底部出现状态框，几秒内显示「识别已就绪 · CPU」。
3. 一只手放到镜头前中央：状态框变「主控已锁定」，右侧显示 `CPU xx ms` 与 FPS。**期望 FPS ≥ 15、单帧 ≤ 70 ms**（开发机 21 ms / 22 FPS）。
4. 移动手掌：屏幕上的金色光标连续跟随、静止时不抖。
5. 拇指食指捏一下：选中光标处的星（或虚空捞诗）；捏住拖动：视角旋转；捏住往身前拉：放大。
6. 比 ✌️ 保持约 1 秒：进度条走满后随机选中一位诗人；👍 保持约 1 秒：拉出一首随机诗。
7. 取消勾选「手势控制」：状态框消失，浏览器标签上的摄像头指示灯熄灭。
8. 打开浏览器控制台（F12）：无红色报错（`INFO: Created TensorFlow Lite XNNPACK delegate` 是 MediaPipe 的正常日志，虽显示为红色）。

任一步不通过，按第 8 节回滚并把控制台截图交给开发。

## 8. 回滚

方式一（秒级，推荐）：

```bash
ssh user@host 'mv /var/www/shiyun/dist /var/www/shiyun/dist.failed && mv /var/www/shiyun/dist.bak-<时间戳> /var/www/shiyun/dist'
```

方式二（源码级）：在仓库 `git revert <本次 commit>` 后重新执行第 4、5 节。

功能默认关闭，即使不回滚，访客也不会被动进入手势模式。

## 9. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 勾选后状态框显示「摄像头权限未允许」 | 用户拒绝过权限；地址栏锁图标 → 站点设置 → 摄像头 → 允许后刷新 |
| 状态框显示「当前浏览器不支持摄像头识别」 | 通过 `http://`（非 localhost）访问，浏览器禁止摄像头；必须 HTTPS |
| 一直「模型已就绪 · 等待摄像头」 | 摄像头被其他程序占用（会议软件等） |
| 一直「未检测到手」但摄像头正常 | 光线太暗、手太远（> 2 m）或掌心没朝镜头；先在 1 m 处测试 |
| 控制台 404 `/gesture_recognizer.task` 或 `/mediapipe-wasm/…` | 构建时没跑 `sync-mediapipe` 或 rsync 遗漏；重做第 4、5 节 |
| 控制台报 CSP / `wasm-unsafe-eval` | 见第 6 节第 3 条 |
| 状态框 FPS 很低（< 8）且 `CPU` 耗时 > 120 ms | 机器太弱；设置里「识别负载」选「低占用」；不要改成「GPU · 实验」除非现场试过（部分显卡驱动下检测分数偏低会导致一直检不到手） |
| Firefox / Safari 上没有光标补帧或无法开启 | 主要支持 Chrome/Edge（展会机）；Safari 16.4+、Firefox 最新版可用但未做展会级验证 |
| 有人担心隐私 | 见第 2 节：本地识别、无上传、无记录，关闭开关即停摄像头 |

## 10. 记录

发布后请在本文件末尾追加一行：日期、发布人、构建 commit、验收结果、nginx 是否加了第 6 节配置。
