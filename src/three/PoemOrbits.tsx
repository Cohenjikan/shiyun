import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DYNASTY_BY_KEY, DYNASTIES, DYNASTY_COUNT, hashStr } from "../data/dynasties";
import { getPoets, type PoetRow } from "../data/load";
import { useStore } from "../state/store";
import { galaxySpin, poemClock } from "./galaxyParams";
import { poetPosition, poemOffset, poemOmega } from "./positions";
import { encodePoemPickColor } from "./gpuPick";
import { pickTargets } from "./picking";

// Poems as big, irregular, self-rotating 3D clusters around their poet (positions.ts). Two layers:
//   • ALL field (store.showAllPoems = 行星 toggle): EVERY poet's poems, dim, persistent (高性能机器).
//   • HIGHLIGHT: selecting a poet ALWAYS spawns a bright 10-second highlight of THAT poet's whole
//     cluster — regardless of the 行星 toggle (item 1) — flashing in (闪光渐入), holding, then fading
//     out (渐弱). In 行星-ON mode it overlays the dim field so you see which poet you picked.
// Each cloud SELF-ROTATES around its poet (aOmega + poemClock, mirrored in the GPU picker so clicks
// still land). The whole group also rides the shared galaxy spin. *(sizes/brightness tune on a real GPU.)*

const FADE_IN = 0.4; // s — flash in
const FADE_OUT = 1.5; // s — fade when replaced/deselected
const HOLD_FLARE = 0.6; // sustained brightness/size boost held for the WHOLE selection (item 7)

