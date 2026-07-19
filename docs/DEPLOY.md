# Deploy — 诗云 / Poetry Cloud (static-first, with optional minimal endpoints)

The whole app is a static build. **The corpus, all index math, and rendering stay 100% client-side —
never add a backend for those.** You ship `dist/` to any static host that supports **HTTP Range** on
`poems/*.json` (nginx, Caddy, most CDNs do).

The optional server touchpoints are a bounded feedback inbox (§5) and a content-free global claim-number
allocator (§7). Leave their build-time endpoint variables unset and the build is fully static. Neither endpoint
accepts poem text; the claim endpoint also rejects every request body and never receives a reversible index.

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
> in **§5**. 诗云 has **two optional backends** — this feedback collector (§5) and the 认领 number
> allocator (§7); both are opt-in and the corpus/index/render stack stays fully static without them.

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

## 5. Optional: collect feedback on a server

In-page feedback (设置 → 更多 → 💬 反馈) is **always** saved to the visitor's `localStorage`, but note there is
currently **no on-device reader UI** — the old FeedbackViewer behind the 5-taps-on-logo gesture was replaced
by the 流星 DevTool, so a pure-static build keeps feedback per-browser with no way to read it back. To gather
(and actually read) feedback across all visitors/devices, set **one build-time env var** to a write-only endpoint;
each submission is then **also** POSTed there as fire-and-forget JSON. The POST never blocks or fails the
submit — `localStorage` stays the source of truth, the network is best-effort
([src/state/feedback.ts](../src/state/feedback.ts)).

**Contract.** On submit, the client sends:

```http
POST <VITE_FEEDBACK_ENDPOINT>
Content-Type: application/json

{ "message": "<the feedback text>" }
```

The endpoint URL is inlined into the client bundle by Vite → it is **public**. Point it at a *write-only*
collector, never anything needing a secret.

### 5a. RECOMMENDED — self-hosted collector on your own server (无第三方)

**Owner's explicit direction: store feedback on OUR backend, not a third-party service.** The complete,
zero-dependency collector ships in this repo: [deploy/feedback-server.mjs](../deploy/feedback-server.mjs).
It stores exactly **`{message, receivedAt}`**, never persists IP or User-Agent, sanitizes legacy rows at boot,
caps the inbox at 5,000 rows, has a coarse in-memory rate limit, and offers a token-protected GET for the
owner to read the inbox.

On the server (same box that runs nginx):

```bash
sudo mkdir -p /opt/shiyun
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
Environment=FEEDBACK_FILE=/var/lib/private/shiyun-feedback/feedback.jsonl
Environment=FEEDBACK_TOKEN=<paste the openssl token here>
Environment=FEEDBACK_MAX_ROWS=5000
Restart=on-failure
DynamicUser=yes
StateDirectory=shiyun-feedback
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
location = /api/feedback {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
}
```

**Reading the inbox (owner)** — token goes in the `Authorization` header, never the URL (query
strings land in nginx access logs):

```bash
curl -s -H "Authorization: Bearer <FEEDBACK_TOKEN>" "https://你的域名/api/feedback"   # one JSON per line
# or directly on the server:  sudo tail -n 50 /var/lib/private/shiyun-feedback/feedback.jsonl
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
  -d '{"message":"部署冒烟测试"}'
# want: {"ok":true}, and the line shows up in /var/lib/private/shiyun-feedback/feedback.jsonl
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

**Privacy boundary.** Crawlers and servers never see URL fragments. Public poet ids may therefore be mirrored
for a custom card, but reversible poem coordinates must stay in `#p=<index>` and never enter a query/access log.

**The fix (two halves, both already in the build):**
1. `src/state/permalink.ts` mirrors only a public poet target: `/?a=<poetId>#a=<poetId>`. Poem links remain
   hash-only: `/#p=<index>`. Old `?p=` links still restore client-side, but the app no longer creates them.
