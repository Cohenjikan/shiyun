import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// ── canonical 别名层 (G2): searchPoetsSmart redirects a mergedInto hit → the canonical poet + a
// data-driven note ("「唐温如」即「唐珙」"), mirroring the POET_ALIASES mechanism but WITHOUT a hardcoded
// name table — the redirect is driven entirely by the PoetRow.mergedInto field build-data.mjs emits from
// corpus poets.jsonl. Poets are loaded via loadData() against a stubbed fetch (searchPoets reads the
// module-level _poets cache, so there's no lighter-weight injection point — matches load.test.ts's
// existing pattern for exercising searchPoems/searchByLine).
describe("searchPoetsSmart — canonical mergedInto redirect (data-driven, G2)", () => {
  const TANGWENRU = { id: "4a282690", name: "唐温如", dynasty: "tang", poemCount: 0, clusterSize: 0, mergedInto: "28a217e3" };
  const TANGGONG_MING = { id: "1c8a158b", name: "唐珙", dynasty: "ming", poemCount: 0, clusterSize: 0, mergedInto: "28a217e3" };
  const TANGGONG_YUAN = { id: "28a217e3", name: "唐珙", dynasty: "yuan", poemCount: 4, clusterSize: 4 };
  const LIBAI = { id: "libai0001", name: "李白", dynasty: "tang", poemCount: 1000, clusterSize: 30 };
  const POETS = [LIBAI, TANGGONG_YUAN, TANGWENRU, TANGGONG_MING];

  const okJson = (o: unknown) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  const notOk = (s: number) => ({ ok: false, status: s, json: async () => ({}), text: async () => "" });

  function install() {
    const charset = { chars: "唐温如珙李白", n: 6, hash: "deadbeef" };
    const manifest = { n: 6, poetCount: POETS.length, poemCount: 1004, buckets: [], lineBuckets: [], dynCounts: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/charset.json")) return okJson(charset);
        if (url.includes("/poets.index.json")) return okJson(POETS);
        if (url.includes("/manifest.json")) return okJson(manifest);
        if (url.includes("/lexicon.json")) return notOk(404);
        return okJson({});
      }),
    );
  }

  beforeEach(() => {
    vi.resetModules(); // fresh module → _poets/_byId reset per test
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("searching the ALIAS name (唐温如) redirects to the canonical row + a 「X」即「Y」 note", async () => {
    install();
    const { loadData } = await import("./load");
    const { searchPoetsSmart } = await import("./poetAliases");
    await loadData();

    const { results, note } = searchPoetsSmart("唐温如");
    expect(note).toBe("「唐温如」即「唐珙」");
    expect(results.some((p) => p.id === "28a217e3")).toBe(true); // 正身 present
    expect(results.some((p) => p.mergedInto)).toBe(false); // no dead 0-poem alias row leaks into results
  });

  it("searching the CANONICAL name (唐珙) surfaces it with no note, and drops the SAME-NAME alias row (唐珙|ming)", async () => {
    install();
    const { loadData } = await import("./load");
    const { searchPoetsSmart } = await import("./poetAliases");
    await loadData();

    const { results, note } = searchPoetsSmart("唐珙");
    expect(note).toBeNull();
    expect(results.map((p) => p.id)).toContain("28a217e3");
    expect(results.some((p) => p.mergedInto)).toBe(false); // 唐珙|ming (mergedInto, poemCount 0) filtered out
  });

  it("an unrelated query (李白) is unaffected — no alias machinery triggers", async () => {
    install();
    const { loadData } = await import("./load");
    const { searchPoetsSmart } = await import("./poetAliases");
    await loadData();

    const { results, note } = searchPoetsSmart("李白");
    expect(note).toBeNull();
    expect(results.map((p) => p.id)).toEqual(["libai0001"]);
  });

  it("a SAME-NAME merge surfaced via substring (珙) dynasty-suffixes the note — never 「唐珙」即「唐珙」", async () => {
    // querying 珙 has no exact-name row, so redirectMerged fires on the 唐珙|ming alias; both sides of the
    // note share the display name 唐珙 → disambiguated with DYNASTIES labels (ming→明, yuan→元), like the
    // PoetPanel 已并入 notice.
    install();
    const { loadData } = await import("./load");
    const { searchPoetsSmart } = await import("./poetAliases");
    await loadData();

    const { results, note } = searchPoetsSmart("珙");
    expect(note).toBe("「唐珙(明)」即「唐珙(元)」");
    expect(results.map((p) => p.id)).toContain("28a217e3"); // 正身 唐珙|yuan present
    expect(results.some((p) => p.mergedInto)).toBe(false);
  });
});
