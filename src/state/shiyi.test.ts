import { describe, it, expect, beforeEach } from "vitest";
import { addShiyi, removeShiyi, listShiyi, hasShiyi, makePreview, type Storageish } from "./shiyi";

// 拾遗 is a PURE store keyed by the universal 全集编号. These cover the contract the UI leans on:
// newest-first ordering, dedupe-by-index (re-add refreshes + bumps to front), the 200-cap dropping the
// OLDEST, remove, and tolerance of corrupt / non-JSON / wrong-shape localStorage (a hand-edit must never
// crash the panel). A trivial in-memory stub stands in for localStorage so this runs in node.

function memStore(): Storageish & { _v: Map<string, string> } {
  const _v = new Map<string, string>();
  return {
    _v,
    getItem: (k) => (_v.has(k) ? _v.get(k)! : null),
    setItem: (k, v) => void _v.set(k, v),
    removeItem: (k) => void _v.delete(k),
  };
}

describe("shiyi — pure keepsake store", () => {
  let s: ReturnType<typeof memStore>;
  beforeEach(() => {
    s = memStore();
  });

  it("starts empty", () => {
    expect(listShiyi(s)).toEqual([]);
    expect(hasShiyi("123", s)).toBe(false);
  });

  it("add then list returns the entry; has() is true", () => {
    addShiyi({ index: "42", preview: "床前明月光", ts: 1000 }, s);
    const list = listShiyi(s);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ index: "42", ts: 1000, preview: "床前明月光" });
    expect(hasShiyi("42", s)).toBe(true);
  });

  it("newest first: a later add is at the front", () => {
    addShiyi({ index: "1", preview: "一", ts: 10 }, s);
    addShiyi({ index: "2", preview: "二", ts: 20 }, s);
    addShiyi({ index: "3", preview: "三", ts: 30 }, s);
    expect(listShiyi(s).map((e) => e.index)).toEqual(["3", "2", "1"]);
  });

  it("dedupe by index: re-adding moves it to the front and refreshes ts + preview", () => {
    addShiyi({ index: "1", preview: "旧", ts: 10 }, s);
    addShiyi({ index: "2", preview: "二", ts: 20 }, s);
    addShiyi({ index: "1", preview: "新", ts: 99 }, s); // same index again
    const list = listShiyi(s);
    expect(list).toHaveLength(2); // not 3 — deduped
    expect(list[0]).toEqual({ index: "1", ts: 99, preview: "新" }); // bumped to front, refreshed
    expect(list[1].index).toBe("2");
  });

  it("caps at 200, dropping the OLDEST", () => {
    for (let i = 0; i < 205; i++) addShiyi({ index: String(i), preview: "p", ts: i }, s);
    const list = listShiyi(s);
    expect(list).toHaveLength(200);
    expect(list[0].index).toBe("204"); // newest kept at front
    expect(list[list.length - 1].index).toBe("5"); // 0..4 (the 5 oldest) dropped
    expect(hasShiyi("4", s)).toBe(false);
    expect(hasShiyi("5", s)).toBe(true);
  });

  it("remove drops by index, leaves the rest in order", () => {
    addShiyi({ index: "1", preview: "一", ts: 10 }, s);
    addShiyi({ index: "2", preview: "二", ts: 20 }, s);
    addShiyi({ index: "3", preview: "三", ts: 30 }, s);
    removeShiyi("2", s);
    expect(listShiyi(s).map((e) => e.index)).toEqual(["3", "1"]);
    expect(hasShiyi("2", s)).toBe(false);
  });

  it("remove of a missing index is a no-op", () => {
    addShiyi({ index: "1", preview: "一", ts: 10 }, s);
    removeShiyi("nope", s);
    expect(listShiyi(s)).toHaveLength(1);
  });

  it("empty / whitespace index is ignored (no phantom entry)", () => {
    addShiyi({ index: "", preview: "x" }, s);
    addShiyi({ index: "   ", preview: "x" }, s);
    expect(listShiyi(s)).toEqual([]);
  });

  it("preview is clamped to 14 汉字 on the way in", () => {
    const long = "一二三四五六七八九十壹贰叁肆伍陆"; // 16 chars
    addShiyi({ index: "1", preview: long }, s);
    expect(listShiyi(s)[0].preview).toBe("一二三四五六七八九十壹贰叁肆"); // 14
  });

  it("makePreview trims and clamps; tolerates null/undefined", () => {
    expect(makePreview("  hi  ")).toBe("hi");
    expect(makePreview(null)).toBe("");
    expect(makePreview(undefined)).toBe("");
    expect(makePreview("一二三四五六七八九十一二三四五")).toHaveLength(14);
  });

  // ── corrupt / hostile storage tolerance ──
  it("non-JSON raw value → list is empty, never throws", () => {
    s.setItem("shiyun_shiyi_v1", "{not json");
    expect(listShiyi(s)).toEqual([]);
    expect(hasShiyi("1", s)).toBe(false);
  });

  it("JSON that isn't an array → empty", () => {
    s.setItem("shiyun_shiyi_v1", JSON.stringify({ index: "1" }));
    expect(listShiyi(s)).toEqual([]);
  });

  it("array with garbage rows → only well-formed entries survive", () => {
    s.setItem(
      "shiyun_shiyi_v1",
      JSON.stringify([
        { index: "1", ts: 10, preview: "ok" }, // good
        { index: 5, ts: 10, preview: "bad index type" }, // bad
        { ts: 10, preview: "no index" }, // bad
        { index: "2", ts: "NaN", preview: "bad ts" }, // bad
        null, // bad
        "string", // bad
        { index: "3", ts: 30, preview: "" }, // good (empty preview allowed)
      ]),
    );
    expect(listShiyi(s).map((e) => e.index)).toEqual(["1", "3"]);
  });

  it("adding onto a corrupt store recovers gracefully (corrupt rows dropped, new one kept)", () => {
    s.setItem("shiyun_shiyi_v1", "garbage");
    addShiyi({ index: "1", preview: "新生", ts: 1 }, s);
    expect(listShiyi(s)).toEqual([{ index: "1", ts: 1, preview: "新生" }]);
  });

  it("null store (no localStorage) → all ops are safe no-ops", () => {
    expect(listShiyi(null)).toEqual([]);
    expect(hasShiyi("1", null)).toBe(false);
    expect(addShiyi({ index: "1", preview: "x" }, null)).toEqual([]);
    expect(removeShiyi("1", null)).toEqual([]);
  });
});
