// Deterministic meteor trajectories for 认领 (claimed poems). PURE geometry (no GPU/React/clock) so it's
// unit-testable and so the SAME claim always streaks the SAME way (stable as the galaxy turns — callers
// apply the shared spinXZ to reach world space, like positions.ts / PulledStars).
//
// Design (per owner feedback): an AMBIENT meteor (someone else's claim) must NOT read as a spaceship
// crossing the galaxy — it's "天上一颗若隐若现的星星闪了一下,银河里微不足道但可被注意到". So it sits IN the
// disk and travels only a SHORT streak; the drama is in the brightness envelope (flash → faint thin line),
// done in the renderer, not in a long path. The CEREMONY (the claimer's OWN poem) keeps the 奔赴感: it
// plunges from where the poem was just located toward the galactic heart.
import { GALAXY } from "./galaxyParams";

export type V3 = [number, number, number];

export const METEOR = {
  DISK_R_MIN: GALAXY.RADIUS * 0.28, // ambient meteors live within the luminous disk…
  DISK_R_MAX: GALAXY.RADIUS * 0.95,
  DISK_Y: GALAXY.RADIUS * 0.05, // …in a thin slab near the galactic plane
  STREAK_LEN: GALAXY.RADIUS * 0.18, // SHORT travel — a glimpsed streak, not a crossing (kills "spaceship")
  CENTRIPETAL: 0.12, // ambient streak's slight inward lean (≤15%) so it also drifts toward the heart
  JITTER_DEG: 10, // ±per-index angular jitter on the tangent (avoid a too-mechanical look)
  CEREMONY_END_R: GALAXY.RADIUS * 0.08, // the claimer's poem plunges to near the core
};

/** FNV-1a → unsigned 32-bit hash of a (decimal) string. Stable across runs/platforms. */
export function hashU32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const frac = (h: number, shift: number) => ((h >>> shift) & 0xffff) / 0x10000;

/** A deterministic point inside the luminous disk, near the plane (where an ambient meteor appears). */
function diskPoint(index: string): V3 {
  const h = hashU32(index + "~p");
  const az = frac(h, 0) * Math.PI * 2;
  const rr = METEOR.DISK_R_MIN + (METEOR.DISK_R_MAX - METEOR.DISK_R_MIN) * frac(h, 16);
  const y = (frac(hashU32(index + "~y"), 0) * 2 - 1) * METEOR.DISK_Y;
  return [Math.cos(az) * rr, y, Math.sin(az) * rr];
}

export interface MeteorTrajectory {
  start: V3; // LOCAL galaxy frame
  end: V3; // LOCAL galaxy frame
}

/**
 * Ambient meteor for a known claim: appears at a point in the disk and streaks a SHORT distance ALONG the
 * galactic rotation (tangentially, hugging the plane) — not a random azimuth that flew radially outward.
 *
 * Direction: spinXZ == makeRotationY(galaxySpin.angle), so the orbital forward direction of a fixed LOCAL
 * point is d/dangle at angle 0 = (z, 0, -x) — the tangent. We lean it slightly inward (CENTRIPETAL, so it
 * also drifts toward the heart / "没入银河") and add a small per-index angular jitter (avoid a mechanical
 * look), keep |y|≈0, then normalize. Sign self-check: if meteors run AGAINST the visible spin on 5199,
 * flip the tangent to [-z, 0, x].
 */
export function ambientPath(index: string): MeteorTrajectory {
  const start = diskPoint(index);
  const x = start[0], z = start[2];
  const rl = Math.hypot(x, z) || 1;
  // orbital tangent (LOCAL): (z, -x); + a slight centripetal (inward) lean
  let dx = z / rl + (-x / rl) * METEOR.CENTRIPETAL;
  let dz = -x / rl + (-z / rl) * METEOR.CENTRIPETAL;
  // ±JITTER_DEG per-index rotation about Y (deterministic)
  const h = hashU32(index + "~d");
  const j = (frac(h, 0) * 2 - 1) * ((METEOR.JITTER_DEG * Math.PI) / 180);
  const cj = Math.cos(j), sj = Math.sin(j);
  const rx = dx * cj - dz * sj;
  const rz = dx * sj + dz * cj;
  // hug the plane (a tiny y wobble), then normalize the full 3D direction
  const yj = (frac(h, 16) * 2 - 1) * 0.04;
  const m = Math.hypot(rx, yj, rz) || 1;
  const d: V3 = [rx / m, yj / m, rz / m];
  const L = METEOR.STREAK_LEN;
  return { start, end: [start[0] + d[0] * L, start[1] + d[1] * L, start[2] + d[2] * L] };
}

/**
 * Ceremony meteor for the claimer's OWN poem: it was just LOCATED at `from`, so the streak launches from
 * exactly there and plunges toward the galactic heart — the 奔赴感 the owner asked to keep for the
 * claimant alone. Falls back to an ambient path if `from` is degenerate (at the origin).
 */
export function ceremonyPath(from: V3, index: string): MeteorTrajectory {
  const m = Math.hypot(from[0], from[1], from[2]);
  if (m < 1e-3) return ambientPath(index);
  const k = METEOR.CEREMONY_END_R / m;
  return { start: from, end: [from[0] * k, from[1] * k * 0.5, from[2] * k] };
}

/**
 * 仪式流星的时间重映射(纯函数,无状态):把 raw 生命进度 u∈[0,1] 映射为**路程进度**∈[0,1]。
 * 匀速 lerp(根因②)让爆发感被稀释——亮度 flash 吃 raw u,高潮却落在几乎没动的起步瞬间。重映射后位移
 * 是「蓄力→奔赴→余韵」三段:前段近乎悬停(flash 最亮时正好蓄力,彗尾自然缩成亮点),中段瞬时速度冲峰
 * (彗尾被速度自然拉长——速度驱动尾长,免费的物理正确),末段减速滑入落点(彗尾自然收缩)。
 *
 * 形状 = 前段偏斜 + smootherstep:pow(u,1.5) 把陡峭段推后并加剧,再过五次 smootherstep(两端零导数)。
 * 两者都单调增 ⇒ 复合单调;端点 pow/S 都保 0→0、1→1。参数/曲线可微调,**meteorPath.test.ts 是形状契约**。
 */
export function ceremonyRemap(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u; // clamp: delay 段(u<0)与越界都夹到端点
  const s = Math.pow(x, 1.5); // 前段偏斜:蓄力更久、奔赴更猛
  return s * s * s * (s * (s * 6 - 15) + 10); // smootherstep(两端速度→0 ⇒ 起步悬停、落点滑入)
}
