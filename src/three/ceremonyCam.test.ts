import { describe, it, expect } from "vitest";
import { ceremonyFrame, type V3 } from "./ceremonyCam";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const angleDeg = (from: V3, viewDir: V3, to: V3) =>
  (Math.acos(Math.max(-1, Math.min(1, dot(viewDir, norm(sub(to, from)))))) * 180) / Math.PI;

// ── S2 取景数学 (ceremonyFrame) ── the camera hero-frame for a ceremony streak: a top-down 俯冲 arc that
// keeps BOTH endpoints of the streak inside the frame. Pure so it's unit-testable (no camera/GPU state).
describe("ceremonyFrame — hero-frame both endpoints of the ceremony streak (S2)", () => {
  // a spread of streaks (outer disk → near core) × camera positions × orientations
  const streaks: Array<[V3, V3]> = [
    [[800, 120, -600], [64, 48, -48]],
    [[1500, 0, 0], [120, 0, 0]],
    [[500, 180, -300], [40, 72, -24]],
    [[-1200, -90, 900], [-96, -36, 72]],
    [[100, 20, 100], [8, 8, 8]],
  ];
  const cams: V3[] = [
    [0, 0, 5000],
    [3000, 500, 3000],
    [-2000, 400, 1000],
    [0, 2000, -4000],
  ];

  it("both endpoints sit within fov/2 × 0.9 of the view direction (landscape + portrait)", () => {
    for (const [s, e] of streaks) {
      for (const cam of cams) {
        for (const aspect of [1.6, 0.5]) {
          const { pos } = ceremonyFrame(s, e, cam, 60, aspect);
          const m = mid(s, e);
          const view = norm(sub(m, pos));
          const cap = (60 / 2) * 0.9;
          expect(angleDeg(pos, view, s)).toBeLessThanOrEqual(cap);
          expect(angleDeg(pos, view, e)).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it("lands on the SAME side of the streak as the camera (horizontal offset dot > 0)", () => {
    // 同侧 = the XZ (horizontal) offset from the streak midpoint aligns with the camera's XZ offset. The +Y
    // lift (俯冲弧) is intentional and orthogonal to this side choice, so we test the horizontal plane. We skip
    // the geometric degeneracy where the camera is END-ON to the streak (camXZ ∥ axisXZ ⇒ "which side" is
    // undefined, dot == 0) — a real camera is essentially never exactly in-line with a plunge.
    for (const [s, e] of streaks) {
      for (const cam of cams) {
        const m = mid(s, e);
        const axisXZ: V3 = [e[0] - s[0], 0, e[2] - s[2]];
        const camXZ: V3 = [cam[0] - m[0], 0, cam[2] - m[2]];
        const alen = len(axisXZ), clen = len(camXZ);
        if (alen < 1e-6 || clen < 1e-6) continue; // no horizontal side to speak of
        if (Math.abs(dot(norm(axisXZ), norm(camXZ))) > 0.98) continue; // end-on degeneracy → side undefined
        const { pos } = ceremonyFrame(s, e, cam, 60, 1.6);
        const offXZ: V3 = [pos[0] - m[0], 0, pos[2] - m[2]];
        expect(dot(offXZ, camXZ)).toBeGreaterThan(0);
      }
    }
  });

  it("lifts above the streak (a top-down 俯冲 arc, not a level side view)", () => {
    for (const [s, e] of streaks) {
      const { pos } = ceremonyFrame(s, e, [0, 0, 5000], 60, 1.6);
      const m = mid(s, e);
      expect(pos[1]).toBeGreaterThan(m[1]); // camera sits above the midpoint
    }
  });

  it("degenerates without NaN when |axis| → 0 (start == end)", () => {
    const p = [800, 120, -600] as V3;
    const { pos } = ceremonyFrame(p, p, [0, 0, 5000], 60, 1.6);
    expect(pos.every((c) => Number.isFinite(c))).toBe(true);
  });

  it("handles an axis parallel to +Y without NaN (cross degenerates)", () => {
    const { pos } = ceremonyFrame([0, 0, 0], [0, 500, 0], [0, 0, 5000], 60, 1.6);
    expect(pos.every((c) => Number.isFinite(c))).toBe(true);
  });

  it("portrait (aspect<1) pulls the camera FARTHER back than landscape (narrower horizontal fov)", () => {
    const s: V3 = [1500, 0, 0], e: V3 = [120, 0, 0], cam: V3 = [0, 0, 5000];
    const m = mid(s, e);
    const land = ceremonyFrame(s, e, cam, 60, 1.6).pos;
    const port = ceremonyFrame(s, e, cam, 60, 0.5).pos;
    expect(len(sub(port, m))).toBeGreaterThan(len(sub(land, m)));
  });

  it("sticky side: inside the end-on dead zone the caller's stickySide wins; outside it does not", () => {
    const s: V3 = [1500, 0, 0], e: V3 = [120, 0, 0];
    const m = mid(s, e);
    // DEAD ZONE: camera nearly END-ON to the streak (toCam ∥ axis ⇒ |dot(perp, toCam)| ≈ 0). Without
    // stickiness the raw sign flips frame-to-frame as the galaxy turns → the desired pos leaps ~2×dist.
    const camOn: V3 = [5000, 100, 20]; // toCam ≈ +X = the axis line → normalized perp-dot ≈ 0.005
    const a = ceremonyFrame(s, e, camOn, 60, 1.6, 1);
    const b = ceremonyFrame(s, e, camOn, 60, 1.6, -1);
    expect(a.side).toBe(1); // sticky side honoured…
    expect(b.side).toBe(-1);
    const offA: V3 = [a.pos[0] - m[0], 0, a.pos[2] - m[2]];
    const offB: V3 = [b.pos[0] - m[0], 0, b.pos[2] - m[2]];
    expect(dot(offA, offB)).toBeLessThan(0); // …and it actually lands on opposite horizontal sides
    // OUTSIDE the dead zone the geometric side wins — stickySide must NOT override it.
    const camSide: V3 = [810, 0, 5000]; // squarely to one side of the streak
    const c = ceremonyFrame(s, e, camSide, 60, 1.6, 1);
    const d = ceremonyFrame(s, e, camSide, 60, 1.6, -1);
    const d0 = ceremonyFrame(s, e, camSide, 60, 1.6, 0);
    expect(c.side).toBe(d.side);
    expect(c.side).toBe(d0.side);
    expect(c.pos).toEqual(d.pos);
    expect(c.pos).toEqual(d0.pos);
  });
});
