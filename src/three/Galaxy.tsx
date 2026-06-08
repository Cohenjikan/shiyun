import * as THREE from "three";
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { discTexture } from "./disc";
import { GALAXY, gauss3, advanceSpin, galaxySpin } from "./galaxyParams";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ARMS = 20000;
const BULGE = 8000;
const TOTAL = ARMS + BULGE;

const cBulge = new THREE.Color("#ffd9a0");
const cMid = new THREE.Color("#ffffff");
const cArm = new THREE.Color("#6f9bff");
const cBlue = new THREE.Color("#aaccff");

// Realistic spiral galaxy backdrop (Points + differential-rotation shader).
export function Galaxy() {
  const built = useMemo(() => {
    const rnd = mulberry32(31337);
    const R = GALAXY.RADIUS;
    const pos = new Float32Array(TOTAL * 3);
    const col = new Float32Array(TOTAL * 3);
    const scale = new Float32Array(TOTAL);
    const c = new THREE.Color();

    for (let i = 0; i < TOTAL; i++) {
      let x: number, y: number, z: number, t: number, armProx = 0;
      if (i < ARMS) {
        // spiral arm population
        const rr = Math.pow(rnd(), 1.6) * R;
        t = rr / R;
        const branch = ((i % GALAXY.BRANCHES) / GALAXY.BRANCHES) * Math.PI * 2;
        const twist = t * GALAXY.TWIST;
        const armDev = gauss3(rnd(), rnd(), rnd()) * GALAXY.ARM_SPREAD;
        armProx = Math.exp(-((armDev / GALAXY.ARM_SPREAD) ** 2) * 2);
        const ang = branch + twist + armDev;
        const sc = (v: number) => Math.pow(rnd(), 2.6) * (rnd() < 0.5 ? -1 : 1) * v * rr;
        x = Math.cos(ang) * rr + sc(0.18);
        z = Math.sin(ang) * rr + sc(0.18);
        y = gauss3(rnd(), rnd(), rnd()) * rr * GALAXY.THICKNESS;
      } else {
        // central bulge — round, warm, no spin
        const rr = Math.abs(gauss3(rnd(), rnd(), rnd())) * R * 0.16;
        t = Math.min(0.45, rr / R);
        const phi = rnd() * Math.PI * 2;
        x = Math.cos(phi) * rr;
        z = Math.sin(phi) * rr;
        y = gauss3(rnd(), rnd(), rnd()) * rr * 0.6;
        armProx = 0.2;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      // 3-stop radial gradient + arm blue-bias + jitter
      if (t < 0.5) c.copy(cBulge).lerp(cMid, t / 0.5);
      else c.copy(cMid).lerp(cArm, (t - 0.5) / 0.5);
      c.lerp(cBlue, armProx * 0.4);
      const bright = (0.82 + armProx * 0.45) * (0.85 + rnd() * 0.3);
      col[i * 3] = c.r * bright;
      col[i * 3 + 1] = c.g * bright;
      col[i * 3 + 2] = c.b * bright;
      scale[i] = (i < ARMS ? 0.5 + (1 - t) * 1.1 : 1.5) * (0.7 + rnd() * 0.6);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aScale", new THREE.BufferAttribute(scale, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 3.2 } },
      // The whole spiral spins as a rigid pattern via the object's rotation.y
      // (see useFrame below), shared with the poet layer — no in-shader spin here,
      // so backdrop and poets wind the SAME way and turn in lockstep.
      vertexShader: /* glsl */ `
        uniform float uSize;
        attribute vec3 aColor; attribute float aScale;
        varying vec3 vColor;
        void main() {
          vec4 vp = viewMatrix * modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * vp;
          gl_PointSize = clamp(uSize * aScale * (900.0 / -vp.z), 0.6, 30.0);
          vColor = aColor;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float s = 1.0 - distance(gl_PointCoord, vec2(0.5)) * 2.0;
          if (s < 0.02) discard;
          s = pow(max(s, 0.0), 3.5);
          gl_FragColor = vec4(vColor * s, s);
        }`,
    });
    const points = new THREE.Points(g, m);
    points.frustumCulled = false;

    // cheap "bloom": two big dim additive glow sprites at the core
    const grp = new THREE.Group();
    grp.add(points);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: discTexture(),
        color: new THREE.Color("#ffdca0"),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.32,
      }),
    );
    glow.scale.set(1020, 1020, 1);
    grp.add(glow);
    const glow2 = glow.clone();
    glow2.material = (glow.material as THREE.SpriteMaterial).clone();
    (glow2.material as THREE.SpriteMaterial).color = new THREE.Color("#fff2d8");
    glow2.scale.set(560, 560, 1);
    grp.add(glow2);

    // faint far star dome
    {
      const n = 5000;
      const dp = new Float32Array(n * 3);
      const dc = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const RR = 7200;
        const th = rnd() * Math.PI * 2;
        const ph = Math.acos(2 * rnd() - 1);
        dp[i * 3] = RR * Math.sin(ph) * Math.cos(th);
        dp[i * 3 + 1] = RR * Math.cos(ph);
        dp[i * 3 + 2] = RR * Math.sin(ph) * Math.sin(th);
        const gg = 0.5 + rnd() * 0.5;
        dc[i * 3] = gg;
        dc[i * 3 + 1] = gg;
        dc[i * 3 + 2] = gg * 1.05;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
      dg.setAttribute("color", new THREE.BufferAttribute(dc, 3));
      const dome = new THREE.Points(
        dg,
        new THREE.PointsMaterial({
          size: 18,
          sizeAttenuation: true,
          vertexColors: true,
          map: discTexture(),
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          alphaTest: 0.01,
          blending: THREE.AdditiveBlending,
        }),
      );
      dome.frustumCulled = false;
      grp.add(dome);
    }

    return { grp, points };
  }, []);

  useFrame((_, dt) => {
    // single owner of the shared spin clock (Galaxy mounts at boot, before the
    // poet layer); everyone else just reads galaxySpin.angle.
    advanceSpin(dt);
    built.points.rotation.y = galaxySpin.angle; // bloom sprites + far dome stay fixed
  });

  return <primitive object={built.grp} />;
}
