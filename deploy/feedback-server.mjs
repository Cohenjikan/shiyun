// 诗云 — self-hosted feedback collector. ZERO dependencies (node:http only), ~100 lines.
//
// The ONLY backend 诗云 uses: receives the in-page feedback POSTs and appends them to a JSONL
// file. Everything else (corpus, index math, rendering) stays static — never add more backend.
//
//   POST /api/feedback   body: {"source":"shiyun","message":"…","ts":1781000000000}
//                        → appends one JSON line to FEEDBACK_FILE, replies {"ok":true}
//   GET  /api/feedback?token=<FEEDBACK_TOKEN>
//                        → owner-only: streams the JSONL back (newest last). 403 without token.
//   GET  /api/feedback/health → {"ok":true} (for monitoring)
//
// Privacy by design: stores message + timestamps + truncated user-agent. NO IP address.
//
// Run (dev):        node deploy/feedback-server.mjs
// Configure (env):  PORT=8787  HOST=127.0.0.1  FEEDBACK_FILE=/var/lib/shiyun/feedback.jsonl
//                   FEEDBACK_TOKEN=<long random string — REQUIRED for the GET listing>
//
// Deploy: bind to 127.0.0.1 and put nginx in front (same-origin /api/feedback → no CORS at all);
// see docs/DEPLOY.md §5 for the nginx location + systemd unit.
import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const FILE = process.env.FEEDBACK_FILE || "./feedback.jsonl";
const TOKEN = process.env.FEEDBACK_TOKEN || ""; // empty → GET listing disabled
const MAX_BODY = 16 * 1024; // 16 KB is plenty for a 5000-char message
const MAX_MSG = 5000;

// tiny in-memory rate limit: per-process, 30 posts / 10 min / UA-bucket. Coarse on purpose —
// it only needs to stop a runaway loop, not a determined attacker (nginx limit_req can do more).
const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 10 * 60_000);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 10_000) hits.clear(); // bound memory
  return arr.length > 30;
}

const json = (res, code, obj) =>
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(obj));

await mkdir(dirname(FILE), { recursive: true }).catch(() => {});

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && path === "/api/feedback/health") return json(res, 200, { ok: true });

  if (req.method === "GET" && path === "/api/feedback") {
    if (!TOKEN || url.searchParams.get("token") !== TOKEN) return json(res, 403, { error: "forbidden" });
    const body = await readFile(FILE, "utf8").catch(() => "");
    return res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" }).end(body);
  }

  if (req.method === "POST" && path === "/api/feedback") {
    const ua = String(req.headers["user-agent"] || "").slice(0, 120);
    if (rateLimited(ua)) return json(res, 429, { error: "slow down" });
    let raw = "";
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { json(res, 413, { error: "too large" }); req.destroy(); return; }
      raw += c;
    });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let body = null;
      try { body = JSON.parse(raw); } catch { /* fall through to the empty-message 400 */ }
      const msg = String(body?.message ?? "").trim().slice(0, MAX_MSG);
      if (!msg) return json(res, 400, { error: "empty message" });
      const entry = { message: msg, ts: Number(body?.ts) || Date.now(), receivedAt: Date.now(), ua };
      try {
        await appendFile(FILE, JSON.stringify(entry) + "\n", "utf8");
        return json(res, 200, { ok: true });
      } catch (e) {
        console.error("append failed:", e.message);
        return json(res, 500, { error: "storage" });
      }
    });
    return;
  }

  json(res, 404, { error: "not found" });
}).listen(PORT, HOST, () => {
  console.log(`shiyun feedback collector on http://${HOST}:${PORT}/api/feedback → ${FILE}`);
  if (!TOKEN) console.warn("FEEDBACK_TOKEN unset — the GET listing is disabled (POST still works)");
});
