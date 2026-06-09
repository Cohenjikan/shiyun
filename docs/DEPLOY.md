# Deploy — 诗云 / Poetry Cloud (static, with one optional feedback endpoint)

The whole app is a static build. **The corpus, all index math, and rendering stay 100% client-side —
never add a backend for those.** You ship `dist/` to any static host that supports **HTTP Range** on
`poems/*.json` (nginx, Caddy, most CDNs do).

The **only** optional server touchpoint is **feedback collection** (§5): if you want a shared, cross-device
inbox instead of per-browser localStorage, point one env var at a write-only endpoint. Leave it unset and the
build is fully static, exactly as before.

## 1. Build

```bash
npm ci
node --max-old-space-size=4096 pipeline/build-data.mjs   # regenerate public/data (poems + lines + sidecars)
npm run deploy:build                                     # = npm run build && npm run precompress
```

- `npm run build` runs `tsc --noEmit` then `vite build` → `dist/`. Vite copies `public/` (incl.
  `public/data/`) into `dist/data/`, so the heavy corpora ship as static files.
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
collector, never anything needing a secret. The endpoint must send permissive **CORS** headers (it's called
cross-origin from the static host).

### 5a. Wire it

```bash
cp .env.example .env.local
# edit .env.local:  VITE_FEEDBACK_ENDPOINT="https://shiyun-feedback.<you>.workers.dev"
npm run deploy:build      # the URL is baked into dist/ at build time
```

`.env.local` is git-ignored; `.env.example` is the tracked template. Unset/blank ⇒ 100% static (no network).

### 5b. Drop-in Cloudflare Worker (free tier; stores to KV)

`wrangler init shiyun-feedback`, bind a KV namespace as `FEEDBACK`, then:

```js
export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",            // or lock to your site's origin
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("method", { status: 405, headers: cors });
    let body;
    try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers: cors }); }
    const msg = String(body?.message ?? "").slice(0, 5000).trim();
    if (!msg) return new Response("empty", { status: 400, headers: cors });
    // key by time so listing is chronological; store msg + a little request metadata
    const key = `${Date.now()}-${crypto.randomUUID()}`;
    await env.FEEDBACK.put(key, JSON.stringify({
      message: msg,
      ts: Number(body?.ts) || Date.now(),
      ip: req.headers.get("cf-connecting-ip") || null,
      ua: req.headers.get("user-agent") || null,
    }));
    return new Response("ok", { headers: cors });
  },
};
```

`wrangler deploy` → copy the `*.workers.dev` URL into `VITE_FEEDBACK_ENDPOINT`. Read submissions with
`wrangler kv key list --binding=FEEDBACK` / `wrangler kv key get --binding=FEEDBACK <key>`. (Add basic rate
limiting / a turnstile check before sharing the URL widely if abuse is a concern.)

> Prefer no-code? Any JSON-accepting form backend works the same way — e.g. a **Formspree** form URL as
> `VITE_FEEDBACK_ENDPOINT` (it accepts `{message, ...}` JSON and shows submissions in its dashboard). The
> client contract above is all the endpoint has to honor.

### 5c. Verify after deploy

```bash
curl -s -X POST "$VITE_FEEDBACK_ENDPOINT" -H 'Content-Type: application/json' \
  -d '{"source":"shiyun","message":"部署冒烟测试 ✅","ts":1781000000000}' -i | head -1
# want: HTTP/.. 200 (and the message shows up in your KV / Formspree inbox)
```

In the live app, submit a test message and confirm a `POST` to your endpoint in the browser Network panel
(it should be `200`; a failure is silently tolerated and the message still lands in localStorage).
