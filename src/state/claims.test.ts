import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addLocalClaim,
  setLocalClaimNo,
  setLocalClaimResult,
  isPrizeKey,
  listClaims,
  getClaim,
  dayBucket,
  isSameDay,
  mergeClaims,
  claimBadge,
  type Storageish,
  type FeedClaim,
  type MyClaim,
} from "./claims";

// The PURE parts of the 认领 client: the local store (add / dedupe / patch-number / cap / corrupt
// tolerance), the viewer-local day bucket (今日 vs 往日), and the feed↔local meteor-pool merge. A trivial
// in-memory stub stands in for localStorage so this runs in node. The bodyless POST privacy contract is
// covered below with a fetch stub so adding a request body or Content-Type becomes a gate failure.

function memStore(): Storageish & { _v: Map<string, string> } {
  const _v = new Map<string, string>();
  return {
    _v,
    getItem: (k) => (_v.has(k) ? _v.get(k)! : null),
    setItem: (k, v) => void _v.set(k, v),
    removeItem: (k) => void _v.delete(k),
  };
}

describe("claims — local store", () => {
  let s: ReturnType<typeof memStore>;
  beforeEach(() => {
    s = memStore();
  });

  it("starts empty", () => {
    expect(listClaims(s)).toEqual([]);
    expect(getClaim("1", s)).toBeUndefined();
  });

  it("addLocalClaim records a pending (no=null) claim, newest first", () => {
    addLocalClaim({ index: "10", ts: 100 }, s);
    addLocalClaim({ index: "20", ts: 200 }, s);
    const list = listClaims(s);
    expect(list.map((c) => c.index)).toEqual(["20", "10"]);
    expect(list[0]).toEqual({ index: "20", no: null, ts: 200 });
  });

  it("dedupes by index — a re-claim returns the existing record, no second entry/number", () => {
    addLocalClaim({ index: "10", no: 5, ts: 100 }, s);
    const again = addLocalClaim({ index: "10", ts: 999 }, s); // same poem again
    expect(again).toHaveLength(1);
    expect(again[0]).toEqual({ index: "10", no: 5, ts: 100 }); // unchanged (kept the number + original ts)
  });

  it("setLocalClaimNo patches the 认领编号 onto a pending claim", () => {
    addLocalClaim({ index: "10", ts: 100 }, s);
    setLocalClaimNo("10", 42, s);
    expect(getClaim("10", s)).toEqual({ index: "10", no: 42, ts: 100 });
  });

  it("setLocalClaimNo does not overwrite an existing number, and is a no-op for missing/invalid", () => {
    addLocalClaim({ index: "10", no: 7, ts: 100 }, s);
    setLocalClaimNo("10", 99, s); // already numbered → keep 7
    expect(getClaim("10", s)?.no).toBe(7);
    expect(setLocalClaimNo("nope", 1, s)).toHaveLength(1); // missing index → no throw, list intact
    setLocalClaimNo("10", -3, s); // invalid number → ignored
    expect(getClaim("10", s)?.no).toBe(7);
  });

  it("caps at 500, dropping the OLDEST", () => {
    for (let i = 0; i < 505; i++) addLocalClaim({ index: String(i), ts: i }, s);
    const list = listClaims(s);
    expect(list).toHaveLength(500);
    expect(list[0].index).toBe("504"); // newest at front
    expect(getClaim("4", s)).toBeUndefined(); // 0..4 dropped
    expect(getClaim("5", s)).toBeDefined();
  });

  it("ignores empty/whitespace index", () => {
    addLocalClaim({ index: "" }, s);
    addLocalClaim({ index: "   " }, s);
    expect(listClaims(s)).toEqual([]);
  });

  it("tolerates corrupt storage (non-JSON / non-array / garbage rows) → only valid survive", () => {
    s.setItem("shiyun_claims_v1", "{not json");
    expect(listClaims(s)).toEqual([]);
    s.setItem("shiyun_claims_v1", JSON.stringify({ index: "1" }));
    expect(listClaims(s)).toEqual([]);
    s.setItem(
      "shiyun_claims_v1",
      JSON.stringify([
        { index: "1", no: 3, ts: 10 }, // good
        { index: "2", no: null, ts: 20 }, // good (pending)
        { index: 5, no: 1, ts: 10 }, // bad index type
        { index: "3", no: -1, ts: 10 }, // bad no (≤0)
        { index: "4", no: 1, ts: "x" }, // bad ts
        null,
        "str",
      ]),
    );
    expect(listClaims(s).map((c) => c.index)).toEqual(["1", "2"]);
  });

  it("null store → all ops are safe no-ops", () => {
    expect(listClaims(null)).toEqual([]);
    expect(addLocalClaim({ index: "1" }, null)).toEqual([]);
    expect(setLocalClaimNo("1", 1, null)).toEqual([]);
    expect(setLocalClaimResult("1", 1, "SY1-QKC9T-E9BP3-7TCDP-7KNYC", null)).toEqual([]);
  });
});

