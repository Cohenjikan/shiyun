import { describe, it, expect } from "vitest";
import { centroid, pinchDistance, thrustFromDrag, pinchSpeed, classifyGesture, orbitZoom } from "./touchGesture";

describe("touchGesture — centroid / distance", () => {
  it("centroid is the midpoint", () => {
    expect(centroid({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
  it("distance is euclidean", () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("touchGesture — thrustFromDrag (WASD convention: z<0 forward, x>0 right)", () => {
  const O = { x: 100, y: 100 };
  it("inside the deadzone → no thrust", () => {
    expect(thrustFromDrag(O, { x: 105, y: 95 })).toEqual({ z: 0, x: 0 });
  });
  it("fingers pushed UP → forward (z negative)", () => {
    const t = thrustFromDrag(O, { x: 100, y: 100 - 130 }); // 130px up, span 120, dz 10
    expect(t.z).toBeLessThan(0);
    expect(t.x).toBe(0);
  });
  it("fingers pushed DOWN → back (z positive)", () => {
    expect(thrustFromDrag(O, { x: 100, y: 100 + 130 }).z).toBeGreaterThan(0);
  });
  it("fingers pushed RIGHT → strafe right (x positive)", () => {
    expect(thrustFromDrag(O, { x: 100 + 130, y: 100 }).x).toBeGreaterThan(0);
  });
  it("fingers pushed LEFT → strafe left (x negative)", () => {
    expect(thrustFromDrag(O, { x: 100 - 130, y: 100 }).x).toBeLessThan(0);
  });
  it("diagonal up-right → forward + right, independent per axis", () => {
    const t = thrustFromDrag(O, { x: 100 + 130, y: 100 - 130 });
    expect(t.z).toBeLessThan(0); // forward
    expect(t.x).toBeGreaterThan(0); // right
  });
  it("clamps to [-1, 1] beyond full span", () => {
    const t = thrustFromDrag(O, { x: 100, y: 100 - 9999 });
    expect(t.z).toBe(-1);
  });
  it("deadzone is subtracted (not full magnitude at the edge)", () => {
    // 10px deadzone + 120px span: a 70px displacement → (70-10)/120 = 0.5
    const t = thrustFromDrag(O, { x: 100, y: 100 + 70 });
    expect(t.z).toBeCloseTo(0.5, 5);
  });
});

describe("touchGesture — pinchSpeed (free-fly, clamp 0.1..80)", () => {
  it("spreading fingers (cur > prev) → faster", () => {
    expect(pinchSpeed(1, 100, 200)).toBe(2);
  });
  it("pinching in (cur < prev) → slower", () => {
    expect(pinchSpeed(2, 200, 100)).toBe(1);
  });
  it("clamps at the max (80)", () => {
    expect(pinchSpeed(50, 100, 1000)).toBe(80);
  });
  it("clamps at the min (0.1)", () => {
    expect(pinchSpeed(0.2, 1000, 100)).toBe(0.1);
  });
  it("a no-op pinch (cur === prev) returns speedMul UNCHANGED (strict ===, no drift)", () => {
    // FlyControls relies on `sm !== speedMul.current` to skip redundant store writes — must not drift.
    expect(pinchSpeed(5, 100, 100)).toBe(5);
  });
  it("guards a zero/invalid prev distance", () => {
    expect(pinchSpeed(3, 0, 100)).toBe(3);
  });
  it("guards NaN / negative distances (degenerate centroid never poisons speed)", () => {
    expect(pinchSpeed(5, 100, NaN)).toBe(5);
    expect(pinchSpeed(5, NaN, 100)).toBe(5);
    expect(pinchSpeed(5, 100, -50)).toBe(5);
  });
});

describe("touchGesture — classifyGesture (mode-lock: pan XOR pinch)", () => {
  const O = { x: 100, y: 100 };
  it("returns null until movement crosses the threshold", () => {
    expect(classifyGesture(O, { x: 105, y: 105 }, 200, 205)).toBeNull();
  });
  it("centroid moved more than distance changed → pan", () => {
    expect(classifyGesture(O, { x: 100, y: 70 }, 200, 205)).toBe("pan"); // 30px pan, 5px pinch
  });
  it("distance changed more than centroid moved → pinch", () => {
    expect(classifyGesture(O, { x: 103, y: 103 }, 200, 260)).toBe("pinch"); // ~4px pan, 60px pinch
  });
  it("a one-handed pinch (centroid drifts but distance dominates) → pinch, not pan", () => {
    // thumb anchored, index spreads 100px: centroid drifts ~50px, distance changes ~100px → pinch wins
    expect(classifyGesture(O, { x: 100, y: 150 }, 200, 300)).toBe("pinch");
  });
});

describe("touchGesture — orbitZoom (galaxy-lock pinch-to-zoom, clamp [min,max])", () => {
  it("spreading fingers (cur > prev) → orbit moves CLOSER (smaller dist)", () => {
    expect(orbitZoom(1000, 100, 200, 40, 6000)).toBe(500); // 1000 * 100/200 = 500
    expect(orbitZoom(1000, 100, 200, 40, 6000)).toBeLessThan(1000);
  });
  it("pinching in (cur < prev) → orbit moves FARTHER (larger dist)", () => {
    expect(orbitZoom(500, 200, 100, 40, 6000)).toBe(1000);
  });
  it("clamps to the min/max", () => {
    expect(orbitZoom(100, 100, 9999, 40, 6000)).toBe(40); // would go below min
    expect(orbitZoom(5000, 9999, 100, 40, 6000)).toBe(6000); // would exceed max
  });
  it("guards zero / NaN / negative distances → dist unchanged", () => {
    expect(orbitZoom(800, 0, 100, 40, 6000)).toBe(800);
    expect(orbitZoom(800, 100, NaN, 40, 6000)).toBe(800);
    expect(orbitZoom(800, -5, 100, 40, 6000)).toBe(800);
  });
});
