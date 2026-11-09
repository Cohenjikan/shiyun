import { describe, expect, it } from "vitest";
import { WUDAI_CURATED, wudaiDisplay } from "./wudaiRules.mjs";

describe("wudaiDisplay (五代十国 display layer, UF-16)", () => {
  it("curated 南唐 poets get dd + state", () => {
    expect(wudaiDisplay("李煜", "tang", "唐")).toEqual({ dd: "wudai", ds: "南唐" });
    expect(wudaiDisplay("冯延巳", "tang", "唐")).toEqual({ dd: "wudai", ds: "南唐" });
  });
  it("curated poets with a disputed state get dd only", () => {
    expect(wudaiDisplay("花蕊夫人", "tang", "唐")).toEqual({ dd: "wudai" });
  });
  it("upstream 唐末宋初 label is data-driven 五代十国", () => {
    expect(wudaiDisplay("徐铉", "tang", "唐末宋初")).toEqual({ dd: "wudai" });
  });
  it("leaves plain 唐 poets and borderline late-Tang poets alone", () => {
    expect(wudaiDisplay("李白", "tang", "唐")).toBeNull();
    expect(wudaiDisplay("韦庄", "tang", "唐")).toBeNull();
    expect(wudaiDisplay("罗隐", "tang", "唐")).toBeNull();
  });
  it("never applies outside the tang bucket (namesakes in other dynasties)", () => {
    expect(wudaiDisplay("李中", "song", "宋")).toBeNull();
    expect(wudaiDisplay("李建勋", "ming", "明")).toBeNull();
    expect(wudaiDisplay("徐铉", "song", "唐末宋初")).toBeNull();
  });
  it("borderline names are not in the curated list", () => {
    for (const n of ["韦庄", "牛峤", "贯休", "齐己", "韩偓", "罗隐", "杜荀鹤", "杜光庭"]) expect(n in WUDAI_CURATED).toBe(false);
  });
});
