// 诗云 — self-hosted 认领 (poem-claim) collector. ZERO dependencies (node:http only), ~160 lines.
//
// The SECOND (and last) optional backend 诗云 uses, a sibling of the feedback collector. It exists for
// ONE thing the static client cannot do: hand out a GLOBALLY monotonic 认领编号 (claim number) that
// counts up from 1 across ALL users.
//
// ⚖️ HARD CONSTRAINT — STORE ONLY THREE NUMBERS (+ on a prize row, ONE server-random key), NEVER ANY
//   TEXT/IDENTITY. Each claim appends EXACTLY:
//      no    — the 认领编号 (global, from 1, consecutive)
//      index — the poem's 全集编号 (a long decimal; 诗云's 编号↔诗 is a reversible bijection)
//      ts    — the claim timestamp
//      key   — ONLY on a 里程碑 prize row (no ∈ PRIZE_NOS): a server-random 中奖密钥 (see below). Nothing
//              else — still zero identity, zero 文字, zero IP. The key is co-located with `ts` on the same
//              line so the owner verifies both together (a key is bound to the moment it was minted).
//   NEVER stored: the poem TEXT or any文字内容, user identity, IP, or User-Agent. The poem is recomputed
//   client-side from `index` (pulledFromIndex) and never touches the server. Rationale: persisting poem
//   text would make this a user-generated-content service (论坛性质) → ICP 备案 / 内容审核 obligations in
//   中国. Storing only numbers (+ a random prize token) = mathematical coordinates, NOT a content service.
//   (UA is used ONLY for the in-memory rate limiter and is never written to disk.)
//
//   🎁 里程碑中奖 (milestone prize): when a newly-allocated `no` is a milestone (PRIZE_NOS, default
//   1,100,500,1000,5000,10000), the server mints a random, time-bound 中奖密钥 (impossible to guess or
//   pre-compute). The POST reply carries it back as `prizeKey`; the client shows 「你中奖了」 and the
//   claimer DMs the author on any platform to redeem 刘慈欣《诗云》原著. The owner verifies by grepping
//   claims.jsonl for the {no,ts,key} the claimer quotes. RED LINE: the key lives ONLY in the JSONL and the
//   ONE POST reply — the PUBLIC feed and the boot-recovered in-memory window NEVER carry it.
//
//   POST /api/claim        body: {"index":"<decimal 全集编号>","ts?":169…}  (any other field is IGNORED)
//                          → atomically allocates the next 认领编号, appends one JSON line {no,index,ts}
//                            (+ "key" on a prize row), replies {"ok":true,"no":<claim#>,"index":"…","ts":…}.
//                            On a 里程碑 prize row the reply ALSO carries "prizeKey":"SY<no>-…" (this reply
//                            ONLY). The number is THE backend value.
//   GET  /api/claim/feed   ?since=<ts>&limit=<n>   (PUBLIC — every visitor reads it to draw meteors)
//                          → {"total":<all-time count>,"serverNow":<ms>,"claims":[{"no","index","ts"},…]}
//                            newest-first, capped at `limit` (default 500, max 2000). No token: it only
//                            exposes claim numbers + public poem indices + timestamps (no identity).
//   GET  /api/claim/health → {"ok":true}
//
// Atomicity: node is single-threaded, but appendFile is async — two concurrent POSTs could both read the
// counter before either writes. A tiny promise-chain mutex (allocate) serialises "increment + append" so
// every claim gets a UNIQUE consecutive number, even under a burst. The counter is recovered at boot by
// scanning the JSONL (max `no` seen), so a restart never reuses or skips a number.
//
// Run (dev):        node deploy/claim-server.mjs
// Configure (env):  PORT=8788  HOST=127.0.0.1  CLAIM_FILE=/var/lib/shiyun/claims.jsonl
//                   FEED_MAX=2000   (hard cap on the public feed window)
//                   PRIZE_NOS="1,100,500,1000,5000,10000"   (认领编号 that mint a 中奖密钥; comma-separated)
//
// Owner verify (a claimer DMs you a 中奖密钥): ssh in, then
//     grep '"key":"SY<no>-' /var/lib/shiyun/claims.jsonl   →  confirm the {no, ts, key} matches what they sent
// (the key is bound to that no+ts on one line; it appears NOWHERE else — not in the feed, not in any reply
// but the original one). No key on file ⇒ not a genuine winner.
//
// Deploy: bind to 127.0.0.1 and put nginx in front (same-origin /api/claim → no CORS); see
// docs/DEPLOY.md §7 for the nginx location + systemd unit. Keep it SEPARATE from the feedback collector
// (different failure domain; the feed is public while the feedback inbox is token-gated).
import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";
const FILE = process.env.CLAIM_FILE || "./claims.jsonl";
const FEED_MAX = Math.max(1, Number(process.env.FEED_MAX || 2000)); // hard cap on the public window
const MAX_BODY = 4 * 1024; // a claim is a tiny JSON — 4 KB is generous
const MAX_INDEX = 4096; // a 全集编号 is a long decimal but bounded; reject absurd input

