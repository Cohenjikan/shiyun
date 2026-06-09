# Deploy — 诗云 / Poetry Cloud (static, with one optional feedback endpoint)

The whole app is a static build. **The corpus, all index math, and rendering stay 100% client-side —
never add a backend for those.** You ship `dist/` to any static host that supports **HTTP Range** on
`poems/*.json` (nginx, Caddy, most CDNs do).

The **only** optional server touchpoint is **feedback collection** (§5): if you want a shared, cross-device
inbox instead of per-browser localStorage, point one env var at a write-only endpoint. Leave it unset and the
build is fully static, exactly as before.

## ▶ Quickstart for the deploy / 运维 AI

Latest code is on **`main`** (`origin/main`). The heavy poem data is **git-ignored (~1.1 GB)** and lives,
complete + verified, in the **main worktree** at `C:\Users\Cohen\Desktop\shiyun\public\data`. Fastest correct
deploy — build there, where both the latest code (after pull) and the data already exist:

```bash
cd C:\Users\Cohen\Desktop\shiyun     # the main worktree — already has the complete public/data
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

- **Option A — use the existing complete copy (recommended; no corpora needed).** The canonical, verified set
  (poems 236 MB · lines 792 MB · search 130 MB) is in the main worktree's `public/data`. Either **build from
  the main worktree** (the Quickstart above), or copy those dirs into your build tree:
  ```bash
  # from a fresh clone's repo root, on the same machine:
  cp -r "C:/Users/Cohen/Desktop/shiyun/public/data/poems"  public/data/
  cp -r "C:/Users/Cohen/Desktop/shiyun/public/data/lines"  public/data/   # only if you want 诗句 search
  cp -r "C:/Users/Cohen/Desktop/shiyun/public/data/search" public/data/   # only if you want 寻诗/探诗 search
  ```
  (On Windows you can junction instead of copy: `New-Item -ItemType Junction -Path public\data\poems -Target "C:\Users\Cohen\Desktop\shiyun\public\data\poems"` — vite follows junctions when copying into `dist/`.)
- **Option B — regenerate (only if you have the corpora).** Needs `C:/corpus/Werneror-Poetry` **and**
  `C:/corpus/modern-poetry` cloned. **This OVERWRITES `public/data`.** A missing modern corpus now **fails
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
caps build size, host `data/` on object storage / a CDN and point `loadData(base)` /
`loadPoetPoems(id, base)` at it (the `base` arg already exists for exactly this).

## 2. Serve

Use [deploy/nginx.conf](../deploy/nginx.conf) as a starting point (needs the `ngx_brotli` module for
`brotli_static`; `gzip_static` is built in). Key points:

- **SPA fallback** — 诗云 is a hash-router (`#a=…` / `#p=…`), so `try_files $uri $uri/ /index.html`.
- **Cache** — `/assets/*` (content-hashed) `immutable, max-age=31536000`; `index.html` `no-cache`.
- **Compression** — brotli/gzip for js/css/json **except** `data/poems/` (§3).

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

**Reading the inbox (owner):**

```bash
curl -s "https://你的域名/api/feedback?token=<FEEDBACK_TOKEN>"   # newest last, one JSON per line
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
