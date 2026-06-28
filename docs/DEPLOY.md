# Deploy — 诗云 / Poetry Cloud (static, with one optional feedback endpoint)

The whole app is a static build. **The corpus, all index math, and rendering stay 100% client-side —
never add a backend for those.** You ship `dist/` to any static host that supports **HTTP Range** on
`poems/*.json` (nginx, Caddy, most CDNs do).

The **only** optional server touchpoint is **feedback collection** (§5): if you want a shared, cross-device
inbox instead of per-browser localStorage, point one env var at a write-only endpoint. Leave it unset and the
build is fully static, exactly as before.

## ▶ Quickstart for the deploy / 运维 AI

Latest code is on **`main`** (`origin/main`). The heavy poem data is **git-ignored (~1.1 GB)** and lives,
complete + verified, in the **main worktree** at `<repo>\public\data`. Fastest correct
deploy — build there, where both the latest code (after pull) and the data already exist:

```bash
cd <repo>     # the main worktree — already has the complete public/data
git pull                             # fast-forward to the latest merged code
npm ci
npm run deploy:build                 # tsc + vite build → dist/ (heavy data baked in) + precompress
#  → serve dist/ per §2–§3.
```

> ⚠ **If a poet shows a poem COUNT but "载入作品…" never finishes, the data is missing — see §1.** That count
> comes from the git-tracked `poets.index.json`; the actual poems live in the git-ignored `poems/` buckets. A
> fresh clone has none. **Do not** "fix" it by running `build-data.mjs` unless you have the corpora cloned (§1
> Option B) — provision the existing data instead (§1 Option A).

