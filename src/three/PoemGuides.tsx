import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DYNASTIES, DYNASTY_COUNT, displayDynasty } from "../data/dynasties";
import { useStore } from "../state/store";
import { galaxySpin, poemClock } from "./galaxyParams";
import { poetPosition, poemOffset, poemOmega, poemSystemRadius } from "./positions";
import { buildPlaneGuidePaths, buildEquatorRing, PLANE_VERTICAL_SPLIT } from "./planeGuidePath";

// 行星指引: when a poet is selected, the poet star emits guide lines to its poems — a one-shot ~grow→hold→
// fade animation that then auto-deletes (flash) or stays (hold). Lines self-rotate with the poem cloud
// (same aCenter/aOmega trick as PoemOrbits) so they stay attached to the orbiting planets, and ride the
// shared galaxy spin via the group.
//
// TWO styles (store.guideStyle):
//   • "plane" (默认, NEW): a 平面坐标式 reading aid. Each guide is a TWO-SEGMENT L-shape in the cluster's
//     LOCAL frame — 平面段 origin→H=(ox,0,oz) (bearing + radial distance on the poet's equator plane) then
//     垂直段 H→P=(ox,oy,oz) (height above/below the plane). The grow is STAGED (散射→直射): the plane
//     segments radiate first, then the vertical segments rise. MUCH dimmer than the legacy beams (the
//     plane segment dimmest, the vertical somewhat brighter — it carries the NEW height info). A faint
//     赤道参考环 outlines the plane. See three/planeGuidePath.ts for the pure path math (unit-tested).
//   • "line" (旧版): the original 赠诗-style straight beams — one bright segment poet→planet. Preserved
//     intact + selectable.

const GROW = 1.2; // s — lines extend from the poet outward
const FADE = 1.2; // s — fade-out after the (settings-driven) hold time
const MAX_LINES = 4000; // 'optimized' coverage cap (then sampled across the full range); 'all' lifts it

// ── Brightness (item 3: the plane style must be CLEARLY dimmer than the legacy beams) ────────────────
// Legacy beams: intensity 0.85, alpha peak 0.60. The new plane style sits well below that:
const LINE_INTENSITY = 0.85; // legacy beam colour intensity (unchanged)
const LINE_ALPHA = 0.6; // legacy beam alpha peak (unchanged)
const PLANE_ALPHA = 0.28; // plane-style alpha peak — < half the legacy beam
const PLANE_SEG_DIM = 0.35; // 平面段 colour intensity — dimmest (just bearing/radius context)
const PLANE_SEG_BRIGHT = 0.7; // 垂直段 colour intensity — somewhat brighter (carries the NEW height info)
const RING_ALPHA = 0.1; // 赤道参考环 alpha peak — very faint, never competes with the lines
const RING_INTENSITY = 0.3; // ring colour intensity — dim outline

interface Guide {
  group: THREE.Group; // holds the line(s) [+ ring]; rotates with the galaxy spin
  geos: THREE.BufferGeometry[];
  mats: THREE.ShaderMaterial[];
  born: number;
}

