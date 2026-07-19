// Shared mutable singleton for the CEREMONY camera hand-off: the
// render layer (three/Meteors.tsx) writes the live ceremony streak's WORLD geometry here each frame, and
// FlyControls reads it in useFrame to fly a hero-frame that plunges WITH the claimer's own streak toward the
// heart (fixes 根因①: the camera used to lock onto the streak's START and never followed the plunge).
//
// FRAME CONVENTION — RED LINE: everything in `ceremonyCam` is already WORLD space (Meteors applies toWorld /
// spinXZ before writing). FlyControls uses these coordinates DIRECTLY and MUST NOT spin them again — this is
// the OPPOSITE of flyTarget (which is LOCAL and gets spinXZ'd in FlyControls). Double-spinning would send the
// camera to a ghost location that drifts as the galaxy turns.
import { GALAXY } from "./galaxyParams";

export type V3 = [number, number, number];

export const ceremonyCam = {
  active: false,
  id: -1, // matches claimCeremony.id; on back-to-back claims, follow the newest (larger id)
  head: [0, 0, 0] as V3, // WORLD — the streak head this frame (camera lookAt target)
  start: [0, 0, 0] as V3, // WORLD — refreshed every frame (the galaxy is turning)
  end: [0, 0, 0] as V3, // WORLD
  u: 0, // raw life progress (<0 = pre-launch delay段, head parked at start so the camera pre-frames)
  cancelled: false, // set true by FlyControls when the user grabs control; we never re-grab this ceremony
};

// ── per-call scratch (module-level so the per-frame math allocates only the tiny returned V3, not 4 temps) ──
const _mid: V3 = [0, 0, 0];
const _axis: V3 = [0, 0, 0];
const _perp: V3 = [0, 0, 0];
const _off: V3 = [0, 0, 0];
const CLAMP_MIN = 60; // never glue the camera to the streak's face
const CLAMP_MAX = GALAXY.RADIUS * 1.5; // never fall out past the galaxy on the far side
const SIDE_DEAD_ZONE = 0.15; // |normalized perp·toCam| below this = camera near END-ON to the streak, where
// "which side" is ill-defined and the galaxy's spin flips the raw sign frame-to-frame (the desired pos would
// leap ~2×dist, visible as a lurch). A caller-held sticky side wins inside this zone.

/**
 * Pure hero-frame for a ceremony streak `start→end` (both WORLD), given the camera's CURRENT position (to
 * choose the near side), the camera's VERTICAL fov (deg) and viewport aspect. Returns the desired camera
 * position — a top-down 俯冲 arc that keeps BOTH endpoints in frame — plus the chosen `side` (relative to the
 * base perp = axis × +Y): a per-frame caller passes LAST frame's side back as `stickySide` so the choice can't
 * oscillate in the end-on dead zone (0 = no preference, first call / new ceremony). Returns a FRESH V3 (a
 * ceremony is a rare, seconds-long event, so one small array per frame is negligible — and it avoids a
 * shared-buffer footgun for callers that compare two results). `ceremonyCam.test.ts` is the contract
 * (both-endpoints-in-frame / same-side / sticky-side / portrait-farther / degenerate-safe) — the constants may
 * be tuned as long as the tests hold.
 */
export function ceremonyFrame(
  start: V3,
  end: V3,
  camPos: V3,
  fovDeg: number,
  aspect: number,
  stickySide: -1 | 0 | 1 = 0,
): { pos: V3; side: -1 | 1 } {
  _mid[0] = (start[0] + end[0]) * 0.5;
  _mid[1] = (start[1] + end[1]) * 0.5;
  _mid[2] = (start[2] + end[2]) * 0.5;
  _axis[0] = end[0] - start[0];
  _axis[1] = end[1] - start[1];
  _axis[2] = end[2] - start[2];
  const aLen = Math.hypot(_axis[0], _axis[1], _axis[2]) || 1e-6;
  // perp ⊥ axis, in the horizontal plane (axis × +Y). If axis ∥ Y (cross ≈ 0), fall back to axis × +X.
  _perp[0] = _axis[1] * 0 - _axis[2] * 1; // (axis × Y).x = ay*0 - az*1
  _perp[1] = _axis[2] * 0 - _axis[0] * 0; // = 0
  _perp[2] = _axis[0] * 1 - _axis[1] * 0; // (axis × Y).z = ax*1 - ay*0
  let pl = Math.hypot(_perp[0], _perp[1], _perp[2]);
  if (pl < 1e-6) {
    // axis parallel to Y → use axis × +X = (0, az, -ay)
    _perp[0] = 0; _perp[1] = _axis[2]; _perp[2] = -_axis[1];
    pl = Math.hypot(_perp[0], _perp[1], _perp[2]) || 1;
  }
  _perp[0] /= pl; _perp[1] /= pl; _perp[2] /= pl;
  // choose the perp side nearer the camera (so the camera doesn't swing to the far side of the streak).
  // d = normalized perp·toCam; inside the end-on dead zone (|d| tiny) the caller's sticky side wins so the
  // choice can't flip frame-to-frame; outside it the geometry decides (sticky must NOT override a clear side).
  const tcx = camPos[0] - _mid[0], tcy = camPos[1] - _mid[1], tcz = camPos[2] - _mid[2];
  const tcl = Math.hypot(tcx, tcy, tcz) || 1;
  const d = (_perp[0] * tcx + _perp[1] * tcy + _perp[2] * tcz) / tcl;
  const side: -1 | 1 = stickySide !== 0 && Math.abs(d) < SIDE_DEAD_ZONE ? stickySide : d >= 0 ? 1 : -1;
  _perp[0] *= side; _perp[1] *= side; _perp[2] *= side;
  // lift into a top-down 俯冲 arc: add +Y to the (horizontal) perp, then normalize → offset DIRECTION
  _off[0] = _perp[0]; _off[1] = _perp[1] + 0.32; _off[2] = _perp[2];
  const ol = Math.hypot(_off[0], _off[1], _off[2]) || 1;
  _off[0] /= ol; _off[1] /= ol; _off[2] /= ol;
  // distance to fit the streak's half-length at the (fov-limited) framing. Portrait (aspect<1) has a NARROWER
  // horizontal fov, so fit to the horizontal fov → farther back. ×1.30 = safety margin so the lift-tilt keeps
  // both endpoints inside fov/2×0.9 (see test). clamp so we never glue-to-face nor punch through the far side.
  const fovRad = (fovDeg * Math.PI) / 180;
  const fitRad = aspect < 1 ? 2 * Math.atan(Math.tan(fovRad / 2) * aspect) : fovRad;
  let dist = ((aLen / 2) / Math.tan(fitRad / 2)) * 1.3;
  dist = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, dist));
  return { pos: [_mid[0] + _off[0] * dist, _mid[1] + _off[1] * dist, _mid[2] + _off[2] * dist], side };
}
