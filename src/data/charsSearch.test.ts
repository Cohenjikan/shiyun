import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { charsBucket, capCharRecords, filterCharSubstring, rarestCharIndex, shouldLatchCharsUnavailable } from "./charsSearch";

describe("all-position character search helpers", () => {
  it("uses the 4096-shard FNV bucket contract", () => {
    expect(charsBucket("青")).toMatch(/^[0-9a-f]{3}$/);
    expect(charsBucket("青")).toBe(charsBucket("青"));
  });
  it("ranks famous/quality scores first while limiting a prolific poet", () => {
    const rows = [
      { p: "lu", score: 1_000_000_100, id: "a" }, { p: "lu", score: 1_000_000_099, id: "b" },
      { p: "lu", score: 1_000_000_098, id: "c" }, { p: "other", score: 10, id: "d" },
    ];
    // picks a,b (lu capped at 2) + d, then interleaves: each poet's 1st line before anyone's 2nd
    expect(capCharRecords(rows, 3, 2).map((r) => r.id)).toEqual(["a", "d", "b"]);
  });
  it("interleaves poets so one prolific poet cannot fill the first page", () => {
    const rows = [
      ...[1, 2, 3, 4].map((n) => ({ p: "lu", score: 100, id: "lu" + n })),
      { p: "li", score: 90, id: "li1" }, { p: "li", score: 90, id: "li2" }, { p: "du", score: 80, id: "du1" },
    ];
    expect(capCharRecords(rows, 10, 3).map((r) => r.id)).toEqual(["lu1", "li1", "du1", "lu2", "li2", "lu3"]);
  });
  it("chooses the smaller source list and filters the continuous substring", () => {
    const a = [{ line: "青山云外" }, { line: "青云直上" }];
    const b = [{ line: "青云直上" }];
    expect(rarestCharIndex(["青", "云"], new Map([["青", a], ["云", b]]))).toBe(b);
    expect(filterCharSubstring(a, "青云")).toEqual([a[1]]);
  });
  it("only a real 404 should latch the optional index unavailable", () => {
    expect(shouldLatchCharsUnavailable(404)).toBe(true);
    expect(shouldLatchCharsUnavailable(503)).toBe(false);
    expect(shouldLatchCharsUnavailable(200)).toBe(false);
  });
});

describe("searchByChars optional-index fetch behavior", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("silently latches after a genuine 404, so later character lookups do not probe", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { searchByChars } = await import("./load");
    expect(await searchByChars("青")).toEqual([]);
    expect(await searchByChars("月")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not latch transient 5xx or network errors", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { searchByChars } = await import("./load");
    await searchByChars("青");
    await searchByChars("月");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the less populated list for a two-character substring", async () => {
    const { charsBucket } = await import("./charsSearch");
    const buckets = new Map<string, Record<string, unknown>>();
    buckets.set(charsBucket("青"), { 青: [["p", 0, "含云", "other", "青云直上"], ["p", 1, "青山", "other", "青山白云"]] });
    buckets.set(charsBucket("云"), { 云: [["p", 0, "含云", "other", "青云直上"]] });
    const fetchMock = vi.fn(async (input: unknown) => {
      const b = String(input).match(/\/chars\/([^/.]+)/)?.[1] || "";
      return { ok: true, status: 200, json: async () => buckets.get(b) || {} } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { searchByChars } = await import("./load");
    const hits = await searchByChars("青云");
    expect(hits.map((h) => h.matchedLine)).toEqual(["青云直上"]);
  });
});
