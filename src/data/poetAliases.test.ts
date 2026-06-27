import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POET_ALIASES, NOT_POETS } from "./poetAliases";

// Every alias TARGET must be a real poet row in the shipped index — a dead target silently turns
// the alias into a miss (the original 陶渊明 bug: GIFT_ALIAS pointed at 「陶渊明」 while the corpus
// canonical row is 「陶潜」). poets.index.json is git-tracked, so this runs on any fresh checkout.
const INDEX = fileURLToPath(new URL("../../public/data/poets.index.json", import.meta.url));

describe("POET_ALIASES integrity (vs shipped poets.index.json)", () => {
  const names = new Set(
    (JSON.parse(readFileSync(INDEX, "utf8")) as { name: string }[]).map((p) => p.name),
  );

  it("every alias target exists as a canonical poet row", () => {
    const dead = [...new Set(Object.values(POET_ALIASES))].filter((t) => !names.has(t));
    expect(dead).toEqual([]);
  });

  it("no alias key shadows a REAL poet row (the alias would hide their own star)", () => {
    const shadowing = Object.keys(POET_ALIASES).filter((k) => names.has(k));
    expect(shadowing).toEqual([]);
  });

  it("陶渊明 resolves to 陶潜 (the bug this layer exists for)", () => {
    expect(POET_ALIASES["陶渊明"]).toBe("陶潜");
    expect(names.has("陶潜")).toBe(true);
  });

  it("帝王别名解析到本名 (乾隆→弘历 等)", () => {
    expect(POET_ALIASES["乾隆"]).toBe("弘历");
    expect(POET_ALIASES["隋炀帝"]).toBe("杨广");
    expect(POET_ALIASES["宋徽宗"]).toBe("赵佶");
  });

  it("讹名/常用名解析到库内本名 (王禹偁→王禹称, 蔡文姬→蔡琰)", () => {
    expect(POET_ALIASES["王禹偁"]).toBe("王禹称");
    expect(POET_ALIASES["蔡文姬"]).toBe("蔡琰");
    expect(names.has("王禹称")).toBe(true);
    expect(names.has("蔡琰")).toBe(true);
  });

  it("NOT_POETS entries are genuinely absent from the corpus", () => {
    const present = Object.keys(NOT_POETS).filter((k) => names.has(k));
    expect(present).toEqual([]);
  });
});