2. The **existing** feedback collector ([deploy/feedback-server.mjs](../deploy/feedback-server.mjs)) gains
   ONE optional route: with `SITE_ROOT` set, `GET /?a=…` returns `index.html` with
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

### 6b. nginx — route only `/` WITH public `?a=` to the backend

In the site `server {}` block ([deploy/nginx.conf](../deploy/nginx.conf)), the `location = /` already
proxies to the node backend **only** when `$arg_a` is present, else serves the static
`index.html`:

```nginx
location = / {
    if ($arg_a) { proxy_pass http://127.0.0.1:8787; }
    proxy_set_header Host $host;
    try_files /index.html =404;   # no public poet query (and no proxy) → static index.html
}
```

`proxy_pass` **without** a URI part is the `if`-safe form. Reload nginx after editing
(`sudo nginx -t && sudo systemctl reload nginx`).

### 6c. Verify

```bash
# on the box (bypassing nginx) — want the poet's name in og:title:
curl -s 'http://127.0.0.1:8787/?a=82a5851c' | grep 'og:title'
#   <meta property="og:title" content="李白 — 诗云 · Poetry Cloud" />
# a plain GET / (or ?p=) still 404s on the backend; nginx serves it statically:
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
in the visitor's localStorage), but its status reads **"本次未联网 · 未取得编号"**, and other
visitors don't see each other's meteors. This is the **one** feature a static client genuinely cannot do
alone: hand out a **globally monotonic 认领编号 (claim number, from 1, shared across ALL users)**.

The collector ([deploy/claim-server.mjs](../deploy/claim-server.mjs), `node:http` only, **zero deps**) is a
SIBLING of the feedback collector — kept separate on purpose: its feed is **public** (every visitor reads it
to draw meteors) whereas the feedback inbox is token-gated. The global counter is allocated through a tiny
promise-chain mutex (atomic under concurrent POSTs) and recovered from the JSONL at boot (a restart never
reuses or skips a number).

> ⚖️ **PRIVACY RED LINE — the cloud stores no poem and no reversible poem coordinate.** Each claim request
> has an **empty body**. The allocator creates exactly **`{no, ts}`** — plus, on a **里程碑 prize row** (see
> §7d), one extra field **`key`**: a server-random 中奖密钥 with **zero user content** (not derived from any
> poem, identity or IP). The public feed exposes only `{no, ts}` and **never a key**. Poem text, previews and
> the reversible 全集编号 stay in that visitor's browser. A request carrying any body is rejected, not ignored.
> IP/User-Agent is not persisted; a bounded process-memory IP bucket is only a backstop behind nginx. At boot,
> the collector normalizes valid legacy rows but **never discards a malformed/torn row**: original bytes stay
> in the ledger, recoverable `no` values still advance the counter, and a copy goes to `claims.jsonl.rejected`.
> A well-formed prize `key` is always preserved (destroying it would void a winner's redemption).

```
POST /api/claim        empty body → {ok, no, ts}   (+ "prizeKey":"SY<no>-…" on a 里程碑 row ONLY — see §7d)
GET  /api/claim/feed   ?limit=<n>   (PUBLIC) → {total, serverNow, claims:[{no,ts}…]}  (newest-first,
                       NEVER carries a prize key)
