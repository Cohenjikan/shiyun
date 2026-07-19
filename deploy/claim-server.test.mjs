import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "claim-server.mjs");

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

// Readiness is bounded by WALL-CLOCK, not a fixed iteration count. Each case spawns a REAL node process +
// boots off disk; under vitest's parallel workers a cold spawn can blow past a few-second budget even
// though the child is fine (observed ~1-in-4 parallel runs). A ~15s ceiling is orders of magnitude over a
// healthy boot yet still fails fast if the child never listens. We ALSO short-circuit on the "allocator on"
// stdout line the server prints from its listen() callback, so a ready server is detected the moment it
// logs — the health poll is the backstop.
const READY_TIMEOUT_MS = 15_000;
async function waitForServer(origin, child, output) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`claim server exited early:\n${output()}`);
    if (/allocator on http/.test(output())) return; // listen() callback fired
    try {
      const response = await fetch(`${origin}/api/claim/health`);
      if (response.ok) return;
    } catch {
      // boot is still in progress
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`claim server did not become ready within ${READY_TIMEOUT_MS}ms:\n${output()}`);
}

// Spawn the real allocator against a scratch ledger + env, wait until it answers /health. Returns the
// handles the caller needs plus a live log accessor for failure messages.
async function startServer(ledger, extraEnv = {}) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let logs = "";
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), CLAIM_FILE: ledger, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  await waitForServer(origin, child, () => logs);
  return { child, origin, logs: () => logs };
}

async function stopServer(child) {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode != null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 2000);
  });
}

async function oversizedRawPost(origin) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`oversized request socket stayed open; response=${response}`));
    }, 3_000);
    socket.on("connect", () => {
      socket.write(
        `POST /api/claim HTTP/1.1\r\nHost: ${url.host}\r\nContent-Length: 1048576\r\nConnection: keep-alive\r\n\r\n`,
      );
      socket.write(Buffer.alloc(4_096, 0x61));
    });
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