> 🟡 **ACTION FOR 运维 — stand up the feedback backend (owner's explicit request).** The app ships with
> in-page feedback that saves to each visitor's `localStorage` only; there is **no server-side store until
> you start one**. The owner wants it **self-hosted on our own server — NOT a third-party form service**.
> Everything you need is in this repo: run [deploy/feedback-server.mjs](../deploy/feedback-server.mjs)
> (zero-dep node, JSONL file, no IPs stored) behind an nginx `location /api/feedback`, then build with
> `VITE_FEEDBACK_ENDPOINT="/api/feedback"`. Complete copy-paste steps (systemd unit + nginx block + verify)
> in **§5**. This is the ONLY backend 诗云 has — the corpus/index/render stack stays fully static.

## 1. Build

### 1.0 Provision the git-ignored data FIRST (the #1 deploy gotcha)

`public/data/{poems,lines,search,linesf}` are **git-ignored** (too large for git). Everything else
(`charset.json`, `poets.index.json`, `lexicon.json`, `gifts.json`, `manifest.json`) is tracked, so a fresh
checkout boots the galaxy + author list but **cannot load any poem** until you provide the buckets.

- **Option A — use the existing complete copy (recommended; no corpora needed).** The canonical, verified
  **v2** set (poems 279 MB · lines 904 MB · search 137 MB — 32,657 poets / 933,857 poems) is in the main
  worktree's `public/data`. Either **build from the main worktree** (the Quickstart above), or copy those
  dirs into your build tree:
  ```bash
  # from a fresh clone's repo root, on the same machine:
  cp -r "<repo>/public/data/poems"  public/data/
  cp -r "<repo>/public/data/lines"  public/data/   # only if you want 诗句 search
  cp -r "<repo>/public/data/search" public/data/   # only if you want 寻诗/探诗 search
  ```
  (On Windows you can junction instead of copy: `New-Item -ItemType Junction -Path public\data\poems -Target "<repo>\public\data\poems"` — vite follows junctions when copying into `dist/`.)
- **Option A′ — restore from the GitHub backup (works on ANY machine).** The v2 data set is archived as
  release assets on the private repo — release **`data-v2-2026-06-10`** at
  `https://github.com/Cohenjikan/shiyun/releases` (assets: `poems.tar.gz`, `lines.tar.gz`,
  `search.tar.gz`, `SHA256SUMS.txt`). Download (needs repo auth), verify checksums, then extract into
  `public/data/`:
  ```bash
  cd public/data
  sha256sum -c SHA256SUMS.txt          # verify first
  tar -xzf poems.tar.gz && tar -xzf lines.tar.gz && tar -xzf search.tar.gz
  ```
  Old v1 data (pre-2026-06-10, 29,808 poets) is kept on the dev machine as `public/data/*_v1_backup`
  for rollback only — do not deploy it; the git-tracked `poets.index.json` now matches v2.
- **Option B — regenerate (only if you have the corpora).** Needs `<corpus>/Werneror-Poetry` **and**
  `<corpus>/modern-poetry` cloned. **This OVERWRITES `public/data`.** A missing modern corpus now **fails
  loud** (it used to silently drop the 508 modern 新诗 poets and desync the index): set `ALLOW_NO_MODERN=1`
  only for an intentional Werneror-only build.
  ```bash
  node --max-old-space-size=4096 pipeline/build-data.mjs            # poems + lines + sidecars
  npm run build:search                                             # 寻诗/诗名 prefix index (search/)
  # npm run build:fuzzy                                            # optional 异文 fuzzy index (linesf/, ~4.4 GB)
  ```

`linesf/` (fuzzy 异文 search) is an **optional fallback** — `load.ts` no-ops if it's absent, so you can skip
it. The minimum for "poems load + 诗句/寻诗 search work" is `poems/` + `lines/` + `search/`.

### 1.1 Build the static bundle

```bash
npm ci
npm run deploy:build   # = npm run build (tsc --noEmit + vite build → dist/) && npm run precompress
```

- Vite copies `public/` (incl. `public/data/`) into `dist/data/`, so the heavy corpora ship as static files.
- `npm run precompress` ([deploy/precompress.mjs](../deploy/precompress.mjs)) writes `.br` + `.gz`
  next to every text asset **except `dist/data/poems/*.json`** (those stay raw — see §3).

**Size:** `dist/data/poems/` ≈ 235 MB, `dist/data/lines/` ≈ 791 MB (compresses well). If your host
caps build size, host `data/` on object storage / a CDN and build with **`VITE_DATA_BASE`** set to that
absolute origin (e.g. `VITE_DATA_BASE="https://cdn.example.com/shiyun-data"`) — all six fetch helpers in
[src/data/load.ts](../src/data/load.ts) default to it. (Each helper still takes an explicit `base` arg for
per-call overrides; `VITE_DATA_BASE` just changes the default.) Unset ⇒ same-origin `/data` as before. A
*same-origin* versioned value like `/data/v2` unlocks immutable caching — see §2.1.

## 2. Serve

Use [deploy/nginx.conf](../deploy/nginx.conf) as a starting point (needs the `ngx_brotli` module for
`brotli_static`; `gzip_static` is built in). Key points:

- **SPA fallback** — 诗云 is a hash-router (`#a=…` / `#p=…`), so `try_files $uri $uri/ /index.html`.
- **Cache** — `/assets/*` (content-hashed) `immutable, max-age=31536000`; `index.html` `no-cache`.
- **Compression** — brotli/gzip for js/css/json **except** `data/poems/` (§3).

### 2.1 Optional: versioned data path → IMMUTABLE caching (kill the daily revalidate)

By default the data shards are served from the stable `/data/` path with `Cache-Control: max-age=86400`
(1 day). Because the path never changes across data bumps, we *can't* mark it `immutable` — so a returning
visitor revalidates every shard daily, most painfully the ~2.8 MB `poets.index.json`. To serve those
byte-frozen shards with a **1-year `immutable`** cache (like `/assets/*`), pin them behind a **versioned
path** and let the version bump bust the cache:

1. **Build** with the data base pointed at a versioned path (the `VITE_DATA_BASE` knob in
   [src/data/load.ts](../src/data/load.ts)):
   ```bash
   cp .env.example .env.local
   # .env.local:  VITE_DATA_BASE="/data/v2"      ← all six fetch helpers now request /data/v2/…
   npm run deploy:build
   ```
2. **Serve** the *same files on disk* under that versioned prefix with `immutable` — uncomment the two
   sibling `location ^~ /data/v2/…` blocks in [deploy/nginx.conf](../deploy/nginx.conf). They `alias`
   straight back at the existing `dist/data/` dir (no disk restructuring, no second copy). **The
   `/data/v2/poems/` block MUST keep the §3 Range gotcha** — RAW (no gzip/brotli) + `Accept-Ranges: bytes`
   — or per-poet Range fetches silently fall back to whole-bucket.

**When to flip the suffix.** On every data version change (new poems/lines/search → a fresh
`data-vN-…` release per §1.0 Option A′): bump BOTH the nginx path suffix (`/data/v2` → `/data/v3`, new
sibling pair) AND `VITE_DATA_BASE` to match, then rebuild + redeploy. Old `/data/v2` caches die naturally —
their URLs are simply never requested again, so there's no purge to coordinate. Leaving this OFF (the
default config) is the safe choice: stable `/data/`, `max-age=86400`, no immutability promise to break.

