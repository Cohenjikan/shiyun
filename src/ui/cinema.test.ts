import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../state/store";
import { resolveCinemaPoem, type AnyIndexLike } from "./cinemaResolve";
import type { PoetRow } from "../data/load";
import type { PulledPoem } from "../engine/engineApi";

// 留影(cinema): the per-poem button in PoetPanel sets an EXPLICIT cinema target so you can frame ANY
// poem in the 目录 — not only the 搜的这首 focus poem. These cover the store seams (open / close-resets /
// poet-change-clears) and the pure resolution precedence that <Cinema/> uses.

const poet = (id: string): PoetRow => ({ id, name: `诗人${id}`, dynasty: "tang", poemCount: 3, clusterSize: 1 });
const voidPoem: PulledPoem = {
  form: "wujue",
  lines: ["床前明月光", "疑是地上霜"],
  babelIndex: "424242",
  babelDigits: 6,
  lushiIndex: null,
  valid: true,
  pos: [0, 0, 0],
};

describe("store — 留影 explicit cinema target", () => {
  beforeEach(() => {
    // reset the slices these tests touch (zustand is a module singleton)
    useStore.setState({ cinema: false, cinemaPoemIdx: null, selected: null, selectedPoet: null, poetPoems: null, poetFocus: null });
  });

  it("openCinemaFor sets cinema ON and records the poem index", () => {
    useStore.getState().openCinemaFor(2);
    expect(useStore.getState().cinema).toBe(true);
    expect(useStore.getState().cinemaPoemIdx).toBe(2);
  });

  it("openCinemaFor works for index 0 (falsy idx must still register)", () => {
    useStore.getState().openCinemaFor(0);
    expect(useStore.getState().cinema).toBe(true);
    expect(useStore.getState().cinemaPoemIdx).toBe(0);
  });

  it("closing cinema (toggleCinema off) resets the explicit target — no leak on reopen", () => {
    useStore.getState().openCinemaFor(5);
    useStore.getState().toggleCinema(); // OFF
    expect(useStore.getState().cinema).toBe(false);
    expect(useStore.getState().cinemaPoemIdx).toBeNull();
  });

  it("toggleCinema ON (panel button) does NOT invent a target — stays null", () => {
    useStore.getState().toggleCinema(); // OFF→ON
    expect(useStore.getState().cinema).toBe(true);
    expect(useStore.getState().cinemaPoemIdx).toBeNull();
  });

  it("changing the selected poet clears a stale explicit target", () => {
    useStore.getState().openCinemaFor(4);
    useStore.getState().selectPoet(poet("b"));
    expect(useStore.getState().cinemaPoemIdx).toBeNull();
  });

  it("a void pull (selectPoem) clears a stale explicit target", () => {
    useStore.getState().openCinemaFor(4);
    useStore.getState().selectPoem(voidPoem);
    expect(useStore.getState().cinemaPoemIdx).toBeNull();
  });

  it("clearPoet clears the explicit target", () => {
    useStore.getState().openCinemaFor(1);
    useStore.getState().clearPoet();
    expect(useStore.getState().cinemaPoemIdx).toBeNull();
  });

  it("selected (void) and selectedPoet are mutually exclusive in the store", () => {
    useStore.getState().selectPoet(poet("a"));
    expect(useStore.getState().selected).toBeNull();
    useStore.getState().selectPoem(voidPoem);
    expect(useStore.getState().selectedPoet).toBeNull();
  });
});

describe("resolveCinemaPoem — precedence", () => {
  const indexer = (lines: string[]): AnyIndexLike | null =>
    lines.length ? { index: `idx-${lines.join("|")}`, digits: 7 } : null;
  const poems = [
    { t: "题一", p: ["aaa", "bbb"] },
    { t: "", p: ["ccc"] }, // 无题
    { t: "题三", p: ["ddd"] },
  ];
  const p = { name: "李白" };

  it("explicit cinemaPoemIdx wins, using the poem at that ORIGINAL index", () => {
    const r = resolveCinemaPoem({ selected: null, poet: p, poems, focus: { poemIdx: 0 }, cinemaPoemIdx: 2, indexer });
    expect(r?.lines).toEqual(["ddd"]);
    expect(r?.attribution).toBe("李白《题三》");
    expect(r?.index).toBe("idx-ddd");
    expect(r?.digits).toBe(7);
  });

  it("explicit target SHADOWS a void selected (deliberate choice beats a lingering pull)", () => {
    const r = resolveCinemaPoem({ selected: voidPoem, poet: p, poems, focus: null, cinemaPoemIdx: 1, indexer });
    expect(r?.attribution).toBe("李白《无题》"); // empty title → 无题
    expect(r?.lines).toEqual(["ccc"]);
  });

  it("falls back to the void pull when no explicit target and no poet poems", () => {
    const r = resolveCinemaPoem({ selected: voidPoem, poet: null, poems: null, focus: null, cinemaPoemIdx: null, indexer });
    expect(r?.attribution).toBe("诗云 · 从虚空里捞起");
    expect(r?.index).toBe(voidPoem.babelIndex);
  });

  it("falls back to the 搜的这首 focus poem when no explicit target and no void pull", () => {
    const r = resolveCinemaPoem({ selected: null, poet: p, poems, focus: { poemIdx: 0 }, cinemaPoemIdx: null, indexer });
    expect(r?.attribution).toBe("李白《题一》");
    expect(r?.lines).toEqual(["aaa", "bbb"]);
  });

  it("out-of-range explicit idx does NOT crash — falls through to the next branch", () => {
    const r = resolveCinemaPoem({ selected: voidPoem, poet: p, poems, focus: null, cinemaPoemIdx: 99, indexer });
    expect(r?.attribution).toBe("诗云 · 从虚空里捞起"); // fell through to the void pull
  });

  it("returns null when nothing is resolvable (no explicit/void/focus)", () => {
    expect(resolveCinemaPoem({ selected: null, poet: p, poems, focus: null, cinemaPoemIdx: null, indexer })).toBeNull();
  });

  it("index is null (glyph outside 字库) → card still resolves, just without an 编号", () => {
    const nullIndexer = () => null;
    const r = resolveCinemaPoem({ selected: null, poet: p, poems, focus: null, cinemaPoemIdx: 0, indexer: nullIndexer });
    expect(r?.index).toBeNull();
    expect(r?.digits).toBe(0);
    expect(r?.lines).toEqual(["aaa", "bbb"]);
  });
});
