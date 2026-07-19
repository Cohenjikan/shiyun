import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Send a RAW HTTP/1.1 request over a socket — fetch() refuses to transmit a malformed Host header,
// so the Host-DoS path can only be exercised at the byte level. Returns the first status line.
function rawRequest(port, hostHeader) {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1", () => {
      sock.write(`GET /?a=82a5851c HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
    });
    let buf = "";
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error("raw request timeout")); });
    sock.on("data", (d) => { buf += d; });
    sock.on("end", () => resolve(buf.split("\r\n")[0] || ""));
    sock.on("error", reject);
  });
}
import {
  injectOg,
  applyCard,
  setMetaContent,
  escapeHtml,
  poetCard,
  poemCard,
  buildPoetMap,
  DYNASTY_LABELS,
  MAX_POEM_DIGITS,
} from "./og-inject.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "feedback-server.mjs");

// A minimal index.html with the SAME meta tags the real build ships (index.html). Both attribute
// orders + a hostile-looking default content so we can prove the regex is anchored, not greedy.
const HTML = `<!doctype html><html><head>
<meta property="og:type" content="website" />
<meta property="og:title" content="诗云 · Poetry Cloud — 一切可能的诗" />
<meta property="og:description" content="generic desc" />
<meta property="og:url" content="https://shiyun.example.com/" />
<meta property="og:image" content="/og.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="诗云 · Poetry Cloud — 一切可能的诗" />
<meta name="twitter:description" content="generic twitter desc" />
<meta name="twitter:image" content="/og.jpg" />
</head><body></body></html>`;

const POETS = buildPoetMap([
  { id: "82a5851c", name: "李白", dynasty: "tang", poemCount: 1107, clusterSize: 48.58 },
  { id: "1ca4256c", name: "陆游", dynasty: "song", poemCount: 10565, clusterSize: 60 },
  // hostile fixture: a name with HTML metacharacters must be escaped, never break out of the attr.
  { id: "dead00ff", name: `<script>&"'`, dynasty: "tang", poemCount: 3, clusterSize: 1 },
]);