Verify after deploy (immutable header present · poems Range still 206 · no compression under
`/data/v2/poems/`):
```bash
# small shard → immutable, 1-year:
curl -s -D- -o /dev/null https://shiyun.example.com/data/v2/poets.index.json | grep -i 'cache-control'
# want: Cache-Control: public, max-age=31536000, immutable
# poems Range still works AND stays uncompressed under the versioned path:
curl -s -D- -o /dev/null -H 'Range: bytes=0-99' https://shiyun.example.com/data/v2/poems/00.json \
  | grep -i '206\|content-range\|content-encoding\|cache-control'
# want: HTTP/.. 206, Content-Range: bytes 0-99/…, NO Content-Encoding, and the immutable Cache-Control
```

## 3. ⚠ The one deploy gotcha: keep `data/poems/*.json` RAW

The per-poet fetch ([load.ts::loadPoetPoems](../src/data/load.ts)) sends `Range: bytes=off-end`,
where `off/len` come from `poems/{bucket}.idx.json` and index the **uncompressed** file. If the host
serves a **compressed** `poems/*.json` (gzip/brotli), a byte Range slices the *compressed* stream →
the bytes don't parse → the client safely falls back to downloading the whole bucket (correct, but
you lose the ~99% egress saving). So:

- Serve `data/poems/*.json` **uncompressed** (the nginx `location /data/poems/` block disables
  gzip/brotli + advertises `Accept-Ranges: bytes`). `precompress.mjs` already skips them.
- `data/lines/*.json` are fetched **whole** (content search) → compress them normally (big win).

Verify after deploy:
```bash
curl -s -D- -o /dev/null -H 'Range: bytes=0-99' https://shiyun.example.com/data/poems/00.json | grep -i '206\|content-range\|content-encoding'
# want: HTTP/.. 206, Content-Range: bytes 0-99/…, and NO Content-Encoding
```

## 4. Smoke test

`npm run preview` serves `dist/` locally (vite preview = sirv, which supports Range) — click a poet,
confirm a `206` in the network panel, and that a shared `#a=<poetId>` / `#p=<form>.<index>` link
restores the right poem on load.

## 5. Optional: collect feedback on a server (the one allowed backend)

In-page feedback (设置 → 更多 → 💬 反馈) is **always** saved to the visitor's `localStorage`; the owner reads it
on-device via the hidden gesture (5 taps on the 诗云 logo within 10 s → FeedbackViewer). That's per-browser
only. To gather feedback across all visitors/devices, set **one build-time env var** to a write-only endpoint;
each submission is then **also** POSTed there as fire-and-forget JSON. The POST never blocks or fails the
submit — `localStorage` stays the source of truth, the network is best-effort
([src/state/feedback.ts](../src/state/feedback.ts)).

**Contract.** On submit, the client sends:

```http
POST <VITE_FEEDBACK_ENDPOINT>
Content-Type: application/json

{ "source": "shiyun", "message": "<the feedback text>", "ts": 1781000000000 }
```

The endpoint URL is inlined into the client bundle by Vite → it is **public**. Point it at a *write-only*
collector, never anything needing a secret.

### 5a. RECOMMENDED — self-hosted collector on your own server (无第三方)

