# 运维 Runbook — 2026-11 更新上线(合并 + 推送 + 部署 + 公告)

照本文从上到下执行。所有命令都在 **Git Bash** 里跑(不是 PowerShell)。ssh/scp 要在沙箱外运行,密钥
`C:\Users\Cohen\Desktop\Oracle.key` 先按 icacls 收紧为仅 Cohen 可读(见 `docs/devlog/DEPLOY-ANNOUNCE-2026-07.md` 开头)。

```bash
KEY=/c/Users/Cohen/Desktop/Oracle.key
H=ubuntu@207.211.153.71
WT=/c/Users/Cohen/Desktop/shiyun/.claude/worktrees/inspiring-shaw-9f2fb2   # 本次更新的 worktree(数据在这里)
MAIN=/c/Users/Cohen/Desktop/shiyun
CORPUS=/c/Users/Cohen/Desktop/shiyun-corpus
TS=$(date +%Y%m%d-%H%M%S)
```

## 红线(任何一步都不许违反)

- 线上严禁 `POST /api/claim`(只允许 `GET /api/claim/health`);不碰 `claims.jsonl`、反馈收件箱、systemd 服务。
- `data/poems/*.json` 必须是 **RAW**(不压缩、不生成 .gz):前端用 Range 按未压缩字节偏移切片。
- **不上传** `linesf/` 和任何 `*_v1_backup`。**禁止 `rsync --delete`**;旧的 `assets/*` 一律保留(给缓存了旧 index.html 的回头客)。
- 重型数据只从 **`$WT/public/data`** 取;主工作区 `$MAIN/public/data` 里的 poems/lines/search 是旧的,和新的 poets.index 对不上。

## 0. 本次改了什么(上线后要对得上的数字)

| 项 | 旧 → 新 |
|---|---|
| `charset.json` | **不变**(N=22,219,逐字节一致 → `#p=`、拾遗、认领编号全部不受影响) |
| `poets.index.json` | 33,458 行,id 集合不变;新增 83 个 `dd`(五代十国)键;纳兰性德 194 → 195 |
| `manifest.json` | poemCount 871,268 → **871,269**;giftEdges 5,051 → **4,986** |
| `gifts.json` | 删 65 条误配边,零新增 |
| `poems/` | 只有 `38.json` + `38.idx.json` 变化 |
| `lines/` | 256 片(255 片内容变了) |
| `search/` | 256 片(新增副题键) |
| `chars/` | **新目录**:4096 个 `.json` + 4096 个 `.json.gz`(构建脚本自带 gz),约 160 MB |
| 前端 | 新 `index.html` + `assets/*`;新公告 `announce-202611.js`(dist 根目录) |

## 1. 合并与推送

两个仓库都只做 fast-forward;如果 `--ff-only` 失败,说明 main 被别人动过,先停下来问 owner。

```bash
# ① 语料库(本仓库本身当前检出在 fix/update-2026-11 分支)
cd "$CORPUS" && git status --short && git switch main && git merge --ff-only fix/update-2026-11 && git push origin main
git log --oneline -1    # 应为 300c2cd feat(curated): 补录纳兰性德《于中好·送梁汾南还为题小影》…

# ② 诗云(主工作区在 main)
cd "$MAIN" && git status --short && git merge --ff-only feat/update-2026-11 && git push origin main
git log --oneline -9    # 顶上 7 个是本次提交(155205f … 公告提交),下面是 2c7ff2f
```

推送后 GitHub 上会公开公告文案和投稿调研文档,这是 owner 同意的。

## 2. 构建(在 worktree 里,不在主工作区)

worktree 里有本次的全部数据,也有自己的 `node_modules`(主工作区的 node_modules 缺 `react-test-renderer`)。

```bash
cd "$WT" && git log --oneline -1          # 必须与 main 的 HEAD 是同一个提交
npx vitest run && npm run build            # tsc + vite build;不要跑 deploy:build(全量 precompress 要约 5 小时)
grep -o 'assets/index-[^"]*' dist/index.html | sort -u
grep -c 'announce-202611.js' dist/index.html   # 应为 1
grep -c 'announce-202607.js' dist/index.html   # 应为 0
ls dist/data | grep -iE 'linesf|_v1_backup'    # 应无输出
```

