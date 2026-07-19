// 诗云 — self-hosted feedback collector. ZERO dependencies (node:http only), ~100 lines.
//
// Receives optional in-page feedback POSTs and appends them to a bounded JSONL inbox. The corpus,
// index math, rendering and poem claims remain content-free/static or use their separate number allocator.
//
//   POST /api/feedback   body: {"message":"…"}
//                        → appends one JSON line to FEEDBACK_FILE, replies {"ok":true}
//   GET  /api/feedback   header: Authorization: Bearer <FEEDBACK_TOKEN>
//                        → owner-only: streams the JSONL back (newest last). 403 without token.
//                        (header, NOT query string — query strings land in nginx access logs)
//   GET  /api/feedback/health → {"ok":true} (for monitoring)
//
// Privacy by design: stores only message + server receivedAt. NO IP or User-Agent is persisted.
//
// Run (dev):        node deploy/feedback-server.mjs
// Configure (env):  PORT=8787  HOST=127.0.0.1  FEEDBACK_FILE=/var/lib/shiyun/feedback.jsonl
//                   FEEDBACK_TOKEN=<long random string — REQUIRED for the GET listing>
//
// Deploy: bind to 127.0.0.1 and put nginx in front (same-origin /api/feedback → no CORS at all);
// see docs/DEPLOY.md §5 for the nginx location + systemd unit.
//
// OPTIONAL: dynamic OG share cards (docs/DEPLOY.md §6). Set SITE_ROOT=<built dist/> and nginx routes
//   GET /?a=… here; we return index.html with the OG/Twitter title+description swapped for public poets.
//   Reversible poem coordinates remain hash-only and are never accepted in this server route.
//   per target (server-side, so crawlers see the right card). SITE_ROOT unset → those routes 404
//   exactly as before, so existing deployments are unaffected. index.html + poets.index.json are read
//   ONCE at boot into memory; every request is O(1) string work, never a per-request file read.
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { injectOg, buildPoetMap } from "./og-inject.mjs";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const FILE = process.env.FEEDBACK_FILE || "./feedback.jsonl";
const TOKEN = process.env.FEEDBACK_TOKEN || ""; // empty → GET listing disabled
const SITE_ROOT = process.env.SITE_ROOT || ""; // empty → dynamic OG disabled (GET / stays 404)
const MAX_BODY = 16 * 1024; // 16 KB is plenty for a 5000-char message
const MAX_MSG = 5000;
const HARD_MAX_ROWS = 5000;
const requestedRows = Number(process.env.FEEDBACK_MAX_ROWS);
const MAX_ROWS = Number.isSafeInteger(requestedRows) && requestedRows > 0
  ? Math.min(requestedRows, HARD_MAX_ROWS)
  : HARD_MAX_ROWS;

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

// constant-time secret comparison: hash both sides → equal-length buffers for timingSafeEqual
// (a plain !== short-circuits on the first differing char — a textbook timing side channel).
const sha = (s) => createHash("sha256").update(String(s)).digest();
const tokenOk = (presented) => !!TOKEN && timingSafeEqual(sha(presented), sha(TOKEN));

await mkdir(dirname(FILE), { recursive: true }).catch(() => {});