**Owner's explicit direction: store feedback on OUR backend, not a third-party service.** The complete,
zero-dependency collector ships in this repo: [deploy/feedback-server.mjs](../deploy/feedback-server.mjs)
(~100 lines, `node:http` only — tested). It appends each message as one JSON line to a JSONL file, stores
**no IP address** (privacy by design), has a coarse built-in rate limit, and offers a token-protected GET
for the owner to read the inbox.

On the server (same box that runs nginx):

```bash
sudo mkdir -p /opt/shiyun /var/lib/shiyun
sudo cp deploy/feedback-server.mjs /opt/shiyun/
# generate the owner token once:  openssl rand -hex 24
sudo tee /etc/systemd/system/shiyun-feedback.service >/dev/null <<'EOF'
[Unit]
Description=shiyun feedback collector
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/shiyun/feedback-server.mjs
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=FEEDBACK_FILE=/var/lib/shiyun/feedback.jsonl
Environment=FEEDBACK_TOKEN=<paste the openssl token here>
Restart=on-failure
DynamicUser=yes
StateDirectory=shiyun
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now shiyun-feedback
curl -s localhost:8787/api/feedback/health   # → {"ok":true}
```

Then add ONE location to the existing nginx server block ([deploy/nginx.conf](../deploy/nginx.conf)) —
same-origin, so **no CORS is needed at all**:

```nginx
location /api/feedback {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    # optional belt-and-braces rate limit (define the zone in the http{} block):
    # limit_req zone=fb burst=5 nodelay;
}
```

**Reading the inbox (owner)** — token goes in the `Authorization` header, never the URL (query
strings land in nginx access logs):

```bash
curl -s -H "Authorization: Bearer <FEEDBACK_TOKEN>" "https://你的域名/api/feedback"   # one JSON per line
# or directly on the server:  tail -n 50 /var/lib/shiyun/feedback.jsonl
```

### 5b. Wire the client

```bash
cp .env.example .env.local
# .env.local:  VITE_FEEDBACK_ENDPOINT="/api/feedback"     ← same-origin relative path
npm run deploy:build      # baked into dist/ at build time
```

`.env.local` is git-ignored; `.env.example` is the tracked template. Unset/blank ⇒ 100% static (no network).

### 5c. Verify after deploy

```bash
curl -s -X POST "https://你的域名/api/feedback" -H 'Content-Type: application/json' \
  -d '{"source":"shiyun","message":"部署冒烟测试","ts":1781000000000}'
# want: {"ok":true}, and the line shows up in /var/lib/shiyun/feedback.jsonl
```

In the live app, submit a test message and confirm a `POST /api/feedback → 200` in the browser Network
panel (a failure is silently tolerated and the message still lands in localStorage).

> Fallback only if there is NO server at all (e.g. the site moves to a pure CDN): any JSON-accepting
> endpoint satisfies the same client contract — a Cloudflare Worker+KV or Formspree URL in
> `VITE_FEEDBACK_ENDPOINT` works (those are third-party: get the owner's sign-off first, send permissive
> CORS, and do NOT store IPs).

## 6. Optional: 动态 OG 分享卡 (per-target share previews)

**不部署 / 不改 nginx 时,纯静态行为与今天完全一致** — this whole section is opt-in and touches nothing
when off.

**The problem.** A shared link is hash-based (`#a=<poetId>` / `#p=<index>`). Crawlers (WeChat / Twitter /
Telegram) and servers **never see the fragment**, so every shared link previews the same generic `og.jpg`.

**The fix (two halves, both already in the build):**
1. `src/state/permalink.ts` now **mirrors** the target into the query string: the address bar reads
   `/?a=<poetId>#a=<poetId>` (resp. `?p=…#p=…`). The **hash stays canonical** (old pure-hash links restore
   bit-for-bit); the query exists only so a server/crawler can see the target. All 分享/复制 buttons read
   `location.href`, which now carries both. Nothing here needs a server — it ships in the static bundle.
