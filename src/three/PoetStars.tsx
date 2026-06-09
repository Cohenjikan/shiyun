import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { DYNASTY_BY_KEY, DYNASTIES, DYNASTY_COUNT, bandRadius, hashStr, R_MIN, R_MAX } from "../data/dynasties";
import { getPoets, type PoetRow } from "../data/load";
import { FAMOUS_POETS } from "../data/famousPoets";
import { useStore } from "../state/store";
import { pickTargets } from "./picking";
import { createGpuPicker, encodePickColor, POET_SIZE_SCALE } from "./gpuPick";
import { GALAXY, gauss3, galaxySpin, spinXZ } from "./galaxyParams";

// Iconic poets → brighter + larger landmark stars (a sense of "明星" distinction).
const FAMOUS = new Set(FAMOUS_POETS.map((f) => f.name));
const WHITE = new THREE.Color("#ffffff");

// Deterministic galaxy position. Mean radius = dynasty shell (time = depth) but with a GAUSSIAN
// radial spread that BLEEDS into neighbouring dynasty bands, so the colours blend into a gradient
// instead of hard concentric rings; angle is biased onto the spiral arms (same arms as the
// backdrop). Y uses a thicker gaussian that swells toward the centre (bulge) for visual depth.
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
  // Near the centre the 4 arms converge into a hard CROSS/X. Spread poets fully azimuthally there
  // (strong at the core, gone by t≈0.42) so the centre reads as a ROUND bulge blended into the
  // diffuse galaxy core — not a stark cross of dots. Keeps the spiral arms intact further out.
  const az = ((h >>> 24) & 0xff) / 255;
  // Wider, stronger azimuthal dissolve: full random angle over the whole core out to t≈0.5
  // (was 0.42) so the 4-arm X is gone and the centre reads as a filled round disc, not a cross.
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
  // The rr-scaled scatter shrinks to ~0 near the centre, so the core stays a tight concentrated
  // shape. Add a strong ABSOLUTE in-plane x/z scatter that peaks at the core and fades by t≈0.5,
  // dissolving the centre into a diffuse round cloud (round-5 feedback — push it HARD: fill the
  // whole central region, no inter-arm dark wedges). Tune `0.22` on a real GPU if it over/under-fills.
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
      const s = (1.4 + p.clusterSize * 0.32) * (fam ? 2.4 : 1);
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
    pickTargets.pick = (x, y) => picker.pick(x, y);
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
        return { ok: got?.id === p.id, want: p.name, got: got?.name ?? null, gotId: got?.id ?? null, wantId: p.id };
      };
    }
    return () => {
      picker.dispose();
      pickTargets.pick = null;
    };
  }, [gl, camera, built]);

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
