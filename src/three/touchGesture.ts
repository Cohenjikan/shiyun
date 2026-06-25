// Pure two-finger gesture math, extracted from FlyControls so it's unit-testable WITHOUT a real
// touchscreen (headless swiftshader can't synthesize multi-touch — a pure helper is the only testable
// surface for the touch-fly/pinch feature). No three.js / DOM imports here.
//
// TWO interaction modes (store.freeMove), so touch users can finally 放大缩小:
//   • FREE-FLY (freeMove=true; desktop default) — a two-finger gesture LOCKS to one mode once its movement
//     crosses a threshold (classifyGesture) so the intents never cross-talk (a one-handed pinch, thumb
//     anchored, drifts the centroid ~half the spread and would otherwise leak thrust):
//       PAN   — centroid displacement off the ORIGIN → analog thrust (joystick: hold to keep flying).
//       PINCH — finger-distance ratio between moves → speed multiplier (pinch out = faster).
//   • GALAXY-LOCK (freeMove=false; touch default) — the camera ORBITS a target (a locked poet/poem, else
//     the whole galaxy at the origin): one-finger drag = yaw/pitch, two-finger pinch = ZOOM (orbit distance,
//     orbitZoom below), tap a star = switch the locked target. (The OLD build had two fingers RELEASE the
//     lock and offered no pinch-zoom of the galaxy — the "只能拖不能放大缩小" complaint.)

export interface Pt {
  x: number;
  y: number;
}

export function centroid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function pinchDistance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Analog thrust from the centroid's displacement off the gesture origin. Returns {z, x} in the SAME
// convention as the WASD keys (z<0 = forward, x>0 = strafe right) so it adds straight into the fly
// vector: pushing both fingers UP (cur.y < origin.y) → z<0 → forward; RIGHT (cur.x > origin.x) → x>0.
// `deadzone` ignores small jitter / pinch leak; `span` is the px displacement that maps to full thrust.
export function thrustFromDrag(
  origin: Pt,
  cur: Pt,
  deadzone = 10,
  span = 120,
): { z: number; x: number } {
  const axis = (d: number) => {
    const past = Math.abs(d) - deadzone;
    if (past <= 0) return 0;
    return Math.max(-1, Math.min(1, (Math.sign(d) * past) / span));
  };
  return { z: axis(cur.y - origin.y), x: axis(cur.x - origin.x) };
}

// Speed-multiplier update from a pinch (free-fly): spreading fingers (curDist > prevDist) → faster.
// Mirrors the wheel's speed role; clamped to the SAME [0.1, 80] range as the wheel handler. The
// `!(x > 0)` guards reject 0, negative AND NaN distances (a degenerate centroid) → never poisons speed.
export function pinchSpeed(
  speedMul: number,
  prevDist: number,
  curDist: number,
  min = 0.1,
  max = 80,
): number {
  if (!(prevDist > 0) || !(curDist > 0)) return speedMul;
  return Math.max(min, Math.min(max, speedMul * (curDist / prevDist)));
}

// Lock a two-finger gesture to ONE mode once its movement passes `threshold` px, so pan and pinch never
// cross-talk. PAN = the centroid drifted further off its origin than the finger-distance changed; PINCH =
// the reverse. Returns null until either signal crosses the threshold (so a still/tiny touch does nothing).
export function classifyGesture(
  origin: Pt,
  cur: Pt,
  startDist: number,
  curDist: number,
  threshold = 16,
): "pan" | "pinch" | null {
  const panDisp = Math.hypot(cur.x - origin.x, cur.y - origin.y);
  const pinchDisp = Math.abs(curDist - startDist);
  if (panDisp < threshold && pinchDisp < threshold) return null;
  return panDisp >= pinchDisp ? "pan" : "pinch";
}

// Galaxy-lock pinch-to-ZOOM: fingers spreading (curDist > prevDist) pull the orbit CLOSER (smaller dist);
// pinching in pushes it away. Clamped to [min, max]. Guards reject 0 / negative / NaN distances (a
// degenerate centroid) → dist unchanged. Mirrors the wheel's orbit-distance role in lock mode.
export function orbitZoom(
  dist: number,
  prevDist: number,
  curDist: number,
  min: number,
  max: number,
): number {
  if (!(prevDist > 0) || !(curDist > 0)) return dist;
  return Math.max(min, Math.min(max, dist * (prevDist / curDist)));
}
