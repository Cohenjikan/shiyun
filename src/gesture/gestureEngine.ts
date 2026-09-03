// The gesture STATE MACHINE — pure, timestamp-driven, DOM-free (unit-tested in gestureEngine.test.ts).
// GestureControls feeds it one recognised hand per frame (numHands = 1) and turns the returned events
// into the app's existing gesture events + cursor DOM writes.
//
// Vocabulary (one hand, identical in both camera modes — only the meaning of drag/zoom changes):
//   hover           any relaxed pose → cursor follows the palm
//   pinch tap       thumb+index touch and release without moving → select at the cursor
//   pinch + drag    → orbit (centre lock) / look around (free move)
//   pinch + push/pull (hand toward / away from the camera) → zoom (centre lock) / fly forward-back
//   ✌️ held 600 ms   → random poet          👍 held 600 ms → random poem
//
// Why pinch: one scalar with hysteresis (see gestureMath.pinchRatio) beats every whole-hand pose label
// for stability, it does not move the palm-based cursor, and it is the convention people already know
// from touch screens (pinch-zoom) and VR/AR hand tracking.

import { OneEuroAxis, OneEuroPoint } from "./oneEuro";
import {
  MIN_OWNER_EXTENT,
  PINCH_ENTER,
  PINCH_EXIT,
  distance2,
  insideAcquireBox,
  isFistPose,
  isOpenPalmPose,
  isThumbUpPose,
  isVictoryPose,
  makeReachBox,
  mapToScreenFraction,
  pinchGuard,
  pinchRatio,
  pinchStrength,
  recentreReachBox,
  type HandSample,
  type Point2,
  type ReachBox,
} from "./gestureMath";

export type OwnerState = "none" | "acquiring" | "locked" | "lost" | "ignored";
export type Pose = "none" | "open" | "point" | "pinch" | "victory" | "thumbUp" | "fist" | "other";
export type HoldKind = "victory" | "thumbUp";
export type PinchPhase = "none" | "pressed" | "dragging" | "pushing";

export type EngineEvent =
  | { type: "tap"; x: number; y: number } // screen fraction where the pinch began
  | { type: "dragStart" }
  | { type: "drag"; dx: number; dy: number } // screen-fraction deltas since the previous frame
  | { type: "dragEnd" }
  | { type: "push"; ratio: number; sinceStart: number } // palm-size ratio vs previous frame / vs pinch start
  | { type: "pushEnd" }
  | { type: "fire"; hold: HoldKind };

export interface Pointer {
  x: number; // screen fraction 0..1 (mirrored so hand-right = cursor-right)
  y: number;
  vx: number; // screen fractions per second, from the last two filtered samples
  vy: number;
  t: number; // timestamp of the sample that produced it
}

export interface EngineFrame {
  owner: OwnerState;
  ownerText: string;
  hand: HandSample | null; // the accepted presenter hand this frame
  pose: Pose;
  pointer: Pointer | null;
  pinch: { active: boolean; strength: number; phase: PinchPhase; moved: number; sinceStart: number };
  hold: { kind: HoldKind | null; progress: number };
  events: EngineEvent[];
  wantsTrackerReset: boolean;
}

export interface EngineOptions {
  acquireMs: number; // hand must sit in the acquire box this long to become the presenter
  lostMs: number; // presenter unseen this long → lock released
  ignoredResetMs: number; // a foreign hand tracked this long while the presenter is gone → ask MediaPipe to re-detect
  pinchEnterMs: number; // ratio must stay under PINCH_ENTER this long (time-based so CPU and GPU rates feel the same)
  pinchExitMs: number; // …and over PINCH_EXIT this long to release
  tapMinMs: number; // shorter pinches are recognition flicker
  tapMaxMs: number; // longer pinches are "grab and hold", not a click
  dragSlop: number; // screen fraction the palm must travel before a pinch becomes a drag
  pushDeadzone: number; // |size/startSize − 1| beyond which a pinch becomes a push/pull
  holdMs: number; // ✌️ / 👍 dwell before they fire (long enough to outlast a photo pose)
  poseDropoutMs: number; // pose may flicker off this long without resetting its hold
  handDropoutMs: number; // pinch survives this long without a hand before it is cancelled
  screenAspect: number; // reach box keeps the screen's aspect so hand motion feels 1:1
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  acquireMs: 200,
  lostMs: 1200,
  ignoredResetMs: 2000,
  pinchEnterMs: 40,
  pinchExitMs: 60,
  tapMinMs: 50,
  tapMaxMs: 900,
  dragSlop: 0.035,
  pushDeadzone: 0.07,
  holdMs: 900,
  poseDropoutMs: 250,
  handDropoutMs: 260,
  screenAspect: 16 / 9,
};

