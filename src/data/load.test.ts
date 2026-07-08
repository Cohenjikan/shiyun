import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lineSkeletons, resolveCanonicalPoet, poetAliasRedirectNote, aliasNoticeNames, type PoetRow } from "./load";

// ── 方案 A:下载进度反馈(流式读取 Response body,按 Content-Length 报告 received/total)──────────────
// 大诗人切片可达 2.6MB(陆游),poems/ 不压缩、首访回源,等待时长。readWithProgress 边收边回调进度,
// 让加载动画显示百分比;并在【收齐全部字节后再一次性 decode】,从而跨 chunk 的多字节 UTF-8 不会被截断。
describe("readWithProgress — 流式读取 + 下载进度 (方案 A)", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const concatU8 = (parts: Uint8Array[]) => {
    const n = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  function streamRes(parts: Uint8Array[], contentLength?: number) {
    let i = 0;
    return {
      headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? (contentLength != null ? String(contentLength) : null) : null) },
      body: { getReader: () => ({ read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true, value: undefined }) }) },
      text: async () => new TextDecoder().decode(concatU8(parts)),
    } as unknown as Response;
  }

  it("拼回完整文本(跨 chunk 的多字节 UTF-8 正确),并按累计字节回调进度", async () => {
    const { readWithProgress } = await import("./load");
    const full = enc('[{"t":"静夜思","f":"wujue","p":["床前明月光"]}]');
    // 在第 8 字节切开 —— 正好落在「静」(E9 9D 99)中间,确保有多字节字符跨 chunk 边界。
    const parts = [full.slice(0, 8), full.slice(8, 20), full.slice(20)];
    const ticks: Array<[number, number]> = [];
    const txt = await readWithProgress(streamRes(parts, full.length), (r, t) => ticks.push([r, t]));
    expect(JSON.parse(txt)[0].t).toBe("静夜思"); // 完整 decode,未因 chunk 边界损坏多字节字
    expect(ticks.map((x) => x[0])).toEqual([8, 20, full.length]); // 累计 received 单调递增到 total
    expect(ticks.every((x) => x[1] === full.length)).toBe(true); // total 恒为 Content-Length
  });

  it("body 不是可读流时回退到 res.text()(老运行时 / 测试桩,不报错)", async () => {
    const { readWithProgress } = await import("./load");
    const res = { headers: { get: () => "12" }, text: async () => "fallback-text" } as unknown as Response;
    expect(await readWithProgress(res)).toBe("fallback-text");
  });
});

// ── loadPoetPoems 走 Range 206 时改为流式读取并上报进度;返回的 poems 与原来逐字节一致 ───────────────
describe("loadPoetPoems — Range 206 流式 + 进度 (方案 A)", () => {
  const POET = "ab12cd34ef56"; // bucket = id.slice(0,2) = "ab"
  const SLICE = '[{"t":"测试诗","f":"wujue","p":["床前明月光","疑是地上霜"]}]';
  const enc = (s: string) => new TextEncoder().encode(s);
  const okJson = (o: unknown) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) }) as unknown as Response;
  const notOk = (s: number) => ({ ok: false, status: s, json: async () => ({}), text: async () => "" }) as unknown as Response;

  function install() {
    const charset = { chars: "床前明月光疑是地上霜测试诗", n: 13, hash: "x" };
    const poets = [{ id: POET, name: "测试", dynasty: "tang", poemCount: 1, clusterSize: 1 }];
    const manifest = { n: 13, poetCount: 1, poemCount: 1, buckets: [], lineBuckets: [], dynCounts: {}, poemSidecar: true };
    const bytes = enc(SLICE);
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/charset.json")) return okJson(charset);
      if (url.includes("/poets.index.json")) return okJson(poets);
      if (url.includes("/manifest.json")) return okJson(manifest);
      if (url.includes("/lexicon.json")) return notOk(404);
      if (url.includes("/poems/ab.idx.json")) return okJson({ [POET]: [0, bytes.length] });
      if (url.includes("/poems/ab.json")) {
        let i = 0;
        const parts = [bytes.slice(0, 10), bytes.slice(10)];
        return {
          ok: true, status: 206,
          headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? String(bytes.length) : null) },
          body: { getReader: () => ({ read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true, value: undefined }) }) },
          text: async () => SLICE,
        } as unknown as Response;
      }
      return okJson({});
    }));
  }
  beforeEach(() => { vi.resetModules(); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("走 Range 206、流式读取、回调进度,返回正确解析的 poems", async () => {
    install();
    const { loadData, loadPoetPoems } = await import("./load");
    await loadData(); // 设置 _manifest.poemSidecar=true → 走 Range 路径
    const ticks: Array<[number, number]> = [];
    const poems = await loadPoetPoems(POET, undefined, (r, t) => ticks.push([r, t]));
    expect(poems).toEqual([{ t: "测试诗", f: "wujue", p: ["床前明月光", "疑是地上霜"] }]);
    expect(ticks.length).toBeGreaterThan(0);
    const total = ticks[ticks.length - 1][1];
    expect(ticks[ticks.length - 1][0]).toBe(total); // 最终 received == total
    expect(total).toBe(enc(SLICE).length);
  });
});