// Durable privacy boundary: retain only valid {message,receivedAt} rows, remove legacy UA/client timestamp/
// source fields, and bound the inbox. User-Agent remains transient in the in-memory rate limiter only.
let storedRows = 0;
async function sanitizeFeedbackFile() {
  let body;
  try {
    body = await readFile(FILE, "utf8");
  } catch {
    return;
  }
  const safe = [];
  let changed = false;
  for (const line of body.split("\n")) {
    const source = line.trim();
    if (!source) continue;
    let row;
    try { row = JSON.parse(source); } catch { changed = true; continue; }
    const message = typeof row?.message === "string" ? row.message.trim().slice(0, MAX_MSG) : "";
    const receivedAt = Number(row?.receivedAt ?? row?.ts);
    if (!message || !Number.isFinite(receivedAt) || receivedAt <= 0) { changed = true; continue; }
    const entry = { message, receivedAt };
    if (JSON.stringify(entry) !== source) changed = true;
    safe.push(entry);
  }
  if (safe.length > MAX_ROWS) {
    safe.splice(0, safe.length - MAX_ROWS);
    changed = true;
  }
  storedRows = safe.length;
  if (changed) {
    const temp = `${FILE}.privacy-${process.pid}.tmp`;
    const sanitized = safe.length ? `${safe.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
    await writeFile(temp, sanitized, "utf8");
    await rename(temp, FILE);
    console.warn(`privacy migration sanitized legacy feedback rows in ${FILE}`);
  }
}
await sanitizeFeedbackFile();

let appendChain = Promise.resolve();
function storeFeedback(message) {
  const run = async () => {
    if (storedRows >= MAX_ROWS) {
      const error = new Error("feedback inbox full");
      error.code = "FEEDBACK_LIMIT";
      throw error;
    }
    const entry = { message, receivedAt: Date.now() };
    await appendFile(FILE, `${JSON.stringify(entry)}\n`, "utf8");
    storedRows++;
  };
  const next = appendChain.then(run, run);
  appendChain = next.catch(() => {});
  return next;
}

// Dynamic OG: load the built index.html + the poet index ONCE at boot (never per-request). If
// SITE_ROOT is unset OR the files are missing/unreadable, OG_HTML stays null and GET / stays 404 —
// the feedback routes are entirely unaffected. The poet index is ~2.8 MB → an id→row Map in memory.
let OG_HTML = null; // the built index.html string, or null when dynamic OG is disabled
let OG_POETS = new Map(); // id → poet row
if (SITE_ROOT) {
  try {
    OG_HTML = await readFile(join(SITE_ROOT, "index.html"), "utf8");
    const arr = JSON.parse(await readFile(join(SITE_ROOT, "data", "poets.index.json"), "utf8"));
    OG_POETS = buildPoetMap(arr);
    console.log(`dynamic OG enabled: ${OG_POETS.size} poets from ${SITE_ROOT}`);
  } catch (e) {
    OG_HTML = null; // any failure → silently disable (the routes 404, static behavior is untouched)
    console.warn(`SITE_ROOT set but dynamic OG disabled (load failed): ${e?.message || e}`);
  }
}

createServer(async (req, res) => {
  // the Host header is attacker-controlled — an invalid one (`Host: a b`) makes new URL throw,
  // which in an async handler becomes an unhandled rejection and KILLS the process (one-line DoS,
  // proven). Parse defensively; any other sync throw is caught by the outer try below.
  try {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch {
      return json(res, 400, { error: "bad request" });
    }
    const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && path === "/api/feedback/health") return json(res, 200, { ok: true });

  if (req.method === "GET" && path === "/api/feedback") {
    const ua = String(req.headers["user-agent"] || "").slice(0, 120);
    if (rateLimited("get:" + ua)) return json(res, 429, { error: "slow down" }); // throttle token probes too
    // token via Authorization header, NOT the query string (query strings land in access logs)
    const auth = String(req.headers.authorization || "");
    const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!tokenOk(presented)) return json(res, 403, { error: "forbidden" });
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
      try {
        await storeFeedback(msg);
        return json(res, 200, { ok: true });
      } catch (e) {
        if (e?.code === "FEEDBACK_LIMIT") return json(res, 503, { error: "feedback inbox full" });
        console.error("append failed:", e.message);
        return json(res, 500, { error: "storage" });
      }
    });
    return;
  }

  // Dynamic OG share card: GET / (root only) with a public ?a=. Reversible poem indexes are deliberately
  // hash-only and never reach this process/access logs. Disabled (→ falls through to 404,
  // exactly as today) when SITE_ROOT is unset/unloadable. The url is already parsed defensively above
  // (a hostile Host can't reach here — new URL threw → 400). Query values are length-capped + escaped
  // inside injectOg; the raw input is never echoed. Crawler traffic, O(1) string work → no rate limit.
  if (OG_HTML && req.method === "GET" && path === "") {
    const a = url.searchParams.get("a");
    if (a != null) {
      // og:url mirrors the request (same target) so crawlers canonicalize to it; built from the
      // already-validated URL (origin + path + query), never from raw header concatenation.
      const ogUrl = `${url.origin}${url.pathname}${url.search}`;
      const { html } = injectOg(OG_HTML, { a }, OG_POETS, ogUrl);
      return res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" })
        .end(html);
    }
    // GET / with no public poet target → fall through to 404 (nginx serves static index.html).
  }

  json(res, 404, { error: "not found" });
  } catch (e) {
    // belt-and-braces: no request may ever crash the process (unhandled rejection = process exit)
    console.error("handler error:", e?.message || e);
    if (!res.writableEnded) {
      try { json(res, 500, { error: "internal" }); } catch { /* socket already gone */ }
    }
  }
}).listen(PORT, HOST, () => {
  console.log(`shiyun feedback collector on http://${HOST}:${PORT}/api/feedback → ${FILE}`);
  console.log(`privacy: stored fields=message,receivedAt only; row limit=${MAX_ROWS}`);
  if (!TOKEN) console.warn("FEEDBACK_TOKEN unset — the GET listing is disabled (POST still works)");
});
