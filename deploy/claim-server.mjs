// 诗云 — self-hosted claim-number allocator. ZERO dependencies (node:http only).
//
// Privacy boundary:
//   POST /api/claim has NO request body. The server creates and stores exactly {no, ts} — plus, on a 里程碑
//   prize row (no ∈ PRIZE_NOS), ONE extra field `key`: a server-random 中奖密钥 with ZERO user content (it is
//   not derived from any poem, identity, IP or User-Agent). Poem text, previews and the reversible corpus
//   index never leave the browser. The public feed contains only {no, ts} and cannot locate a poem or carry
//   a key.
//
// 里程碑中奖 (milestone prize): when a newly-allocated `no` is a milestone, the server mints a random,
//   time-bound 中奖密钥 (SY<no>-XXXXX-XXXXX-XXXXX-XXXXX, ≈99 bits — impossible to guess or pre-compute). The
//   POST reply carries it back exactly ONCE as `prizeKey`; the client shows 「你中奖了」 and the winner DMs the
//   author to redeem 刘慈欣《诗云》原著. The owner verifies by grepping claims.jsonl for the {no, ts, key} the
//   claimer quotes.
//   ⚖️ RED LINE: the key exists in exactly TWO places — the one claims.jsonl line it was written to, and the
//   single POST reply that minted it. The public feed, the boot-recovered in-memory window, and every other
//   output NEVER carry it. That one line is the owner's SOLE redemption credential, so claims.jsonl is now a
//   load-bearing backup (see the boot migration below — it deliberately preserves the key).
//
// Existing JSONL ledgers are privacy-migrated at boot: valid rows are reduced to {no,ts} — PLUS a
// well-formed prize `key` if present. A malformed/torn row is NEVER discarded: its bytes remain in the
// ledger, its `no` still advances the recovered counter when possible, and a copy is quarantined in the
// `.rejected` sidecar for operator review. claims.jsonl is a redemption credential, not disposable input.
//
// Endpoints:
//   POST /api/claim          empty body -> {ok,no,ts}  (+ "prizeKey":"SY<no>-…" on a 里程碑 row ONLY)
//   GET  /api/claim/feed    ?since=<server-ts>&limit=<n> -> {total,serverNow,claims:[{no,ts}]}  (never a key)
//   GET  /api/claim/health  -> {ok:true}
//
// Safety limits:
//   MAX_CLAIMS defaults to 1,000,000 and can only be configured DOWNWARD.
//   FEED_MAX defaults to 500 and is hard-capped at 2,000.
//   PRIZE_NOS defaults to "1,100,500,1000,5000,10000" (认领编号 that mint a 中奖密钥; comma-separated env).
//   A bounded in-memory IP bucket is a process-level backstop; nginx's per-real-IP limit is authoritative.
import { createServer } from "node:http";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";
const FILE = process.env.CLAIM_FILE || "./claims.jsonl";
const HARD_MAX_CLAIMS = 1_000_000;
const HARD_FEED_MAX = 2_000;
const MAX_BODY = 512;

function boundedPositiveInt(value, fallback, hardMax) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, hardMax) : fallback;
}

const MAX_CLAIMS = boundedPositiveInt(process.env.MAX_CLAIMS, HARD_MAX_CLAIMS, HARD_MAX_CLAIMS);
const FEED_MAX = boundedPositiveInt(process.env.FEED_MAX, 500, HARD_FEED_MAX);
const CLAIM_RATE_CAP = boundedPositiveInt(process.env.CLAIM_RATE_CAP, 60, 5_000);
const FEED_RATE_CAP = boundedPositiveInt(process.env.FEED_RATE_CAP, 240, 10_000);

// 里程碑中奖号 (认领编号 that mint a 中奖密钥). A Set of positive ints from PRIZE_NOS (comma-separated),
// default the 1st / 100th / 500th / 1000th / 5000th / 10000th claim. Malformed entries are dropped.
const PRIZE_NOS = new Set(
  String(process.env.PRIZE_NOS ?? "1,100,500,1000,5000,10000")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0),
);