const OWNER_TEXT: Record<OwnerState, string> = {
  none: "等待主控 · 将一只手放到取景框中央",
  acquiring: "正在锁定主控…",
  locked: "主控已锁定",
  lost: "主控暂时丢失 · 正在等待",
  ignored: "主控已锁定 · 忽略背景手",
};

interface OwnerLock {
  state: OwnerState;
  anchor: Point2;
  acquireSince: number | null; // first frame of the current acquisition dwell
  lastSeen: number;
  // a hand has been REPORTED but not accepted (foreign / off-centre / too small) since this time.
  // With numHands = 1 MediaPipe keeps tracking whichever hand it has, so after a while we ask the
  // worker to re-detect, otherwise a visitor's hand at the frame edge could hold the tracker forever.
  rejectedSince: number | null;
}

const emptyOwner = (): OwnerLock => ({ state: "none", anchor: { x: 0.5, y: 0.5 }, acquireSince: null, lastSeen: 0, rejectedSince: null });

interface PinchState {
  active: boolean;
  phase: PinchPhase;
  enterSince: number | null; // first frame under PINCH_ENTER
  exitSince: number | null; // first frame over PINCH_EXIT
  since: number;
  start: Point2; // pointer (screen fraction) at pinch start
  startSize: number;
  prevSize: number;
  moved: number;
  cancelled: boolean;
  dragging: boolean;
  pushing: boolean;
}

interface HoldState {
  kind: HoldKind | null;
  since: number;
  lastSeen: number;
  latched: boolean;
}

export class GestureEngine {
  private readonly opts: EngineOptions;
  private owner: OwnerLock = emptyOwner();
  private readonly palmFilter = new OneEuroPoint({ minCutoff: 1.2, beta: 4, dCutoff: 1 });
  private readonly sizeFilter = new OneEuroAxis({ minCutoff: 0.9, beta: 0.8, dCutoff: 1 });
  private pointer: Pointer | null = null;
  private box: ReachBox | null = null;
  private boxFrozen = false; // while pinching: a push/pull must not resize the box under the cursor
  private pinch: PinchState = GestureEngine.emptyPinch();
  private hold: HoldState = { kind: null, since: 0, lastSeen: 0, latched: false };

  constructor(options: Partial<EngineOptions> = {}) {
    this.opts = { ...DEFAULT_ENGINE_OPTIONS, ...options };
  }

  private static emptyPinch(): PinchState {
    return {
      active: false, phase: "none", enterSince: null, exitSince: null, since: 0,
      start: { x: 0.5, y: 0.5 }, startSize: 0.1, prevSize: 0.1, moved: 0, cancelled: false, dragging: false, pushing: false,
    };
  }

  reset(): void {
    this.owner = emptyOwner();
    this.palmFilter.reset();
    this.sizeFilter.reset();
    this.pointer = null;
    this.box = null;
    this.boxFrozen = false;
    this.pinch = GestureEngine.emptyPinch();
    this.hold = { kind: null, since: 0, lastSeen: 0, latched: false };
  }

  get reachBox(): ReachBox | null {
    return this.box;
  }

  get locked(): boolean {
    return this.owner.state === "locked" || this.owner.state === "lost" || this.owner.state === "ignored";
  }

  // `hand` is the single hand MediaPipe reported (or null). `blocked` = another input source (mouse,
  // keyboard, cinema) currently owns the app: tracking continues but no events are produced.
  update(hand: HandSample | null, now: number, blocked = false): EngineFrame {
    const events: EngineEvent[] = [];
    const accepted = this.resolveOwner(hand, now);
    let wantsTrackerReset = false;
    const o = this.owner;
    if (hand && !accepted && o.state !== "acquiring") {
      if (o.rejectedSince === null) o.rejectedSince = now;
      else if (now - o.rejectedSince > this.opts.ignoredResetMs) {
        wantsTrackerReset = true;
        o.rejectedSince = now; // ask once per window
      }
    } else {
      o.rejectedSince = null;
    }

    if (!accepted) {
      // Keep the last pointer briefly so a pinch release that loses tracking for a frame still lands.
      this.releasePinchIfStale(now, events);
      this.decayHold(now);
      return this.frame(null, "none", events, wantsTrackerReset);
    }

    // ── pointer: filter the palm in camera units, then map through the palm-scaled reach box ──
    const filtered = this.palmFilter.filter(accepted.palm.x, accepted.palm.y, now);
    const size = this.sizeFilter.filter(accepted.size, now);
    const prev = this.pointer;
    const dt = prev ? Math.max(0.008, (now - prev.t) / 1000) : 0;
    if (!this.box) this.box = makeReachBox(filtered, size, undefined, this.opts.screenAspect);
    else if (!this.boxFrozen) {
      // follow the (slowly filtered) palm size so the sweep stays ~70 cm at any distance
      const resized = makeReachBox(this.box.anchor, size, undefined, this.opts.screenAspect);
      this.box = recentreReachBox(resized, filtered, dt || 0);
    }
    const mapped = mapToScreenFraction(this.box, filtered);
    this.pointer = {
      x: mapped.x,
      y: mapped.y,
      vx: prev && dt ? (mapped.x - prev.x) / dt : 0,
      vy: prev && dt ? (mapped.y - prev.y) / dt : 0,
      t: now,
    };

    // ── pose ──
    const ratio = pinchRatio(accepted);
    const guard = pinchGuard(accepted);
    const pose = this.updatePinch(accepted, ratio, guard, size, prev, now, blocked, events);
    this.updateHold(accepted, pose, now, blocked, events);
    return this.frame(accepted, pose, events, wantsTrackerReset);
  }

