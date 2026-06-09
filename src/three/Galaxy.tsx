import * as THREE from "three";
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useStore } from "../state/store";
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

// cheap smooth value-noise on a 2D lattice → density clumping / dust gaps so the arms read as
// real (clumpy) nebulosity rather than clean mathematical spirals.
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const n00 = h(xi, zi), n10 = h(xi + 1, zi), n01 = h(xi, zi + 1), n11 = h(xi + 1, zi + 1);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

// Three populations (research: dexyfex Gaussian-falloff density fields + beltoforion exponential
// disk / concentrated bulge + Bruno-Simon branch skeleton):
//   • DUST  — many tiny dim soft sprites; this IS the nebulosity that fills the gaps.
//   • STARS — fewer, larger, brighter resolved stars on the arms (with sparse pink HII knots).
//   • BULGE — a dense particle cloud on a steep exponential radius, so the bright core accumulates
//             SMOOTHLY from additive overlap (no hard glow-sprite → no abrupt white blob).
const cCore = new THREE.Color("#fff1d6"); // warm old-star bulge (~4500 K)
const cInner = new THREE.Color("#fff7ec");
const cMid = new THREE.Color("#ffffff");
const cArm = new THREE.Color("#cfe0ff"); // blue-white young arm stars (~9000 K, less saturated)
const cHII = new THREE.Color("#ff6d92"); // pink HII regions