// 里程碑中奖号 (认领编号 that mint a 中奖密钥). A Set of positive ints from PRIZE_NOS (comma-separated),
// default the 1st / 100th / 500th / 1000th / 5000th / 10000th claim. Malformed entries are dropped.
const PRIZE_NOS = new Set(
  String(process.env.PRIZE_NOS ?? "1,100,500,1000,5000,10000")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0),
);
console.log(`prize 认领编号: ${[...PRIZE_NOS].sort((a, b) => a - b).join(", ") || "(none)"}`);

// 中奖密钥 alphabet — Crockford-ish 31 chars, NO 0/O/1/I/L (hand-copy-proof). Key format is
// `SY<no>-XXXXX-XXXXX-XXXXX-XXXXX`: 4 groups × 5 chars = 20 symbols → 31^20 ≈ 99 bits of entropy, so it
// cannot be guessed or pre-computed. `<no>` prefixes it purely so a human eyeballs which milestone it is.
const KEY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // length 31

// Draw `n` uniform symbols with REJECTION SAMPLING (no modulo bias): 256 % 31 = 8, so bytes ≥ 248 are
// discarded and the remaining 0..247 map evenly across the 31 symbols. randomBytes is a CSPRNG.
function randomSymbols(n) {
  const m = KEY_ALPHABET.length; // 31
  const limit = 256 - (256 % m); // 248
  const out = [];
  while (out.length < n) {
    for (const b of randomBytes(Math.max(16, (n - out.length) * 2))) {
      if (b >= limit) continue; // reject the biased tail
      out.push(KEY_ALPHABET[b % m]);
      if (out.length === n) break;
    }
  }
  return out;
}

// Mint a 中奖密钥 for a prize 认领编号: `SY<no>-XXXXX-XXXXX-XXXXX-XXXXX`.
function makePrizeKey(no) {
  const s = randomSymbols(20);
  const g = (i) => s.slice(i, i + 5).join("");
  return `SY${no}-${g(0)}-${g(5)}-${g(10)}-${g(15)}`;
}

// tiny in-memory rate limit: per-process, 60 claims / 10 min / UA-bucket. Coarse on purpose — it only
// needs to stop a runaway loop, not a determined attacker (nginx limit_req does the real throttling).
const hits = new Map();
const WINDOW = 10 * 60_000;
function rateLimited(key, cap) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 10_000) {
    // bound memory by evicting STALE buckets (last hit outside the window) — not a blanket clear, which
    // would also zero every legitimate visitor's counter. A last-resort clear only if everything is fresh.
    for (const [k, v] of hits) if (now - v[v.length - 1] >= WINDOW) hits.delete(k);
    if (hits.size > 20_000) hits.clear();
  }
  return arr.length > cap;
}

const json = (res, code, obj) =>
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  }).end(JSON.stringify(obj));

await mkdir(dirname(FILE), { recursive: true }).catch(() => {});

// ── recover the counter + an in-memory recent window from the JSONL at boot ──────────────────────────
// `counter` = the highest 认领编号 ever written (next claim = counter+1). `recent` = the newest claims
// kept in memory so GET /feed is O(1) (never re-reads the growing file per request); `total` = all-time
// count. A malformed line is skipped (never crashes boot).
let counter = 0;
let total = 0;
let recent = []; // newest-LAST in memory; the feed reverses a slice to newest-first
async function boot() {
  let body = "";
  try {
    body = await readFile(FILE, "utf8");
  } catch {
    return; // no file yet → empty ledger
  }
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let row = null;
    try { row = JSON.parse(s); } catch { continue; }
    const no = Number(row?.no);
    const index = typeof row?.index === "string" ? row.index : "";
    if (!Number.isFinite(no) || no <= 0 || !index) continue;
    total++;
    if (no > counter) counter = no;
    // RED LINE (same as allocate): recover ONLY the three numbers into the feed window — never row.key.
    // A prize row on disk has a `key`, but it must NEVER re-enter the public feed after a restart.
    recent.push({ no, index, ts: Number(row?.ts) || 0 });
  }
  // keep memory bounded — only the newest FEED_MAX matter for the feed
  if (recent.length > FEED_MAX) recent = recent.slice(recent.length - FEED_MAX);
  console.log(`claims recovered: total=${total}, last 认领编号=${counter}, window=${recent.length}`);
}
await boot();