## 3. 服务器备份(只读 + 复制,不改线上)

备份放在 web 根(`/var/www/shiyun/dist`)之外。

```bash
ssh -i $KEY $H "set -e; D=/var/www/shiyun/dist; B=/var/www/shiyun/rollback-$TS; sudo mkdir -p \$B/data/poems;
  cd \$D && sudo tar czf /root/shiyun-frontend-bak-$TS.tar.gz index.html* assets;
  sudo cp -a \$D/data/manifest.json* \$D/data/poets.index.json* \$D/data/gifts.json* \$B/data/;
  sudo cp -a \$D/data/poems/38.json \$D/data/poems/38.idx.json \$B/data/poems/;
  sudo cp -a \$D/data/lines \$D/data/search \$B/data/;
  du -sh \$B; ls -la /root/shiyun-frontend-bak-$TS.tar.gz; df -h / | tail -1"
```

## 4. 上传到暂存区(同一文件系统,便于原子替换)

```bash
cd "$WT/dist"
ssh -i $KEY $H "sudo mkdir -p /var/www/shiyun/staging-$TS && sudo chown ubuntu /var/www/shiyun/staging-$TS"
# 前端 + 公告 + 小 JSON + poems/38(RAW)
tar cf - index.html announce-202611.js assets data/manifest.json data/poets.index.json data/gifts.json \
  data/poems/38.json data/poems/38.idx.json | ssh -i $KEY $H "tar xf - -C /var/www/shiyun/staging-$TS"
# 重型目录(压缩传输;lines 约 830 MB raw)
tar czf - data/lines data/search data/chars | ssh -i $KEY $H "tar xzf - -C /var/www/shiyun/staging-$TS"
```

## 5. 服务器端生成 .gz 并对账

`gzip_static` 只认文件名,不检查 .gz 和 .json 是否对应。lines/search 的 .gz **必须全部重新生成**,
否则支持 gzip 的浏览器会拿到旧索引。poems 不压缩;chars 已经自带 .gz。

```bash
ssh -i $KEY $H "set -e; S=/var/www/shiyun/staging-$TS; cd \$S;
  gzip -kf9 index.html announce-202611.js data/manifest.json data/poets.index.json data/gifts.json;
  gzip -kf9 assets/*.js assets/*.css;
  (cd data/lines && ls *.json | xargs -P2 -n16 gzip -kf9); (cd data/search && ls *.json | xargs -P2 -n16 gzip -kf9);
  echo lines json=\$(ls data/lines/*.json | wc -l) gz=\$(ls data/lines/*.gz | wc -l);
  echo search json=\$(ls data/search/*.json | wc -l) gz=\$(ls data/search/*.gz | wc -l);
  echo chars json=\$(ls data/chars/*.json | wc -l) gz=\$(ls data/chars/*.gz | wc -l);
  ls data/poems; (cd data && md5sum manifest.json poets.index.json gifts.json poems/38.json poems/38.idx.json)"
# 本地对照(md5 必须与上面逐行一致)
cd "$WT/dist/data" && md5sum manifest.json poets.index.json gifts.json poems/38.json poems/38.idx.json | sed 's/ \*/  /'
```

预期:lines 256/256、search 256/256、chars 4096/4096,`data/poems` 里只有两个文件且没有 .gz。

## 6. 切换(先数据,后前端)

旧前端读新数据是兼容的(只多了可选键和新目录),所以先换数据,最后再换 `index.html`。

