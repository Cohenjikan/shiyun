import * as THREE from "three";
import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useStore } from "../state/store";
import { getPoet, loadGifts } from "../data/load";
import { DYNASTIES, DYNASTY_COUNT, displayDynasty, displayDynastyKey } from "../data/dynasties";
import { poetPosition } from "./PoetStars";
import { galaxySpin } from "./galaxyParams";
import type { GiftEdge } from "../data/contract";

// 赠诗 network: soft curved filaments between poets one dedicated a poem to (寄/赠/和/次韵…).
// Each edge is a cubic Bézier whose two control points are pulled TOWARD the galaxy centre, so
// edges bundle into elegant flowing束线 (a poor-man's hierarchical edge bundling) instead of a
// straight web. A shader sends a soft pulse along each arc giver→receiver (flow direction).
// Endpoints fade so lines emerge gently from the stars; selecting a poet lights a clean ego-net.
const STEPS = 26;
const BUNDLE = 0.3; // control-point pull toward the centre (0 = straight chords, 1 = through core)
const AMBIENT_MIN_W = 3; // with no poet selected, only the strongest relationships (cleaner)
const CENTER = new THREE.Vector3(0, 0, 0);

interface Edge {
  pts: Float32Array; // (STEPS+1)*3 cubic samples
  base: Float32Array; // (STEPS+1)*3 dynasty-lerp colour × endpoint fade
  fromDyn: string;
  toDyn: string;
  from: string;
  to: string;
  w: number;
  seed: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _v = new THREE.Vector3();
const _ca = new THREE.Color();
const _cb = new THREE.Color();
const _cc = new THREE.Color();

export function GiftLines() {
  const showGifts = useStore((s) => s.showGifts);
  const hidden = useStore((s) => s.hidden);
  const selId = useStore((s) => s.selectedPoet?.id ?? null);
  const pathDimEgo = useStore((s) => s.pathDimEgo); // 弱化往来线,突出路径 (item 4)
  const giftHoverId = useStore((s) => s.giftHoverId); // 悬停高亮的往来线对方 (item 6)
  const [raw, setRaw] = useState<GiftEdge[] | null>(null);

  useEffect(() => {
    if (showGifts && !raw) loadGifts().then(setRaw);
  }, [showGifts, raw]);

  // resolve each edge to a centre-bundled, endpoint-faded curve once (per dataset)
  const edges = useMemo<Edge[]>(() => {
    if (!raw) return [];
    const fallback = DYNASTIES[DYNASTY_COUNT - 1];
    const out: Edge[] = [];
    for (const [from, to, w] of raw) {
      const pf = getPoet(from);
      const pt = getPoet(to);
      if (!pf || !pt) continue;
      _a.set(...poetPosition(pf));
      _b.set(...poetPosition(pt));
      // control points along the chord (⅓, ⅔) then pulled toward the galactic centre → bundling
      _c1.lerpVectors(_a, _b, 0.33).lerp(CENTER, BUNDLE);
      _c2.lerpVectors(_a, _b, 0.67).lerp(CENTER, BUNDLE);
      _ca.set((displayDynasty(pf) ?? fallback).color);
      _cb.set((displayDynasty(pt) ?? fallback).color);

      const pts = new Float32Array((STEPS + 1) * 3);
      const base = new Float32Array((STEPS + 1) * 3);
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        const u = 1 - t;
        // cubic Bézier B(t) = u³a + 3u²t c1 + 3ut² c2 + t³ b
        _v.set(0, 0, 0)
          .addScaledVector(_a, u * u * u)
          .addScaledVector(_c1, 3 * u * u * t)
          .addScaledVector(_c2, 3 * u * t * t)
          .addScaledVector(_b, t * t * t);
        pts[s * 3] = _v.x;
        pts[s * 3 + 1] = _v.y;
        pts[s * 3 + 2] = _v.z;
        const fade = Math.sin(Math.PI * t); // 0 at ends → soft emergence
        _cc.copy(_ca).lerp(_cb, t).multiplyScalar(fade);
        base[s * 3] = _cc.r;
        base[s * 3 + 1] = _cc.g;
        base[s * 3 + 2] = _cc.b;
      }
      const seed = ((parseInt(from.slice(0, 6), 16) || 0) % 997) / 997;
      out.push({ pts, base, fromDyn: displayDynastyKey(pf), toDyn: displayDynastyKey(pt), from, to, w, seed });
    }
    return out;
  }, [raw]);

  // stable material (so the flow `uTime` survives geometry rebuilds on selection / filter change)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec3 aColor; attribute float aT; attribute float aSeed;
          varying vec3 vColor; varying float vT; varying float vSeed;
          void main() {
            vColor = aColor; vT = aT; vSeed = aSeed;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor; varying float vT; varying float vSeed;
          uniform float uTime;
          void main() {
            // soft pulse travelling giver(t=0) → receiver(t=1)
            float phase = fract(uTime * 0.16 + vSeed);
            float d = vT - phase; d = d - floor(d + 0.5);   // nearest wrap
            float pulse = smoothstep(0.07, 0.0, abs(d));
            vec3 col = vColor * (1.0 + pulse * 2.2);
            float a = max(max(col.r, col.g), col.b);
            if (a < 0.004) discard;
            gl_FragColor = vec4(col, a);
          }`,
      }),
    [],
  );

  // (re)build geometry on visibility / selection change (curve points are precomputed)
  const object = useMemo(() => {
    if (!edges.length) return null;
    const pos: number[] = [];
    const col: number[] = [];
    const ts: number[] = [];
    const seeds: number[] = [];
    for (const e of edges) {
      if (hidden.has(e.fromDyn) || hidden.has(e.toDyn)) continue;
      const hot = selId !== null && (e.from === selId || e.to === selId);
      if (selId !== null) {
        if (!hot) continue; // selected → clean ego-network
      } else if (e.w < AMBIENT_MIN_W) continue; // ambient → only strong relationships
      const other = e.from === selId ? e.to : e.from;
      const isHover = hot && giftHoverId !== null && other === giftHoverId;
      let factor = hot ? 1.4 : 0.32;
      if (pathDimEgo) factor *= 0.16; // 弱化往来线 → the cyan path / gold trail dominate
      if (isHover) factor = 2.8; // 悬停的那条往来线高亮,好点选
      for (let s = 0; s < STEPS; s++) {
        const i0 = s * 3, i1 = (s + 1) * 3;
        pos.push(e.pts[i0], e.pts[i0 + 1], e.pts[i0 + 2], e.pts[i1], e.pts[i1 + 1], e.pts[i1 + 2]);
        col.push(
          e.base[i0] * factor, e.base[i0 + 1] * factor, e.base[i0 + 2] * factor,
          e.base[i1] * factor, e.base[i1 + 1] * factor, e.base[i1 + 2] * factor,
        );
        ts.push(s / STEPS, (s + 1) / STEPS);
        seeds.push(e.seed, e.seed);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(ts), 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(seeds), 1));
    const ls = new THREE.LineSegments(g, mat);
    ls.frustumCulled = false;
    return ls;
  }, [edges, hidden, selId, pathDimEgo, giftHoverId, mat]);

  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
    // arcs are built from LOCAL poetPosition + the centre (the spin axis), so rotating the
    // whole object by the shared spin keeps every endpoint glued to its (rotating) poet star.
    if (object) object.rotation.y = galaxySpin.angle;
  });

  useEffect(() => {
    return () => {
      object?.geometry.dispose();
    };
  }, [object]);
  useEffect(() => () => mat.dispose(), [mat]);

  if (!showGifts || !object) return null;
  return <primitive object={object} />;
}