// 中奖密钥 alphabet — Crockford-ish 31 chars, NO 0/O/1/I/L (hand-copy-proof). Key format is
// `SY<no>-XXXXX-XXXXX-XXXXX-XXXXX`: 4 groups × 5 chars = 20 symbols → 31^20 ≈ 99 bits of entropy, so it
// cannot be guessed or pre-computed. `<no>` prefixes it purely so a human eyeballs which milestone it is.
const KEY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // length 31
// Matches makePrizeKey output. `[2-9A-Z]` is a deliberate superset of the alphabet (real keys never contain
// I/L/O), so a genuine key ALWAYS matches — used at boot to preserve a real credential and reject junk.
const PRIZE_KEY_RE = /^SY\d+-[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/;
const EMBEDDED_PRIZE_KEY_RE = /"key"\s*:\s*"(SY\d+-[2-9A-Z]{5}(?:-[2-9A-Z]{5}){3})"/;

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

const hits = new Map();
const RATE_WINDOW = 10 * 60_000;
function rateLimited(key, cap) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW);
  hits.set(key, arr);
  // Once full, never push again: a hot bucket is hard-bounded at `cap` instead of growing without limit
  // and making the per-request filter increasingly expensive.
  if (arr.length >= cap) return true;
  arr.push(now);
  if (hits.size > 10_000) {
    for (const [k, values] of hits) if (now - values[values.length - 1] >= RATE_WINDOW) hits.delete(k);
    if (hits.size > 20_000) hits.clear();
  }
  return false;
}

const json = (res, code, obj) =>
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }).end(JSON.stringify(obj));

await mkdir(dirname(FILE), { recursive: true }).catch(() => {});

let counter = 0;
let total = 0;
let recent = []; // newest last; public response reverses it

function recoverNos(source) {
  const values = [];
  const pattern = /"no"\s*:\s*(\d+)/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const no = Number(match[1]);
    if (Number.isSafeInteger(no) && no > 0) values.push(no);
  }
  return values;
}

async function cleanupPrivacyTemps() {
  const directory = dirname(FILE);
  const prefix = `${basename(FILE)}.privacy-`;
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
      .map((name) => unlink(join(directory, name)).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      })),
  );
}

async function writeDurable(path, contents) {
  const handle = await open(path, "w", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.datasync();
  } finally {
    await handle.close();
  }
}

async function appendDurable(path, contents) {
  const handle = await open(path, "a", 0o600);
  try {
    await handle.appendFile(contents, "utf8");
    // Do not hand a prize key to the client until the credential line has reached stable storage.
    await handle.datasync();
  } finally {
    await handle.close();
  }
}

