import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useStore } from "../state/store";
import { spinXZ } from "./galaxyParams";
import { mergeClaims, isSameDay, type MeteorClaim } from "../state/claims";
import { ambientPath, ceremonyPath, ceremonyRemap, hashU32, type V3 } from "./meteorPath";
import { meteorPick } from "./meteorPick";
import { ceremonyCam } from "./ceremonyCam";

// 认领的诗 → 流星. The look must belong to 诗云's painterly sky (soft glowing colored particles + bloom),
// NOT a hard white scratch. Real meteors (research): a bright COLOURED head + a fading train that shifts
// colour along its length (head warm/white → cool ionized wake), glowing gas with soft edges — never a
// uniform white line. So each meteor here is:
//   • a soft glowing HEAD knot (same smoothstep halo as the poet stars) that flashes near-star-bright then
//     settles to a small persistent glow, with a gentle sparkle;
//   • a soft, slightly-wider, TAPERED trail with a head→tail COLOUR GRADIENT (warm head → cool/colour tail),
//     a gaussian across-profile so it reads as luminous gas, not a 1px line.
// AMBIENT (others' claims) are dim/subtle and follow the galactic rotation (meteorPath); the CEREMONY (the
// claimer's own) is brighter, warmer-tailed and plunges into the heart (奔赴感). Spawn 2–10 s (dev-adjustable).

const MAX_ALIVE = 16;
const N4 = MAX_ALIVE * 4; // ribbon vertices (one quad per meteor)
// Owner-tuned defaults (dev-tool sliders, 2026-06-28): len 0.75× · width 0.40× · bright 2.05× · head 0.50×
// are BAKED into TAIL_SPAN + PROF below, so meteorLook resets to 1× and these ARE the look. Colour = a
// comet palette: WHITE head → PALE-BLUE tail (owner request).
const TAIL_SPAN = 0.56; // 0.75 base × 0.75 (len)
const END_FADE = 0.24; // fraction of life over which it quickly disappears
const CEREMONY_DELAY = 0.4; // s — let the 定位 flare read before the claimer's streak launches
const REPLAY_COOLDOWN = 150; // s — once every claim has streaked, wait this long then REPLAY the pool at low
// frequency, so an early sky (few claims) doesn't fall permanently dead after one pass (夜空冷却后低频重演)。
const DUR = { today: 2.0, past: 1.8, ceremony: 3.6 }; // seconds (ceremony longer: the 蓄力→奔赴→余韵 remap needs room)

// per-kind look. head/tail = the streak's COMET COLOUR GRADIENT (white head → pale-blue tail). flashBright
// = head brightness at the instant (smoothstep glow + bloom ⇒ star-like flash); baseHead = the PERSISTENT
// soft head knot after the flash; lineAmp = trail brightness (bright enough to ENGAGE bloom so it GLOWS);
// headSmall/headFlash = head point size after/at the flash (small = star-like, not a blob); width = ribbon
// half-width px (gaussian core keeps the bright line thin); flashK = flash decay. (brightness ×2.05, size
// ×0.50, width ×0.40 already folded in.) store.meteorLook still multiplies these live (dev tool).
const WHITE = [1.0, 1.0, 1.0];
const PALE_BLUE = [0.6, 0.78, 1.0];
const PROF = {
  ceremony: { flashBright: 5.3, baseHead: 1.48, lineAmp: 1.74, headSmall: 2750, headFlash: 11000, width: 1.04, flashK: 9, head: WHITE, tail: PALE_BLUE },
  today: { flashBright: 4.7, baseHead: 0.57, lineAmp: 1.03, headSmall: 1600, headFlash: 10000, width: 0.72, flashK: 15, head: WHITE, tail: PALE_BLUE },
  past: { flashBright: 2.25, baseHead: 0.33, lineAmp: 0.62, headSmall: 1300, headFlash: 5500, width: 0.56, flashK: 17, head: [0.85, 0.92, 1.0], tail: [0.55, 0.74, 1.0] },
};

interface Meteor {
  index: string;
  start: V3; // LOCAL
  end: V3; // LOCAL
  birth: number; // clock seconds (ceremony adds CEREMONY_DELAY)
  dur: number;
  bright: boolean; // 今日 (clickable). ceremony is also bright.
  ceremony: boolean;
  cerId: number; // ceremony id (claimCeremony.id, or a synthetic id for dev spawns); -1 for ambient. The
  // camera (ceremonyCam) follows the NEWEST live ceremony = the largest cerId (连续认领跟最新).
  seed: number; // [0,1) per-meteor sparkle phase
}