describe("claims — 里程碑中奖密钥 (prize key)", () => {
  let s: ReturnType<typeof memStore>;
  const KEY = "SY1-QKC9T-E9BP3-7TCDP-7KNYC"; // a real-shaped key (server format, Crockford-ish)
  beforeEach(() => {
    s = memStore();
  });

  it("isPrizeKey accepts the server format and rejects everything else", () => {
    expect(isPrizeKey(KEY)).toBe(true);
    expect(isPrizeKey("SY100-ABCDE-FGHJK-MNPQR-STUVW")).toBe(true); // multi-digit no
    expect(isPrizeKey("SY1-QKC9T-E9BP3-7TCDP")).toBe(false); // only 3 groups
    expect(isPrizeKey("SY1-QKC9T-E9BP3-7TCDP-7KNYC-EXTRA")).toBe(false); // 5 groups
    expect(isPrizeKey("XY1-QKC9T-E9BP3-7TCDP-7KNYC")).toBe(false); // wrong prefix
    expect(isPrizeKey("SY-QKC9T-E9BP3-7TCDP-7KNYC")).toBe(false); // no number
    expect(isPrizeKey("SY1-qkc9t-e9bp3-7tcdp-7knyc")).toBe(false); // lowercase
    expect(isPrizeKey("SY1-QKC9-E9BP3-7TCDP-7KNYC")).toBe(false); // 4-char group
    expect(isPrizeKey(12345)).toBe(false);
    expect(isPrizeKey(null)).toBe(false);
    expect(isPrizeKey(undefined)).toBe(false);
  });

  it("setLocalClaimResult patches 编号 + a valid prize key onto a pending claim", () => {
    addLocalClaim({ index: "10", ts: 100 }, s);
    setLocalClaimResult("10", 1, KEY, s);
    expect(getClaim("10", s)).toEqual({ index: "10", no: 1, ts: 100, prizeKey: KEY });
  });

  it("setLocalClaimResult patches 编号 alone when there is no prize key (non-milestone)", () => {
    addLocalClaim({ index: "20", ts: 200 }, s);
    setLocalClaimResult("20", 7, undefined, s);
    const c = getClaim("20", s);
    expect(c).toEqual({ index: "20", no: 7, ts: 200 }); // no prizeKey property at all
    expect("prizeKey" in c!).toBe(false);
  });

  it("setLocalClaimResult drops a malformed key but still lands the 编号 (guard)", () => {
    addLocalClaim({ index: "30", ts: 300 }, s);
    setLocalClaimResult("30", 3, "not-a-key", s);
    expect(getClaim("30", s)).toEqual({ index: "30", no: 3, ts: 300 }); // number kept, junk key rejected
  });

  it("the prize key persists across reload (survives listClaims round-trip)", () => {
    addLocalClaim({ index: "40", ts: 400 }, s);
    setLocalClaimResult("40", 100, KEY, s);
    // simulate a fresh page load: a brand-new store view over the SAME backing map
    const reread: MyClaim[] = listClaims(s);
    expect(reread.find((c) => c.index === "40")?.prizeKey).toBe(KEY);
  });

  it("a claim with a non-string prizeKey in storage is rejected by the guard", () => {
    s.setItem(
      "shiyun_claims_v1",
      JSON.stringify([
        { index: "1", no: 1, ts: 10, prizeKey: KEY }, // good
        { index: "2", no: 2, ts: 20, prizeKey: 123 }, // bad prizeKey type → dropped
      ]),
    );
    expect(listClaims(s).map((c) => c.index)).toEqual(["1"]);
  });

  it("setLocalClaimNo (back-compat) never writes a prize key", () => {
    addLocalClaim({ index: "50", ts: 500 }, s);
    setLocalClaimNo("50", 5, s);
    const c = getClaim("50", s);
    expect(c).toEqual({ index: "50", no: 5, ts: 500 });
    expect("prizeKey" in c!).toBe(false);
  });

  it("a re-claim keeps the ORIGINAL prize key (dedupe by index, no second key)", () => {
    addLocalClaim({ index: "60", ts: 600 }, s);
    setLocalClaimResult("60", 1, KEY, s);
    addLocalClaim({ index: "60", ts: 999, prizeKey: "SY9-AAAAA-BBBBB-CCCCC-DDDDD" }, s); // re-claim
    expect(getClaim("60", s)).toEqual({ index: "60", no: 1, ts: 600, prizeKey: KEY }); // unchanged
  });
});

