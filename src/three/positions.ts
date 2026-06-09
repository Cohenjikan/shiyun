// Deterministic galaxy-space positions for poets AND their poems. Pure functions (no GPU/React),
// shared by the render layers (PoetStars / PoemOrbits), the panels (locate-to-planet), and search,
// so a poem's "planet" is at the SAME spot wherever it's referenced. All positions are in the LOCAL
// galaxy frame (callers apply the shared spinXZ to get world coords).
import { DYNASTY_BY_KEY, DYNASTIES, DYNASTY_COUNT, bandRadius, hashStr, R_MIN, R_MAX } from "../data/dynasties";
import type { PoetRow } from "../data/load";
import { GALAXY, gauss3, poemClock } from "./galaxyParams";

// Mean radius = dynasty shell (time = depth) with a GAUSSIAN radial spread that BLEEDS into
// neighbouring dynasty bands (colours blend into a gradient, not hard rings); angle is biased onto
// the spiral arms (same arms as the backdrop). Y uses a thicker gaussian that swells toward the
// centre (bulge). Near the core a strong azimuthal + in-plane scatter dissolves the 4-arm cross into
// a filled round disc (round-5 feedback).
export function poetPosition(p: PoetRow): [number, number, number] {
  const dyn = DYNASTY_BY_KEY[p.dynasty] ?? DYNASTIES[DYNASTY_COUNT - 1];
  const [inner, outer] = bandRadius(dyn.id);
  const h = hashStr(p.id + p.name);
  const center = (inner + outer) / 2;
  const width = outer - inner;
  const ra = ((h >>> 2) & 0xff) / 255, rb = ((h >>> 10) & 0xff) / 255, rc = ((h >>> 18) & 0xff) / 255;
  let rr = center + gauss3(ra, rb, rc) * width * 1.5; // σ ≈ 1 band → adjacent dynasty colours blend
  rr = Math.max(R_MIN * 0.35, Math.min(R_MAX * 1.06, rr));
  const t = rr / GALAXY.RADIUS;
  const branch = ((h % GALAXY.BRANCHES) / GALAXY.BRANCHES) * Math.PI * 2;
  const twist = t * GALAXY.TWIST;
  const a = ((h >>> 3) & 0xff) / 255, b = ((h >>> 11) & 0xff) / 255, cc = ((h >>> 19) & 0xff) / 255;
  // tight arm σ → poets concentrate ONTO the same 4 spiral arms as the backdrop (woven in,
  // not a separate ring layer); the dynasty colour then reads as a gradient ALONG the arms.
  const armDev = gauss3(a, b, cc) * GALAXY.ARM_SPREAD * 0.45;
  // Wider, stronger azimuthal dissolve: full random angle over the whole core out to t≈0.5
  // (was 0.42) so the 4-arm X is gone and the centre reads as a filled round disc, not a cross.
  const az = ((h >>> 24) & 0xff) / 255;
  const centerBlur = Math.max(0, 0.5 - t) / 0.5; // 1 at core → 0 by t=0.5
  const ang = branch + twist + armDev + (az - 0.5) * Math.PI * 2 * centerBlur;
  const ya = ((h >>> 5) & 0xff) / 255, yb = ((h >>> 13) & 0xff) / 255, yc = ((h >>> 21) & 0xff) / 255;
  const bulge = 1 + Math.max(0, 0.45 - t) * 2.6; // taller near the centre, thin at the rim
  const y = gauss3(ya, yb, yc) * rr * GALAXY.THICKNESS * 2.1 * bulge;
  // in-plane x/z scatter (like the backdrop's `scatter`): gives each arm real width so the
  // poet layer is a volumetric ribbon, NOT a thin sheet that reads as a wall edge-on.
  const h2 = hashStr(p.name + "#" + p.id);
  const sxu = ((h2 >>> 2) & 0xff) / 255, sxs = ((h2 >>> 10) & 0xff) / 255;
  const szu = ((h2 >>> 18) & 0xff) / 255, szs = ((h2 >>> 26) & 0xff) / 255;
  const scat = (u: number, sgn: number) => Math.pow(u, 2.2) * (sgn < 0.5 ? -1 : 1) * 0.22 * rr;
  // The rr-scaled scatter shrinks to ~0 near the centre. Add a strong ABSOLUTE in-plane x/z scatter
  // that peaks at the core and fades by t≈0.5, dissolving the centre into a diffuse round cloud.
  const cs = Math.max(0, 0.5 - t) / 0.5; // 1 at core → 0 by t=0.5 (wider band)
  const coreScat = cs * cs * GALAXY.RADIUS * 0.22; // ~1.5× the round-4 fill radius
  const cjx = (((h2 >>> 5) & 0xff) / 255 - 0.5) * 2;
  const cjz = (((h2 >>> 13) & 0xff) / 255 - 0.5) * 2;
  return [
    Math.cos(ang) * rr + scat(sxu, sxs) + cjx * coreScat,
    y,
    Math.sin(ang) * rr + scat(szu, szs) + cjz * coreScat,
  ];
}