export function Galaxy() {
  const quality = useStore((s) => s.quality);
  const built = useMemo(() => {
    const hi = quality === "high";
    // FUSION: the bright DISCRETE points should read as the (clickable) poets, not decoration.
    // So the backdrop is mostly diffuse haze + a soft core; few discrete decoration "stars" (and
    // those are dimmer/smaller below) → flying through, the resolvable stars are real poets.
    const DUST = hi ? 120000 : 42000; // soft dim haze (the nebulosity that fills the arms)
    const STARS = hi ? 9000 : 3500; // few faint decoration stars (poets are THE arm stars now)
    const BULGE = hi ? 64000 : 24000; // dense core cloud — denser + wider (round-5) → fills the centre
    const TOTAL = DUST + STARS + BULGE;
    const rnd = mulberry32(31337);
    const R = GALAXY.RADIUS;
    const NF = 4.2 / R; // noise frequency
    const pos = new Float32Array(TOTAL * 3);
    const col = new Float32Array(TOTAL * 3);
    const scale = new Float32Array(TOTAL);
    const c = new THREE.Color();

    // exponential-disk radius (inverse-transform): dense centre → sparse edge, no banding.
    const expR = (h: number, cap: number) => Math.min(cap, -h * Math.log(1 - rnd() * 0.9999));

    for (let i = 0; i < TOTAL; i++) {
      const isBulge = i >= DUST + STARS;
      const isStar = !isBulge && i >= DUST;
      let x: number, y: number, z: number, t: number, armProx = 0, bright: number, hii = false;

      if (isBulge) {
        // DIFFUSE, irregular core haze — NOT a tight regular dot-ball. A wider, softer exponential
        // cloud + jitter + noise-driven density so the centre reads as blurred, disordered nebulosity
        // (like a real galaxy's core) rather than a structured grid of white dots. The ORDERED poet
        // + arm layer outside is what should carry the map's "logic"; the core is just a white haze.
        const rr = expR(R * 0.10, R * 0.42); // wider spread + larger cap → covers more of the centre
        t = rr / R;
        const phi = rnd() * Math.PI * 2;
        const ct = 2 * rnd() - 1; // cos(theta) for a (flattened) sphere
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        x = rr * st * Math.cos(phi) + R * 0.05 * (rnd() - 0.5); // jitter → irregular, not a clean shell
        z = rr * st * Math.sin(phi) + R * 0.05 * (rnd() - 0.5);
        y = rr * ct * 0.6 + R * 0.03 * (rnd() - 0.5);
        armProx = 0.2;
        // dimmer per-particle so additive overlap accumulates into SMOOTH haze (no grainy bright
        // dots), with value-noise clumping so the density is uneven/disordered.
        const nz = vnoise(x * NF * 1.6, z * NF * 1.6);
        bright = (0.80 - t * 0.75) * (0.55 + rnd() * 0.5) * (0.7 + nz * 0.75); // modest floor lift → no dark patches
      } else {
        // disk: spiral arm population on an exponential radius
        const rr = expR(R * 0.27, R) + R * 0.015;
        t = rr / R;
        const branch = (Math.floor(rnd() * GALAXY.BRANCHES) / GALAXY.BRANCHES) * Math.PI * 2;
        const twist = t * GALAXY.TWIST;
        const armDev = gauss3(rnd(), rnd(), rnd()) * GALAXY.ARM_SPREAD;
        armProx = Math.exp(-((armDev / GALAXY.ARM_SPREAD) ** 2) * 2.2);
        // Near the core the 4 arms converge into a bright X with dark wedges between. Randomise the
        // angle FULLY there (strong at the centre → gone by t≈0.45) so the inner backdrop fills into
        // a round disc — no inter-arm dark zones (round-5 feedback). Arms stay intact further out.
        const cb = Math.max(0, 0.45 - t) / 0.45;
        const ang = branch + twist + armDev + (rnd() - 0.5) * Math.PI * 2 * cb * cb;
        const scatter = (v: number) => Math.pow(rnd(), 2.6) * (rnd() < 0.5 ? -1 : 1) * v * rr;
        // extra absolute in-plane scatter peaking at the core → fills the central region uniformly
        const coreFill = cb * cb * R * 0.07;
        x = Math.cos(ang) * rr + scatter(0.16) + (rnd() - 0.5) * 2 * coreFill;
        z = Math.sin(ang) * rr + scatter(0.16) + (rnd() - 0.5) * 2 * coreFill;
        y = gauss3(rnd(), rnd(), rnd()) * rr * GALAXY.THICKNESS * (isStar ? 0.8 : 1.1);
        // clumping + dust gaps from value noise; brighter on-arm
        const nz = vnoise(x * NF, z * NF);
        // dimmer decoration stars (fusion): they no longer rival the poet stars in brightness
        const armBoost = isStar ? 0.42 + armProx * 1.0 : 0.34 + armProx * 0.75;
        // lift the inter-arm + noise floor toward the core so the filled centre has no black gaps
        bright = (armBoost + cb * 0.4) * (0.45 + cb * 0.25 + nz * 0.8) * (0.8 + rnd() * 0.4);
        if (isStar && armProx > 0.55 && rnd() < 0.04) hii = true; // sparse HII knots on arms
      }

      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      // colour: warm core → white mid → blue-white arms; lerp toward arm by arm-proximity
      if (t < 0.12) c.copy(cCore).lerp(cInner, t / 0.12);
      else if (t < 0.4) c.copy(cInner).lerp(cMid, (t - 0.12) / 0.28);
      else c.copy(cMid).lerp(cArm, Math.min(1, (t - 0.4) / 0.5));
      if (!isBulge) c.lerp(cArm, armProx * 0.45);
      if (hii) c.copy(cHII);
      col[i * 3] = c.r * bright;
      col[i * 3 + 1] = c.g * bright;
      col[i * 3 + 2] = c.b * bright;

      // sizes: dust tiny, stars larger/sparser; bulge LARGER + softer so its particles blur together
      // into continuous haze instead of resolving as discrete dots; HII a touch bigger
      scale[i] = isBulge
        ? (1.5 + (0.3 - t) * 2.6) * (0.7 + rnd() * 0.7)
        : isStar
          ? (0.7 + armProx * 0.8 + (hii ? 0.8 : 0)) * (0.7 + rnd() * 0.6) // smaller decoration stars
          : (0.5 + (1 - t) * 0.8) * (0.7 + rnd() * 0.5); // dust a touch larger to keep the haze full
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aScale", new THREE.BufferAttribute(scale, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 3.0 } },
      // The whole spiral spins as a rigid pattern via the object's rotation.y (see useFrame),
      // shared with the poet layer + 赠诗 arcs — no in-shader spin, so all layers wind the SAME
      // way and turn in lockstep.
      vertexShader: /* glsl */ `
        uniform float uSize;
        attribute vec3 aColor; attribute float aScale;
        varying vec3 vColor;
        void main() {
          vec4 vp = viewMatrix * modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * vp;
          gl_PointSize = clamp(uSize * aScale * (900.0 / -vp.z), 0.6, 64.0);
          vColor = aColor;
        }`,
      // Gaussian falloff: soft wide skirts that OVERLAP into a continuous field (no hard dots).
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float a = exp(-d * d * 4.5);
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    const points = new THREE.Points(g, m);
    points.frustumCulled = false;

    const grp = new THREE.Group();
    grp.add(points);

    // one very faint, very large, SMOOTH ambient halo (gaussian gradient, no hard edge) — a soft
    // floor of core glow that bloom (if enabled) lifts further; the bright core itself is particles.
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softGlowTexture(),
        color: new THREE.Color("#ffe9c4"),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.24, // a touch stronger so the smooth core glow comes from haze, not bright dots
      }),
    );
    halo.scale.set(R * 1.05, R * 1.05, 1);
    grp.add(halo);

    // faint far star dome
    {
      const n = 5200;
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
          size: 16,
          sizeAttenuation: true,
          vertexColors: true,
          map: softGlowTexture(),
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
  }, [quality]);

  // dispose the previous galaxy's geometries/materials when quality rebuilds it
  useEffect(() => {
    const grp = built.grp;
    return () => {
      grp.traverse((o) => {
        const mesh = o as THREE.Points;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        mat?.dispose();
      });
    };
  }, [built]);

  useFrame((_, dt) => {
    // single owner of the shared spin clock (Galaxy mounts at boot, before the poet layer);
    // everyone else just reads galaxySpin.angle.
    advanceSpin(dt);
    built.points.rotation.y = galaxySpin.decorAngle; // backdrop spins FASTER than poets (differential)
  });

  return <primitive object={built.grp} />;
}

// smooth gaussian-ish radial gradient (softer than disc.ts's hard core) for ambient glow.
let _soft: THREE.Texture | null = null;
function softGlowTexture(): THREE.Texture {
  if (_soft) return _soft;
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.18, "rgba(255,255,255,0.38)");
  g.addColorStop(0.45, "rgba(255,255,255,0.09)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _soft = new THREE.CanvasTexture(cv);
  _soft.needsUpdate = true;
  return _soft;
}