GET  /api/claim/health → {ok:true}
```

The app shows the visitor two numbers at claim time: **「已有 X 人认领」** (`feed.total`) and **「你是第 N 个 ·
认领编号 #N」** (the backend `no`).

### 7a. Stand up the collector (same box as nginx)

```bash
sudo mkdir -p /opt/shiyun
sudo cp deploy/claim-server.mjs /opt/shiyun/
sudo tee /etc/systemd/system/shiyun-claim.service >/dev/null <<'EOF'
[Unit]
Description=shiyun 认领 (poem-claim) collector
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/shiyun/claim-server.mjs
Environment=PORT=8788
Environment=HOST=127.0.0.1
Environment=CLAIM_FILE=/var/lib/private/shiyun-claim/claims.jsonl
Environment=MAX_CLAIMS=1000000
Environment=FEED_MAX=500
# 里程碑中奖号 (认领编号 that mint a 中奖密钥). Default is the 1/100/500/1000/5000/10000th claim; override to
# retune. Changing it only affects FUTURE allocations — a key already on disk is permanent (see §7d).
Environment=PRIZE_NOS=1,100,500,1000,5000,10000
Restart=on-failure
DynamicUser=yes
StateDirectory=shiyun-claim
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now shiyun-claim
curl -s localhost:8788/api/claim/health   # → {"ok":true}
```

> Note: `claims.jsonl` is the **only durable state** — it IS the global counter **and the sole record of
> 里程碑中奖密钥** (§7d), so its backup is load-bearing for redemption. Back it up like `feedback.jsonl` (it
> still contains **no** text/identity). `StateDirectory=shiyun-claim` isolates it at
> `/var/lib/private/shiyun-claim`; the feedback service independently owns `/var/lib/private/shiyun-feedback`,
> so restarting either DynamicUser service cannot chown the other's ledger.

### 7b. nginx — mandatory per-IP limits + same-origin routes (no CORS)

The limits are a **required production control**: rotating User-Agent strings must not bypass prize allocation
throttling. Define both zones once in nginx's `http {}` context (outside every `server {}`):

```nginx
limit_req_zone $binary_remote_addr zone=claim:10m     rate=6r/m;
limit_req_zone $binary_remote_addr zone=claimfeed:10m rate=30r/m;
```

Then add the exact same-origin routes to the site `server {}` block ([deploy/nginx.conf](../deploy/nginx.conf)):

```nginx
location = /api/claim {
    limit_req zone=claim burst=5 nodelay;
    client_max_body_size 1k;
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $host;
}
location = /api/claim/feed {
    limit_req zone=claimfeed burst=20 nodelay;
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $host;
}
location = /api/claim/health {
    proxy_pass http://127.0.0.1:8788;
    proxy_set_header Host $host;
}
```

`sudo nginx -t && sudo systemctl reload nginx`. From one public IP, the first burst is admitted and subsequent
rapid POSTs must return `429`; changing `User-Agent` must not change that result.

### 7c. Wire the client + verify

```bash
# .env.local:  VITE_CLAIM_ENDPOINT="/api/claim"     ← same-origin relative path (git-ignored)
npm run deploy:build       # baked into dist/ at build time; unset ⇒ claims stay local-only
```

```bash
# POST a bodyless claim → a number, then it shows in the index-free feed:
curl -s -X POST "https://你的域名/api/claim"
#   → {"ok":true,"no":1,"ts":1781000000000,"prizeKey":"SY1-…"}   ← no=1 is a 里程碑, so a key rides ALONG
#     (an ordinary 认领编号 replies without prizeKey)
curl -s "https://你的域名/api/claim/feed?limit=5"
#   → {"total":1,"serverNow":…,"claims":[{"no":1,"ts":1781000000000}]}   ← feed NEVER carries the key
```

In the live app: open a void poem → **认领这首诗** → the panel shows **认领编号 #N** and the poem streaks off
as a meteor. Today's claims render as bright meteors and older ones as faint glints; all are non-interactive
and carry no poem address. 更多 → 流星
toggles the whole layer off.

### 7d. 里程碑中奖密钥 (milestone prize keys) + owner verification

When an allocated `no` is a milestone (`PRIZE_NOS`, default the 1st / 100th / 500th / 1000th / 5000th /
10000th claim), the server mints a **random, time-bound 中奖密钥** — impossible to guess or pre-compute
(31-symbol Crockford alphabet, `SY<no>-XXXXX-XXXXX-XXXXX-XXXXX`, ≈99 bits). The winning claimer sees a
**「🎉 你中奖了」** block with the key + a copy button, and is told to **DM the author on 抖音 / 小红书 / B站** to
redeem **刘慈欣原著《诗云》实体书一本**. The key is also saved into the visitor's **我的认领** so it survives a
page reload.

- **Where the key lives:** ONLY in `claims.jsonl` (on the winning row, as `{no, ts, key}`) **and** the single
  POST reply that minted it. It is **NEVER** in the public `/feed`, never in the boot-recovered in-memory
  window, never in any later reply. The public interface stays a set of numbers; only the owner's disk holds
  the secret. The empty-body POST means no poem/index is ever involved either.
- **Owner verification (a claimer DMs you a key):** SSH to the box and grep the ledger —
  ```bash
  sudo grep '"key":"SY42-' /var/lib/private/shiyun-claim/claims.jsonl    # or grep the exact 认领编号
  #  → {"no":42,"ts":1781…,"key":"SY42-…"}   verify BOTH the key string AND the ts match
  ```
  A genuine winner's key is on exactly one line, bound to that `no` + `ts`. No matching line ⇒ not a real
  winner (fabricated or mistyped key).
- **Backups are load-bearing for redemption.** `claims.jsonl` was always the global counter; it is also the
  sole record of prize keys. Back it up like `feedback.jsonl` (it still contains **no** text/identity).
- **Retuning:** change `PRIZE_NOS` and restart. It only affects **future** allocations — a key already
  written to disk is permanent regardless of the current `PRIZE_NOS`, and boot migration deliberately
  preserves it.

### 7e. Mandatory operations: backups, restart checks, and orphan-prize reconciliation

Run these before launch and after every service/unit change:

```bash
# StateDirectory ownership isolation: both units must keep writing after alternating restarts.
sudo systemctl restart shiyun-feedback shiyun-claim shiyun-feedback shiyun-claim
curl -fsS localhost:8787/api/feedback/health
curl -fsS localhost:8788/api/claim/health
# Exercise an actual append in each service after the alternating restarts (not merely a root permission check).
curl -fsS -X POST localhost:8787/api/feedback -H 'Content-Type: application/json' \
  -d '{"message":"StateDirectory restart smoke test"}'
