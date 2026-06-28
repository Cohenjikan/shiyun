import { describe, it, expect } from "vitest";
import { ambientPath, ceremonyPath, hashU32, METEOR, type V3 } from "./meteorPath";

const mag = (v: V3) => Math.hypot(v[0], v[1], v[2]);
const planarR = (v: V3) => Math.hypot(v[0], v[2]);
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("meteorPath — deterministic claim trajectories", () => {
  it("hashU32 is stable and well-distributed for distinct strings", () => {
    expect(hashU32("123")).toBe(hashU32("123"));
    expect(hashU32("123")).not.toBe(hashU32("124"));
  });

  it("ambientPath is deterministic per index", () => {
    expect(ambientPath("99887766")).toEqual(ambientPath("99887766"));
  });

  it("ambient meteors appear INSIDE the luminous disk, near the plane", () => {
    for (const idx of ["1", "42", "7777", "918273645", "555", "1000000000007"]) {
      const { start } = ambientPath(idx);
      const r = planarR(start);
      expect(r).toBeGreaterThanOrEqual(METEOR.DISK_R_MIN - 1e-6);
      expect(r).toBeLessThanOrEqual(METEOR.DISK_R_MAX + 1e-6);
      expect(Math.abs(start[1])).toBeLessThanOrEqual(METEOR.DISK_Y + 1e-6); // thin slab
    }
  });

  it("ambient travel is a SHORT streak (not a galaxy crossing)", () => {
    const { start, end } = ambientPath("123456789");
    expect(dist(start, end)).toBeCloseTo(METEOR.STREAK_LEN, 3); // |dir| == 1 ⇒ exactly STREAK_LEN
    expect(METEOR.STREAK_LEN).toBeLessThan(GALAXY_RADIUS()); // sanity: well under the galaxy radius
  });

  it("different indices generally appear in different places", () => {
    expect(ambientPath("1000000000000").start).not.toEqual(ambientPath("1000000000001").start);
  });

  it("ambient direction follows the galactic rotation: tangential (⊥ radial), same sign as the [z,-x] tangent", () => {
    for (const idx of ["1", "42", "7777", "918273645", "555", "1000000000007", "2718281828", "314159"]) {
      const { start, end } = ambientPath(idx);
      const dx = end[0] - start[0], dz = end[2] - start[2];
      const dl = Math.hypot(dx, dz) || 1;
      const ux = dx / dl, uz = dz / dl; // unit streak direction in the disk plane
      const rl = Math.hypot(start[0], start[2]) || 1;
      const rx = start[0] / rl, rz = start[2] / rl; // unit radial (outward)
      // tangential ⇒ nearly perpendicular to radial (small inward lean + jitter keep |dot| modest)
      expect(Math.abs(ux * rx + uz * rz)).toBeLessThan(0.35);
      // same sign as the chosen orbital tangent [z, -x] (顺公转), and strongly aligned with it
      const tx = start[2] / rl, tz = -start[0] / rl; // unit tangent
      expect(ux * tx + uz * tz).toBeGreaterThan(0.85);
    }
  });

  it("ceremonyPath launches from the located point and plunges toward the heart (the 奔赴感)", () => {
    const from: V3 = [800, 120, -600];
    const { start, end } = ceremonyPath(from, "42");
    expect(start).toEqual(from); // starts exactly where the poem was located
    expect(mag(end)).toBeLessThanOrEqual(METEOR.CEREMONY_END_R + 1e-6); // ends near (just shy of) the core
    expect(mag(end)).toBeGreaterThan(METEOR.CEREMONY_END_R * 0.9);
    expect(Math.sign(end[0])).toBe(Math.sign(from[0])); // along the same ray inward
    expect(Math.sign(end[2])).toBe(Math.sign(from[2]));
  });

  it("ceremonyPath falls back to an ambient path when launched from the origin", () => {
    expect(ceremonyPath([0, 0, 0], "42")).toEqual(ambientPath("42"));
  });
});

// STREAK_LEN is defined as GALAXY.RADIUS * 0.18; recover RADIUS for the sanity bound without importing it.
function GALAXY_RADIUS() {
  return METEOR.STREAK_LEN / 0.18;
}