// The fuzzy 诗句 index relies on this property: two same-length lines differing by ONE substitution
// share the (L-1) skeleton formed by deleting the differing position. That's how 「举头望明月」 finds
// the corpus 「举头望山月」 (静夜思).
describe("lineSkeletons (fuzzy 1-edit keys)", () => {
  it("a 1-char substitution shares a skeleton (举头望明月 ↔ 举头望山月)", () => {
    const sa = new Set(lineSkeletons([..."举头望明月"]));
    const shared = lineSkeletons([..."举头望山月"]).filter((s) => sa.has(s));
    expect(shared).toContain("举头望月"); // dropping the differing position (明/山)
  });
  it("produces one skeleton per position", () => {
    expect(lineSkeletons([..."床前明月光"])).toHaveLength(5);
  });
  it("dedupes skeletons from repeated chars", () => {
    expect(lineSkeletons([..."明明"])).toHaveLength(1); // both drops yield 「明」
  });
  it("a fully different same-length line shares NO skeleton", () => {
    const sa = new Set(lineSkeletons([..."春眠不觉晓"]));
    expect(lineSkeletons([..."夜来风雨声"]).some((s) => sa.has(s))).toBe(false);
  });
});

// linesf/ (the 4.4 GB delete-1 fuzzy index) is intentionally NOT deployed in prod, so every fuzzy probe
// 404s. Because it's sharded by skeleton hash, one query fans across many distinct buckets → dozens of
// certain-404 round-trips per session. searchByLine must observe ONE 404 and then stop probing linesf/
// for the rest of the session — WITHOUT disabling exact line search (lines/) and WITHOUT hard-coding
// (a future deploy whose first request succeeds must NOT be latched off). 5xx / network errors are
// transient and must stay retryable. These tests drive searchByLine through a mocked fetch and assert on
// the linesf/ vs lines/ traffic it emits.
describe("searchByLine — linesf/ fuzzy session latch", () => {
  // A real FirstLineRef-shaped hit for the lines/ (exact) layer.
  const exactHit = { p: "li_bai", i: 0, t: "静夜思", f: "wujue" };

  function installFetch(opts: {
    linesf: "404" | "503" | "throw" | "200";
    linesfData?: Record<string, unknown[]>; // skeleton→hits served when linesf is "200" (a deployed index)
    lines?: Record<string, unknown[]>;
  }) {
    const calls: string[] = [];
    const linesData = opts.lines ?? {}; // default: exact layer finds nothing → fuzzy fallback runs
    const fzData = opts.linesfData ?? {};
    const fn = vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/linesf/")) {
        if (opts.linesf === "throw") throw new Error("network down");
        if (opts.linesf === "200")
          return { ok: true, status: 200, json: async () => fzData, text: async () => JSON.stringify(fzData) };
        const status = opts.linesf === "404" ? 404 : 503;
        return { ok: false, status, json: async () => ({}), text: async () => "" };
      }
      if (url.includes("/lines/")) {
        return { ok: true, status: 200, json: async () => linesData, text: async () => JSON.stringify(linesData) };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" }; // search/ etc.
    });
    vi.stubGlobal("fetch", fn);
    return {
      linesf: () => calls.filter((u) => u.includes("/linesf/")).length,
      lines: () => calls.filter((u) => u.includes("/lines/")).length,
      search: () => calls.filter((u) => u.includes("/search/")).length,
      clear: () => (calls.length = 0),
    };
  }

  const QUERY_A = "举头望明月"; // 5 Han chars → in the fuzzy len-4..10 window; exact finds nothing
  const QUERY_B = "白日依山尽"; // a DIFFERENT 5-char line → different shards (rules out per-bucket caching)

  beforeEach(() => {
    vi.resetModules(); // fresh module instance per test → _linesfUnavailable + caches reset
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("latches on a real 404: first call probes linesf/ exactly once, later calls never touch it", async () => {
    const net = installFetch({ linesf: "404" });
    const { searchByLine } = await import("./load");

    await searchByLine(QUERY_A);
    // The first skeleton 404s and latches; every remaining skeleton in the SAME call short-circuits in
    // loadFzShard — so the session emits ONE certain-404 request, not one per skeleton.
    expect(net.linesf()).toBe(1);

    net.clear();
    await searchByLine(QUERY_B); // different query, different buckets → not just a cache hit
    expect(net.linesf()).toBe(0); // latched → zero further linesf/ traffic this session
    expect(net.lines()).toBeGreaterThan(0); // exact line search is unaffected (degradation is invisible)
  });

  it("does NOT latch on a 5xx (transient): later calls still retry linesf/", async () => {
    const net = installFetch({ linesf: "503" });
    const { searchByLine } = await import("./load");

    await searchByLine(QUERY_A);
    expect(net.linesf()).toBeGreaterThan(0); // it tried

    net.clear();
    await searchByLine(QUERY_A); // a 5xx is never cached → the fuzzy probe retries
    expect(net.linesf()).toBeGreaterThan(0); // NOT latched → still attempts linesf/
  });

  it("does NOT latch on a network error (transient): later calls still retry linesf/", async () => {
    const net = installFetch({ linesf: "throw" });
    const { searchByLine } = await import("./load");

    await searchByLine(QUERY_A);
    expect(net.linesf()).toBeGreaterThan(0);

    net.clear();
    await searchByLine(QUERY_A);
    expect(net.linesf()).toBeGreaterThan(0);
  });

  it("never probes linesf/ when exact already found hits (fuzzy fallback is exact-gated)", async () => {
    // Exact lines/ returns a hit for the whole query → hits.length > 0 → fuzzy never runs, latch or not.
    const net = installFetch({ linesf: "404", lines: { [QUERY_A]: [exactHit] } });
    const { searchByLine } = await import("./load");

    const out = await searchByLine(QUERY_A);
    expect(out.length).toBeGreaterThan(0); // exact hit surfaced
    expect(net.linesf()).toBe(0); // exact succeeded → linesf/ never probed
  });

  it("a SUCCESSFUL linesf/ response never latches: fuzzy works and later calls keep probing (Req: not hard-coded)", async () => {
    // The day linesf/ ships, the first request returns 200 — the latch must stay disarmed so fuzzy keeps
    // working forever. Serve a delete-1 hit under 「举头望月」 (QUERY_A with the 4th char 明 dropped → the
    // shared skeleton of corpus 「举头望山月」, 静夜思). Exact still finds nothing, so the fuzzy path runs.
    const fzHit = { p: "li_bai", i: 0, t: "静夜思", f: "wujue" };
    const net = installFetch({ linesf: "200", linesfData: { "举头望月": [fzHit] } });
    const { searchByLine } = await import("./load");

    const out = await searchByLine(QUERY_A);
    expect(out.length).toBeGreaterThan(0); // the 1-edit fuzzy hit surfaced → the fuzzy path is wired through
    expect(net.linesf()).toBeGreaterThan(0); // it probed linesf/

    net.clear();
    await searchByLine(QUERY_B); // a different query → different buckets, not a cache hit
    expect(net.linesf()).toBeGreaterThan(0); // a 200 NEVER latches → fuzzy stays live for the whole session
  });

  it("emits ZERO linesf/ for queries outside the fuzzy length window (the 4..10 gate keeps certain-404s at 0)", async () => {
    // The fuzzy fallback only fires for 4..10 Han chars. Out-of-window queries must never touch linesf/,
    // independent of the latch — that's part of keeping guaranteed-404 traffic at zero. Exact still runs.
    const net = installFetch({ linesf: "404" });
    const { searchByLine } = await import("./load");

    await searchByLine("举头望"); // 3 Han chars — below the window
    expect(net.linesf()).toBe(0);
    expect(net.lines()).toBeGreaterThan(0); // exact line search still active

    net.clear();
    await searchByLine("床前明月光疑是地上霜举头"); // 12 Han chars — above the window
    expect(net.linesf()).toBe(0);
    expect(net.lines()).toBeGreaterThan(0);
  });

  it("searchPoems confines the degradation to the fuzzy layer (search/ + lines/ keep firing after the latch)", async () => {
    // searchPoems is the real 寻诗 entry point: searchByHead (search/) ∥ searchByLine (lines/ + linesf/).
    // After a 404 latches the fuzzy layer, the parallel prefix/title index (search/) and the exact line
    // index (lines/) must keep working — the user-visible degradation is invisible (Req 3).
    const net = installFetch({ linesf: "404" });
    const { searchPoems } = await import("./load");

    await searchPoems(QUERY_A); // trips the latch via the searchByLine half
    net.clear();
    await searchPoems(QUERY_B); // fresh query
    expect(net.linesf()).toBe(0); // fuzzy layer skipped (latched)
    expect(net.search()).toBeGreaterThan(0); // 寻诗 prefix/诗名 index unaffected
    expect(net.lines()).toBeGreaterThan(0); // exact line index unaffected
  });
});