// uAlpha = fade in/out; uFlare = birth flash (size + brightness); the cloud self-rotates by uTime*aOmega.
function planetMaterial(bright: number, sizeScale: number, maxPx: number, twinkle: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uFlare: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute vec3 aCenter; attribute float aOmega; ${twinkle ? "attribute float aSeed;" : ""}
      uniform float uTime; uniform float uAlpha; uniform float uFlare;
      varying vec3 vColor; varying float vTw; varying float vAlpha;
      void main() {
        // self-rotate the rest offset around the poet's Y axis (matches positions.poemPosition + the picker)
        vec3 off0 = position - aCenter;
        float ang = uTime * aOmega;
        float c = cos(ang), s = sin(ang);
        vec3 wp = aCenter + vec3(off0.x * c - off0.z * s, off0.y, off0.x * s + off0.z * c);
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        float flareSize = 1.0 + uFlare * 1.8;
        gl_PointSize = clamp(${sizeScale.toFixed(1)} / -mv.z, 1.0, ${maxPx.toFixed(1)}) * flareSize;
        vTw = ${twinkle ? "0.65 + 0.35 * sin(uTime * 1.7 + aSeed * 6.2831853)" : "1.0"};
        vColor = aColor * ${bright.toFixed(2)} * (1.0 + uFlare * 1.4);
        vAlpha = uAlpha;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vTw; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        if (a < 0.02) discard;
        gl_FragColor = vec4(vColor * vTw, a * vTw * vAlpha);
      }`,
  });
}

type PoemRef = { poet: PoetRow; poemIdx: number } | null;

function buildGeometry(poets: PoetRow[], total: number, withSeed: boolean) {
  const pos = new Float32Array(total * 3); // REST position (poet centre + rest offset); shader rotates it
  const col = new Float32Array(total * 3);
  const ctr = new Float32Array(total * 3); // poet centre (rotation pivot)
  const om = new Float32Array(total); // per-poet self-rotation rate
  const pick = new Float32Array(total * 3);
  const seed = withSeed ? new Float32Array(total) : null;
  const poetIdxOf = new Int32Array(total);
  const poemIdxOf = new Int32Array(total);
  const tmp = new THREE.Color();
  let k = 0;
  for (let pi = 0; pi < poets.length; pi++) {
    const p = poets[pi];
    const P = Math.max(0, p.poemCount);
    if (!P) continue;
    const dyn = DYNASTY_BY_KEY[p.dynasty] ?? DYNASTIES[DYNASTY_COUNT - 1];
    const [cx, cy, cz] = poetPosition(p);
    const omega = poemOmega(p);
    tmp.set(dyn.color);
    const r = tmp.r, g = tmp.g, b = tmp.b;
    for (let j = 0; j < P && k < total; j++) {
      const [dx, dy, dz] = poemOffset(p, j);
      pos[k * 3] = cx + dx;
      pos[k * 3 + 1] = cy + dy;
      pos[k * 3 + 2] = cz + dz;
      col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
      ctr[k * 3] = cx; ctr[k * 3 + 1] = cy; ctr[k * 3 + 2] = cz;
      om[k] = omega;
      const [pr, pg, pb] = encodePoemPickColor(k);
      pick[k * 3] = pr; pick[k * 3 + 1] = pg; pick[k * 3 + 2] = pb;
      poetIdxOf[k] = pi; poemIdxOf[k] = j;
      if (seed) seed[k] = (hashStr(p.id + ":" + j) & 0xffff) / 0xffff;
      k++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aCenter", new THREE.BufferAttribute(ctr, 3));
  geo.setAttribute("aOmega", new THREE.BufferAttribute(om, 1));
  geo.setAttribute("aPickColor", new THREE.BufferAttribute(pick, 3));
  if (seed) geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setDrawRange(0, k);
  const resolve = (localId: number): PoemRef =>
    localId >= 0 && localId < k ? { poet: poets[poetIdxOf[localId]], poemIdx: poemIdxOf[localId] } : null;
  return { geo, resolve };
}

interface Layer {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  resolve: (id: number) => PoemRef;
  sizeScale: number;
  maxPx: number;
  born: number;
  outAt: number | null; // null = alive; else the clock time fade-out began
}

function makeLayer(
  poets: PoetRow[],
  total: number,
  o: { bright: number; sizeScale: number; maxPx: number; twinkle: boolean },
): Layer | null {
  if (!total) return null;
  const { geo, resolve } = buildGeometry(poets, total, o.twinkle);
  const mat = planetMaterial(o.bright, o.sizeScale, o.maxPx, o.twinkle);
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, geo, mat, resolve, sizeScale: o.sizeScale, maxPx: o.maxPx, born: poemClock.t, outAt: null };
}

export function PoemOrbits() {
  const showAll = useStore((s) => s.showAllPoems);
  const selectedPoet = useStore((s) => s.selectedPoet);
  const groupRef = useRef<THREE.Group>(null);
  const allRef = useRef<Layer | null>(null); // persistent dim field (行星 toggle)
  const hi = useRef<Layer[]>([]); // highlight clusters (timed)
  const activeHi = useRef<Layer | null>(null); // newest live highlight (for clicking in OFF mode)
  const showAllRef = useRef(showAll);
  showAllRef.current = showAll;

  const mk = (L: Layer) => ({ geometry: L.geo, sizeScale: L.sizeScale, maxPx: L.maxPx, resolve: L.resolve });
  // clicking resolves via the ALL field when 行星 is ON (every planet shown), else via the live highlight.
  const refreshPick = () => {
    pickTargets.poemLayer = showAllRef.current
      ? allRef.current ? mk(allRef.current) : null
      : activeHi.current ? mk(activeHi.current) : null;
  };

  // ALL field: build/teardown on the 行星 toggle (no fade — a deliberate overview).
  useEffect(() => {
    const grp = groupRef.current;
    if (!grp || !showAll) { refreshPick(); return; }
    const poets = getPoets();
    let total = 0;
    for (const p of poets) total += Math.max(0, p.poemCount);
    const L = makeLayer(poets, total, { bright: 1.25, sizeScale: 360, maxPx: 11, twinkle: false });
    if (L) { allRef.current = L; grp.add(L.points); }
    refreshPick();
    return () => {
      if (allRef.current) { grp.remove(allRef.current.points); allRef.current.geo.dispose(); allRef.current.mat.dispose(); allRef.current = null; }
    };
  }, [showAll]);

  // HIGHLIGHT: selecting a poet always flashes its whole cluster in for ~10 s (item 1), regardless of
  // the toggle. A previous highlight fades out. Boosted (bright + large + twinkling) so the 星群 pops.
  useEffect(() => {
    const grp = groupRef.current;
    if (!grp) return;
    for (const L of hi.current) if (L.outAt == null) L.outAt = poemClock.t; // fade out the old highlight
    activeHi.current = null;
    if (selectedPoet) {
      // brighter + LARGER while selected (item 7): bigger rendered planets = bigger GPU pick target → the
      // poems are easier to click, and the cluster pops. The highlight now HOLDS for the whole selection
      // (see useFrame) instead of fading after ~10 s, so "仅选中时" the cluster stays lit + clickable + nameable.
      const L = makeLayer([selectedPoet], Math.max(0, selectedPoet.poemCount), {
        bright: 3.4, sizeScale: 860, maxPx: 44, twinkle: true,
      });
      if (L) {
        L.mat.uniforms.uAlpha.value = 0;
        L.mat.uniforms.uFlare.value = 1;
        hi.current.push(L);
        grp.add(L.points);
        activeHi.current = L;
      }
    }
    refreshPick();
  }, [selectedPoet]);

  useEffect(() => () => {
    const grp = groupRef.current;
    for (const L of hi.current) { grp?.remove(L.points); L.geo.dispose(); L.mat.dispose(); }
    hi.current = [];
    pickTargets.poemLayer = null;
  }, []);

  useFrame((_, dt) => {
    // 奇迹时刻: freeze the poem clock → planet self-rotation + the highlight flash/fade lifecycle hold.
    if (!useStore.getState().cinema) poemClock.t += Math.min(dt, 0.05); // advance self-rotation + lifecycle clock
    const t = poemClock.t;
    const grp = groupRef.current;
    if (grp) grp.rotation.y = galaxySpin.angle;
    if (allRef.current) allRef.current.mat.uniforms.uTime.value = t;

    const keep: Layer[] = [];
    let expired = false;
    for (const L of hi.current) {
      L.mat.uniforms.uTime.value = t;
      let alpha: number, flare: number;
      if (L.outAt != null) {
        const k = (t - L.outAt) / FADE_OUT;
        if (k >= 1) { grp?.remove(L.points); L.geo.dispose(); L.mat.dispose(); if (activeHi.current === L) { activeHi.current = null; expired = true; } continue; }
        alpha = Math.max(0, 1 - k); flare = 0;
      } else {
        const age = t - L.born;
        // item 7: HOLD the highlight for the WHOLE selection (was: fade after ~10 s). It only fades when a
        // new selection / deselection sets L.outAt (the useEffect above), so the selected poet's cluster
        // stays lit + big-pick + nameable as long as it's selected. (No auto-expiry → activeHi stays valid.)
        if (age < FADE_IN) { alpha = age / FADE_IN; flare = 1 - (1 - HOLD_FLARE) * (age / FADE_IN); }
        else { alpha = 1; flare = HOLD_FLARE; }
      }
      L.mat.uniforms.uAlpha.value = alpha;
      L.mat.uniforms.uFlare.value = flare;
      keep.push(L);
    }
    hi.current = keep;
    if (expired) refreshPick(); // highlight ended → stop resolving clicks to it (OFF mode)
  });

  return <group ref={groupRef} />;
}