  private frame(hand: HandSample | null, pose: Pose, events: EngineEvent[], wantsTrackerReset: boolean): EngineFrame {
    const p = this.pinch;
    return {
      owner: this.owner.state,
      ownerText: OWNER_TEXT[this.owner.state],
      hand,
      pose,
      pointer: this.pointer,
      pinch: {
        active: p.active,
        strength: hand ? pinchStrength(pinchRatio(hand)) : 0,
        phase: p.phase,
        moved: p.moved,
        sinceStart: p.active && p.startSize > 0 ? p.prevSize / p.startSize : 1,
      },
      hold: {
        kind: this.hold.kind,
        progress: this.hold.kind ? Math.min(1, (this.hold.lastSeen - this.hold.since) / this.opts.holdMs) : 0,
      },
      events,
      wantsTrackerReset,
    };
  }

  // ── presenter lock ───────────────────────────────────────────────────────────────────────────
  private resolveOwner(hand: HandSample | null, now: number): HandSample | null {
    const o = this.owner;
    if (!hand) {
      if (this.locked) {
        if (now - o.lastSeen > this.opts.lostMs) {
          this.unlock();
        } else {
          o.state = "lost";
        }
      } else {
        o.state = "none";
        o.acquireSince = null;
      }
      return null;
    }

    const qualifies = insideAcquireBox(hand.center) && hand.extent >= MIN_OWNER_EXTENT;
    if (!this.locked) {
      if (!qualifies) {
        o.state = "none";
        o.acquireSince = null;
        return null;
      }
      if (o.acquireSince === null) o.acquireSince = now;
      if (now - o.acquireSince < this.opts.acquireMs) {
        o.state = "acquiring";
        return null;
      }
      o.state = "locked";
      o.anchor = hand.center;
      o.lastSeen = now;
      return hand;
    }

    // Locked: accept by continuity with the last accepted position. A hand that appears far away is
    // someone else's until the presenter has been gone long enough for the lock to expire.
    const d = distance2(hand.center, o.anchor);
    const gone = now - o.lastSeen;
    const continuous = d < 0.3 || (gone > 400 && d < 0.5) || (gone > this.opts.lostMs * 0.75 && qualifies);
    if (!continuous) {
      o.state = "ignored";
      if (gone > this.opts.lostMs) this.unlock();
      return null;
    }
    o.state = "locked";
    o.anchor = hand.center;
    o.lastSeen = now;
    return hand;
  }

  private unlock(): void {
    const rejectedSince = this.owner.rejectedSince;
    this.owner = emptyOwner();
    this.owner.rejectedSince = rejectedSince;
    this.palmFilter.reset();
    this.sizeFilter.reset();
    this.pointer = null;
    this.box = null;
    this.boxFrozen = false;
  }