export function PoemGuides() {
  const selectedPoet = useStore((s) => s.selectedPoet);
  const guideMode = useStore((s) => s.guideMode); // off / flash / hold
  const guideCoverage = useStore((s) => s.guideCoverage); // all / optimized
  const guideStyle = useStore((s) => s.guideStyle); // plane / line
  const groupRef = useRef<THREE.Group>(null);
  const cur = useRef<Guide | null>(null);

  useEffect(() => {
    const grp = groupRef.current;
    if (!grp) return;
    disposeGuide(grp, cur);
    if (!selectedPoet || guideMode === "off") return;
    const total = Math.max(0, selectedPoet.poemCount);
    if (!total) return;
    // coverage: 'all' = a guide to EVERY poem (一首不漏); 'optimized' = cap then SAMPLE uniformly across the
    // whole range so guides still reach the outermost planets (not just the first MAX_LINES).
    const CAP = guideCoverage === "all" ? 20000 : MAX_LINES;
    const P = Math.min(CAP, total);
    const poemIndexOf = (k: number) => (total <= CAP ? k : Math.floor((k * total) / P));

    const [cx, cy, cz] = poetPosition(selectedPoet);
    const omega = poemOmega(selectedPoet);
    const dyn = displayDynasty(selectedPoet) ?? DYNASTIES[DYNASTY_COUNT - 1];
    const col = new THREE.Color(dyn.color);

    const inner = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.ShaderMaterial[] = [];

    if (guideStyle === "plane") {
      buildPlane(inner, geos, mats, { cx, cy, cz, omega, col, P, poemIndexOf, poet: selectedPoet });
    } else {
      buildLegacyLine(inner, geos, mats, { cx, cy, cz, omega, col, P, poemIndexOf, poet: selectedPoet });
    }
    cur.current = { group: inner, geos, mats, born: poemClock.t };
    grp.add(inner);
  }, [selectedPoet, guideMode, guideCoverage, guideStyle]);

  useEffect(() => () => disposeGuide(groupRef.current, cur), []);

  useFrame(() => {
    const grp = groupRef.current;
    if (grp) grp.rotation.y = galaxySpin.angle;
    const g = cur.current;
    if (!g) return;
    const st = useStore.getState();
    const hold = st.guideMode === "hold"; // 常驻: keep the lines up; flash: hold for guideSeconds then fade
    const showSec = Math.max(1, st.guideSeconds); // per-click display time (flash mode)
    const bright = st.guideBrightness; // adjustable 指引线亮度
    const t = poemClock.t; // advanced by PoemOrbits
    const age = t - g.born;
    const grow = Math.min(1, age / GROW);
    // lifecycle alpha envelope (0..1), shared by all materials; each material scales it by its own peak.
    let env: number;
    if (age < GROW) env = age / GROW;
    else if (hold || age < GROW + showSec) env = 1;
    else env = Math.max(0, 1 - (age - GROW - showSec) / FADE);
    for (const m of g.mats) {
      m.uniforms.uTime.value = t;
      m.uniforms.uGrow.value = grow;
      m.uniforms.uBright.value = bright;
      (m.uniforms.uEnv.value as number) = env;
    }
    if (!hold && age >= GROW + showSec + FADE) disposeGuide(grp, cur); // auto-delete (flash only)
  });

  return <group ref={groupRef} />;
}

function disposeGuide(grp: THREE.Group | null, cur: React.MutableRefObject<Guide | null>) {
  const g = cur.current;
  if (!g) return;
  grp?.remove(g.group);
  for (const geo of g.geos) geo.dispose();
  for (const m of g.mats) m.dispose();
  cur.current = null;
}

interface BuildCtx {
  cx: number; cy: number; cz: number;
  omega: number;
  col: THREE.Color;
  P: number;
  poemIndexOf: (k: number) => number;
  poet: Parameters<typeof poemOffset>[0];
}

