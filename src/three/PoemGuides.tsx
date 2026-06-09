import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DYNASTY_BY_KEY, DYNASTIES, DYNASTY_COUNT } from "../data/dynasties";
import { useStore } from "../state/store";
import { galaxySpin, poemClock } from "./galaxyParams";
import { poetPosition, poemOffset, poemOmega } from "./positions";

// 行星指引: when a poet is selected, the poet star emits a line to EVERY poem it wrote (like the 赠诗
// arcs) — a one-shot ~10 s animation (lines grow out from the poet, hold, fade) that then auto-deletes.
// Lines self-rotate with the poem cloud (same aCenter/aOmega trick) so they stay attached to the
// orbiting planets, and ride the shared galaxy spin via the group. Makes the (now very spread) cluster
// unmistakably read as "this poet's works", without leaving permanent clutter.

const GROW = 1.2; // s — lines extend from the poet outward
const HOLD = 8.0; // s
const FADE = 1.2; // s  (GROW + HOLD + FADE ≈ 10 s, then disposed)
const MAX_LINES = 4000; // safety cap (largest poets have a few thousand poems)

interface Guide {
  lines: THREE.LineSegments;
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  born: number;
}

export function PoemGuides() {
  const selectedPoet = useStore((s) => s.selectedPoet);
  const groupRef = useRef<THREE.Group>(null);
  const cur = useRef<Guide | null>(null);

  useEffect(() => {
    const grp = groupRef.current;
    if (!grp) return;
    if (cur.current) { grp.remove(cur.current.lines); cur.current.geo.dispose(); cur.current.mat.dispose(); cur.current = null; }
    if (!selectedPoet) return;
    const total = Math.max(0, selectedPoet.poemCount);
    if (!total) return;
    const P = Math.min(MAX_LINES, total); // guide-line COUNT (capped only for the few >MAX_LINES poets)
    // Which poem each guide points at: ≤ cap → every poem; otherwise SAMPLE uniformly across the WHOLE
    // range so guides reach the OUTERMOST planets too (was the first MAX_LINES → it ignored the rest).
    const poemIndexOf = (k: number) => (total <= MAX_LINES ? k : Math.floor((k * total) / P));

    const [cx, cy, cz] = poetPosition(selectedPoet);
    const omega = poemOmega(selectedPoet);
    const dyn = DYNASTY_BY_KEY[selectedPoet.dynasty] ?? DYNASTIES[DYNASTY_COUNT - 1];
    const col = new THREE.Color(dyn.color);
    const n = P * 2;
    const pos = new Float32Array(n * 3);
    const ctr = new Float32Array(n * 3);
    const om = new Float32Array(n);
    const cc = new Float32Array(n * 3);
    for (let j = 0; j < P; j++) {
      const [dx, dy, dz] = poemOffset(selectedPoet, poemIndexOf(j));
      const a = j * 2, b = a + 1;
      pos[a * 3] = cx; pos[a * 3 + 1] = cy; pos[a * 3 + 2] = cz; // poet endpoint (off = 0 → stays)
      pos[b * 3] = cx + dx; pos[b * 3 + 1] = cy + dy; pos[b * 3 + 2] = cz + dz; // planet endpoint
      for (const v of [a, b]) {
        ctr[v * 3] = cx; ctr[v * 3 + 1] = cy; ctr[v * 3 + 2] = cz;
        om[v] = omega;
        cc[v * 3] = col.r; cc[v * 3 + 1] = col.g; cc[v * 3 + 2] = col.b;
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
      uniforms: { uTime: { value: poemClock.t }, uGrow: { value: 0 }, uAlpha: { value: 0 } },
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
        uniform float uAlpha; varying vec3 vColor;
        void main() { gl_FragColor = vec4(vColor * 0.85, uAlpha); }`,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    cur.current = { lines, geo, mat, born: poemClock.t };
    grp.add(lines);
  }, [selectedPoet]);

  useEffect(() => () => {
    const grp = groupRef.current;
    if (cur.current) { grp?.remove(cur.current.lines); cur.current.geo.dispose(); cur.current.mat.dispose(); cur.current = null; }
  }, []);

  useFrame(() => {
    const grp = groupRef.current;
    if (grp) grp.rotation.y = galaxySpin.angle;
    const g = cur.current;
    if (!g) return;
    const hold = useStore.getState().guideHold; // 指引常驻: keep the lines up instead of the 10 s auto-fade
    const t = poemClock.t; // advanced by PoemOrbits
    g.mat.uniforms.uTime.value = t;
    const age = t - g.born;
    g.mat.uniforms.uGrow.value = Math.min(1, age / GROW);
    let alpha: number;
    if (age < GROW) alpha = (age / GROW) * 0.6;
    else if (hold || age < GROW + HOLD) alpha = 0.6; // 常驻 → hold full alpha indefinitely
    else alpha = Math.max(0, 0.6 * (1 - (age - GROW - HOLD) / FADE));
    g.mat.uniforms.uAlpha.value = alpha;
    if (!hold && age >= GROW + HOLD + FADE) { grp?.remove(g.lines); g.geo.dispose(); g.mat.dispose(); cur.current = null; } // auto-delete (off only)
  });

  return <group ref={groupRef} />;
}
