import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useStore } from "../state/store";
import { galaxySpin } from "./galaxyParams";

// Marks where poems were pulled out of the void (a click, or a search-locate).
// Each mark FLARES bright on birth, holds, then linearly fades to a quiet glow —
// so the star you just lit is unmistakable, then settles into the trail instead of
// staying a barely-visible dot. Gold = landed 格律-valid; pale blue = ordinary noise.
// Positions are LOCAL (the group is rotated by the shared galaxy spin), so marks
// drift along with the galaxy rather than hanging in absolute space.
export function PulledStars() {
  const pulls = useStore((s) => s.pulls);
  const spinRef = useRef<THREE.Group>(null);

  const points = useMemo(() => {
    const n = pulls.length;
    const cap = Math.max(n, 1);
    const pos = new Float32Array(cap * 3);
    const col = new Float32Array(cap * 3);
    const t0 = new Float32Array(cap);
    pulls.forEach((p, i) => {
      pos[i * 3] = p.pos[0];
      pos[i * 3 + 1] = p.pos[1];
      pos[i * 3 + 2] = p.pos[2];
      const c = p.valid ? [1.0, 0.86, 0.45] : [0.72, 0.84, 1.0];
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
      t0[i] = p.t0;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aT0", new THREE.BufferAttribute(t0, 1));
    g.setDrawRange(0, n);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uNow: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aT0;
        uniform float uNow;
        varying vec3 vColor; varying float vGlow;
        void main() {
          float age = uNow - aT0;
          float rise = clamp(age / 0.12, 0.0, 1.0);        // quick flare-in (~120ms)
          float k    = clamp((age - 1.6) / 3.5, 0.0, 1.0); // 0 while holding → 1 faded
          float glow = mix(3.4, 0.95, k) * rise;           // peak flash → settled base
          float scl  = mix(2.5, 1.0, k);
          vGlow = glow;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(13.0 * scl * (900.0 / -mv.z), 2.0, 110.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vGlow;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * vGlow, a); // additive: brightness ∝ glow · disc
        }`,
    });
    return new THREE.Points(g, m);
  }, [pulls]);

  useFrame(() => {
    (points.material as THREE.ShaderMaterial).uniforms.uNow.value = performance.now() / 1000;
    if (spinRef.current) spinRef.current.rotation.y = galaxySpin.angle;
  });

  return (
    <group ref={spinRef}>
      <primitive object={points} />
    </group>
  );
}
