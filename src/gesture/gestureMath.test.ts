import { describe, expect, it } from "vitest";
import {
  PINCH_ENTER,
  buildHandSample,
  isFistPose,
  isOpenPalmPose,
  isThumbUpPose,
  isVictoryPose,
  makeReachBox,
  mapToScreenFraction,
  pinchGuard,
  recentreReachBox,
  pinchRatio,
  pinchStrength,
  type GestureLandmark,
  type HandSample,
} from "./gestureMath";

// Synthetic but anatomically plausible landmark sets (camera units, y down). Knuckle width = `size`.
export type SynthPose = "open" | "point" | "pinch" | "victory" | "thumbUp" | "fist" | "closing";

export function synthHand(opts: { x?: number; y?: number; size?: number; pose?: SynthPose; gesture?: string; score?: number } = {}): HandSample {
  const { x: px = 0.5, y: py = 0.5, size: s = 0.12, pose = "open" } = opts;
  const l: GestureLandmark[] = Array.from({ length: 21 }, () => ({ x: px, y: py }));
  l[0] = { x: px, y: py + 1.2 * s };
  const mcps: Record<number, number> = { 5: px - 0.5 * s, 9: px - 0.17 * s, 13: px + 0.17 * s, 17: px + 0.5 * s };
  const finger = (mcp: number, extended: boolean) => {
    const mx = mcps[mcp];
    l[mcp] = { x: mx, y: py };
    if (extended) {
      l[mcp + 1] = { x: mx, y: py - 0.5 * s };
      l[mcp + 2] = { x: mx, y: py - 0.85 * s };
      l[mcp + 3] = { x: mx, y: py - 1.15 * s };
    } else {
      // curled into the palm: tip ends up below the knuckle line, near the palm centre
      l[mcp + 1] = { x: mx, y: py - 0.45 * s };
      l[mcp + 2] = { x: mx + 0.03 * s, y: py - 0.05 * s };
      l[mcp + 3] = { x: mx + 0.05 * s, y: py + 0.35 * s };
    }
  };
  const ext = {
    open: [true, true, true, true],
    point: [true, false, false, false],
    pinch: [true, true, true, true],
    victory: [true, true, false, false],
    thumbUp: [false, false, false, false],
    fist: [false, false, false, false],
    closing: [false, true, true, true],
  }[pose];
  finger(5, ext[0]); finger(9, ext[1]); finger(13, ext[2]); finger(17, ext[3]);
  // thumb
  l[1] = { x: px - 0.6 * s, y: py + 0.7 * s };
  l[2] = { x: px - 0.9 * s, y: py + 0.35 * s };
  l[3] = { x: px - 1.1 * s, y: py + 0.05 * s };
  l[4] = { x: px - 1.3 * s, y: py - 0.25 * s };
  if (pose === "pinch") l[4] = { x: l[8].x - 0.08 * s, y: l[8].y + 0.06 * s };
  if (pose === "closing") l[4] = { x: l[8].x - 0.1 * s, y: l[8].y }; // thumb meets a FOLDED index tip
  if (pose === "thumbUp") l[4] = { x: px - 0.4 * s, y: py - 1.1 * s };
  if (pose === "fist") l[4] = { x: px - 0.2 * s, y: py + 0.2 * s };
  return buildHandSample(l, "Right", opts.gesture ?? "None", opts.score ?? 0, 1);
}

