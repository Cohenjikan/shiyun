import { describe, it, expect } from "vitest";
import { chooseCanonicalBucket, resolveZone } from "./canonicalRules.mjs";

// ── AUTO 别名正身判定 (Task 1): pure decision function behind build-data.mjs's auto-alias emission for
// dedup-zeroed (name,dynasty) buckets. Rules under test: canonical_id majority vote → tie/no-vote falls
// back to most-poems same-name live bucket → nothing qualifies returns null (plain 0-row, no mergedInto).
describe("chooseCanonicalBucket — 清零桶正身判定 (majority vote / tie→最大同名桶 / 防御)", () => {
  const A = "施蛰存|jinxiandai", B = "施蛰存|dangdai", C = "李白|tang";

  it("clear majority vote wins (the corpus's own canonical_id targets decide)", () => {
    const alive = new Set([A, B]);
    expect(chooseCanonicalBucket([A, A, B], [], alive)).toBe(A);
    expect(chooseCanonicalBucket([B, A, B, B], [], alive)).toBe(B);
  });

  it("a single vote is a majority (the typical zeroed bucket: every dup points at one canonical row)", () => {
    expect(chooseCanonicalBucket([A], [], new Set([A]))).toBe(A);
  });

  it("majority TIE falls back to the most-poems same-name live bucket", () => {
    const alive = new Set([A, B]);
    // 1×A vs 1×B — tied; candidates say B has more poems → B
    expect(chooseCanonicalBucket([A, B], [{ key: A, count: 3 }, { key: B, count: 90 }], alive)).toBe(B);
  });

  it("NO canonical_id at all (组诗总题类, 防御 — 理论不会零化整桶) falls back to most-poems same-name bucket", () => {
    const alive = new Set([A, B]);
    expect(chooseCanonicalBucket([], [{ key: A, count: 89 }, { key: B, count: 2 }], alive)).toBe(A);
  });

  it("DEAD vote targets (bucket not alive in this build, e.g. whole-bucket charset skip) never win — falls through", () => {
    const alive = new Set([B]); // A is dead
    // all votes point at dead A → votes filtered to B only... here: A,A,B → only B counts → B wins
    expect(chooseCanonicalBucket([A, A, B], [], alive)).toBe(B);
    // ALL votes dead + no candidates → null
    expect(chooseCanonicalBucket([A, A], [], new Set())).toBeNull();
  });

  it("fallback candidates are ALSO alive-gated (a dead same-name bucket can't be a redirect target)", () => {
    const alive = new Set([B]);
    expect(chooseCanonicalBucket([], [{ key: A, count: 999 }, { key: B, count: 1 }], alive)).toBe(B);
  });

  it("nothing qualifies (no votes, no same-name live bucket) → null → caller emits plain 0-row without mergedInto", () => {
    expect(chooseCanonicalBucket([], [], new Set([C]))).toBeNull();
  });

  it("unrelated alive buckets don't leak in — only voted / same-name candidates can win", () => {
    const alive = new Set([A, B, C]);
    expect(chooseCanonicalBucket([A], [{ key: B, count: 5 }], alive)).toBe(A); // C never considered
  });
});

// ── 赠诗裸名解析区 (Task 2): jinxiandai+dangdai are ONE zone (the modern era is split into two buckets
// purely by upstream source labels; canonical dedup moves poets wholesale across the boundary — same-
// dynasty-only resolution broke 22 real edges and always missed genuine cross-bucket ones). All other
// dynasties keep their own zone (bare cross-dynasty namesakes are almost always collisions).
describe("resolveZone — 赠诗裸名解析区 (jinxiandai↔dangdai 同区, 其余朝代各自独立)", () => {
  it("jinxiandai and dangdai share one zone (裸名互通)", () => {
    expect(resolveZone("jinxiandai")).toBe(resolveZone("dangdai"));
  });

  it("tang and song remain DIFFERENT zones (跨朝代裸名仍不通 — 原精度论证不变)", () => {
    expect(resolveZone("tang")).not.toBe(resolveZone("song"));
  });

  it("every pre-modern dynasty is its own zone (identity for itself, distinct from all others)", () => {
    const keys = ["xianqin", "qinhan", "weijin", "nanbeichao", "sui", "tang", "wudai", "song", "liao", "jin", "yuan", "ming", "qing"];
    for (const k of keys) expect(resolveZone(k)).toBe(k); // same dynasty ⇒ same zone (self)
    expect(new Set(keys.map(resolveZone)).size).toBe(keys.length); // pairwise distinct
  });

  it("modern zone does NOT bleed into pre-modern (qing↔jinxiandai 不通)", () => {
    expect(resolveZone("qing")).not.toBe(resolveZone("jinxiandai"));
    expect(resolveZone("qing")).not.toBe(resolveZone("dangdai"));
  });

  it("an unknown key is its own zone (defensive — matches old dynId behaviour of not resolving cross-bucket)", () => {
    expect(resolveZone("unknown")).toBe("unknown");
    expect(resolveZone("unknown")).not.toBe(resolveZone("tang"));
  });
});