// ── Legacy 直线 (旧版) — one straight beam poet→planet, unchanged from the original implementation ────
function buildLegacyLine(inner: THREE.Group, geos: THREE.BufferGeometry[], mats: THREE.ShaderMaterial[], ctx: BuildCtx) {
  const { cx, cy, cz, omega, col, P, poemIndexOf, poet } = ctx;
  const n = P * 2;
  const pos = new Float32Array(n * 3);
  const ctr = new Float32Array(n * 3);
  const om = new Float32Array(n);
  const cc = new Float32Array(n * 3);
  for (let j = 0; j < P; j++) {
    const [dx, dy, dz] = poemOffset(poet, poemIndexOf(j));
    const a = j * 2, b = a + 1;
    pos[a * 3] = cx; pos[a * 3 + 1] = cy; pos[a * 3 + 2] = cz; // poet endpoint (off = 0 → stays)
    pos[b * 3] = cx + dx; pos[b * 3 + 1] = cy + dy; pos[b * 3 + 2] = cz + dz; // planet endpoint
    for (const vtx of [a, b]) {
      ctr[vtx * 3] = cx; ctr[vtx * 3 + 1] = cy; ctr[vtx * 3 + 2] = cz;
      om[vtx] = omega;
      cc[vtx * 3] = col.r; cc[vtx * 3 + 1] = col.g; cc[vtx * 3 + 2] = col.b;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aCenter", new THREE.BufferAttribute(ctr, 3));
  geo.setAttribute("aOmega", new THREE.BufferAttribute(om, 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(cc, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: poemClock.t }, uGrow: { value: 0 }, uEnv: { value: 0 }, uBright: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute vec3 aCenter; attribute float aOmega;
      uniform float uTime; uniform float uGrow;
      varying vec3 vColor;
      void main() {
        vec3 off0 = position - aCenter;
        float ang = uTime * aOmega;                 // self-rotate like the planets
        float c = cos(ang), s = sin(ang);
        vec3 off = vec3(off0.x * c - off0.z * s, off0.y, off0.x * s + off0.z * c);
        vec3 wp = aCenter + off * clamp(uGrow, 0.0, 1.0); // grow from poet outward
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uEnv; uniform float uBright; varying vec3 vColor;
      void main() { gl_FragColor = vec4(vColor * ${LINE_INTENSITY.toFixed(2)} * uBright, ${LINE_ALPHA.toFixed(2)} * uEnv); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  inner.add(lines);
  geos.push(geo);
  mats.push(mat);
}

// ── NEW 平面坐标式 — staged L-shaped polylines + a faint equator ring (planeGuidePath.ts) ─────────────
function buildPlane(inner: THREE.Group, geos: THREE.BufferGeometry[], mats: THREE.ShaderMaterial[], ctx: BuildCtx) {
  const { cx, cy, cz, omega, col, P, poemIndexOf, poet } = ctx;
  // Pure path math: interleaved tip/anchor/stage for P guides (4 vertices each — two LineSegments segs).
  const paths = buildPlaneGuidePaths({ count: P, offsetOf: (k) => poemOffset(poet, poemIndexOf(k)) });
  const n = paths.count;
  // position = LOCAL tip offset + poet centre (the shader subtracts aCenter back to a LOCAL offset, lerps
  // anchor→tip, rotates about Y, re-adds the centre — H and P share aCenter/aOmega so the L never shears).
  const pos = new Float32Array(n * 3);
  const anc = new Float32Array(n * 3); // anchor offset + poet centre
  const ctr = new Float32Array(n * 3);
  const om = new Float32Array(n);
  const stg = new Float32Array(n);
  let maxHoriz = 0;
  for (let v = 0; v < n; v++) {
    const tx = paths.tip[v * 3], ty = paths.tip[v * 3 + 1], tz = paths.tip[v * 3 + 2];
    pos[v * 3] = cx + tx; pos[v * 3 + 1] = cy + ty; pos[v * 3 + 2] = cz + tz;
    anc[v * 3] = cx + paths.anchor[v * 3]; anc[v * 3 + 1] = cy + paths.anchor[v * 3 + 1]; anc[v * 3 + 2] = cz + paths.anchor[v * 3 + 2];
    ctr[v * 3] = cx; ctr[v * 3 + 1] = cy; ctr[v * 3 + 2] = cz;
    om[v] = omega;
    stg[v] = paths.stage[v];
    const h = Math.hypot(tx, tz);
    if (h > maxHoriz) maxHoriz = h;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aAnchor", new THREE.BufferAttribute(anc, 3));
  geo.setAttribute("aCenter", new THREE.BufferAttribute(ctr, 3));
  geo.setAttribute("aOmega", new THREE.BufferAttribute(om, 1));
  geo.setAttribute("aStage", new THREE.BufferAttribute(stg, 1));
  const mat = planeMaterial(col);
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  inner.add(lines);
  geos.push(geo);
  mats.push(mat);

  // 赤道参考环: radius = the cluster's horizontal extent. Use the max horizontal tip radius if we have
  // guides; fall back to the system radius (positions.ts) so a degenerate cluster still gets a sane ring.
  const ringR = Math.max(maxHoriz, poemSystemRadius(Math.max(1, poet.poemCount)) * 0.5);
  const ringLocal = buildEquatorRing(ringR, 96);
  const rn = ringLocal.length / 3;
  const rpos = new Float32Array(rn * 3);
  const rctr = new Float32Array(rn * 3);
  const rom = new Float32Array(rn);
  for (let i = 0; i < rn; i++) {
    rpos[i * 3] = cx + ringLocal[i * 3]; rpos[i * 3 + 1] = cy + ringLocal[i * 3 + 1]; rpos[i * 3 + 2] = cz + ringLocal[i * 3 + 2];
    rctr[i * 3] = cx; rctr[i * 3 + 1] = cy; rctr[i * 3 + 2] = cz;
    rom[i] = omega;
  }
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute("position", new THREE.BufferAttribute(rpos, 3));
  rgeo.setAttribute("aCenter", new THREE.BufferAttribute(rctr, 3));
  rgeo.setAttribute("aOmega", new THREE.BufferAttribute(rom, 1));
  const rmat = ringMaterial(col);
  const ring = new THREE.LineLoop(rgeo, rmat);
  ring.frustumCulled = false;
  inner.add(ring);
  geos.push(rgeo);
  mats.push(rmat);
}

// Staged L-shape shader: lerp aAnchor→position by the per-STAGE grow progress (plane segment fills over
// [0,SPLIT], vertical over [SPLIT,1]), then rotate about the poet's Y axis (H & P share aCenter/aOmega →
// rotation-safe). The 平面段 (stage 0) renders dimmer, the 垂直段 (stage 1) somewhat brighter.
function planeMaterial(col: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: poemClock.t }, uGrow: { value: 0 }, uEnv: { value: 0 }, uBright: { value: 1 },
      uColor: { value: new THREE.Vector3(col.r, col.g, col.b) }, uSplit: { value: PLANE_VERTICAL_SPLIT },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aAnchor; attribute vec3 aCenter; attribute float aOmega; attribute float aStage;
      uniform float uTime; uniform float uGrow; uniform float uSplit;
      varying float vStage;
      void main() {
        // per-stage grow progress (matches planeGuidePath.stageProgress): plane over [0,split], vertical
        // over [split,1]. stage 0 → plane, stage 1 → vertical.
        float g = clamp(uGrow, 0.0, 1.0);
        float planeP = uSplit <= 0.0 ? 1.0 : clamp(g / uSplit, 0.0, 1.0);
        float vertP  = uSplit >= 1.0 ? 0.0 : clamp((g - uSplit) / (1.0 - uSplit), 0.0, 1.0);
        float prog = mix(planeP, vertP, aStage);
        // grow each vertex from its anchor toward its tip (position), in LOCAL offset space
        vec3 tip = position - aCenter;
        vec3 anc = aAnchor - aCenter;
        vec3 off0 = mix(anc, tip, prog);
        float ang = uTime * aOmega;                 // self-rotate with the cloud (Y axis → plane maps to itself)
        float c = cos(ang), s = sin(ang);
        vec3 off = vec3(off0.x * c - off0.z * s, off0.y, off0.x * s + off0.z * c);
        vStage = aStage;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(aCenter + off, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uEnv; uniform float uBright; uniform vec3 uColor;
      varying float vStage;
      void main() {
        float intensity = mix(${PLANE_SEG_DIM.toFixed(2)}, ${PLANE_SEG_BRIGHT.toFixed(2)}, vStage);
        gl_FragColor = vec4(uColor * intensity * uBright, ${PLANE_ALPHA.toFixed(2)} * uEnv);
      }`,
  });
}

// 赤道参考环 shader: a flat circle in the plane, self-rotating with the cloud (spins in place). Fades in
// with the plane segments (grow→split) so it doesn't pop before the lines, then rides the shared envelope.
function ringMaterial(col: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: poemClock.t }, uGrow: { value: 0 }, uEnv: { value: 0 }, uBright: { value: 1 },
      uColor: { value: new THREE.Vector3(col.r, col.g, col.b) }, uSplit: { value: PLANE_VERTICAL_SPLIT },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter; attribute float aOmega;
      uniform float uTime;
      void main() {
        vec3 off0 = position - aCenter;
        float ang = uTime * aOmega;
        float c = cos(ang), s = sin(ang);
        vec3 off = vec3(off0.x * c - off0.z * s, off0.y, off0.x * s + off0.z * c);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(aCenter + off, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uEnv; uniform float uGrow; uniform float uBright; uniform vec3 uColor; uniform float uSplit;
      void main() {
        // ease the ring in alongside the plane segments (grow 0→split), then follow the lifecycle envelope
        float appear = uSplit <= 0.0 ? 1.0 : clamp(uGrow / uSplit, 0.0, 1.0);
        gl_FragColor = vec4(uColor * ${RING_INTENSITY.toFixed(2)} * uBright, ${RING_ALPHA.toFixed(2)} * uEnv * appear);
      }`,
  });
}
