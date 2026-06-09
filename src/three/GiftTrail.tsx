import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useStore } from "../state/store";
import { getPoet } from "../data/load";
import { poetPosition } from "./positions";
import { galaxySpin } from "./galaxyParams";

// 赠诗漫游 3D overlays, both PERSISTENT and riding the shared galaxy spin (endpoints glued to poet stars):
//   • giftTrail  → bright-GOLD "return lines": the breadcrumb of poets you hopped through (≤10 edges),
//                  with a pulse running older→newer node, so the way back is always visible.
//   • pathResult → CYAN "path highlight": the chain of 赠诗 edges found by 路径查找 between two poets.
// Both are visually distinct from the dynasty-coloured ambient 赠诗 arcs (GiftLines).
const STEPS = 24;
const BUNDLE = 0.18; // milder centre-pull than the ambient arcs → reads as a more direct path
const CENTER = new THREE.Vector3(0, 0, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Sample the bundled Bézier polyline through a poet-id path into a LineSegments geometry. */
function buildPathGeo(ids: string[]): THREE.BufferGeometry | null {
  if (ids.length < 2) return null;
  const pos: number[] = [], ts: number[] = [], segs: number[] = [];
  for (let e = 0; e < ids.length - 1; e++) {
    const pf = getPoet(ids[e]);
    const pt = getPoet(ids[e + 1]);
    if (!pf || !pt) continue;
    _a.set(...poetPosition(pf));
    _b.set(...poetPosition(pt));
    _c1.lerpVectors(_a, _b, 0.33).lerp(CENTER, BUNDLE);
    _c2.lerpVectors(_a, _b, 0.67).lerp(CENTER, BUNDLE);
    let px = 0, py = 0, pz = 0, has = false;
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS, u = 1 - t;
      _v.set(0, 0, 0)
        .addScaledVector(_a, u * u * u)
        .addScaledVector(_c1, 3 * u * u * t)
        .addScaledVector(_c2, 3 * u * t * t)
        .addScaledVector(_b, t * t * t);
      if (has) { pos.push(px, py, pz, _v.x, _v.y, _v.z); ts.push((s - 1) / STEPS, s / STEPS); segs.push(e, e); }
      px = _v.x; py = _v.y; pz = _v.z; has = true;
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(ts), 1));
  g.setAttribute("aSeg", new THREE.BufferAttribute(new Float32Array(segs), 1));
  return g;
}

function makeMat(r: number, g: number, b: number, pulse: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Vector3(r, g, b) }, uPulse: { value: pulse ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float aT; attribute float aSeg;
      varying float vT; varying float vSeg;
      void main() { vT = aT; vSeg = aSeg; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCol; uniform float uPulse; varying float vT; varying float vSeg;
      void main() {
        float phase = fract(uTime * 0.22 - vSeg * 0.13);  // pulse runs start→end
        float d = vT - phase; d = d - floor(d + 0.5);
        float pulse = uPulse * smoothstep(0.09, 0.0, abs(d)) * 2.0;
        gl_FragColor = vec4(uCol * (0.9 + pulse), 0.92);
      }`,
  });
}

export function GiftTrail() {
  const showGifts = useStore((s) => s.showGifts);
  const trail = useStore((s) => s.giftTrail);
  const pathResult = useStore((s) => s.pathResult);
  const groupRef = useRef<THREE.Group>(null);

  const goldMat = useMemo(() => makeMat(1.0, 0.78, 0.34, true), []);
  const cyanMat = useMemo(() => makeMat(0.32, 0.85, 1.0, false), []);

  const trailObj = useMemo(() => {
    const g = buildPathGeo(trail);
    return g ? new THREE.LineSegments(g, goldMat) : null;
  }, [trail, goldMat]);
  const pathObj = useMemo(() => {
    const g = pathResult && pathResult.length > 1 ? buildPathGeo(pathResult) : null;
    return g ? new THREE.LineSegments(g, cyanMat) : null;
  }, [pathResult, cyanMat]);
  if (trailObj) trailObj.frustumCulled = false;
  if (pathObj) pathObj.frustumCulled = false;

  useFrame((_, dt) => {
    goldMat.uniforms.uTime.value += dt;
    cyanMat.uniforms.uTime.value += dt;
    const grp = groupRef.current;
    if (grp) grp.rotation.y = galaxySpin.angle;
  });

  useEffect(() => () => { trailObj?.geometry.dispose(); }, [trailObj]);
  useEffect(() => () => { pathObj?.geometry.dispose(); }, [pathObj]);
  useEffect(() => () => { goldMat.dispose(); cyanMat.dispose(); }, [goldMat, cyanMat]);

  if (!showGifts || (!trailObj && !pathObj)) return null;
  return (
    <group ref={groupRef}>
      {pathObj && <primitive object={pathObj} />}
      {trailObj && <primitive object={trailObj} />}
    </group>
  );
}