// ── serialise allocate-number + append so concurrent POSTs never collide on a number ─────────────────
// Every allocate() chains onto the previous one's promise; the critical section (read counter → write
// line → bump counter/window) runs strictly one-at-a-time. A failed append does NOT advance the counter.
let chain = Promise.resolve();
function allocate(index, ts) {
  const run = async () => {
    const no = counter + 1;
    // Three numbers always; a 里程碑 prize row ALSO carries one server-random 中奖密钥 (nothing else — still
    // zero identity / zero 文字 / zero IP). The key is minted INSIDE the critical section and lands on the
    // same line as {no, index, ts} so it is bound to that exact moment (owner verifies key + ts together).
    const key = PRIZE_NOS.has(no) ? makePrizeKey(no) : null;
    const entry = key ? { no, index, ts, key } : { no, index, ts };
    await appendFile(FILE, JSON.stringify(entry) + "\n", "utf8"); // throws → NEITHER number NOR key committed
    counter = no;
    total++;
    // RED LINE: the in-memory feed window is the PUBLIC interface — it NEVER holds the key. Push only the
    // three numbers here (and boot() does the same when recovering from disk).
    recent.push({ no, index, ts });
    if (recent.length > FEED_MAX) recent.shift();
    return { no, key }; // key is non-null only on a prize row → echoed to the POST reply as prizeKey
  };
  const next = chain.then(run, run); // run regardless of a prior rejection (each claim is independent)
  chain = next.catch(() => {}); // keep the chain alive even if this one rejected
  return next;
}

// digits-only, length-bounded 全集编号 (the universal anyRank decimal). Reject anything else so a hostile
// body can't bloat the ledger or smuggle non-numeric junk into the public feed.
function cleanIndex(v) {
  if (typeof v !== "string") return "";
  const s = v.replace(/[^0-9]/g, "");
  if (!s || s.length > MAX_INDEX) return "";
  return s.replace(/^0+(?=\d)/, ""); // normalize leading zeros (keep a lone "0")
}

createServer(async (req, res) => {
  // the Host header is attacker-controlled — an invalid one makes `new URL` throw, which in an async
  // handler becomes an unhandled rejection and KILLS the process. Parse defensively (matches the
  // feedback collector); any other sync throw is caught by the outer try below.
  try {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch {
      return json(res, 400, { error: "bad request" });
    }
    const path = url.pathname.replace(/\/+$/, "");

    if (req.method === "GET" && path === "/api/claim/health") return json(res, 200, { ok: true });

    // PUBLIC feed: newest-first window + the all-time total. No token — only public data (a claim number,
    // a public poem index, a timestamp). `since` lets the client fetch just what's new; `limit` caps size.
    if (req.method === "GET" && path === "/api/claim/feed") {
      const ua = String(req.headers["user-agent"] || "").slice(0, 120);
      if (rateLimited("feed:" + ua, 240)) return json(res, 429, { error: "slow down" });
      const since = Number(url.searchParams.get("since")) || 0;
      let limit = Number(url.searchParams.get("limit")) || 500;
      limit = Math.max(1, Math.min(FEED_MAX, limit));
      // newest-first; optional since-filter (claims strictly after `since` ms)
      const claims = [];
      for (let i = recent.length - 1; i >= 0 && claims.length < limit; i--) {
        const c = recent[i];
        if (since && c.ts <= since) continue; // skip (not break) — ts may be slightly out of append order
        claims.push({ no: c.no, index: c.index, ts: c.ts });
      }
      return json(res, 200, { total, serverNow: Date.now(), claims });
    }

    if (req.method === "POST" && path === "/api/claim") {
      const ua = String(req.headers["user-agent"] || "").slice(0, 120);
      if (rateLimited("post:" + ua, 60)) return json(res, 429, { error: "slow down" });
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
        try { body = JSON.parse(raw); } catch { /* fall through to the empty-index 400 */ }
        const index = cleanIndex(body?.index);
        if (!index) return json(res, 400, { error: "missing or invalid index" });
        // form / source / any other field is deliberately IGNORED — only {index, ts} are read, only
        // {no, index, ts} are stored (compliance: no text content ever lands on disk).
        const ts = Number(body?.ts) || Date.now();
        try {
          const { no, key } = await allocate(index, ts);
          // Prize rows echo the 中奖密钥 back ONCE (this reply only) so the client can persist + show it.
          // Non-prize claims reply exactly as before {ok,no,index,ts}. The key is NEVER in the feed.
          const reply = { ok: true, no, index, ts };
          if (key) reply.prizeKey = key;
          return json(res, 200, reply);
        } catch (e) {
          console.error("claim append failed:", e?.message || e);
          return json(res, 500, { error: "storage" });
        }
      });
      return;
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
  console.log(`shiyun claim collector on http://${HOST}:${PORT}/api/claim → ${FILE}`);
});
