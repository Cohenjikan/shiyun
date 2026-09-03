import { describe, expect, it } from "vitest";
import { OneEuroAxis } from "./oneEuro";

describe("OneEuroAxis", () => {
  it("smooths small jitter around a resting value", () => {
    const f = new OneEuroAxis({ minCutoff: 1.2, beta: 4, dCutoff: 1 });
    let t = 0;
    f.filter(0.5, t);
    let maxDev = 0;
    for (let i = 1; i <= 60; i++) {
      t += 60; // ~17 Hz recognition
      const noisy = 0.5 + (i % 2 ? 0.004 : -0.004); // ±0.4 % of the frame, typical landmark jitter
      const out = f.filter(noisy, t);
      maxDev = Math.max(maxDev, Math.abs(out - 0.5));
    }
    expect(maxDev).toBeLessThan(0.0015);
  });

  it("follows a fast sweep with little lag", () => {
    const f = new OneEuroAxis({ minCutoff: 1.2, beta: 4, dCutoff: 1 });
    let t = 0;
    f.filter(0.2, t);
    let out = 0.2;
    // 0.6 of the frame in 300 ms = 2 units/s
    for (let i = 1; i <= 5; i++) {
      t += 60;
      out = f.filter(0.2 + 0.12 * i, t);
    }
    // true position is 0.8; a plain 1.2 Hz low-pass would lag far behind
    expect(out).toBeGreaterThan(0.7);
  });

  it("resets cleanly and tolerates non-increasing timestamps", () => {
    const f = new OneEuroAxis({ minCutoff: 1.2, beta: 4, dCutoff: 1 });
    expect(f.filter(0.3, 100)).toBe(0.3);
    expect(f.filter(0.9, 100)).toBe(0.9); // same timestamp → re-seed, no division by zero
    f.reset();
    expect(f.value).toBeNull();
    expect(f.filter(0.1, 50)).toBe(0.1);
  });
});