// ── Plan C: 多句(整联)按「命中句数」重排 ──────────────────────────────────────────────────────────
// 用户反馈 (2026-06):寻诗「行到水穷处，坐看云起时」把 王安石《春山》(只含上句) 排在了 王维《终南别业》
// (含完整两句) 之前。根因:(1) searchByLine 只查整串的「开头定长前缀」,第二句「坐看云起时」从未被查 —
// 两首都只命中「行到水穷处」;(2) 平局再用 famous→poemCount 打破,王安石(1918 首) ≫ 王维(397 首) → 《春山》
// 被顶到最前。Plan C:按标点把输入拆成多句,每句各查整行索引,按命中的「不同句数」重排(终南别业=2 > 春山=1),
// 该维度优先于 poemCount 平局。
describe("searchPoems — 多句(整联)按命中句数重排 (Plan C)", () => {
  const WANG_ANSHI = { id: "wang_anshi", name: "王安石", dynasty: "song", poemCount: 1918, clusterSize: 44 };
  const WANG_WEI = { id: "wang_wei", name: "王维", dynasty: "tang", poemCount: 397, clusterSize: 20 };
  const chunshan = { p: "wang_anshi", i: 3, t: "春山", f: "wulu" }; // 行到水穷处 ∈ 春山,坐看云起时 ∉
  const zhongnan = { p: "wang_wei", i: 5, t: "终南别业", f: "wulu" }; // 两句都 ∈ 终南别业
  // lines/ 整行索引。春山 在「行到水穷处」下故意排在第一位 —— 这样有 bug 的实现也无法靠「插入顺序」蒙对,
  // 唯一能区分两者的就是命中句数。
  const LINES: Record<string, unknown[]> = {
    行到水穷处: [chunshan, zhongnan],
    坐看云起时: [zhongnan],
  };

  const okJson = (o: unknown) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  const notOk = (s: number) => ({ ok: false, status: s, json: async () => ({}), text: async () => "" });

  function installFetch() {
    const charset = { chars: "行到水穷处坐看云起时春山别业", n: 14, hash: "deadbeef" };
    const poets = [WANG_ANSHI, WANG_WEI];
    const manifest = { n: 14, poetCount: 2, poemCount: 2315, buckets: [], lineBuckets: [], dynCounts: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/charset.json")) return okJson(charset);
        if (url.includes("/poets.index.json")) return okJson(poets);
        if (url.includes("/manifest.json")) return okJson(manifest);
        if (url.includes("/lexicon.json")) return notOk(404); // → dummyLexicon,不需要真 格律
        if (url.includes("/lines/")) return okJson(LINES);
        if (url.includes("/linesf/")) return notOk(404); // fuzzy 未部署
        return okJson({}); // search/ (前缀/诗名) → 无 head 命中,隔离出整行层
      }),
    );
  }

  beforeEach(() => {
    vi.resetModules(); // fresh module → _byId / caches / 各 latch 复位
    vi.spyOn(console, "error").mockImplementation(() => {}); // loadData 会对故意造假的 charset hash 报警,屏蔽噪音
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("整联输入:含完整两句的《终南别业》排在只含一句的《春山》之前(即便王安石更多产)", async () => {
    installFetch();
    const { loadData, searchPoems } = await import("./load");
    await loadData(); // 填充 _byId,让 famous→poemCount 平局真正生效(复现真实 bug 条件)

    const hits = await searchPoems("行到水穷处，坐看云起时");

    expect(hits[0]?.poetId).toBe("wang_wei"); // 终南别业 —— 完整一联,而非《春山》
    expect(hits[0]?.title).toBe("终南别业");
    expect(hits.some((h) => h.poetId === "wang_anshi")).toBe(true); // 《春山》仍在列,只是排在后面
  });

  it("单句输入仍走原 exact 整行路径:含该句的两首都在,firstLine 即该句", async () => {
    installFetch();
    const { loadData, searchByLine } = await import("./load");
    await loadData();

    // 只输入上句(无标点、单段)→ splitHanLines 得 1 段 → 不进多句分支 → 原 exact 整行路径不变。
    const hits = await searchByLine("行到水穷处");
    const ids = hits.map((h) => h.poetId);
    expect(ids).toContain("wang_anshi"); // 《春山》
    expect(ids).toContain("wang_wei"); // 《终南别业》
    expect(hits.every((h) => h.firstLine === "行到水穷处")).toBe(true);
  });
});