describe("claim server privacy contract", () => {
  it("purges legacy indexes, rejects bodies, publishes only no/time, and enforces the hard count", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-test-"));
    const ledger = join(dir, "claims.jsonl");
    writeFileSync(ledger, `${JSON.stringify({ no: 1, index: "987654321", ts: 1_700_000_000_000, key: "legacy-secret", extra: "drop" })}\n`);
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    let logs = "";
    const child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        CLAIM_FILE: ledger,
        MAX_CLAIMS: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => { logs += chunk; });
    child.stderr.on("data", (chunk) => { logs += chunk; });

    try {
      await waitForServer(origin, child, () => logs);

      const rejected = await fetch(`${origin}/api/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: "123", poem: "must never arrive" }),
      });
      expect(rejected.status).toBe(400);

      const allocated = await fetch(`${origin}/api/claim`, { method: "POST" });
      expect(allocated.status).toBe(200);
      const claim = await allocated.json();
      expect(claim.no).toBe(2);
      expect(typeof claim.ts).toBe("number");
      expect(claim).not.toHaveProperty("index");

      const feed = await (await fetch(`${origin}/api/claim/feed`)).json();
      expect(feed.claims).toHaveLength(2);
      expect(feed.claims.every((row) => Object.keys(row).sort().join(",") === "no,ts")).toBe(true);

      const capped = await fetch(`${origin}/api/claim`, { method: "POST" });
      expect(capped.status).toBe(503);

      const rows = readFileSync(ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => !("index" in row) && !("poem" in row))).toBe(true);
      expect(rows[0]).toEqual({ no: 1, ts: 1_700_000_000_000 });
    } finally {
      child.kill();
      await new Promise((resolve) => {
        if (child.exitCode != null) return resolve();
        child.once("exit", resolve);
        setTimeout(resolve, 2000);
      });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("claim server 里程碑中奖密钥 (prize key)", () => {
  const PRIZE_RE = /^SY\d+-[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/;

  it("mints a well-formed key on a prize 编号, none on ordinary ones, and never leaks it to the feed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-prize-"));
    const ledger = join(dir, "claims.jsonl");
    const { child, origin } = await startServer(ledger, { PRIZE_NOS: "1,3" });
    try {
      const post = async () => (await fetch(`${origin}/api/claim`, { method: "POST" })).json();
      const c1 = await post(); // 里程碑
      const c2 = await post(); // ordinary
      const c3 = await post(); // 里程碑

      expect(c1.no).toBe(1);
      expect(c1.prizeKey).toMatch(/^SY1-/);
      expect(c1.prizeKey).toMatch(PRIZE_RE);

      expect(c2.no).toBe(2);
      expect(c2).not.toHaveProperty("prizeKey"); // non-milestone reply carries no key

      expect(c3.no).toBe(3);
      expect(c3.prizeKey).toMatch(/^SY3-/);
      expect(c3.prizeKey).toMatch(PRIZE_RE);

      // the PUBLIC feed carries ONLY {no, ts} — never a prize key on any row
      const feed = await (await fetch(`${origin}/api/claim/feed`)).json();
      expect(feed.claims).toHaveLength(3);
      expect(feed.claims.every((row) => Object.keys(row).sort().join(",") === "no,ts")).toBe(true);

      // on disk: prize rows carry {no, ts, key}; the ordinary row carries {no, ts} only
      const rows = readFileSync(ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(rows[0].key).toBe(c1.prizeKey);
      expect(rows[0].key).toMatch(PRIZE_RE);
      expect("key" in rows[1]).toBe(false);
      expect(rows[2].key).toBe(c3.prizeKey);
    } finally {
      await stopServer(child);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves a prize key through boot migration (strips index, keeps key) and never re-feeds it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-migrate-"));
    const ledger = join(dir, "claims.jsonl");
    const KEY = "SY1-QKC9T-E9BP3-7TCDP-7KNYC"; // a valid, server-shaped key
    writeFileSync(
      ledger,
      `${JSON.stringify({ no: 1, index: "987654321", ts: 1_700_000_000_000, key: KEY, extra: "drop" })}\n` +
        `${JSON.stringify({ no: 2, index: "111", ts: 1_700_000_000_001 })}\n`,
    );
    const { child, origin } = await startServer(ledger, { PRIZE_NOS: "1" });
    try {
      // disk after boot: legacy index/extra stripped, the prize key PRESERVED on its row
      const rows = readFileSync(ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ no: 1, ts: 1_700_000_000_000, key: KEY });
      expect(rows[1]).toEqual({ no: 2, ts: 1_700_000_000_001 });

      // the boot-recovered public feed never carries the preserved key
      const feed = await (await fetch(`${origin}/api/claim/feed`)).json();
      expect(feed.claims.every((row) => Object.keys(row).sort().join(",") === "no,ts")).toBe(true);
      expect(JSON.stringify(feed)).not.toContain(KEY);
    } finally {
      await stopServer(child);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("boot migration is idempotent — a 2nd boot rewrites nothing and keeps the prize key byte-for-byte", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-idempotent-"));
    const ledger = join(dir, "claims.jsonl");
    const KEY = "SY1-QKC9T-E9BP3-7TCDP-7KNYC"; // a valid, server-shaped key
    // A legacy row with a reversible `index` + a real prize key, plus an ordinary row. Boot 1 must migrate
    // (strip index, keep key); boot 2 sees an already-clean ledger and must NOT churn it.
    writeFileSync(
      ledger,
      `${JSON.stringify({ no: 1, index: "987654321", ts: 1_700_000_000_000, key: KEY, extra: "drop" })}\n` +
        `${JSON.stringify({ no: 2, index: "111", ts: 1_700_000_000_001 })}\n`,
    );

    // boot 1: privacy migration runs
    const s1 = await startServer(ledger, { PRIZE_NOS: "1" });
    await stopServer(s1.child);
    const afterBoot1 = readFileSync(ledger, "utf8");

    // boot 2: same ledger, now already-sanitized → must be a no-op on disk
    const s2 = await startServer(ledger, { PRIZE_NOS: "1" });
    await stopServer(s2.child);
    const afterBoot2 = readFileSync(ledger, "utf8");

    try {
      // The heart of the assertion: boot 2 changes NOT ONE BYTE (no re-churn, no dropped key, no re-order).
      expect(afterBoot2).toBe(afterBoot1);
      const rows = afterBoot2.trim().split("\n").map((line) => JSON.parse(line));
      expect(rows).toHaveLength(2);
      // the prize key survived BOTH boots intact; the legacy index/extra stayed stripped
      expect(rows[0]).toEqual({ no: 1, ts: 1_700_000_000_000, key: KEY });
      expect(rows[1]).toEqual({ no: 2, ts: 1_700_000_000_001 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves a torn prize-key tail, recovers its number, quarantines it, and removes orphan privacy tmp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-torn-"));
    const ledger = join(dir, "claims.jsonl");
    const key = "SY2-QKC9T-E9BP3-7TCDP-7KNYC";
    const torn = `{"no":2,"ts":1700000000000,"key":"${key}"`; // deliberately missing `}` + newline
    writeFileSync(ledger, `${JSON.stringify({ no: 1, ts: 1_699_999_999_999 })}\n${torn}`);
    const orphanTmp = `${ledger}.privacy-99999.tmp`;
    writeFileSync(orphanTmp, `full-ledger-copy-with-${key}`);

    const { child, origin } = await startServer(ledger, { PRIZE_NOS: "3" });
    try {
      expect(existsSync(orphanTmp)).toBe(false);
      const afterBoot = readFileSync(ledger, "utf8");
      expect(afterBoot).toContain(torn); // not one credential byte from the malformed source was discarded
      expect(readFileSync(`${ledger}.rejected`, "utf8")).toContain(key);

      const response = await fetch(`${origin}/api/claim`, { method: "POST" });
      expect(response.status).toBe(200);
      const allocated = await response.json();
      expect(allocated.no).toBe(3); // malformed no=2 still held the high-water mark
      expect(allocated.prizeKey).toMatch(/^SY3-/);
      expect(readFileSync(ledger, "utf8")).toContain(key);
    } finally {
      await stopServer(child);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("clamps ts=0 without destroying the numbered prize credential or rolling back the counter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-ts-zero-"));
    const ledger = join(dir, "claims.jsonl");
    const key = "SY5-QKC9T-E9BP3-7TCDP-7KNYC";
    writeFileSync(ledger, `${JSON.stringify({ no: 5, ts: 0, key, index: "legacy-coordinate" })}\n`);
    const { child, origin } = await startServer(ledger, { PRIZE_NOS: "6" });
    try {
      const migrated = JSON.parse(readFileSync(ledger, "utf8").trim());
      expect(migrated).toEqual({ no: 5, ts: 1, key });
      const allocated = await (await fetch(`${origin}/api/claim`, { method: "POST" })).json();
      expect(allocated.no).toBe(6);
      expect(allocated.prizeKey).toMatch(/^SY6-/);
    } finally {
      await stopServer(child);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns 413 and closes the socket immediately for an oversized streaming body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-oversize-"));
    const ledger = join(dir, "claims.jsonl");
    const { child, origin } = await startServer(ledger);
    try {
      const response = await oversizedRawPost(origin);
      expect(response).toContain(" 413 ");
      expect(existsSync(ledger)).toBe(false); // rejected stream never allocated or appended a claim
    } finally {
      await stopServer(child);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("bounds a hot IP bucket and changing User-Agent cannot bypass the process backstop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-rate-"));
    const ledger = join(dir, "claims.jsonl");
    const { child, origin } = await startServer(ledger, { CLAIM_RATE_CAP: "3", PRIZE_NOS: "" });
    try {
      for (let i = 0; i < 3; i++) {
        const response = await fetch(`${origin}/api/claim`, {
          method: "POST",
          headers: { "User-Agent": `rotating-${i}` },
        });
        expect(response.status).toBe(200);
      }
      for (let i = 0; i < 100; i++) {
        const response = await fetch(`${origin}/api/claim`, {
          method: "POST",
          headers: { "User-Agent": `still-rotating-${i}` },
        });
        expect(response.status).toBe(429);
      }
      const health = await fetch(`${origin}/api/claim/health`);
      expect(health.status).toBe(200); // the full bucket did not grow into an O(n²) event-loop stall
      expect(readFileSync(ledger, "utf8").trim().split("\n")).toHaveLength(3);
    } finally {
      await stopServer(child);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("allocates atomically under a concurrent burst — unique contiguous nos, exactly one key per 里程碑", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-claim-burst-"));
    const ledger = join(dir, "claims.jsonl");
    const N = 200;
    const PRIZES = [1, 100]; // both inside 1..N so the burst crosses them
    const { child, origin } = await startServer(ledger, {
      PRIZE_NOS: PRIZES.join(","),
      CLAIM_RATE_CAP: "500",
    });
    try {
      // Fire N bodyless POSTs at once under an explicitly raised test-only process cap. A correct allocate()
      // mutex must serialize all N; production nginx separately enforces the low per-real-IP limit.
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          fetch(`${origin}/api/claim`, { method: "POST", headers: { "User-Agent": `burst-ua-${i}` } }).then((r) => {
            expect(r.status).toBe(200);
            return r.json();
          }),
        ),
      );

      // Replies: N unique, contiguous 1..N nos — no dup, no skip, no gap.
      const replyNos = results.map((r) => r.no).sort((a, b) => a - b);
      expect(replyNos).toEqual(Array.from({ length: N }, (_, i) => i + 1));

      // On disk: the ledger is the source of truth. Same contiguous 1..N, one row each.
      const rows = readFileSync(ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(rows).toHaveLength(N);
      const diskNos = rows.map((r) => r.no).sort((a, b) => a - b);
      expect(diskNos).toEqual(Array.from({ length: N }, (_, i) => i + 1));

      // Each configured 里程碑 minted EXACTLY ONE key, correctly prefixed and well-formed; every non-prize
      // row carries no key at all. This is the mint-inside-the-mutex red-line, locked against regression.
      for (const prize of PRIZES) {
        const prizeRows = rows.filter((r) => r.no === prize);
        expect(prizeRows).toHaveLength(1);
        expect(prizeRows[0].key).toMatch(new RegExp(`^SY${prize}-`));
        expect(prizeRows[0].key).toMatch(PRIZE_RE);
      }
      const prizeSet = new Set(PRIZES);
      expect(rows.filter((r) => !prizeSet.has(r.no)).every((r) => !("key" in r))).toBe(true);

      // The public feed still leaks nothing beyond {no, ts}, even after a heavy burst.
      const feed = await (await fetch(`${origin}/api/claim/feed`, { headers: { "User-Agent": "burst-feed" } })).json();
      expect(feed.total).toBe(N);
      expect(feed.claims.every((row) => Object.keys(row).sort().join(",") === "no,ts")).toBe(true);
    } finally {
      await stopServer(child);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