```bash
ssh -i $KEY $H "set -e; D=/var/www/shiyun/dist; S=/var/www/shiyun/staging-$TS; B=/var/www/shiyun/rollback-$TS;
  sudo chown -R www-data:www-data \$S;
  sudo mv \$D/data/lines \$B/data/lines.live && sudo mv \$S/data/lines \$D/data/lines;
  sudo mv \$D/data/search \$B/data/search.live && sudo mv \$S/data/search \$D/data/search;
  sudo mv \$S/data/chars \$D/data/chars;
  sudo cp -a \$S/data/poems/38.json \$S/data/poems/38.idx.json \$D/data/poems/;
  sudo cp -a \$S/data/manifest.json* \$S/data/poets.index.json* \$S/data/gifts.json* \$D/data/;
  sudo cp -a \$S/announce-202611.js* \$D/;
  sudo cp -a \$S/assets/. \$D/assets/;          # 只增不删,旧 assets 保留
  sudo cp -a \$S/index.html \$S/index.html.gz \$D/;
  sudo rm -f \$D/index.html.br;                 # 旧 .br 不再对应(服务器无 brotli 模块,纯清理)
  ls \$D/data/lines | grep -c '\.br$' || true"
```

`lines/` 旧目录里的 `.br` 已经随 `mv` 一起移进 rollback 目录,新目录里没有 `.br`。

## 7. Cloudflare 清缓存(只清改过的 data URL)

`/data/` 有边缘缓存规则。下面这些 URL 内容变了,必须 purge:lines 256、search 256、poems/38 两个、
manifest、poets.index、gifts,共 517 个。`chars/` 和 `announce-202611.js` 是新 URL,不用清;`index.html` 是 DYNAMIC。
token 在服务器 `/opt/server-ops/secret.json`(`cloudflare_api_token`),**不要把它拷到本地**。

```bash
ssh -i $KEY $H 'python3 - <<"PY"
import json, os, urllib.request
tok = json.load(open("/opt/server-ops/secret.json"))["cloudflare_api_token"]
zone = "2e3ab652e04363c495eadb2e251450ce"; base = "https://shiyun.cohenjikan.com/data/"
D = "/var/www/shiyun/dist/data/"
urls = [base + "lines/" + f for f in sorted(os.listdir(D + "lines")) if f.endswith(".json")]
urls += [base + "search/" + f for f in sorted(os.listdir(D + "search")) if f.endswith(".json")]
urls += [base + p for p in ["poems/38.json", "poems/38.idx.json", "manifest.json", "poets.index.json", "gifts.json"]]
print("urls", len(urls))
for i in range(0, len(urls), 30):
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache", method="POST",
        data=json.dumps({"files": urls[i:i+30]}).encode(), headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json", "User-Agent": "server-ops"})
    r = json.load(urllib.request.urlopen(req)); print(i, r.get("success"), r.get("errors"))
PY'
```

如果返回 403(token 没有 purge 权限),停下来请 owner 在 CF 面板手动 purge 这些 URL,或对 shiyun 子域做一次 Purge Everything。

## 8. 上线验证(从 Cloudflare 边缘)

```bash
U=https://shiyun.cohenjikan.com
# ① index.html 的每个引用都必须 200(JS 和 CSS 都要查;2026-06-13 的无样式事故就是漏传了 CSS)
for p in $(curl -s $U/ | grep -oE '(src|href)="/[^"]+"' | sed -E 's/.*="\/([^"]+)"/\1/' | sort -u); do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' $U/$p)" "$p"; done
curl -sI $U/ | grep -iE 'cache-control|cf-cache-status'          # index.html 不应被浏览器长缓存
# ② 数字
curl -s $U/data/manifest.json | grep -oE '"(n|poemCount|poetCount|giftEdges)":[0-9]+'   # 22219 / 871269 / 32654 / 4986
# ③ poems Range 必须 206、无 content-encoding,切片可解析:纳兰 195 首,第 4 首(下标 3)是新补的《于中好》
curl -s -D - -H 'Range: bytes=54412-98754' $U/data/poems/38.json -o nalan.json | grep -iE '^HTTP|content-encoding|content-range'
node -e 'const a=JSON.parse(require("fs").readFileSync("nalan.json","utf8"));console.log(a.length,a[3].t)' && rm nalan.json
# ④ 新索引可取:chars「青」在 bb5 桶;lines「握手西风泪不干」在 a1 桶;search「寻春服感念」在 48 桶
curl -s --compressed $U/data/chars/bb5.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("青",JSON.parse(s)["青"].length))'
curl -s --compressed $U/data/lines/a1.json | grep -c '握手西风泪不干'
curl -s --compressed $U/data/search/48.json | grep -c '寻春服感念'
curl -sI -H 'Accept-Encoding: gzip' $U/data/chars/bb5.json | grep -iE '^HTTP|content-encoding'   # 200 + gzip
# ⑤ 后端只做健康检查(绝不 POST /api/claim)
curl -s -o /dev/null -w '%{http_code}\n' $U/api/claim/health
```