// ── Poems as a big, irregular, rotating 3D star-cluster around their poet ────────────────────────
// A poem at index `poemIdx` of poet `p` sits in a LARGE, irregular cloud around the poet star — not a
// flat disc (read as tiled blocks) and not a uniform ball (read as too even/dense). Directions use a
// spherical-Fibonacci spread; the radius is a clumpy power-law with WIDE jitter (sparse halo, dense
// core, no hard shell); and per-poet ELLIPSOID axes give each poet a distinct shape (sphere / ellipse
// / oblate). The whole cloud also SELF-ROTATES around the poet (poemOmega + poemClock) so it has life
// and relative motion. A prolific poet (杜甫/李白) becomes a sprawling cluster; a one-poem poet a lone star.
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 rad — even angular spread

/** Cluster radius (LOCAL units) — grows with poemCount. ~6× the round-6 size (was 8+2√P): the field
 *  read too small/local, so spread it out (杜甫 ~1593首 → ~555; a 1-poem poet → ~48). Tune freely. */
export function poemSystemRadius(poemCount: number): number {
  return Math.min(3000, 35 + 13 * Math.sqrt(Math.max(1, poemCount)));
}

/** Per-poet self-rotation rate (rad/s) of the poem cloud around its poet. Gentle ± so it drifts, not spins. */
export function poemOmega(p: PoetRow): number {
  const h = hashStr(p.id + "~spin");
  const sign = h & 1 ? 1 : -1;
  return sign * (0.018 + 0.05 * (((h >>> 8) & 0xff) / 255)); // ~0.018..0.068 rad/s
}

/** REST OFFSET (relative to the poet centre, BEFORE self-rotation) of poem `poemIdx`. Cheap — no
 *  poetPosition call — so the "show ALL poems" build computes the poet centre ONCE and adds this.
 *  The geometry stores this rest offset; the shader (and poemPosition) apply the time rotation. */
export function poemOffset(p: PoetRow, poemIdx: number): [number, number, number] {
  const P = Math.max(1, p.poemCount);
  const R0 = poemSystemRadius(P);
  const yd = 1 - (2 * (poemIdx + 0.5)) / P; // +1..-1 (latitude)
  const rxy = Math.sqrt(Math.max(0, 1 - yd * yd));
  const phase = (hashStr(p.id) & 0xffff) * 0.001; // per-poet phase so clusters aren't aligned
  const th = poemIdx * GOLDEN + phase;
  const h = hashStr(p.id + ":" + poemIdx);
  const jitter = 0.4 + 1.2 * (((h >>> 8) & 0xff) / 255); // WIDE (0.4..1.6) → clumpy, no shell
  const rho = R0 * Math.pow((poemIdx + 0.5) / P, 0.62) * jitter; // dense core, sparse halo (non-uniform)
  // per-poet ellipsoid axes → varied irregular shapes (some round, some elongated, some oblate)
  const he = hashStr(p.id + "#shape");
  const ax = 0.55 + 1.05 * (((he >>> 2) & 0xff) / 255);
  const ay = 0.4 + 0.95 * (((he >>> 10) & 0xff) / 255);
  const az = 0.55 + 1.05 * (((he >>> 18) & 0xff) / 255);
  return [rxy * Math.cos(th) * rho * ax, yd * rho * ay, rxy * Math.sin(th) * rho * az];
}

/** Absolute LOCAL position of a poem-planet NOW (poet centre + self-rotated offset). Time-aware (reads
 *  poemClock) so locate/flares land on the orbiting planet where it currently is. */
export function poemPosition(p: PoetRow, poemIdx: number): [number, number, number] {
  const [cx, cy, cz] = poetPosition(p);
  const [dx, dy, dz] = poemOffset(p, poemIdx);
  const ang = poemClock.t * poemOmega(p); // self-rotation about the poet's Y axis (matches the shader)
  const c = Math.cos(ang), s = Math.sin(ang);
  return [cx + dx * c - dz * s, cy + dy, cz + dx * s + dz * c];
}
