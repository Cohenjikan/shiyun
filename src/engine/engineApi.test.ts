import { describe, it, expect, beforeAll } from "vitest";
import { setDataset } from "../data/provider";
import { makeFixtureLexicon } from "./lexicon.fixture";
import { textBabelIndex, anyTextIndex, pullByIndex, pulledFromIndex, inCharset, outOfCharset } from "./engineApi";

// The 探诗 (compose/reverse) UI calls these. Since 2026-06-09 the displayed 全集编号 is the UNIVERSAL
// anyRank over (chars + line-breaks): ONE globally-unique number per poem (a 五绝 and its 自由 twin share
// it), so 编号 ⇄ 诗 is a clean bijection with no per-form collision and no duplicate. Verify against a
// fixture dataset (120-char 字库 matching makeFixtureLexicon N=120).
const lex = makeFixtureLexicon(60, 60, 6); // N = 120
const charset = Array.from({ length: lex.N }, (_, i) => String.fromCodePoint(0x4e00 + i)); // 一, 丁, 丂 …
const lines5 = [
  charset.slice(0, 5).join(""), charset.slice(5, 10).join(""),
  charset.slice(10, 15).join(""), charset.slice(15, 20).join(""),
]; // a 五绝-shaped poem (4×5)
const lines7 = [
  charset.slice(0, 7).join(""), charset.slice(7, 14).join(""),
  charset.slice(14, 21).join(""), charset.slice(21, 28).join(""),
]; // a 七绝-shaped poem (4×7)

beforeAll(() => setDataset({ lexicon: lex, charset }));

describe("engineApi — universal 全集编号 (anyRank) ⇄ 反查", () => {
  it("a fixed-form poem's universal index reverses to the EXACT poem + infers its 诗体", () => {
    const r = anyTextIndex(lines5);
    expect(r).not.toBeNull();
    const back = pullByIndex("ziyou", r!.index);
    expect(back!.lines).toEqual(lines5);
    expect(back!.form).toBe("wujue"); // 4×5 → 五绝 inferred from the structure
  });

  it("the SAME number is the SAME poem regardless of the form argument (one global catalog)", () => {
    const idx = anyTextIndex(lines7)!.index;
    const a = pullByIndex("wujue", idx);
    const b = pullByIndex("qilu", idx);
    const c = pullByIndex("ziyou", idx);
    expect(a!.lines).toEqual(b!.lines);
    expect(a!.lines).toEqual(c!.lines);
    expect(a!.form).toBe("qijue"); // 4×7 → 七绝 inferred, whatever the arg
  });

  it("DEDUP: the same poem as a fixed form vs as 自由 yields the IDENTICAL index (no 一首诗两个编号)", () => {
    const asFixed = anyTextIndex(lines5)!.index; // 探诗 grid path
    const asFree = anyTextIndex([...lines5])!.index; // 自由 lines path
    expect(asFixed).toBe(asFree); // identical by construction (same chars+breaks → same anyRank)
    // and it is DISTINCT from the legacy per-form babelRank that used to cause the collision
    expect(asFixed).not.toBe(textBabelIndex("wujue", lines5.join(""))!.index);
  });

  it("pulledFromIndex (permalink/拾遗/定位虚空) infers the 诗体 too — a rebuilt fixed-form poem is NOT mislabeled 自由", () => {
    // Regression: describeAny used to hardcode form:"ziyou", so a 七绝/七律 reconstructed from its 全集编号
    // (permalink restore, 拾遗, 定位虚空) showed "自由" even though 探诗·凭编号 (pullByIndex) said 七绝 — the
    // SAME poem got two different 诗体 labels. pulledFromIndex must agree with pullByIndex.
    const idx = anyTextIndex(lines7)!.index; // 4×7
    expect(pulledFromIndex("ziyou", idx)!.form).toBe("qijue"); // inferred, matches pullByIndex
    expect(pulledFromIndex("ziyou", idx)!.form).toBe(pullByIndex("ziyou", idx)!.form);
    // a genuinely irregular poem still infers 自由
    const free = [charset.slice(0, 3).join(""), charset.slice(3, 9).join("")];
    expect(pulledFromIndex("ziyou", anyTextIndex(free)!.index)!.form).toBe("ziyou");
  });

  it("自由: anyTextIndex(lines) → pullByIndex reproduces the exact lines + line breaks", () => {
    const lines = [charset.slice(0, 3).join(""), charset.slice(3, 5).join(""), charset.slice(5, 10).join("")];
    const r = anyTextIndex(lines);
    expect(r!.chars).toBe(10);
    expect(r!.lines).toBe(3);
    expect(pullByIndex("ziyou", r!.index)!.lines).toEqual(lines);
  });

  it("textBabelIndex rejects wrong-length or out-of-字库 input (per-form rank stays well-defined)", () => {
    expect(textBabelIndex("wujue", charset.slice(0, 19).join(""))).toBeNull(); // 19 ≠ 20
    expect(textBabelIndex("wujue", charset.slice(0, 19).join("") + "Z")).toBeNull(); // Z dropped → 19
  });

  it("inCharset reflects the active 字库 (drives per-cell compose feedback)", () => {
    expect(inCharset(charset[0])).toBe(true);
    expect(inCharset(charset[lex.N - 1])).toBe(true);
    expect(inCharset("Z")).toBe(false);
    expect(inCharset("")).toBe(false);
  });

  it("outOfCharset lists unique 字库外的字 (drives the 自由填诗 hint), code-point + dedup + order", () => {
    expect(outOfCharset(charset[0] + charset[1])).toEqual([]); // all in 字库
    expect(outOfCharset("與")).toEqual(["與"]); // 繁体 (U+8207) — not in this Simplified fixture
    expect(outOfCharset(charset[0] + "與Z與")).toEqual(["與", "Z"]); // dedup + first-seen order, mixes Han + latin
    expect(outOfCharset("")).toEqual([]);
  });
});