const lerp = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const toWorld = (p: V3): V3 => {
  const [wx, wz] = spinXZ(p[0], p[2]);
  return [wx, p[1], wz];
};
const seedOf = (index: string) => (hashU32(index + "~tw") & 0xffff) / 0x10000;

function pickNext(pool: MeteorClaim[], spawned: Set<string>, now: number, tz: number): MeteorClaim | null {
  const todays: MeteorClaim[] = [];
  const pasts: MeteorClaim[] = [];
  for (const c of pool) {
    if (spawned.has(c.index)) continue;
    (isSameDay(c.ts, now, tz) ? todays : pasts).push(c);
  }
  const useToday = todays.length > 0 && (pasts.length === 0 || Math.random() < 0.7);
  const from = useToday ? todays : pasts.length ? pasts : todays;
  return from.length ? from[Math.floor(Math.random() * from.length)] : null;
}

export function Meteors() {
  const meteorsOn = useStore((s) => s.meteorsOn);
  const feed = useStore((s) => s.claimFeed);
  const mine = useStore((s) => s.myClaims);
  const { size } = useThree();

  const pool = useMemo(() => mergeClaims(feed?.claims ?? [], mine), [feed, mine]);
  const total = feed?.total ?? pool.length;

  const clock = useRef(0);
  const nextSpawn = useRef(1.2);
  const spawned = useRef<Set<string>>(new Set());
  const appearances = useRef(0);
  const meteors = useRef<Meteor[]>([]);
  const seenCeremony = useRef<Set<number>>(new Set());
  const seenReq = useRef<number>(-1);
  const devCerId = useRef(1e9); // synthetic ceremony ids for DevTool spawns — offset above real claimCeremony.id
  // so a dev ceremony always sorts as "newest" for the camera and never collides with a real ceremony id.
  const res = useRef<[number, number]>([1, 1]);
  res.current = [size.width || 1, size.height || 1];
  const tz = useRef(0);
  useMemo(() => {
    tz.current = new Date().getTimezoneOffset();
  }, []);

  useEffect(() => {
    if (!meteorsOn) meteorPick.alive = [];
  }, [meteorsOn]);

  // release the camera hand-off if this layer unmounts mid-ceremony (otherwise FlyControls would keep
  // chasing a stale head forever — the render loop that clears `active` would no longer run).
  useEffect(() => () => { ceremonyCam.active = false; }, []);

  const obj = useMemo(() => {
    // ── head: a soft glowing knot per meteor (smoothstep halo like the poet stars) with a gentle sparkle ──
    const hPos = new Float32Array(MAX_ALIVE * 3);
    const hCol = new Float32Array(MAX_ALIVE * 3);
    const hSiz = new Float32Array(MAX_ALIVE);
    const hSeed = new Float32Array(MAX_ALIVE);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute("position", new THREE.BufferAttribute(hPos, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute("aColor", new THREE.BufferAttribute(hCol, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute("aSize", new THREE.BufferAttribute(hSiz, 1).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute("aSeed", new THREE.BufferAttribute(hSeed, 1).setUsage(THREE.DynamicDrawUsage));
    hg.setDrawRange(0, 0);
    const hm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aSeed;
        uniform float uTime; varying vec3 vColor; varying float vTw;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize / -mv.z, 1.0, 48.0);
          gl_Position = projectionMatrix * mv;
          vColor = aColor;
          vTw = 0.8 + 0.2 * sin(uTime * 7.0 + aSeed * 6.2831853); // subtle sparkle (like the twinkling stars)
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vTw;
        void main() {
          // soft halo identical to the poet stars (three/PoetStars.tsx) → same sky, + bloom does the 辉光
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.04, d);
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor * a * vTw, a * vTw);
        }`,
    });
    const head = new THREE.Points(hg, hm);
    head.frustumCulled = false;

    // ── tail: a soft tapered ribbon with a head→tail COLOUR GRADIENT (a fat-line quad, gaussian profile) ──
    const tPos = new Float32Array(N4 * 3);
    const aHead = new Float32Array(N4 * 3);
    const aTail = new Float32Array(N4 * 3);
    const aGrad = new Float32Array(N4);
    const aSide = new Float32Array(N4);
    const tCol = new Float32Array(N4 * 3); // head-end colour
    const tColT = new Float32Array(N4 * 3); // tail-end colour
    const aWidth = new Float32Array(N4);
    const index = new Uint16Array(MAX_ALIVE * 6);
    for (let n = 0; n < MAX_ALIVE; n++) {
      const v = n * 4;
      aGrad[v] = 0; aSide[v] = 1;
      aGrad[v + 1] = 0; aSide[v + 1] = -1;
      aGrad[v + 2] = 1; aSide[v + 2] = -1;
      aGrad[v + 3] = 1; aSide[v + 3] = 1;
      const i = n * 6;
      index[i] = v; index[i + 1] = v + 1; index[i + 2] = v + 2;
      index[i + 3] = v; index[i + 4] = v + 2; index[i + 5] = v + 3;
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute("aHead", new THREE.BufferAttribute(aHead, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute("aTail", new THREE.BufferAttribute(aTail, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute("aGrad", new THREE.BufferAttribute(aGrad, 1));
    tg.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
    tg.setAttribute("aColor", new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute("aColorTail", new THREE.BufferAttribute(tColT, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute("aWidth", new THREE.BufferAttribute(aWidth, 1).setUsage(THREE.DynamicDrawUsage));
    tg.setIndex(new THREE.BufferAttribute(index, 1));
    tg.setDrawRange(0, 0);
    const tm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uResolution: { value: new THREE.Vector2(1, 1) } },
      vertexShader: /* glsl */ `
        attribute vec3 aHead; attribute vec3 aTail; attribute float aGrad; attribute float aSide;
        attribute vec3 aColor; attribute vec3 aColorTail; attribute float aWidth;
        uniform vec2 uResolution;
        varying vec3 vColor; varying vec3 vColorT; varying float vGrad; varying float vSide;
        void main() {
          vColor = aColor; vColorT = aColorTail; vGrad = aGrad; vSide = aSide;
          vec4 hC = projectionMatrix * modelViewMatrix * vec4(aHead, 1.0);
          vec4 tC = projectionMatrix * modelViewMatrix * vec4(aTail, 1.0);
          vec4 base = mix(tC, hC, aGrad);
          vec2 hN = hC.xy / hC.w, tN = tC.xy / tC.w;
          vec2 d = (hN - tN) * uResolution;
          float dl = length(d);
          vec2 dir = dl > 0.0001 ? d / dl : vec2(1.0, 0.0);
          vec2 perp = vec2(-dir.y, dir.x);
          float w = aWidth * mix(0.2, 1.0, aGrad); // teardrop: thin at tail, full at head
          base.xy += perp * (aSide * w) * 2.0 / uResolution * base.w;
          gl_Position = base;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying vec3 vColorT; varying float vGrad; varying float vSide;
        void main() {
          float along = pow(clamp(vGrad, 0.0, 1.0), 1.7);  // bright at head → 0 at tail
          float across = exp(-vSide * vSide * 3.0);        // gaussian: thin bright core, soft glowing edges
          vec3 col = mix(vColorT, vColor, clamp(vGrad, 0.0, 1.0)); // tail hue → head hue along the streak
          float a = along * across;
          if (a < 0.003) discard;
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    const tail = new THREE.Mesh(tg, tm);
    tail.frustumCulled = false;
    return { head, hg, hPos, hCol, hSiz, hSeed, hm, tail, tg, tPos, aHead, aTail, tCol, tColT, aWidth, tm };
  }, []);

  useFrame((_, dt) => {
    if (useStore.getState().cinema) return; // 留影冻结:不改 ceremonyCam.active(与 meteorPick 同样的冻结自洽)
    if (!meteorsOn) {
      if (meteorPick.alive.length) meteorPick.alive = [];
      if (ceremonyCam.active) ceremonyCam.active = false; // 流星关 → 交还相机
      if (meteors.current.length) {
        meteors.current = [];
        obj.hg.setDrawRange(0, 0);
        obj.tg.setDrawRange(0, 0);
      }
      return;
    }
    clock.current += Math.min(dt, 0.05);
    const t = clock.current;
    obj.tm.uniforms.uResolution.value.set(res.current[0], res.current[1]);
    obj.hm.uniforms.uTime.value = t;
    const now = Date.now();
    const st = useStore.getState();

    // ── ceremony: the claimer's own poem, launched once from where it was just located (keeps 奔赴感) ──
    const cer = st.claimCeremony;
    if (cer && !seenCeremony.current.has(cer.id) && meteors.current.length < MAX_ALIVE) {
      seenCeremony.current.add(cer.id);
      spawned.current.add(cer.index);
      const { start, end } = ceremonyPath(cer.pos, cer.index);
      meteors.current.push({ index: cer.index, start, end, birth: t + CEREMONY_DELAY, dur: DUR.ceremony, bright: true, ceremony: true, cerId: cer.id, seed: seedOf(cer.index) });
    }

    // ── dev tool: spawn ONE meteor of a chosen kind RIGHT NOW (bypasses the cap/throttle; synthetic index) ──
    const req = st.meteorSpawnReq;
    if (req && req.id !== seenReq.current && meteors.current.length < MAX_ALIVE) {
      seenReq.current = req.id;
      const index = String(100000003 + Math.floor(Math.random() * 999999937));
      if (req.kind === "ceremony") {
        const a = Math.random() * Math.PI * 2, r = 900 + Math.random() * 1600;
        const from: V3 = [Math.cos(a) * r, (Math.random() - 0.5) * 280, Math.sin(a) * r];
        const { start, end } = ceremonyPath(from, index);
        meteors.current.push({ index, start, end, birth: t, dur: DUR.ceremony, bright: true, ceremony: true, cerId: devCerId.current++, seed: seedOf(index) });
      } else {
        const bright = req.kind === "today";
        const { start, end } = ambientPath(index);
        meteors.current.push({ index, start, end, birth: t, dur: bright ? DUR.today : DUR.past, bright, ceremony: false, cerId: -1, seed: seedOf(index) });
      }
    }

    // ── ambient spawn: random gap in [minGap, maxGap] (dev-adjustable; product default 2–10 s) ──
    if (t >= nextSpawn.current) {
      if (pool.length > 0 && !pickNext(pool, spawned.current, now, tz.current)) {
        // pool exhausted (every claim already streaked once) but pool NON-EMPTY → REPLAY: after a long cooldown
        // reset the spawned set so the sky keeps breathing (夜空冷却后低频重演,不再永久死寂). Empty pool never
        // enters (guard) so it can't spin every frame. Ceremony-claimed indices replay as ambient — 本就是一条认领。
        spawned.current.clear();
        appearances.current = 0;
        nextSpawn.current = t + REPLAY_COOLDOWN;
      } else {
        nextSpawn.current = t + st.meteorMinGap + Math.random() * Math.max(0, st.meteorMaxGap - st.meteorMinGap);
        const burst = Math.random() < 0.3 ? 2 : 1;
        for (let k = 0; k < burst; k++) {
          if (appearances.current >= total || meteors.current.length >= MAX_ALIVE) break;
          const cand = pickNext(pool, spawned.current, now, tz.current);
          if (!cand) break;
          spawned.current.add(cand.index);
          appearances.current++;
          const bright = isSameDay(cand.ts, now, tz.current);
          const { start, end } = ambientPath(cand.index);
          meteors.current.push({ index: cand.index, start, end, birth: t, dur: bright ? DUR.today : DUR.past, bright, ceremony: false, cerId: -1, seed: seedOf(cand.index) });
        }
      }
    }

    meteors.current = meteors.current.filter((m) => (t - m.birth) / m.dur < 1);

    // ── camera hand-off: publish the NEWEST live ceremony's WORLD geometry to ceremonyCam so FlyControls can
    // fly the hero-frame WITH the plunge (fixes 根因①). Must run even in the u<0 delay段 (head parked at start
    // → the camera pre-frames the streak before it launches), so it lives BEFORE the render loop's `u<0`
    // continue. Positions are toWorld'd HERE — FlyControls uses them raw (RED LINE: never spinXZ again). A new
    // ceremony (larger cerId) resets `cancelled` so the camera re-engages for the fresh streak; when no
    // ceremony is alive we release control (active=false) so normal camera resumes with no snap. ceremony head
    // rides the SAME remap as the render (蓄力→奔赴→余韵) so the camera tracks where the streak actually is.
    let newest: Meteor | null = null;
    for (const m of meteors.current) if (m.ceremony && (!newest || m.cerId > newest.cerId)) newest = m;
    if (newest) {
      const u = (t - newest.birth) / newest.dur;
      const hu = u < 0 ? 0 : ceremonyRemap(u); // delay段 head parked at start (u<0 → 0)
      const h = toWorld(lerp(newest.start, newest.end, hu));
      const s = toWorld(newest.start);
      const e = toWorld(newest.end);
      if (ceremonyCam.id !== newest.cerId) { ceremonyCam.id = newest.cerId; ceremonyCam.cancelled = false; }
      ceremonyCam.head = h; ceremonyCam.start = s; ceremonyCam.end = e; ceremonyCam.u = u; ceremonyCam.active = true;
    } else if (ceremonyCam.active) {
      ceremonyCam.active = false; // no ceremony alive → hand the camera back (FlyControls resumes, no snap)
    }

    // ── rebuild head + tail + the bright-meteor pick list (look = live dev multipliers) ──
    const look = st.meteorLook;
    const tailSpan = TAIL_SPAN * look.len;
    let n = 0;
    const alive: typeof meteorPick.alive = [];
    for (const m of meteors.current) {
      const u = (t - m.birth) / m.dur;
      if (u < 0) continue; // ceremony pre-delay — located, not yet streaking
      const p = m.ceremony ? PROF.ceremony : m.bright ? PROF.today : PROF.past;
      const flash = Math.exp(-u * p.flashK);
      const endFade = Math.min(1, (1 - u) / END_FADE);
      const headAmp = (p.flashBright * flash + p.baseHead) * endFade * look.bright; // flash → persistent knot
      const headSize = (p.headSmall + p.headFlash * flash) * look.head;
      const lineAmp = (p.lineAmp + p.flashBright * flash * 0.12) * endFade * look.bright;
      const width = p.width * look.width;
      // ceremony 位移吃 remap(蓄力→奔赴→余韵);ambient 保持匀速线性(owner 已锁定其外观,不动)。彗尾锚也过同一
      // remap ⇒ 尾长由**瞬时速度**决定:悬停段尾缩成亮点(此时 flash 最亮)、奔赴段尾拉长、落点段尾收缩(免费的物理正确)。
      const hu = m.ceremony ? ceremonyRemap(u) : u; // head 路程进度
      const [hx, hy, hz] = toWorld(lerp(m.start, m.end, hu)); // head
      const tuRaw = Math.max(0, u - tailSpan);
      const tu = m.ceremony ? ceremonyRemap(tuRaw) : tuRaw; // tail anchor 路程进度
      const [tx, ty, tz2] = toWorld(lerp(m.start, m.end, tu)); // tail anchor (line draws out)
      // head point (head hue)
      obj.hPos[n * 3] = hx; obj.hPos[n * 3 + 1] = hy; obj.hPos[n * 3 + 2] = hz;
      obj.hCol[n * 3] = p.head[0] * headAmp; obj.hCol[n * 3 + 1] = p.head[1] * headAmp; obj.hCol[n * 3 + 2] = p.head[2] * headAmp;
      obj.hSiz[n] = headSize;
      obj.hSeed[n] = m.seed;
      // tail ribbon: head-end colour = head hue, tail-end colour = tail hue (the gradient), both × lineAmp
      const hr = p.head[0] * lineAmp, hg = p.head[1] * lineAmp, hb = p.head[2] * lineAmp;
      const tr = p.tail[0] * lineAmp, tg2 = p.tail[1] * lineAmp, tb = p.tail[2] * lineAmp;
      for (let k = 0; k < 4; k++) {
        const v = (n * 4 + k) * 3;
        obj.aHead[v] = hx; obj.aHead[v + 1] = hy; obj.aHead[v + 2] = hz;
        obj.aTail[v] = tx; obj.aTail[v + 1] = ty; obj.aTail[v + 2] = tz2;
        obj.tPos[v] = hx; obj.tPos[v + 1] = hy; obj.tPos[v + 2] = hz;
        obj.tCol[v] = hr; obj.tCol[v + 1] = hg; obj.tCol[v + 2] = hb;
        obj.tColT[v] = tr; obj.tColT[v + 1] = tg2; obj.tColT[v + 2] = tb;
        obj.aWidth[n * 4 + k] = width;
      }
      if (m.bright) alive.push({ x: hx, y: hy, z: hz, index: m.index });
      n++;
    }
    obj.hg.setDrawRange(0, n);
    obj.tg.setDrawRange(0, n * 6);
    obj.hg.attributes.position.needsUpdate = true;
    obj.hg.attributes.aColor.needsUpdate = true;
    (obj.hg.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (obj.hg.attributes.aSeed as THREE.BufferAttribute).needsUpdate = true;
    obj.tg.attributes.position.needsUpdate = true;
    obj.tg.attributes.aHead.needsUpdate = true;
    obj.tg.attributes.aTail.needsUpdate = true;
    obj.tg.attributes.aColor.needsUpdate = true;
    obj.tg.attributes.aColorTail.needsUpdate = true;
    (obj.tg.attributes.aWidth as THREE.BufferAttribute).needsUpdate = true;
    meteorPick.alive = alive;
  });

  if (!meteorsOn) return null;
  return (
    <>
      <primitive object={obj.tail} />
      <primitive object={obj.head} />
    </>
  );
}