  // ── pinch ────────────────────────────────────────────────────────────────────────────────────
  private updatePinch(
    hand: HandSample,
    ratio: number,
    guard: boolean,
    size: number,
    prevPointer: Pointer | null,
    now: number,
    blocked: boolean,
    events: EngineEvent[],
  ): Pose {
    const p = this.pinch;
    const pointer = this.pointer!;

    if (!p.active) {
      // Enter: one decisive frame (tips clearly touching) or the ratio staying under the threshold for
      // pinchEnterMs — time-based, so a quick visitor tap registers at 17 Hz (CPU) and 30 Hz (GPU) alike.
      const under = guard && ratio < PINCH_ENTER;
      if (!under) p.enterSince = null;
      else if (p.enterSince === null) p.enterSince = now;
      const decisive = guard && ratio < PINCH_ENTER - 0.08;
      const confirmed = p.enterSince !== null && now - p.enterSince >= this.opts.pinchEnterMs;
      if (!blocked && (decisive || confirmed)) {
        p.active = true;
        p.phase = "pressed";
        p.since = p.enterSince ?? now;
        p.start = { x: pointer.x, y: pointer.y };
        p.startSize = size;
        p.prevSize = size;
        p.moved = 0;
        p.cancelled = false;
        p.dragging = false;
        p.pushing = false;
        p.exitSince = null;
        p.enterSince = null;
        this.boxFrozen = true;
        return "pinch";
      }
      return this.staticPose(hand);
    }

    // Active. Exit on a failed guard (the hand is closing into a fist — never a click), on the ratio
    // staying above the exit threshold for pinchExitMs, or on the caller blocking us.
    if (!guard) {
      p.cancelled = true;
      this.endPinch(now, events);
      return this.staticPose(hand);
    }
    if (ratio <= PINCH_EXIT) p.exitSince = null;
    else if (p.exitSince === null) p.exitSince = now;
    if ((p.exitSince !== null && now - p.exitSince >= this.opts.pinchExitMs) || blocked) {
      if (blocked) p.cancelled = true;
      this.endPinch(now, events);
      return this.staticPose(hand);
    }

    // Still pinched: movement → drag, palm growing/shrinking → push/pull. Both may run at once.
    p.moved = Math.max(p.moved, distance2(pointer, p.start));
    if (!p.dragging && p.moved > this.opts.dragSlop) {
      p.dragging = true;
      events.push({ type: "dragStart" });
    }
    if (p.dragging && prevPointer) {
      const dx = pointer.x - prevPointer.x;
      const dy = pointer.y - prevPointer.y;
      if (dx || dy) events.push({ type: "drag", dx, dy });
    }
    const sinceStart = p.startSize > 0 ? size / p.startSize : 1;
    if (!p.pushing && Math.abs(sinceStart - 1) > this.opts.pushDeadzone) p.pushing = true;
    if (p.pushing) {
      const frameRatio = p.prevSize > 0 ? size / p.prevSize : 1;
      events.push({ type: "push", ratio: frameRatio, sinceStart });
    }
    p.prevSize = size;
    p.phase = p.dragging ? "dragging" : p.pushing ? "pushing" : "pressed";
    return "pinch";
  }

  private endPinch(now: number, events: EngineEvent[]): void {
    const p = this.pinch;
    if (!p.active) return;
    const duration = now - p.since;
    if (p.dragging) events.push({ type: "dragEnd" });
    if (p.pushing) events.push({ type: "pushEnd" });
    const tap = !p.cancelled && !p.dragging && !p.pushing && duration >= this.opts.tapMinMs && duration <= this.opts.tapMaxMs;
    if (tap) events.push({ type: "tap", x: p.start.x, y: p.start.y });
    this.pinch = GestureEngine.emptyPinch();
    this.boxFrozen = false;
  }

  private releasePinchIfStale(now: number, events: EngineEvent[]): void {
    const p = this.pinch;
    if (!p.active) return;
    const lastSeen = this.pointer?.t ?? p.since;
    if (now - lastSeen > this.opts.handDropoutMs) {
      p.cancelled = true;
      this.endPinch(now, events);
    }
  }

  private staticPose(hand: HandSample): Pose {
    if (isVictoryPose(hand)) return "victory";
    if (isThumbUpPose(hand)) return "thumbUp";
    if (isFistPose(hand)) return "fist";
    if (isOpenPalmPose(hand)) return "open";
    return "point";
  }

  // ── ✌️ / 👍 dwell triggers ─────────────────────────────────────────────────────────────────────
  private updateHold(hand: HandSample, pose: Pose, now: number, blocked: boolean, events: EngineEvent[]): void {
    const kind: HoldKind | null = pose === "victory" ? "victory" : pose === "thumbUp" ? "thumbUp" : null;
    const h = this.hold;
    if (!kind || blocked) {
      this.decayHold(now);
      return;
    }
    if (h.kind !== kind) {
      h.kind = kind;
      h.since = now;
      h.latched = false;
    }
    h.lastSeen = now;
    if (!h.latched && now - h.since >= this.opts.holdMs) {
      h.latched = true;
      events.push({ type: "fire", hold: kind });
    }
    void hand;
  }

  private decayHold(now: number): void {
    const h = this.hold;
    if (h.kind && now - h.lastSeen > this.opts.poseDropoutMs) {
      h.kind = null;
      h.since = 0;
      h.latched = false;
    }
  }
}