describe("claims — viewer-local day bucket (今日 / 往日)", () => {
  // UTC+8 (China): getTimezoneOffset() = -480. 2026-06-28 12:00 local.
  const TZ = -480;
  const noonLocal = Date.UTC(2026, 5, 28, 4, 0, 0); // 12:00 in UTC+8 == 04:00 UTC

  it("two times in the same local day share a bucket", () => {
    const morning = noonLocal - 3 * 3_600_000; // 09:00 local
    const evening = noonLocal + 9 * 3_600_000; // 21:00 local
    expect(isSameDay(morning, evening, TZ)).toBe(true);
    expect(dayBucket(morning, TZ)).toBe(dayBucket(evening, TZ));
  });

  it("just before vs just after local midnight are different days", () => {
    const beforeMidnight = Date.UTC(2026, 5, 28, 15, 59, 0); // 23:59 local (UTC+8)
    const afterMidnight = Date.UTC(2026, 5, 28, 16, 1, 0); // 00:01 next local day
    expect(isSameDay(beforeMidnight, afterMidnight, TZ)).toBe(false);
    expect(dayBucket(afterMidnight, TZ) - dayBucket(beforeMidnight, TZ)).toBe(1);
  });

  it("tz matters: the same instant can fall on different days for different viewers", () => {
    const instant = Date.UTC(2026, 5, 28, 17, 0, 0); // 17:00 UTC
    // UTC+8 → 01:00 the 29th; UTC-8 (PST, offset +480) → 09:00 the 28th
    expect(dayBucket(instant, -480)).not.toBe(dayBucket(instant, 480));
  });
});

describe("claims — mergeClaims (feed ∪ local pool)", () => {
  it("dedupes confirmed local claims by claim number and never needs a public poem index", () => {
    const feed: FeedClaim[] = [
      { no: 2, ts: 200 },
      { no: 1, ts: 100 },
    ];
    const mine: MyClaim[] = [
      { index: "A", no: 1, ts: 90 }, // local poem address joins its own public event only on this device
      { index: "C", no: null, ts: 300 }, // offline/pending: local-only drawing key
    ];
    const merged = mergeClaims(feed, mine);
    expect(merged.map((c) => c.key)).toEqual(["local:C", "claim:2", "local:A"]);
    expect(merged.find((c) => c.key === "local:A")).toEqual({ key: "local:A", no: 1, ts: 90 });
    expect(merged.find((c) => c.key === "local:C")).toEqual({ key: "local:C", no: null, ts: 300 });
  });

  it("empty inputs → empty pool", () => {
    expect(mergeClaims([], [])).toEqual([]);
  });
});

describe("claims — postClaim privacy contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("POSTs without body/Content-Type and parses a valid number + prize key", async () => {
    vi.stubEnv("VITE_CLAIM_ENDPOINT", "/api/claim");
    const prizeKey = "SY100-QKC9T-E9BP3-7TCDP-7KNYC";
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, no: 100, prizeKey }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);
    vi.resetModules();
    const { postClaim } = await import("./claims");

    await expect(postClaim()).resolves.toEqual({ no: 100, prizeKey });
    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/claim");
    expect(init.method).toBe("POST");
    expect(init).not.toHaveProperty("body");
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("never returns a prize key when the response number is invalid", async () => {
    vi.stubEnv("VITE_CLAIM_ENDPOINT", "/api/claim");
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, no: 0, prizeKey: "SY100-QKC9T-E9BP3-7TCDP-7KNYC" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);
    vi.resetModules();
    const { postClaim } = await import("./claims");

    await expect(postClaim()).resolves.toEqual({ no: null });
  });
});

describe("claims — claimBadge (milestones / early-adopter)", () => {
  it("#1 is the founder", () => {
    expect(claimBadge(1)).toEqual({ label: "诗云首位认领", tier: "founder" });
  });
  it("round milestones are 里程碑 (with grouped digits)", () => {
    expect(claimBadge(100)).toEqual({ label: "第 100 首 · 里程碑", tier: "milestone" });
    expect(claimBadge(1000)).toEqual({ label: "第 1,000 首 · 里程碑", tier: "milestone" });
    expect(claimBadge(10000)?.tier).toBe("milestone");
  });
  it("the first 100 (non-milestone) are early adopters", () => {
    expect(claimBadge(2)).toEqual({ label: "早期认领者", tier: "early" });
    expect(claimBadge(99)?.tier).toBe("early");
  });
  it("ordinary numbers earn no badge", () => {
    expect(claimBadge(101)).toBeNull();
    expect(claimBadge(2026)).toBeNull();
  });
  it("null / pending / invalid → no badge", () => {
    expect(claimBadge(null)).toBeNull();
    expect(claimBadge(undefined)).toBeNull();
    expect(claimBadge(0)).toBeNull();
    expect(claimBadge(-5)).toBeNull();
    expect(claimBadge(3.5)).toBeNull();
  });
});
