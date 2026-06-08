import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { DYNASTY_BY_KEY, DYNASTIES, DYNASTY_COUNT, bandRadius, hashStr } from "../data/dynasties";
import { getPoets, type PoetRow } from "../data/load";
import { useStore } from "../state/store";
import { pickTargets } from "./picking";
import { GALAXY, gauss3, galaxySpin } from "./galaxyParams";

// Deterministic galaxy position (LOCAL frame — the whole layer is rotated as one by
// galaxySpin). radius = dynasty shell (time = depth); angle is wound onto the spiral
// arms with the SAME recipe the decorative backdrop uses, so poets interleave with
// the backdrop instead of sitting on a razor-thin sheet. We add (a) in-plane x/z
// scatter and (b) gaussian disk thickness — without them the old layout read as a
// flat "wall" (uniform y, zero x/z spread).
export function poetPosition(p: PoetRow): [number, number, number] {
  const dyn = DYNASTY_BY_KEY[p.dynasty] ?? DYNASTIES[DYNASTY_COUNT - 1];
  const [inner, outer] = bandRadius(dyn.id);
  // three decorrelated 32-bit hashes → full-range uniforms (bit-rotated streams).
  const h = hashStr(p.id + p.name);
  const h2 = hashStr(p.name + "#" + p.id);
  const h3 = hashStr(p.id + "@" + p.dynasty);
  const U = (k: number) => (k >>> 0) / 4294967296;
  const rot = (k: number, n: number) => (((k >>> n) | (k << (32 - n))) >>> 0);
  const r0 = U(h), r1 = U(rot(h, 11)), r2 = U(rot(h, 19));
  const r3 = U(h2), r4 = U(rot(h2, 13)), r5 = U(rot(h2, 23));
  const r6 = U(h3), r7 = U(rot(h3, 17));

  const rr = inner + r0 * (outer - inner);
  const t = rr / GALAXY.RADIUS;
  const branch = ((h % GALAXY.BRANCHES) / GALAXY.BRANCHES) * Math.PI * 2;
  const twist = t * GALAXY.TWIST;
  const armDev = gauss3(r1, r2, r3) * GALAXY.ARM_SPREAD;
  const ang = branch + twist + armDev;
  // in-plane scatter (same `sc` shape as the backdrop): gives the arms x/z width.
  const sc = (a: number, b: number) => Math.pow(a, 2.6) * (b < 0.5 ? -1 : 1) * 0.18 * rr;
  const x = Math.cos(ang) * rr + sc(r4, r5);
  const z = Math.sin(ang) * rr + sc(r6, r7);
  // gaussian thickness, concentrated toward the disk plane (matches the backdrop).
  const y = gauss3(r2, r4, r6) * rr * GALAXY.THICKNESS;
  return [x, y, z];
}

export function PoetStars() {
  const hidden = useStore((s) => s.hidden);
  const hoverId = useStore((s) => s.hoverPoetId);
  const selId = useStore((s) => s.selectedPoet?.id ?? null);

  const built = useMemo(() => {
    const poets = getPoets();
    const n = poets.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const baseSize = new Float32Array(n);
    const seed = new Float32Array(n);
    const dynId = new Uint8Array(n);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = poets[i];
      const dyn = DYNASTY_BY_KEY[p.dynasty] ?? DYNASTIES[DYNASTY_COUNT - 1];
      dynId[i] = dyn.id;
      const [x, y, z] = poetPosition(p);
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      tmp.set(dyn.color);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
      const s = 1.4 + p.clusterSize * 0.32;
      size[i] = s;
      baseSize[i] = s;
      seed[i] = (hashStr(p.id) & 0xffff) / 0xffff;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSizeScale: { value: 900 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aSeed;
        uniform float uTime; uniform float uSizeScale;
        varying vec3 vColor; varying float vTw;
        void main() {
          if (aSize < 0.001) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; return; }
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (uSizeScale / -mv.z), 1.2, 70.0);
          vTw = 0.7 + 0.3 * sin(uTime * 0.7 + aSeed * 6.2831853);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vTw;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.03, d);
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor * 1.9, a * vTw);
        }`,
    });
    const points = new THREE.Points(g, m);
    points.frustumCulled = false;
    pickTargets.poetPoints = points;
    pickTargets.poets = poets;
    pickTargets.positions = pos;
    pickTargets.sizes = baseSize;
    return { points, baseSize, dynId, poets };
  }, []);

  // dynasty filter → zero hidden poets' size
  useEffect(() => {
    const hide = new Array<boolean>(DYNASTY_COUNT).fill(false);
    for (const d of DYNASTIES) hide[d.id] = hidden.has(d.key);
    const attr = built.points.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = hide[built.dynId[i]] ? 0 : built.baseSize[i];
    attr.needsUpdate = true;
  }, [hidden, built]);

  const spinRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    (built.points.material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
    // rotate the whole poet layer (stars + labels) by the shared galaxy spin.
    if (spinRef.current) spinRef.current.rotation.y = galaxySpin.angle;
  });

  // labels ONLY for the hovered + selected poet (no names floating in empty void)
  const byId = useMemo(() => new Map(built.poets.map((p) => [p.id, p])), [built]);
  const shown: PoetRow[] = [];
  const seen = new Set<string>();
  for (const id of [hoverId, selId]) {
    if (id && !seen.has(id)) {
      const p = byId.get(id);
      if (p) {
        shown.push(p);
        seen.add(id);
      }
    }
  }

  return (
    <group ref={spinRef}>
      <primitive object={built.points} />
      {shown.map((p) => {
        const isFocus = p.id === hoverId || p.id === selId;
        const dyn = DYNASTY_BY_KEY[p.dynasty] ?? DYNASTIES[DYNASTY_COUNT - 1];
        return (
          <Html
            key={p.id}
            position={poetPosition(p)}
            center
            zIndexRange={[8, 0]}
            style={{ pointerEvents: "none" }}
          >
            <div className={isFocus ? "poet-label focus" : "poet-label"} style={{ color: dyn.color }}>
              {p.name}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
