# 部署 turnkey — 字库再奠基 + 换源(2026-06-28)

> **状态**:Phase 1–3 完成并验证,已合并 `main`(`f406cd7`)+ 推 origin。**Phase 4 prod 部署待执行** —— 本 agent 会话**无 prod SSH 公钥**(`ubuntu@207.211.153.71` Permission denied),故由 owner 在有 SSH 的会话里跑下面命令。
> ⚠️ **此次部署会一次性重置线上全部 `#p=` 诗号永久链**(N 12877→22219,设计内、owner 已认可)。`#a=` 诗人链不受影响(32652/32657 保留)。

## 已就绪(main + 磁盘)
- `public/data/`(gitignored)已是 refound:charset(N=22219,hash `a9cde1f2`,v2)+ poems/lines/search + lexicon + poets.index(33458)+ gifts(5165)。manifest:poemCount 970319。
- `EXPECTED_CHARSET_HASH=a9cde1f2`,tracked 数据与磁盘同步(已验)。

## 部署步骤(在仓库根、有 prod SSH 的会话)
```bash
# 1. 生产构建(tsc + vite build + precompress)
npm run deploy:build

# 2. 🔴 删 dist 里的旧 v1 备份(vite copyPublicDir 会把 ~1.16GB *_v1_backup 拷进 dist)
rm -rf dist/data/*_v1_backup

# 3.(可选)确认 dist 不含 linesf(本次不部署异文索引;prod nginx 仍 `location ^~ /data/linesf/ { return 404; }`)
ls dist/data/linesf 2>/dev/null && echo "⚠ 有 linesf — 本次应不部署,删掉:rm -rf dist/data/linesf"

# 4. rsync 到 prod(只传清理过的 dist,永不直接 scp public/data)
rsync -avz --delete dist/ ubuntu@207.211.153.71:/var/www/shiyun/dist/
```

## 冒烟(部署后)
- 首屏无「字库与本版本不匹配」黄条(charset hash 已对齐 `a9cde1f2`)。
- 搜「乾隆/王禹偁/蔡文姬」落本名;搜「春江花月夜」出张若虚;新诗人「连横/龙榆生」可见。
- 点诗人载诗正常(杜甫等);**点虚空捞诗「像诗」**(Zipf 加权,非乱码);锂/镁 可在造诗格输入。
- `#a=` 老链接仍复原;`#p=` 老链接**已按设计重置**(指向新诗号空间)。

## 红线 / 注意
- **新红线**:charset hash `a9cde1f2` / N=22219(取代旧 a392703b/12877)。`[[shiyun-maintenance-footguns]]` 待按此更新。
- linesf/异文 维持关闭(404 guard 不动 —— 见 [[shiyun-maintenance-footguns]] 的 2026-06-13 封禁事故)。
- 回滚:prod 上保留上一个 dist(或 `git revert` 重建旧 charset 部署);老 `*_v1_backup` 仍是 v1(29808)冷备。

## 重建可复现(如需从语料重生 refound)
```bash
CORPUS_SOURCE=shiyun-corpus REFLOW_CHARSET=1 node --max-old-space-size=6144 pipeline/build-data.mjs
# 把输出的新 hash 写进 src/data/charsetHash.ts EXPECTED_CHARSET_HASH
node pipeline/build-lexicon.mjs && npm run build:lines && npm run build:sidecars && npm run build:search
# (脚本:scratchpad/refound-rebuild.sh 做了全链 + 自动写 hash)
```
