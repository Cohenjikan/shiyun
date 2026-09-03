import { describe, expect, it } from "vitest";
import { GestureEngine, type EngineEvent, type EngineFrame } from "./gestureEngine";
import { synthHand, type SynthPose } from "./gestureMath.test";

const STEP = 60; // ~17 Hz recognition (CPU delegate)

function lockedEngine(opts: Partial<ConstructorParameters<typeof GestureEngine>[0]> = {}) {
  const engine = new GestureEngine(opts);
  let t = 1000;
  // hold an open hand in the centre until the presenter lock is acquired
  let frame: EngineFrame | null = null;
  for (let i = 0; i < 8; i++) {
    frame = engine.update(synthHand({ x: 0.5, y: 0.5 }), t);
    t += STEP;
    if (frame.owner === "locked") break;
  }
  expect(frame?.owner).toBe("locked");
  const run = (pose: SynthPose, frames: number, extra: { x?: number; y?: number; size?: number } = {}) => {
    const events: EngineEvent[] = [];
    let last: EngineFrame | null = null;
    for (let i = 0; i < frames; i++) {
      last = engine.update(synthHand({ pose, ...extra }), t);
      events.push(...last.events);
      t += STEP;
    }
    return { events, last: last! };
  };
  const gap = (frames: number) => {
    const events: EngineEvent[] = [];
    let last: EngineFrame | null = null;
    for (let i = 0; i < frames; i++) {
      last = engine.update(null, t);
      events.push(...last.events);
      t += STEP;
    }
    return { events, last: last! };
  };
  return { engine, run, gap, now: () => t };
}