// ── Plan C 对抗边角验证 (Round 1):主动找回归/边角,逐条钉死 ────────────────────────────────────────
describe("searchPoems — Plan C 对抗边角", () => {
  const jingyesi = { p: "li_bai", i: 0, t: "静夜思", f: "wujue" };
  const shuangju = { p: "minor", i: 0, t: "霜句", f: "other" }; // 非名家,只蹭一句
  const chunshan = { p: "wang_anshi", i: 3, t: "春山", f: "wulu" };
  const zhongnan = { p: "wang_wei", i: 5, t: "终南别业", f: "wulu" };
  const POETS = [
    { id: "li_bai", name: "李白", dynasty: "tang", poemCount: 1000, clusterSize: 30 },
    { id: "minor", name: "张三", dynasty: "tang", poemCount: 5, clusterSize: 2 }, // 不在 FAMOUS_POETS
    { id: "wang_anshi", name: "王安石", dynasty: "song", poemCount: 1918, clusterSize: 44 },
    { id: "wang_wei", name: "王维", dynasty: "tang", poemCount: 397, clusterSize: 20 },
  ];
  const LINES: Record<string, unknown[]> = {
    床前明月光: [jingyesi],
    疑是地上霜: [jingyesi, shuangju], // 静夜思命中两句;霜句只命中这一句
    行到水穷处: [chunshan, zhongnan],
    坐看云起时: [zhongnan],
  };

  const okJson = (o: unknown) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  const notOk = (s: number) => ({ ok: false, status: s, json: async () => ({}), text: async () => "" });

  function install(search: Record<string, unknown[]> = {}) {
    const charset = { chars: "床前明月光疑是地上霜行到水穷坐看云起时春别业", n: 22, hash: "deadbeef" };
    const manifest = { n: 22, poetCount: POETS.length, poemCount: 9999, buckets: [], lineBuckets: [], dynCounts: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/charset.json")) return okJson(charset);
        if (url.includes("/poets.index.json")) return okJson(POETS);
        if (url.includes("/manifest.json")) return okJson(manifest);
        if (url.includes("/lexicon.json")) return notOk(404);
        if (url.includes("/lines/")) return okJson(LINES);
        if (url.includes("/linesf/")) return notOk(404);
        if (url.includes("/search/")) return okJson(search);
        return okJson({});
      }),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("命中句数推广到 3 句:静夜思(命中 2 句)压过只蹭 1 句的诗", async () => {
    install();
    const { loadData, searchPoems } = await import("./load");
    await loadData();
    const hits = await searchPoems("床前明月光，疑是地上霜，举头望明月"); // 第三句是异文(corpus 山月),不精确命中
    expect(hits[0]?.poetId).toBe("li_bai");
    expect(hits[0]?.title).toBe("静夜思");
    expect(hits[0]?.lineMatches).toBe(2); // 床前明月光 + 疑是地上霜
    expect(hits.some((h) => h.poetId === "minor")).toBe(true); // 蹭一句的也在,只是靠后
  });

  it("标点不敏感:半角逗号同样拆句 → 终南别业 居首", async () => {
    install();
    const { loadData, searchPoems } = await import("./load");
    await loadData();
    const hits = await searchPoems("行到水穷处,坐看云起时"); // ASCII 逗号
    expect(hits[0]?.poetId).toBe("wang_wei");
  });

  it("尾随标点/重复句:视作单句,不触发多句重排(lineMatches 不被虚增)", async () => {
    install();
    const { loadData, searchByLine } = await import("./load");
    await loadData();
    const a = await searchByLine("行到水穷处，"); // 尾随逗号 → 1 段
    expect(a.every((h) => h.lineMatches === undefined)).toBe(true); // 没进多句分支
    expect(a.map((h) => h.poetId).sort()).toEqual(["wang_anshi", "wang_wei"]);
    const b = await searchByLine("行到水穷处，行到水穷处"); // 同句重复 → 去重后 1 段,不能算「命中 2 句」
    expect(b.every((h) => h.lineMatches === undefined)).toBe(true);
  });

  it("多句但都不在整行索引:回退单句路径,优雅返回空(不崩不抛)", async () => {
    install();
    const { loadData, searchByLine } = await import("./load");
    await loadData();
    const hits = await searchByLine("深林人不知，返景入深林"); // 两句在 mock 里都不存在
    expect(hits).toEqual([]);
  });

  it("增量单字仍走 searchByHead:不被多句分支影响(核心卖点不回归)", async () => {
    install({ 月: [jingyesi] }); // search/ 前缀索引:「月」→ 静夜思
    const { loadData, searchPoems } = await import("./load");
    await loadData();
    const hits = await searchPoems("月"); // 单字 → searchByLine 直接空,靠 searchByHead
    expect(hits.some((h) => h.poetId === "li_bai" && h.title === "静夜思")).toBe(true);
  });

  it("同一 content-bucket 的两句只抓一次 lines/ shard(去重,省 egress)", async () => {
    const { hashStr } = await import("./dynasties");
    const bk = (s: string) => (hashStr(s) & 0xff).toString(16).padStart(2, "0");
    // 自验证前提:两句在 256 路 content-bucket 同桶。若 hashStr 变更致其不再同桶,此断言先响,提示更新样例。
    expect(bk("黄河入海流")).toBe(bk("花落知多少"));

    let lineFetches = 0;
    const LINES2: Record<string, unknown[]> = {
      黄河入海流: [{ p: "wang_zhihuan", i: 0, t: "登鹳雀楼", f: "wujue" }],
      花落知多少: [{ p: "meng_haoran", i: 0, t: "春晓", f: "wujue" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/lines/")) {
          lineFetches++;
          return { ok: true, status: 200, json: async () => LINES2, text: async () => JSON.stringify(LINES2) };
        }
        if (url.includes("/linesf/")) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
      }),
    );
    const { searchByLine } = await import("./load");
    const hits = await searchByLine("黄河入海流，花落知多少"); // 两句同桶
    expect(lineFetches).toBe(1); // 去重:该 content-bucket 只抓一次(未去重会是 2)
    expect(hits.length).toBe(2); // 两句各命中一首,都在
  });
});

