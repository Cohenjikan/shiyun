import * as THREE from "three";
import type { PoetRow } from "../data/load";
import { galaxySpin, poemClock } from "./galaxyParams";
import { pickTargets, type PickResult } from "./picking";

// GPU colour-ID picking — replaces the O(29,808)/hover CPU scan in FlyControls.screenPick.
// Each poet's index is colour-encoded into a vertex attribute (aPickColor); on a pick we render
// JUST a tiny window of the poet field around the cursor into an offscreen buffer, read the
// pixels back, and decode the colour → the poet under the cursor in O(1). depthTest keeps the
// front-most star per pixel; a small read window restores the old "click NEAR a star" tolerance.
//
// Two reasons this matters (HANDOFF #0): ① picking is O(1), not a per-hover 29k loop; ② poets no
// longer need to be the brightest discrete points for the CPU heuristic to find them — clickability
// is decoupled from brightness, so the decoration can be brightened toward true fusion without
// breaking clicks. uSizeScale + the gate below mirror the PoetStars shader so the pick disc matches
// the rendered star exactly.

export const POET_SIZE_SCALE = 900; // MUST match the PoetStars vertex shader's uSizeScale

// index i (0-based) → RGB in [0,1]; id = i+1 so colour 0,0,0 (cleared background) reads as a MISS.
export function encodePickColor(i: number): [number, number, number] {
  const id = i + 1;
  return [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255];
}

// Poems share the 24-bit id space with poets but live ABOVE this base (poets use 1..29,808), so a
// decoded id ≥ POEM_PICK_BASE is a poem-planet. 0x800000 + max poems (~858k) < 16.7M → fits 24-bit.
export const POEM_PICK_BASE = 0x800000;
export function encodePoemPickColor(localId: number): [number, number, number] {
  const id = POEM_PICK_BASE + localId; // always > poet ids and > 0 (never the background miss)
  return [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255];
}

// Like nearestPoetIndex but returns the RAW decoded id (0 = miss) so the caller can split poet vs poem.
export function nearestPickId(buf: Uint8Array, n: number, radius: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4;
      const id = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
      if (id === 0) continue;
      const dx = x - radius, dy = y - radius;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = id; }
    }
  }
  return best;
}

// Scan an N×N RGBA readback for the non-background pixel CLOSEST to the window centre (the cursor),
// decode its colour → poet index. Distance-to-centre is symmetric so the WebGL row-flip is moot.
export function nearestPoetIndex(buf: Uint8Array, n: number, radius: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4;
      const id = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
      if (id === 0) continue; // background / gated-out / hidden → miss
      const dx = x - radius, dy = y - radius;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = id - 1;
      }
    }
  }
  return best;
}

export interface GpuPicker {
  pick(cssX: number, cssY: number, cameraOverride?: THREE.Camera, includePoems?: boolean): PickResult | null;
  dispose(): void;
}