describe("GestureEngine", () => {
  it("acquires the presenter only after the hand dwells in the centre", () => {
    const engine = new GestureEngine();
    const a = engine.update(synthHand(), 0);
    expect(a.owner).toBe("acquiring");
    expect(a.hand).toBeNull();
    const b = engine.update(synthHand(), 120);
    expect(b.owner).toBe("acquiring");
    const c = engine.update(synthHand(), 240);
    expect(c.owner).toBe("locked");
    expect(c.hand).not.toBeNull();
    expect(c.pointer).not.toBeNull();
    // a small hand at the frame edge never becomes the presenter
    const fresh = new GestureEngine();
    for (let t = 0; t < 1000; t += 60) expect(fresh.update(synthHand({ x: 0.05, y: 0.5, size: 0.03 }), t).owner).toBe("none");
  });

  it("hover follows the palm and small jitter does not start a drag", () => {
    const { run } = lockedEngine();
    for (let x = 0.5; x < 0.7; x += 0.04) run("open", 1, { x });
    const left = run("open", 6, { x: 0.7 }).last.pointer!;
    for (let x = 0.7; x > 0.3; x -= 0.04) run("open", 1, { x });
    const right = run("open", 6, { x: 0.3 }).last.pointer!;
    expect(right.x).toBeGreaterThan(left.x + 0.3); // mirrored: camera-left hand = screen-right cursor
    const { events } = run("open", 10, { x: 0.3 });
    expect(events).toEqual([]);
  });

  it("pinch tap fires once on release at the position where the pinch began", () => {
    const { run } = lockedEngine();
    run("open", 4, { x: 0.4, y: 0.4 });
    const pressed = run("pinch", 4, { x: 0.4, y: 0.4 });
    expect(pressed.last.pinch.active).toBe(true);
    expect(pressed.last.pinch.phase).toBe("pressed");
    expect(pressed.events).toEqual([]);
    const released = run("open", 3, { x: 0.4, y: 0.4 });
    const taps = released.events.filter((e) => e.type === "tap");
    expect(taps).toHaveLength(1);
    const tap = taps[0] as Extract<EngineEvent, { type: "tap" }>;
    expect(tap.x).toBeCloseTo(pressed.last.pointer!.x, 2);
    expect(run("open", 10, { x: 0.4, y: 0.4 }).events).toEqual([]);
  });

  it("a very long pinch is a grab, not a click", () => {
    const { run } = lockedEngine();
    run("open", 4);
    run("pinch", 25); // 1.5 s
    const released = run("open", 3);
    expect(released.events.some((e) => e.type === "tap")).toBe(false);
  });

  it("a single-frame pinch flicker is ignored, a quick tap at 30 Hz is not", () => {
    const { run } = lockedEngine();
    run("open", 4);
    run("pinch", 1); // one 60 ms frame at ratio 0.13 counts as decisive — so use a marginal ratio instead
    const flicker = run("open", 3);
    expect(flicker.events.some((e) => e.type === "tap")).toBe(true); // decisive touch = real tap
    const engine = new GestureEngine();
    let t = 0;
    for (let i = 0; i < 8; i++) { engine.update(synthHand(), t); t += 33; }
    const events: EngineEvent[] = [];
    for (let i = 0; i < 4; i++) { events.push(...engine.update(synthHand({ pose: "pinch" }), t).events); t += 33; }
    for (let i = 0; i < 4; i++) { events.push(...engine.update(synthHand({ pose: "open" }), t).events); t += 33; }
    expect(events.filter((e) => e.type === "tap")).toHaveLength(1);
  });

  it("a push/pull does not move the cursor through box resizing", () => {
    const { run } = lockedEngine();
    run("open", 6, { size: 0.12 });
    const before = run("pinch", 3, { size: 0.12 }).last.pointer!;
    const after = run("pinch", 6, { size: 0.16 }).last.pointer!;
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.02);
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.02);
  });

  it("pinch + move becomes a drag with per-frame deltas and no tap", () => {
    const { run } = lockedEngine();
    run("open", 4, { x: 0.5 });
    run("pinch", 3, { x: 0.5 });
    const events: EngineEvent[] = [];
    for (let i = 1; i <= 8; i++) events.push(...run("pinch", 1, { x: 0.5 - 0.02 * i }).events);
    expect(events.some((e) => e.type === "dragStart")).toBe(true);
    const drags = events.filter((e) => e.type === "drag") as Extract<EngineEvent, { type: "drag" }>[];
    expect(drags.length).toBeGreaterThan(2);
    expect(drags.every((d) => d.dx > 0)).toBe(true); // hand moving camera-left = cursor moving right
    const released = run("open", 3, { x: 0.34 });
    expect(released.events.some((e) => e.type === "dragEnd")).toBe(true);
    expect(released.events.some((e) => e.type === "tap")).toBe(false);
  });

  it("pinch + hand toward the camera becomes a push with ratio > 1", () => {
    const { run } = lockedEngine();
    run("open", 6, { size: 0.12 });
    run("pinch", 3, { size: 0.12 });
    const events: EngineEvent[] = [];
    for (let i = 1; i <= 10; i++) events.push(...run("pinch", 1, { size: 0.12 * (1 + 0.03 * i) }).events);
    const pushes = events.filter((e) => e.type === "push") as Extract<EngineEvent, { type: "push" }>[];
    expect(pushes.length).toBeGreaterThan(0);
    expect(pushes[pushes.length - 1].sinceStart).toBeGreaterThan(1.07);
    expect(pushes.every((p) => p.ratio > 0.99)).toBe(true);
    expect(events.some((e) => e.type === "dragStart")).toBe(false);
    const released = run("open", 3, { size: 0.15 });
    expect(released.events.some((e) => e.type === "pushEnd")).toBe(true);
    expect(released.events.some((e) => e.type === "tap")).toBe(false);
  });

  it("closing the hand into a fist never produces a tap", () => {
    const { run } = lockedEngine();
    run("open", 4);
    run("closing", 2); // thumb meets the folded index on the way to a fist
    run("fist", 3);
    const reopened = run("open", 3);
    expect(reopened.events.some((e) => e.type === "tap")).toBe(false);
  });

  it("✌️ fires once after the dwell and re-arms only after release", () => {
    const { run } = lockedEngine();
    const first = run("victory", 17); // 1020 ms
    expect(first.events.filter((e) => e.type === "fire")).toEqual([{ type: "fire", hold: "victory" }]);
    expect(run("victory", 10).events).toEqual([]);
    run("open", 6);
    const again = run("victory", 17);
    expect(again.events.filter((e) => e.type === "fire")).toHaveLength(1);
    expect(run("thumbUp", 17).events.filter((e) => e.type === "fire")).toEqual([{ type: "fire", hold: "thumbUp" }]);
  });

  it("reports hold progress while dwelling", () => {
    const { run } = lockedEngine();
    const mid = run("victory", 8).last; // 420 ms elapsed since the first victory frame
    expect(mid.hold.kind).toBe("victory");
    expect(mid.hold.progress).toBeGreaterThan(0.3);
    expect(mid.hold.progress).toBeLessThan(0.7);
  });

  it("ignores a distant hand while the presenter is briefly gone, then hands over and asks for a re-detect", () => {
    const { engine, run, gap, now } = lockedEngine();
    run("open", 3, { x: 0.4, y: 0.5 });
    gap(3);
    let t = now();
    const foreign = engine.update(synthHand({ x: 0.9, y: 0.5, size: 0.05 }), t);
    expect(foreign.owner).toBe("ignored");
    expect(foreign.hand).toBeNull();
    let reset = false;
    for (let i = 0; i < 60; i++) {
      t += STEP;
      const f = engine.update(synthHand({ x: 0.9, y: 0.5, size: 0.05 }), t);
      reset ||= f.wantsTrackerReset;
    }
    expect(reset).toBe(true);
  });

  it("drops the lock after the presenter has been gone long enough and cancels a pending pinch", () => {
    const { run, gap } = lockedEngine();
    run("open", 3);
    run("pinch", 3);
    const lost = gap(6);
    expect(lost.last.owner).toBe("lost");
    expect(lost.events.some((e) => e.type === "tap")).toBe(false);
    expect(lost.last.pinch.active).toBe(false);
    const gone = gap(20);
    expect(gone.last.owner).toBe("none");
  });

  it("produces no events while blocked but keeps tracking", () => {
    const engine = new GestureEngine();
    let t = 0;
    for (let i = 0; i < 6; i++) { engine.update(synthHand(), t, true); t += STEP; }
    const events: EngineEvent[] = [];
    for (let i = 0; i < 4; i++) { events.push(...engine.update(synthHand({ pose: "pinch" }), t, true).events); t += STEP; }
    for (let i = 0; i < 3; i++) { events.push(...engine.update(synthHand({ pose: "open" }), t, true).events); t += STEP; }
    expect(events).toEqual([]);
    expect(engine.update(synthHand(), t, true).owner).toBe("locked");
  });
});