2. The **existing** feedback collector ([deploy/feedback-server.mjs](../deploy/feedback-server.mjs)) gains
   ONE optional route: with `SITE_ROOT` set, `GET /?a=…` / `GET /?p=…` returns `index.html` with
   `og:title` / `og:description` / `twitter:*` (+ `og:url`) swapped **per target** (`og:image` stays as
   built). `SITE_ROOT` unset → that route 404s exactly as before; **the `/api/feedback` POST/GET behavior is
   byte-for-byte unchanged**. The injector ([deploy/og-inject.mjs](../deploy/og-inject.mjs), zero-dep, unit
   -tested) HTML-escapes every value, length-caps the query before lookup, and only ever rewrites the
   `content="…"` of the known meta tags — raw input is never echoed.

### 6a. Enable on the server (extend the running collector)

The collector is already up from §5a — just add the env var and copy the new files:

```bash
sudo cp deploy/feedback-server.mjs deploy/og-inject.mjs /opt/shiyun/     # both, og-inject is imported
# add ONE line to the systemd unit so the server can read the built dist/:
sudo systemctl edit shiyun-feedback        # OR edit /etc/systemd/system/shiyun-feedback.service
#   add under [Service]:
#     Environment=SITE_ROOT=/var/www/shiyun/dist
sudo systemctl daemon-reload && sudo systemctl restart shiyun-feedback
# the log should now print:  dynamic OG enabled: 32657 poets from /var/www/shiyun/dist
```

`SITE_ROOT` must point at the **built `dist/`** (it reads `dist/index.html` + `dist/data/poets.index.json`,
ONCE at boot, into memory — never per request). If either file is missing the server logs a warning and the
OG route simply 404s (feedback unaffected).

### 6b. nginx — route only `/` WITH `?a=`/`?p=` to the backend

In the site `server {}` block ([deploy/nginx.conf](../deploy/nginx.conf)), the `location = /` already
proxies to the node backend **only** when `$arg_a` or `$arg_p` is present, else serves the static
`index.html`:

```nginx
location = / {
    if ($arg_a) { proxy_pass http://127.0.0.1:8787; }
    if ($arg_p) { proxy_pass http://127.0.0.1:8787; }
    proxy_set_header Host $host;
    try_files /index.html =404;   # no a/p (and no proxy) → static index.html, exactly as today
}
```

`proxy_pass` **without** a URI part is the `if`-safe form. Reload nginx after editing
(`sudo nginx -t && sudo systemctl reload nginx`).

### 6c. Verify

```bash
# on the box (bypassing nginx) — want the poet's name in og:title:
curl -s 'http://127.0.0.1:8787/?a=82a5851c' | grep 'og:title'
#   <meta property="og:title" content="李白 — 诗云 · Poetry Cloud" />
curl -s 'http://127.0.0.1:8787/?p=12345' | grep 'og:title'
#   <meta property="og:title" content="诗云 · 一首可能的诗" />
# a plain GET / (no a/p) still 404s on the backend (nginx serves it statically):
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:8787/'        # 404
# unknown id → UNMODIFIED index.html (the generic card), 200:
curl -s 'http://127.0.0.1:8787/?a=ffffffff' | grep 'og:title'            # the generic title
# through nginx (real share URL):
curl -s 'https://你的域名/?a=82a5851c' | grep 'og:title'
```

If you never add this block (or never set `SITE_ROOT`), `/` is served statically and sharers get the
generic card — **纯静态行为与今天完全一致**. (Note: once the `if`-proxy block IS in place, a `/?a=…`
request while the backend is *down* returns a 502 for that one request — add `proxy_intercept_errors on;`
+ an `error_page 502 = @static;` named location if you want it to fall back to static instead. The static
SPA at every other path is never affected either way.)

## 7. Optional: 认领 (poem-claim) backend — the GLOBAL 认领编号