curl -fsS -X POST localhost:8788/api/claim   # record this operator-owned smoke-test number/key in the register
sudo tail -n 1 /var/lib/private/shiyun-feedback/feedback.jsonl
sudo tail -n 1 /var/lib/private/shiyun-claim/claims.jsonl

# Back up each independent state directory. Keep these snapshots encrypted and access-controlled.
sudo install -d -m 0700 /var/backups/shiyun
sudo rsync -a /var/lib/private/shiyun-feedback/ /var/backups/shiyun/shiyun-feedback/
sudo rsync -a /var/lib/private/shiyun-claim/ /var/backups/shiyun/shiyun-claim/
```

The POST reply is intentionally one-shot. A network failure can therefore leave a **durable orphan prize row**
(a key exists on the server, but no visitor received it). Keep an owner-only, one-key-per-line redemption
register at `/var/backups/shiyun/redeemed-keys.txt`, then reconcile it regularly:

```bash
sudo touch /var/backups/shiyun/redeemed-keys.txt
sudo chmod 0600 /var/backups/shiyun/redeemed-keys.txt
sudo sed -n 's/.*"key":"\([^"]*\)".*/\1/p' /var/lib/private/shiyun-claim/claims.jsonl \
  | sudo sort -u > /tmp/shiyun-minted-keys.txt
sudo sort -u /var/backups/shiyun/redeemed-keys.txt > /tmp/shiyun-redeemed-keys.txt
comm -23 /tmp/shiyun-minted-keys.txt /tmp/shiyun-redeemed-keys.txt   # minted but not recorded as redeemed
```

Investigate each long-lived entry against owner messages and its ledger timestamp. **Never delete, rewrite, or
reissue its ledger line/key**; record the final disposition (redeemed, expired by published rules, or still
unclaimed) in the owner register and retain both the ledger and its backups. Also inspect
`claims.jsonl.rejected`: any row containing `"key":"SY` is a credential incident requiring manual review.