async function updateRejectedSidecar(rejected) {
  if (!rejected.length) return;
  const sidecar = `${FILE}.rejected`;
  let existing = "";
  try { existing = await readFile(sidecar, "utf8"); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const records = new Set(existing.split("\n").filter(Boolean));
  for (const item of rejected) records.add(JSON.stringify(item));
  await writeDurable(sidecar, `${[...records].join("\n")}\n`);
}

async function boot() {
  // A crash between writing and renaming an earlier migration must not leave a second copy of every key.
  await cleanupPrivacyTemps();
  let body;
  try {
    body = await readFile(FILE, "utf8");
  } catch {
    return;
  }
  const migratedLines = [];
  const safeRows = [];
  const rejected = [];
  const inputLines = body.split("\n");
  if (body.endsWith("\n")) inputLines.pop();
  for (const rawLine of inputLines) {
    const source = rawLine.trim();
    if (!source) {
      migratedLines.push(rawLine);
      continue;
    }
    for (const no of recoverNos(source)) counter = Math.max(counter, no);
    let row;
    try {
      row = JSON.parse(source);
    } catch {
      // Preserve the original bytes in-place. In particular, a torn line containing a valid SY key is
      // still the owner's only redemption proof. The added trailing newline prevents the next append from
      // being glued onto the torn tail.
      migratedLines.push(rawLine);
      rejected.push({ reason: EMBEDDED_PRIZE_KEY_RE.test(source) ? "malformed-with-prize-key" : "malformed", raw: rawLine });
      continue;
    }
    const no = Number(row?.no);
    if (!Number.isSafeInteger(no) || no <= 0) {
      migratedLines.push(rawLine);
      rejected.push({ reason: "invalid-no", raw: rawLine });
      continue;
    }
    counter = Math.max(counter, no);
    const rawTs = Number(row?.ts);
    // A bad timestamp must never take an otherwise valid numbered credential down with it.
    const ts = Number.isFinite(rawTs) && rawTs > 0 ? rawTs : 1;
    // Strip legacy `index` and every other extra field down to {no, ts} — BUT preserve a well-formed prize
    // `key`: it is a 里程碑 winner's sole redemption credential and destroying it here would be an incident.
    const entry = { no, ts };
    if (typeof row?.key === "string" && PRIZE_KEY_RE.test(row.key)) entry.key = row.key;
    migratedLines.push(JSON.stringify(entry));
    safeRows.push(entry);
  }

  total = counter;
  // RED LINE: the public feed window carries ONLY {no, ts} — a prize row's `key` never re-enters memory.
  recent = safeRows.slice(-FEED_MAX).map(({ no, ts }) => ({ no, ts }));

  const migrated = migratedLines.length ? `${migratedLines.join("\n")}\n` : "";
  if (migrated !== body) {
    const temp = `${FILE}.privacy-${process.pid}.tmp`;
    await writeDurable(temp, migrated);
    await rename(temp, FILE);
    console.warn(`privacy migration normalized safe rows without discarding malformed credential bytes in ${FILE}`);
  }
  await updateRejectedSidecar(rejected);
  console.log(`claims recovered: total=${total}, last=${counter}, public-window=${recent.length}`);
}
await boot();
console.log(`prize 认领编号: ${[...PRIZE_NOS].sort((a, b) => a - b).join(", ") || "(none)"}`);

let chain = Promise.resolve();
function allocate() {
  const run = async () => {
    if (counter >= MAX_CLAIMS) {
      const error = new Error("claim limit reached");
      error.code = "CLAIM_LIMIT";
      throw error;
    }
    const no = counter + 1;
    const ts = Date.now();
    // A 里程碑 prize row ALSO carries one server-random 中奖密钥 (nothing else — still zero identity / 文字 /
    // IP). Minted INSIDE the mutex and co-located with {no, ts} so it is bound to that exact moment (the owner
    // verifies key + ts together). RED LINE: the key lands ONLY on this JSONL line and the ONE POST reply.
    const key = PRIZE_NOS.has(no) ? makePrizeKey(no) : null;
    const entry = key ? { no, ts, key } : { no, ts };
    await appendDurable(FILE, `${JSON.stringify(entry)}\n`); // throws → NEITHER number NOR key committed
    counter = no;
    total++;
    recent.push({ no, ts }); // feed window: the two numbers only — never the key
    if (recent.length > FEED_MAX) recent.shift();
    return { no, ts, key }; // key is non-null only on a prize row → echoed to the POST reply as prizeKey
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

createServer(async (req, res) => {
  try {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch {
      return json(res, 400, { error: "bad request" });
    }
    const path = url.pathname.replace(/\/+$/, "");

    if (req.method === "GET" && path === "/api/claim/health") return json(res, 200, { ok: true });

    if (req.method === "GET" && path === "/api/claim/feed") {
      const ip = req.socket.remoteAddress || "unknown";
      if (rateLimited(`feed:${ip}`, FEED_RATE_CAP)) return json(res, 429, { error: "slow down" });
      const since = Number(url.searchParams.get("since")) || 0;
      const limit = boundedPositiveInt(url.searchParams.get("limit"), Math.min(500, FEED_MAX), FEED_MAX);
      const claims = [];
      for (let i = recent.length - 1; i >= 0 && claims.length < limit; i--) {
        const claim = recent[i];
        if (since && claim.ts <= since) continue;
        claims.push({ no: claim.no, ts: claim.ts });
      }
      return json(res, 200, { total, serverNow: Date.now(), claims });
    }

    if (req.method === "POST" && path === "/api/claim") {
      const ip = req.socket.remoteAddress || "unknown";
      if (rateLimited(`post:${ip}`, CLAIM_RATE_CAP)) return json(res, 429, { error: "slow down" });
      let size = 0;
      let tooLarge = false;
      req.on("data", (chunk) => {
        if (tooLarge) return;
        size += chunk.length;
        if (size > MAX_BODY && !res.writableEnded) {
          tooLarge = true;
          json(res, 413, { error: "too large" });
          req.destroy();
          return;
        }
      });
      req.on("end", async () => {
        if (res.writableEnded) return;
        // Reject rather than ignore a body: the official endpoint must be incapable of accepting a poem/index.
        if (size !== 0) return json(res, 400, { error: "request body is not allowed" });
        try {
          const { no, ts, key } = await allocate();
          // A 里程碑 prize row echoes the 中奖密钥 back exactly ONCE (this reply only) so the client can
          // persist + show it. Non-prize claims reply {ok,no,ts}. The key is NEVER in the feed.
          const reply = { ok: true, no, ts };
          if (key) reply.prizeKey = key;
          return json(res, 200, reply);
        } catch (error) {
          if (error?.code === "CLAIM_LIMIT") return json(res, 503, { error: "claim limit reached" });
          console.error("claim append failed:", error?.message || error);
          return json(res, 500, { error: "storage" });
        }
      });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (error) {
    console.error("handler error:", error?.message || error);
    if (!res.writableEnded) {
      try { json(res, 500, { error: "internal" }); } catch { /* socket closed */ }
    }
  }
}).listen(PORT, HOST, () => {
  console.log(`shiyun claim allocator on http://${HOST}:${PORT}/api/claim -> ${FILE}`);
  console.log(`limits: claims=${MAX_CLAIMS}, public-feed=${FEED_MAX}; stored fields=no,ts (+key on a 里程碑 row)`);
});