// inferForm 两句连写识别: a poem typed/reconstructed with couplets merged into fewer, longer lines
// (2 lines of 10 = two 5-char lines glued pairwise; 4 lines of 14 = eight 7-char lines glued pairwise)
// should still infer its 诗体 label — display-only, does not touch anyRank/anyUnrank/lineBreakSyms.
describe("engineApi — inferForm 两句连写识别 (label-only)", () => {
  it("2×10 uniform → wujue (两句连写的五绝/五言, 4×5 merged pairwise)", () => {
    const lines = [charset.slice(0, 10).join(""), charset.slice(10, 20).join("")];
    expect(pullByIndex("ziyou", anyTextIndex(lines)!.index)!.form).toBe("wujue");
  });

  it("2×14 uniform → qijue (两句连写的七绝, 4×7 merged pairwise)", () => {
    const lines = [charset.slice(0, 14).join(""), charset.slice(14, 28).join("")];
    expect(pullByIndex("ziyou", anyTextIndex(lines)!.index)!.form).toBe("qijue");
  });

  it("4×10 uniform → wulu (两句连写的五律, 8×5 merged pairwise)", () => {
    const lines = [
      charset.slice(0, 10).join(""), charset.slice(10, 20).join(""),
      charset.slice(20, 30).join(""), charset.slice(30, 40).join(""),
    ];
    expect(pullByIndex("ziyou", anyTextIndex(lines)!.index)!.form).toBe("wulu");
  });

  it("4×14 uniform → qilu (两句连写的七律, 8×7 merged pairwise)", () => {
    const lines = [
      charset.slice(0, 14).join(""), charset.slice(14, 28).join(""),
      charset.slice(28, 42).join(""), charset.slice(42, 56).join(""),
    ];
    expect(pullByIndex("ziyou", anyTextIndex(lines)!.index)!.form).toBe("qilu");
  });

  it("3×14 uniform stays ziyou (line COUNT doesn't match any merged-couplet shape)", () => {
    const lines = [
      charset.slice(0, 14).join(""), charset.slice(14, 28).join(""), charset.slice(28, 42).join(""),
    ];
    expect(pullByIndex("ziyou", anyTextIndex(lines)!.index)!.form).toBe("ziyou");
  });

  it("4×13 uniform stays ziyou (line LENGTH doesn't match any merged-couplet shape)", () => {
    const lines = [
      charset.slice(0, 13).join(""), charset.slice(13, 26).join(""),
      charset.slice(26, 39).join(""), charset.slice(39, 52).join(""),
    ];
    expect(pullByIndex("ziyou", anyTextIndex(lines)!.index)!.form).toBe("ziyou");
  });

  it("2×20 uniform stays ziyou (length 20 matches no couplet-merge rule: not 10/14)", () => {
    const lines = [charset.slice(0, 20).join(""), charset.slice(20, 40).join("")];
    expect(pullByIndex("ziyou", anyTextIndex(lines)!.index)!.form).toBe("ziyou");
  });

  it("4×5 (already-split 五绝, unmerged) still infers wujue — pre-existing rule untouched", () => {
    expect(pullByIndex("ziyou", anyTextIndex(lines5)!.index)!.form).toBe("wujue");
  });
});