// `geometry` is SHARED with the visual PoetStars points (same position + aSize buffers, including
// the dynasty-filter writes that zero a hidden poet's aSize), plus an aPickColor attribute. So the
// pick pass automatically tracks hover/filter state with zero extra bookkeeping.
export function createGpuPicker(
  gl: THREE.WebGLRenderer,
  defaultCamera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  poets: PoetRow[],
): GpuPicker {
  const material = new THREE.ShaderMaterial({
    transparent: false,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NoBlending,
    uniforms: { uSizeScale: { value: POET_SIZE_SCALE }, uGate: { value: 4.4 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute vec3 aPickColor;
      uniform float uSizeScale; uniform float uGate;
      varying vec3 vPick;
      void main() {
        if (aSize < 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; } // hidden
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float sz = aSize * (uSizeScale / -mv.z); // SAME apparent size as the visual star
        // gate: only deliberately-resolved stars are clickable, so the void between them stays
        // pull-able (matches the old apparent-size>=2.2 CSS-px gate). uGate is in drawing-buffer px.
        if (sz < uGate) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        gl_PointSize = clamp(sz, uGate, 70.0);
        vPick = aPickColor;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vPick;
      void main() {
        if (length(gl_PointCoord - 0.5) > 0.5) discard; // round disc → clickable area = the glow disc
        gl_FragColor = vec4(vPick, 1.0);
      }`,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const group = new THREE.Group(); // rotates with the shared galaxy spin (== the visual poet group)
  group.add(points);
  const scene = new THREE.Scene();
  scene.add(group);

  // Poem-planet pick layer — rendered in the SAME pass as the poets (depth-tested → front-most wins),
  // ONLY on click (includePoems), so hover stays cheap. Apparent size mirrors the visual planet shader
  // (uScale/maxPx supplied per active layer) so the clickable disc matches the drawn planet.
  const poemMat = new THREE.ShaderMaterial({
    transparent: false,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NoBlending,
    uniforms: { uScale: { value: 360 }, uMax: { value: 11 }, uGate: { value: 3.0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aPickColor; attribute vec3 aCenter; attribute float aOmega;
      uniform float uScale; uniform float uMax; uniform float uGate; uniform float uTime;
      varying vec3 vPick;
      void main() {
        // self-rotate exactly like the visual planet shader so the click lands where it's drawn
        vec3 off0 = position - aCenter;
        float ang = uTime * aOmega;
        float c = cos(ang), s = sin(ang);
        vec3 wp = aCenter + vec3(off0.x * c - off0.z * s, off0.y, off0.x * s + off0.z * c);
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        float sz = clamp(uScale / -mv.z, 1.0, uMax); // SAME apparent size as the visual planet
        if (sz < uGate) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        gl_PointSize = clamp(sz, uGate, uMax);
        vPick = aPickColor;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vPick;
      void main() {
        if (length(gl_PointCoord - 0.5) > 0.5) discard; // round disc = the planet's clickable area
        gl_FragColor = vec4(vPick, 1.0);
      }`,
  });
  const emptyGeo = new THREE.BufferGeometry();
  const poemPoints = new THREE.Points(emptyGeo, poemMat);
  poemPoints.frustumCulled = false;
  poemPoints.visible = false;
  group.add(poemPoints); // same group → shares the galaxy-spin rotation as the poems' visual layer

  const rt = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  let buf = new Uint8Array(4);
  const sizeV = new THREE.Vector2();
  const clearC = new THREE.Color();

  function pick(
    cssX: number,
    cssY: number,
    camera: THREE.Camera = defaultCamera,
    includePoems = false,
  ): PickResult | null {
    const pr = gl.getPixelRatio();
    gl.getDrawingBufferSize(sizeV);
    const fullW = sizeV.x, fullH = sizeV.y;
    if (fullW < 1 || fullH < 1) return null;
    const gate = 4.4 * pr; // == old apparent>=2.2 CSS-px gate (diameter), in drawing-buffer px
    const radius = Math.max(2, Math.round(6 * pr)); // ~6 CSS-px click tolerance, drawing-buffer px
    const n = radius * 2 + 1;
    if (rt.width !== n) {
      rt.setSize(n, n);
      buf = new Uint8Array(n * n * 4);
    }
    const dbx = Math.floor(cssX * pr), dby = Math.floor(cssY * pr);

    // sync the pick group to the live spin (exact float match with the visual poet group) + gate
    group.rotation.y = galaxySpin.angle;
    (material.uniforms.uGate.value as number) = gate;

    // poem-planet layer (CLICK only — keeps hover at just the 29k poets). Swap to whatever PoemOrbits
    // currently shows (selected poet's poems, or all) + mirror its apparent size so the pick disc
    // matches the drawn planet. Both layers share `group`, so they spin together and depth-test as one.
    const layer = includePoems ? pickTargets.poemLayer : null;
    if (layer) {
      if (poemPoints.geometry !== layer.geometry) poemPoints.geometry = layer.geometry;
      (poemMat.uniforms.uScale.value as number) = layer.sizeScale;
      (poemMat.uniforms.uMax.value as number) = layer.maxPx;
      (poemMat.uniforms.uGate.value as number) = Math.min(gate, 3.0 * pr); // planets are smaller than stars
      (poemMat.uniforms.uTime.value as number) = poemClock.t; // match the visual self-rotation at click time
      poemPoints.visible = true;
    } else {
      poemPoints.visible = false;
    }
    group.updateMatrixWorld(true);

    // render ONLY the n×n window of the full framebuffer centred on the cursor pixel into the n×n
    // RT (1:1 mapping → gl_PointSize stays in true framebuffer px). All 29k vertices run but the
    // fragment shader touches ~n² pixels. setViewOffset/clearViewOffset live on Perspective/Ortho
    // cameras (not the Camera base type), hence the structural cast.
    const view = camera as unknown as {
      setViewOffset(fw: number, fh: number, x: number, y: number, w: number, h: number): void;
      clearViewOffset(): void;
    };
    view.setViewOffset(fullW, fullH, dbx - radius, dby - radius, n, n);

    const prevRT = gl.getRenderTarget();
    const prevAlpha = gl.getClearAlpha();
    gl.getClearColor(clearC);
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0); // background = id 0 = miss
    gl.clear(true, true, false);
    try {
      gl.render(scene, camera);
    } finally {
      // ALWAYS restore renderer + camera, even if render throws — otherwise the main r3f loop stays
      // bound to the pick RT and the camera stays stuck on the n×n viewOffset, corrupting every frame.
      gl.setRenderTarget(prevRT);
      gl.setClearColor(clearC, prevAlpha);
      view.clearViewOffset();
    }

    gl.readRenderTargetPixels(rt, 0, 0, n, n, buf);
    const id = nearestPickId(buf, n, radius);
    if (id <= 0) return null;
    if (id >= POEM_PICK_BASE) {
      const r = layer?.resolve(id - POEM_PICK_BASE) ?? null; // decode poem-planet → poet + poem index
      return r ? { kind: "poem", poet: r.poet, poemIdx: r.poemIdx } : null;
    }
    const i = id - 1; // poet id = index + 1
    return i >= 0 && i < poets.length ? { kind: "poet", poet: poets[i] } : null;
  }

  function dispose() {
    material.dispose();
    poemMat.dispose();
    emptyGeo.dispose();
    rt.dispose();
  }

  return { pick, dispose };
}