describe("gestureMath", () => {
  it("builds a stable palm point that does not move when the fingers pinch", () => {
    const open = synthHand({ pose: "open" });
    const pinch = synthHand({ pose: "pinch" });
    expect(Math.abs(open.palm.x - pinch.palm.x)).toBeLessThan(1e-9);
    expect(Math.abs(open.palm.y - pinch.palm.y)).toBeLessThan(1e-9);
    expect(open.size).toBeCloseTo(0.12, 5);
  });

  it("pinch ratio is scale invariant and separates pinch from open and from a closing fist", () => {
    const near = synthHand({ pose: "pinch", size: 0.06 });
    const far = synthHand({ pose: "pinch", size: 0.2 });
    expect(pinchRatio(near)).toBeCloseTo(pinchRatio(far), 6);
    expect(pinchRatio(near)).toBeLessThan(PINCH_ENTER);
    expect(pinchGuard(near)).toBe(true);
    expect(pinchRatio(synthHand({ pose: "open" }))).toBeGreaterThan(1);
    // thumb touching a folded index (the hand is closing into a fist): ratio is small but the guard rejects it
    const closing = synthHand({ pose: "closing" });
    expect(pinchRatio(closing)).toBeLessThan(PINCH_ENTER);
    expect(pinchGuard(closing)).toBe(false);
    expect(pinchGuard(synthHand({ pose: "fist" }))).toBe(false);
  });

  it("pinch strength rises smoothly toward 1 as the tips approach", () => {
    expect(pinchStrength(1.4)).toBe(0);
    expect(pinchStrength(0.7)).toBeGreaterThan(0.3);
    expect(pinchStrength(0.7)).toBeLessThan(0.8);
    expect(pinchStrength(0.2)).toBe(1);
  });

  it("recognises ✌️ 👍 fist and open palm from geometry alone", () => {
    expect(isVictoryPose(synthHand({ pose: "victory" }))).toBe(true);
    expect(isVictoryPose(synthHand({ pose: "open" }))).toBe(false);
    expect(isVictoryPose(synthHand({ pose: "point" }))).toBe(false);
    expect(isThumbUpPose(synthHand({ pose: "thumbUp" }))).toBe(true);
    expect(isThumbUpPose(synthHand({ pose: "fist" }))).toBe(false);
    expect(isThumbUpPose(synthHand({ pose: "open" }))).toBe(false);
    expect(isFistPose(synthHand({ pose: "fist" }))).toBe(true);
    expect(isFistPose(synthHand({ pose: "open" }))).toBe(false);
    expect(isOpenPalmPose(synthHand({ pose: "open" }))).toBe(true);
    expect(isOpenPalmPose(synthHand({ pose: "victory" }))).toBe(false);
  });

  it("accepts a confident canned Victory label even when geometry is borderline", () => {
    const hand = synthHand({ pose: "point", gesture: "Victory", score: 0.9 });
    expect(isVictoryPose(hand)).toBe(true);
    expect(isVictoryPose(synthHand({ pose: "point", gesture: "Victory", score: 0.4 }))).toBe(false);
  });

  it("sizes the reach box in palm widths and maps it, mirrored, onto the whole screen", () => {
    // palm 0.12 frame-heights wide (a hand at ~1 m): box = 9 palms = 1.08 iso units → 0.6075 raw x
    const box = makeReachBox({ x: 0.5, y: 0.5 }, 0.12);
    expect(box.halfW).toBeCloseTo(1.08 / (16 / 9) / 2, 5);
    expect(box.halfH).toBeCloseTo(1.08 / (16 / 9) / 2, 5); // same screen aspect as the camera
    const centre = mapToScreenFraction(box, { x: 0.5, y: 0.5 });
    expect(centre.x).toBeCloseTo(0.5, 5);
    expect(centre.y).toBeCloseTo(0.5, 5);
    // hand at the camera-RIGHT edge of the box = screen LEFT (mirrored)
    expect(mapToScreenFraction(box, { x: 0.5 + box.halfW, y: 0.5 }).x).toBeCloseTo(0, 5);
    expect(mapToScreenFraction(box, { x: 0.5 - box.halfW, y: 0.5 }).x).toBeCloseTo(1, 5);
    expect(mapToScreenFraction(box, { x: 0.5, y: 0.5 - box.halfH }).y).toBeCloseTo(0, 5);
    expect(mapToScreenFraction(box, { x: 0.5, y: 0.5 + box.halfH }).y).toBeCloseTo(1, 5);
    // clamped beyond the box
    expect(mapToScreenFraction(box, { x: 0.02, y: 0.5 }).x).toBe(1);
    // a hand twice as far away (half the palm size) gets a box half as wide — same arm sweep
    const far = makeReachBox({ x: 0.5, y: 0.5 }, 0.06);
    expect(far.halfW).toBeCloseTo(box.halfW / 2, 5);
    // a box anchored near the frame edge is pulled back inside the frame
    const edge = makeReachBox({ x: 0.05, y: 0.5 }, 0.12);
    expect(edge.anchor.x).toBeCloseTo(edge.halfW, 5);
  });

  it("slides the reach box after a hand that pushes past its edge", () => {
    const box = makeReachBox({ x: 0.5, y: 0.5 }, 0.12);
    const same = recentreReachBox(box, { x: 0.5, y: 0.5 }, 0.1);
    expect(same).toBe(box);
    // hand beyond the camera-left edge (x < anchor − halfW) → anchor moves left, at most 0.5 box/s
    const pushed = recentreReachBox(box, { x: 0.5 - box.halfW - 0.2, y: 0.5 }, 0.1);
    expect(pushed.anchor.x).toBeLessThan(box.anchor.x);
    expect(box.anchor.x - pushed.anchor.x).toBeCloseTo(0.05 * 2 * box.halfW, 5);
    const down = recentreReachBox(box, { x: 0.5, y: 0.5 + box.halfH + 0.01 }, 0.1);
    expect(down.anchor.y).toBeGreaterThan(box.anchor.y);
  });
});