**不部署时,纯静态行为不变** — without this, the 认领 button still works (the poem becomes a meteor, recorded
in the visitor's localStorage), but its 认领编号 reads **"待联网确认"** instead of a number, and other
visitors don't see each other's meteors. This is the **one** feature a static client genuinely cannot do
alone: hand out a **globally monotonic 认领编号 (claim number, from 1, shared across ALL users)**.

The collector ([deploy/claim-server.mjs](../deploy/claim-server.mjs), `node:http` only, **zero deps**) is a
SIBLING of the feedback collector — kept separate on purpose: its feed is **public** (every visitor reads it
to draw meteors) whereas the feedback inbox is token-gated. The global counter is allocated through a tiny
promise-chain mutex (atomic under concurrent POSTs) and recovered from the JSONL at boot (a restart never
reuses or skips a number).

> ⚖️ **COMPLIANCE — store only numbers, never text/identity.** Each claim appends **EXACTLY three numbers:
> `{no, index, ts}`** (claim number · poem's 全集编号 · timestamp). It **NEVER stores the poem text or any
> 文字内容, user identity, IP, or User-Agent** — the poem is recomputed client-side from `index`
> (`pulledFromIndex`) and never touches the server; the client sends only `{index, ts}` and the server
> ignores any other field. Rationale: persisting poem text would make this user-generated content (论坛性质)
> → ICP 备案 / 内容审核 obligations in 中国; storing only numbers is a set of mathematical coordinates, not a
> content service. Back up `claims.jsonl`, but know it contains no text. (UA is used only for the in-memory
> rate limiter, never written to disk.)

```
POST /api/claim        {index:"<全集编号>", ts?}  (any other field is ignored) → {ok, no, index, ts}
GET  /api/claim/feed   ?limit=<n>   (PUBLIC) → {total, serverNow, claims:[{no,index,ts}…]}  (newest-first)
GET  /api/claim/health → {ok:true}
```

The app shows the visitor two numbers at claim time: **「已有 X 人认领」** (`feed.total`) and **「你是第 N 个 ·
认领编号 #N」** (the backend `no`).

### 7a. Stand up the collector (same box as nginx)

```bash
sudo mkdir -p /opt/shiyun /var/lib/shiyun
sudo cp deploy/claim-server.mjs /opt/shiyun/
sudo tee /etc/systemd/system/shiyun-claim.service >/dev/null <<'EOF'
[Unit]
Description=shiyun 认领 (poem-claim) collector
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/shiyun/claim-server.mjs
Environment=PORT=8788
Environment=HOST=127.0.0.1
Environment=CLAIM_FILE=/var/lib/shiyun/claims.jsonl
Restart=on-failure
DynamicUser=yes
StateDirectory=shiyun
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now shiyun-claim
curl -s localhost:8788/api/claim/health   # → {"ok":true}
```

> Note: `claims.jsonl` is the **only durable state** — it IS the global counter. Back it up like
> `feedback.jsonl`. (`DynamicUser=yes` + `StateDirectory=shiyun` already place it under `/var/lib/private/shiyun`.)

### 7b. nginx — one same-origin location (no CORS)

Add to the site `server {}` block ([deploy/nginx.conf](../deploy/nginx.conf)). `/api/claim` covers the POST,
`/feed`, and `/health` (prefix match):

```nginx
location /api/claim {
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $host;
    # optional: cap the public feed read so a scraper can't hammer it (define zone in http{}):
    # limit_req zone=claim burst=10 nodelay;
}
```

`sudo nginx -t && sudo systemctl reload nginx`.

### 7c. Wire the client + verify

```bash
# .env.local:  VITE_CLAIM_ENDPOINT="/api/claim"     ← same-origin relative path (git-ignored)
npm run deploy:build       # baked into dist/ at build time; unset ⇒ claims stay local-only
```

```bash
# POST a claim → a number, then it shows in the feed:
curl -s -X POST "https://你的域名/api/claim" -H 'Content-Type: application/json' \
  -d '{"source":"shiyun","index":"123456789","ts":1781000000000}'
#   → {"ok":true,"no":1,"index":"123456789","ts":1781000000000}
curl -s "https://你的域名/api/claim/feed?limit=5"
#   → {"total":1,"serverNow":…,"claims":[{"no":1,"index":"123456789","ts":1781000000000}]}
```

In the live app: open a void poem → **认领这首诗** → the panel shows **认领编号 #N** and the poem streaks off
as a meteor. Today's claims render as bright, clickable meteors; older ones as faint glints. 更多 → 流星
toggles the whole layer off.