预期:①全部 200;②四个数字;③206、无 content-encoding、输出 `195 于中好 送梁汾南还为题小影`;
④「青」200 条、另两项各 ≥1;⑤200。

最后用浏览器无痕窗口打开站点(手机也看一次),确认以下几点:
- 顶部出现「诗云更新:修订了一些已知问题…」横幅,「查看详情」能展开,「知道了」后刷新不再出现;
- 寻诗输入「青」出现「含「青」的诗句」;
- 诗人搜「李煜」显示「五代十国·南唐」;
- 「更多 → 隐藏诗人名字」打开后,星图悬停和选中都不再显示名字。最后这一项在开发预览里看不到,必须在真实浏览器里看。

## 9. 收尾

```bash
ssh -i $KEY $H "sudo rm -rf /var/www/shiyun/staging-$TS"     # 暂存区已全部 mv/cp 走
```

主工作区的重型数据还是旧的,上线后要同步成新版,否则主工作区的本地预览和以后的重建都会用错数据。
这些是可重新生成的派生数据,worktree 就是来源,所以不用另做备份。在 **PowerShell** 里跑:

```powershell
$wt = "C:\Users\Cohen\Desktop\shiyun\.claude\worktrees\inspiring-shaw-9f2fb2\public\data"
$main = "C:\Users\Cohen\Desktop\shiyun\public\data"
foreach ($d in "poems","lines","search","chars") { robocopy "$wt\$d" "$main\$d" /MIR /NFL /NDL /NJH /NJS /MT:8 }
Set-Location C:\Users\Cohen\Desktop\shiyun; npm ci   # 补齐 PR #1 新增的 react-test-renderer
```

`linesf/` 不上线,主工作区里那份可以以后再用 `npm run build:fuzzy` 重建(8 GB 堆,先查可用内存)。

- `rollback-$TS` 目录和 `/root/shiyun-frontend-bak-$TS.tar.gz` 观察一周后再删。
- 部署后更新记忆:`shiyun-update-2026-11.md` 标记「已上线」,`shiyun-prod-deployment` 补本次构建哈希。

## 10. 回滚(一条命令)

```bash
ssh -i $KEY $H "set -e; D=/var/www/shiyun/dist; B=/var/www/shiyun/rollback-$TS;
  sudo tar xzf /root/shiyun-frontend-bak-$TS.tar.gz -C \$D;
  sudo mv \$D/data/lines \$B/data/lines.new && sudo mv \$B/data/lines.live \$D/data/lines;
  sudo mv \$D/data/search \$B/data/search.new && sudo mv \$B/data/search.live \$D/data/search;
  sudo cp -a \$B/data/manifest.json* \$B/data/poets.index.json* \$B/data/gifts.json* \$D/data/;
  sudo cp -a \$B/data/poems/38.json \$B/data/poems/38.idx.json \$D/data/poems/"
```

`chars/` 留着无害:旧前端不会请求它。回滚后同样要按 §7 再 purge 一次。

## 不在本次范围(另行处理)

- `/api/feedback` 在 nginx 层没有 `limit_req`(投稿调研 §4 的建议)。这要改 nginx,需要 owner 单独批准。
- UF-16 五代十国边界名单(韦庄、罗隐、贯休……维持唐)待 owner 拍板;改名单只需重建 poets.index,不影响编号。