describe("og-inject — escapeHtml", () => {
  it("escapes the five attribute-breaking chars", () => {
    expect(escapeHtml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
  });
});

describe("og-inject — setMetaContent (anchored, idempotent, order-independent)", () => {
  it("replaces only the targeted tag's content, both attribute orders", () => {
    const a = setMetaContent(HTML, "property", "og:title", "NEW");
    expect(a).toContain('<meta property="og:title" content="NEW" />');
    // og:image (different tag) and twitter:title (different attr name) both untouched
    expect(a).toContain('<meta property="og:image" content="/og.jpg" />');
    expect(a).toContain('<meta name="twitter:title" content="诗云 · Poetry Cloud — 一切可能的诗" />');
    // exactly ONE replacement — the original og:title value is gone, others remain
    expect(a.match(/content="诗云 · Poetry Cloud — 一切可能的诗"/g)?.length).toBe(1);
  });

  it("handles content-before-identifier attribute order", () => {
    const reordered = `<meta content="OLD" property="og:title" />`;
    expect(setMetaContent(reordered, "property", "og:title", "NEW")).toBe(
      `<meta content="NEW" property="og:title" />`,
    );
  });

  it("is a no-op when the tag is absent (idempotent / order-independent)", () => {
    expect(setMetaContent(HTML, "property", "og:nonexistent", "X")).toBe(HTML);
  });

  it("re-applying yields the same result (no double-injection / drift)", () => {
    const once = setMetaContent(HTML, "property", "og:title", "NEW");
    expect(setMetaContent(once, "property", "og:title", "NEW")).toBe(once);
  });
});

describe("og-inject — injectOg ?a= (poet hit)", () => {
  it("a real poet swaps og/twitter title + description (李白)", () => {
    const { html, hit } = injectOg(HTML, { a: "82a5851c" }, POETS, "https://h/?a=82a5851c");
    expect(hit).toBe("poet");
    expect(html).toContain('<meta property="og:title" content="李白 — 诗云 · Poetry Cloud" />');
    expect(html).toContain('<meta property="og:description" content="唐 · 1107 首 · 在三维诗云星图中漫游他的星团" />');
    expect(html).toContain('<meta name="twitter:title" content="李白 — 诗云 · Poetry Cloud" />');
    expect(html).toContain('<meta name="twitter:description" content="唐 · 1107 首 · 在三维诗云星图中漫游他的星团" />');
    expect(html).toContain('<meta property="og:url" content="https://h/?a=82a5851c" />');
    // og:image stays as built — never touched
    expect(html).toContain('<meta property="og:image" content="/og.jpg" />');
  });

  it("unknown id → UNCHANGED html, hit null (the generic card)", () => {
    const r = injectOg(HTML, { a: "ffffffff" }, POETS, "u");
    expect(r.hit).toBeNull();
    expect(r.html).toBe(HTML);
  });

  it("malformed id (non-hex / too long) → UNCHANGED, never echoed", () => {
    expect(injectOg(HTML, { a: "<script>" }, POETS, "u").html).toBe(HTML);
    expect(injectOg(HTML, { a: "x".repeat(200) }, POETS, "u").html).toBe(HTML);
    // the raw hostile string must NOT appear anywhere
    expect(injectOg(HTML, { a: "<script>" }, POETS, "u").html).not.toContain("<script>");
  });

  it("HOSTILE poet NAME is HTML-escaped (no attribute breakout)", () => {
    const { html, hit } = injectOg(HTML, { a: "dead00ff" }, POETS, "u");
    expect(hit).toBe("poet");
    expect(html).toContain("&lt;script&gt;&amp;&quot;&#39; — 诗云");
    // the raw, unescaped sequence never appears in a title
    expect(html).not.toContain(`content="<script>`);
  });
});

describe("og-inject — injectOg ?p= (generic poem card, digits/cap validation)", () => {
  it("valid digits → generic card quoting the truncated 编号", () => {
    const { html, hit } = injectOg(HTML, { p: "123456789012345" }, POETS, "https://h/?p=123456789012345");
    expect(hit).toBe("poem");
    expect(html).toContain('<meta property="og:title" content="诗云 · 一首可能的诗" />');
    expect(html).toContain("编号 123456789012…共 15 位");
  });

  it("short 编号 has no overflow suffix", () => {
    const { html } = injectOg(HTML, { p: "42" }, POETS, "u");
    expect(html).toContain("编号 42 ·");
    expect(html).not.toContain("共");
  });

  it("non-digit p → UNCHANGED (no echo)", () => {
    expect(injectOg(HTML, { p: "12a" }, POETS, "u").html).toBe(HTML);
    expect(injectOg(HTML, { p: "<x>" }, POETS, "u").html).toBe(HTML);
  });

  it("oversized p (> cap) → UNCHANGED (length-limited before any work)", () => {
    const huge = "9".repeat(MAX_POEM_DIGITS + 1);
    expect(injectOg(HTML, { p: huge }, POETS, "u").html).toBe(HTML);
    // exactly at the cap is accepted
    const atCap = "9".repeat(MAX_POEM_DIGITS);
    expect(injectOg(HTML, { p: atCap }, POETS, "u").hit).toBe("poem");
  });

  it("empty p → UNCHANGED", () => {
    expect(injectOg(HTML, { p: "" }, POETS, "u").html).toBe(HTML);
  });
});

describe("og-inject — no target → passthrough", () => {
  it("neither a nor p → unchanged, hit null", () => {
    const r = injectOg(HTML, {}, POETS, "u");
    expect(r.html).toBe(HTML);
    expect(r.hit).toBeNull();
  });
});

describe("og-inject — DYNASTY_LABELS mirrors the dynasties.ts taxonomy", () => {
  it("covers the canonical keys used in poetCard", () => {
    expect(DYNASTY_LABELS.tang).toBe("唐");
    expect(DYNASTY_LABELS.song).toBe("宋");
    expect(DYNASTY_LABELS.dangdai).toBe("当代");
  });
  it("poetCard shows the raw dynasty for an unmapped key, then 历代 when blank", () => {
    // the index only ever carries canonical keys, but be informative if one slips through
    expect(poetCard({ name: "佚名", dynasty: "zzz", poemCount: 0 }).description).toContain("zzz ·");
    expect(poetCard({ name: "佚名", dynasty: "", poemCount: 0 }).description).toContain("历代 ·");
  });
});

// ── ONE spawn-based smoke: real server, random port, tmp SITE_ROOT — end-to-end 200 + injected
//    title; Host-DoS still 400; /api/feedback POST still works. Marked serial so it never races
//    another spawn test on Windows. The pure tests above are the real gate; this proves the wiring. ──
describe.sequential("og-inject — spawn smoke (real feedback-server.mjs with SITE_ROOT)", () => {
  it("serves an injected card on GET /?a=, rejects Host-DoS, and still accepts a feedback POST", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shiyun-og-"));
    const dataDir = join(dir, "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dir, "index.html"), HTML);
    writeFileSync(
      join(dataDir, "poets.index.json"),
      JSON.stringify([{ id: "82a5851c", name: "李白", dynasty: "tang", poemCount: 1107, clusterSize: 48.58 }]),
    );
    const feedbackFile = join(dir, "feedback.jsonl");
    const port = 19000 + Math.floor(Math.random() * 40000);

    const child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        SITE_ROOT: dir,
        FEEDBACK_FILE: feedbackFile,
        FEEDBACK_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      // wait for the listen line on stdout
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("server did not start in time")), 8000);
        child.stdout.on("data", (b) => {
          if (String(b).includes("feedback collector on")) {
            clearTimeout(t);
            resolve(undefined);
          }
        });
        child.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
      });

      const base = `http://127.0.0.1:${port}`;

      // 1) injected poet card
      const og = await fetch(`${base}/?a=82a5851c`);
      expect(og.status).toBe(200);
      expect(og.headers.get("content-type")).toContain("text/html");
      expect(og.headers.get("cache-control")).toContain("max-age=3600");
      const body = await og.text();
      expect(body).toContain('<meta property="og:title" content="李白 — 诗云 · Poetry Cloud" />');

      // Reversible poem coordinates are hash-only; this server refuses the old query-card route.
      const privatePoem = await fetch(`${base}/?p=12345`);
      expect(privatePoem.status).toBe(404);

      // 2) Host-DoS: a malformed Host header (`a b`) makes new URL throw; the inner try must turn
      //    that into 400, NOT an unhandled rejection that kills the process. Raw socket — fetch won't
      //    send an invalid Host. The subsequent POST proves the process survived.
      const statusLine = await rawRequest(port, "a b");
      expect(statusLine).toContain("400");

      // 3) /api/feedback POST still byte-compatible (server survived the DoS attempt)
      const post = await fetch(`${base}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "smoke" }),
      });
      expect(post.status).toBe(200);
      expect(await post.json()).toEqual({ ok: true });
      const stored = JSON.parse(readFileSync(feedbackFile, "utf8").trim());
      expect(Object.keys(stored).sort()).toEqual(["message", "receivedAt"]);
      expect(stored.message).toBe("smoke");

      // 4) health endpoint unchanged
      const health = await fetch(`${base}/api/feedback/health`);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
