import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { DYNASTY_BY_KEY, DYNASTIES, DYNASTY_COUNT, hashStr } from "../data/dynasties";
import { getPoets, type PoetRow } from "../data/load";
import { FAMOUS_POETS } from "../data/famousPoets";
import { useStore } from "../state/store";
import { pickTargets } from "./picking";
import { createGpuPicker, encodePickColor, POET_SIZE_SCALE } from "./gpuPick";
import { galaxySpin, spinXZ } from "./galaxyParams";
import { poetPosition } from "./positions";

export { poetPosition }; // back-compat: callers still import poetPosition from PoetStars

// Iconic poets → brighter + larger landmark stars (a sense of "明星" distinction).
const FAMOUS = new Set(FAMOUS_POETS.map((f) => f.name));
const WHITE = new THREE.Color("#ffffff");

/** Star point-size for a poet (both the visual shader's aSize AND the shared gpuPick geometry). A
 *  canonical 别名层 (G2) row — `mergedInto` set, poemCount:0/clusterSize:0, a redirect not a poet —
 *  is forced to exactly 0: both PoetStars' vertex shader and gpuPick's picker gate on `aSize < 0.001`
 *  to hide/exclude a star, so 0 here means the alias is INVISIBLE and UNPICKABLE, not just tiny. */
export function poetStarSize(p: Pick<PoetRow, "clusterSize" | "mergedInto">, famous: boolean): number {
  if (p.mergedInto) return 0;
  return (1.4 + p.clusterSize * 0.32) * (famous ? 2.4 : 1);
}

export function PoetStars() {
  const hidden = useStore((s) => s.hidden);
  const hoverId = useStore((s) => s.hoverPoetId);
  const selId = useStore((s) => s.selectedPoet?.id ?? null);
  const { gl, camera } = useThree();

  const built = useMemo(() => {
    const poets = getPoets();
    const n = poets.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const baseSize = new Float32Array(n);
    const seed = new Float32Array(n);
    const pick = new Float32Array(n * 3); // colour-encoded poet index → GPU picking (gpuPick.ts)
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
      const fam = FAMOUS.has(p.name);
      tmp.set(dyn.color);
      if (fam) tmp.lerp(WHITE, 0.22).multiplyScalar(1.8); // brighter, slightly gilded landmark
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
      const s = poetStarSize(p, fam);
      size[i] = s;
      baseSize[i] = s;
      seed[i] = (hashStr(p.id) & 0xffff) / 0xffff;
      const [pr, pg, pb] = encodePickColor(i);
      pick[i * 3] = pr;
      pick[i * 3 + 1] = pg;
      pick[i * 3 + 2] = pb;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aPickColor", new THREE.BufferAttribute(pick, 3)); // shared with the GPU picker
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSizeScale: { value: POET_SIZE_SCALE } },
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
          gl_FragColor = vec4(vColor * 2.3, a * vTw); // poets are THE bright stars (fusion)
        }`,
    });
    const points = new THREE.Points(g, m);
    points.frustumCulled = false;
    pickTargets.poets = poets;
    return { points, geometry: g, baseSize, dynId, poets };
  }, []);

  // Build the GPU picker once the geometry exists, and expose it for FlyControls. It SHARES
  // `built.geometry`, so the dynasty-filter aSize writes below also exclude hidden poets from picks.
  useEffect(() => {
    const picker = createGpuPicker(gl, camera, built.geometry, built.poets);
    pickTargets.pick = (x, y, includePoems) => picker.pick(x, y, undefined, includePoems);
    if (import.meta.env.DEV) {
      // Headless round-trip self-test (no effect on the live view): project poet i to screen with a
      // controlled camera, GPU-pick there, and confirm the SAME poet comes back — exercises the full
      // encode → render → readback → decode path. Run from devtools: __shiyunPickTest(0).
      (window as unknown as { __shiyunPickTest?: (i?: number) => unknown }).__shiyunPickTest = (i = 0) => {
        const p = built.poets[i];
        const [lx, ly, lz] = poetPosition(p);
        const [wx, wz] = spinXZ(lx, lz); // LOCAL → WORLD (live spin) — matches the pick group rotation
        const wpos = new THREE.Vector3(wx, ly, wz);
        const el = gl.domElement;
        const cam = new THREE.PerspectiveCamera(55, el.clientWidth / el.clientHeight, 0.1, 18000);
        cam.position.copy(wpos).add(new THREE.Vector3(80, 60, 220));
        cam.lookAt(wpos);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        const ndc = wpos.clone().project(cam); // → screen-centre
        const cssX = (ndc.x * 0.5 + 0.5) * el.clientWidth;
        const cssY = (-ndc.y * 0.5 + 0.5) * el.clientHeight;
        const got = picker.pick(cssX, cssY, cam);
        const gotPoet = got?.kind === "poet" ? got.poet : null;
        return { ok: gotPoet?.id === p.id, want: p.name, got: gotPoet?.name ?? null, gotId: gotPoet?.id ?? null, wantId: p.id };
      };
    }
    return () => {
      picker.dispose();
      pickTargets.pick = null;
    };
  }, [gl, camera, built]);

  // dynasty filter → zero hidden poets' size; the SELECTED poet's star is enlarged so it + its poem
  // cluster read at a glance as one 星群 (the GPU picker shares this aSize, so it's easier to click too).
  useEffect(() => {
    const hide = new Array<boolean>(DYNASTY_COUNT).fill(false);
    for (const d of DYNASTIES) hide[d.id] = hidden.has(d.key);
    const attr = built.points.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      if (hide[built.dynId[i]]) { arr[i] = 0; continue; }
      arr[i] = built.poets[i].id === selId ? built.baseSize[i] * 1.8 : built.baseSize[i];
    }
    attr.needsUpdate = true;
  }, [hidden, built, selId]);

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