// ── canonical 别名层 (G2): resolveCanonicalPoet — pure redirect helper behind #a= restore + 诗人搜索 ──
// corpus (G1) emits a poemCount:0 PoetRow carrying `mergedInto:<正身poetId>` for a merged identity
// (唐温如 → 唐珙|yuan; 唐珙|ming → 唐珙|yuan; 毛泽东|dangdai → 毛泽东|jinxiandai). This is stub data (no
// fetch/loadData needed) — resolveCanonicalPoet takes the lookup map explicitly for exactly that reason.
describe("resolveCanonicalPoet (canonical 别名层, G2)", () => {
  const tangwenru: PoetRow = { id: "4a282690", name: "唐温如", dynasty: "tang", poemCount: 0, clusterSize: 0, mergedInto: "28a217e3" };
  const tanggongMing: PoetRow = { id: "1c8a158b", name: "唐珙", dynasty: "ming", poemCount: 0, clusterSize: 0, mergedInto: "28a217e3" };
  const tanggongYuan: PoetRow = { id: "28a217e3", name: "唐珙", dynasty: "yuan", poemCount: 4, clusterSize: 4 };
  const byId = new Map([tangwenru, tanggongMing, tanggongYuan].map((p) => [p.id, p]));

  it("a normal (non-merged) row passes through unchanged, no aliasName", () => {
    const r = resolveCanonicalPoet(tanggongYuan, byId);
    expect(r.canonical).toBe(tanggongYuan);
    expect(r.aliasName).toBeUndefined();
  });

  it("an alias row resolves to the canonical row + carries its OWN name as aliasName", () => {
    const r = resolveCanonicalPoet(tangwenru, byId);
    expect(r.canonical).toBe(tanggongYuan);
    expect(r.aliasName).toBe("唐温如");
  });

  it("a DIFFERENT alias (唐珙|ming) merged into the SAME canonical also resolves correctly", () => {
    const r = resolveCanonicalPoet(tanggongMing, byId);
    expect(r.canonical).toBe(tanggongYuan);
    expect(r.aliasName).toBe("唐珙"); // alias's OWN name — same string as canonical but a DIFFERENT row/id
    expect(r.canonical.id).toBe("28a217e3");
  });

  it("a dead mergedInto target (data desync) degrades to the alias row itself, not a crash/vanish", () => {
    const orphan: PoetRow = { id: "deadbeef", name: "孤儿", dynasty: "tang", poemCount: 0, clusterSize: 0, mergedInto: "not-in-index" };
    const r = resolveCanonicalPoet(orphan, byId);
    expect(r.canonical).toBe(orphan);
    expect(r.aliasName).toBeUndefined();
  });

  // poetAliasRedirectNote is the ONE place the "「X」已并入「Y」" copy is formatted — permalink.ts's
  // applyHash calls it directly (rather than inlining the template), so this is the actual coverage for
  // the #a= redirect notice PoetPanel renders.
  it("poetAliasRedirectNote formats the PoetPanel notice for an alias row", () => {
    expect(poetAliasRedirectNote(tangwenru, byId)).toBe("「唐温如」已并入「唐珙」");
  });

  it("SAME-name merge (唐珙|ming → 唐珙|yuan) dynasty-suffixes both sides — never the self-referential 「唐珙」已并入「唐珙」", () => {
    // labels come from DYNASTIES (dynasties.ts: ming→明, yuan→元), not a hardcoded map in load.ts
    expect(poetAliasRedirectNote(tanggongMing, byId)).toBe("「唐珙(明)」已并入「唐珙(元)」");
  });

  it("aliasNoticeNames: different names pass through untouched; same names get dynasty labels; unknown dynasty key degrades to the raw key", () => {
    expect(aliasNoticeNames(tangwenru, tanggongYuan)).toEqual(["唐温如", "唐珙"]);
    expect(aliasNoticeNames(tanggongMing, tanggongYuan)).toEqual(["唐珙(明)", "唐珙(元)"]);
    const weird: PoetRow = { id: "x1", name: "唐珙", dynasty: "nosuchkey", poemCount: 0, clusterSize: 0, mergedInto: "28a217e3" };
    expect(aliasNoticeNames(weird, tanggongYuan)).toEqual(["唐珙(nosuchkey)", "唐珙(元)"]); // no crash on a bad key
  });

  it("poetAliasRedirectNote is null for a normal row (no notice on an ordinary #a= visit)", () => {
    expect(poetAliasRedirectNote(tanggongYuan, byId)).toBeNull();
  });

  it("poetAliasRedirectNote is null for a dead-target alias (degrades silently, no confusing self-referential note)", () => {
    const orphan: PoetRow = { id: "deadbeef", name: "孤儿", dynasty: "tang", poemCount: 0, clusterSize: 0, mergedInto: "not-in-index" };
    expect(poetAliasRedirectNote(orphan, byId)).toBeNull();
  });
});
