import { describe, it, expect } from "vitest";
import { poetStarSize } from "./PoetStars";

// canonical 别名层 (G2): poetStarSize is the ONE place that turns a PoetRow into the star's point-size —
// shared by the visual shader's aSize attribute AND gpuPick's shared geometry. A mergedInto row (a
// redirect, not a real poet — poemCount:0/clusterSize:0 from build-data.mjs) must render NOTHING and be
// UNPICKABLE, not just a tiny dot: both shaders gate on `aSize < 0.001`, so returning exactly 0 here is
// load-bearing (not merely cosmetic) — anything > 0 would render+GPU-pick a dead star.
describe("poetStarSize — canonical 别名层 zero-size guard (G2)", () => {
  it("a mergedInto row (alias) is forced to EXACTLY 0, regardless of clusterSize", () => {
    expect(poetStarSize({ clusterSize: 0, mergedInto: "abc123" }, false)).toBe(0);
    expect(poetStarSize({ clusterSize: 0, mergedInto: "abc123" }, true)).toBe(0);
    // even if a future data bug ships a nonzero clusterSize alongside mergedInto, the alias check wins —
    // defence in depth against a partially-migrated / malformed alias row.
    expect(poetStarSize({ clusterSize: 44, mergedInto: "abc123" }, false)).toBe(0);
  });

  it("a normal row (no mergedInto) computes the usual positive size — famous poets get the landmark boost", () => {
    const base = poetStarSize({ clusterSize: 10, mergedInto: undefined }, false);
    const famous = poetStarSize({ clusterSize: 10, mergedInto: undefined }, true);
    expect(base).toBeGreaterThan(0);
    expect(famous).toBeGreaterThan(base); // famous landmark multiplier (×2.4) still applies
    expect(famous).toBeCloseTo(base * 2.4, 5);
  });

  it("clusterSize:0 WITHOUT mergedInto still renders a nonzero minimum-size star (not an alias, a real 1-poem poet)", () => {
    // Distinguishes "a real poet whose clusterSize formula happens to floor at a small value" from
    // an alias — the field that matters is mergedInto, not clusterSize/poemCount alone.
    expect(poetStarSize({ clusterSize: 0, mergedInto: undefined }, false)).toBeGreaterThan(0);
  });
});
