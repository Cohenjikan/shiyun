import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useStore } from "../state/store";
import { pullAt, pulledFromIndex, COMMON_K, POEM_PULL_K } from "../engine/engineApi";
import { getPoet, type PoetRow } from "../data/load";
import { fetchPoetPoems } from "../data/poetPoemsLoader";
import { giftLinks, giftGraphReady } from "../data/giftGraph";
import { pickTargets } from "./picking";
import { meteorPick } from "./meteorPick";
import { ceremonyCam, ceremonyFrame } from "./ceremonyCam";
import { spinXZ, unspinXZ, SPIN_RATE, GALAXY } from "./galaxyParams";
import { poemPosition, poetPosition, poemSystemRadius } from "./positions";
import { COARSE } from "./detectQuality";
import { centroid, pinchDistance, thrustFromDrag, pinchSpeed, classifyGesture, orbitZoom, type Pt } from "./touchGesture";

const GRAVITY_R = GALAXY.RADIUS * 1.15; // inside this sphere the camera is "in the galaxy's grip"
const ORBIT_MAX_POET = 6000; // pinch/wheel zoom-out limit when orbiting a poet/poem
const ORBIT_MAX_GALAXY = GALAXY.RADIUS * 3; // …and when orbiting the whole galaxy (see it all)
const ORBIT_MIN = 40;
const GALAXY_SEED_DIST = GALAXY.RADIUS * 1.7; // fallback orbit distance for a fresh galaxy-lock

// distance (px) from point P to segment AB — for clicking a 赠诗 arc in screen space
function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const GIFT_BUNDLE = 0.3; // must match GiftLines' BUNDLE so the pick curve == the drawn arc
const GIFT_ESTEPS = 16;
const GIFT_PICK_PX = 22; // click within this many px of an arc to hop along it (generous → easy to hit)
const GIFT_HOVER_PX = 26; // hover within this → highlight the arc (so the user sees what they'll click)

const BASE_SPEED = 140; // world units/sec at speed ×1 (slow, galactic feel)
// pressing any of these releases the camera lock (随意按移动键解除锁定)
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"]);
// ── Q/E 滚转 (desktop, 电脑端) ── 按住 = 持续绕视线(前向)轴滚转,松开即停 —— 与 WASD 移动完全同款手感:
// 状态记在 keys.current 里(onKeyDown 已对所有键置位,故 Q/E 无需进 MOVE_KEYS),useFrame 里线性 dt 积分。
// Q 正向、E 逆向;按住 Q → 机身左倾(euler.z=+ 绕局部前向轴 → 星空整体看起来顺时针转);
// 按住 E → 机身右倾(euler.z=- → 星空逆时针)。地平线/星空整体跟着滚,不改朝向(yaw/pitch)。
const ROLL_RATE = 1.2; // rad/s ≈ 70°/s,滚转角速度(owner 眼测可调)

// ── per-frame scratch (hoisted out of useFrame so the hot camera loop allocates ZERO objects) ──
// The lock and flyTarget blocks are mutually exclusive (each early-returns), so they SHARE these:
//   _tgt = follow target (lock's `target` / flyTarget's `tv`) — must survive a whole block;
//   _camOff = camera→target offset (lock's `cur` / flyTarget's `back`) — distinct from _tgt (used together);
//   _desired = the lerp destination — distinct from _tgt (it copies _tgt then mutates);
//   _off = a transient offset vector folded into _desired — distinct from the three above;
//   _mat / _quat = lookAt matrix + its quaternion, consumed within one statement.
// _flyV is the WASD/touch fly vector (runs only when neither block returned). All distinct where used
// simultaneously — see the per-line aliasing notes in useFrame.
const _tgt = new THREE.Vector3();
const _camOff = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _off = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _flyV = new THREE.Vector3();
const _rollQuat = new THREE.Quaternion(); // Q/E 滚转:绕相机局部前向(Z)轴的姿态偏移,后乘到 lookAt 结果上
const _zAxis = new THREE.Vector3(0, 0, 1); // camera local forward axis for the roll offset

export function FlyControls() {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  // Q/E 滚转的唯一真值:当前绕视线轴累计的滚转角(rad)。自由飞时写进 euler.z;环绕/flyTarget 时后乘成姿态偏移。
  const roll = useRef(0);
  const speedMul = useRef(1);
  const drag = useRef({ active: false, lastX: 0, lastY: 0, moved: 0, type: "" });
  const ray = useRef(new THREE.Raycaster());
  const lastHover = useRef(0);
  // orbit state while a poet/planet is locked: spherical offset (yaw/pitch/dist) around the target.
  const lock = useRef({ key: "", dist: 600, yaw: 0, pitch: 0.32 });
  // ── touch ── all pointers currently down ON the canvas, keyed by pointerId. size 1 = look/orbit
  // (the existing mouse path, byte-identical), size 2 (both TOUCH) = fly + pinch. `type` lets us ignore
  // a mouse/pen that coexists with a finger on a 2-in-1 (so it never trips the two-finger gesture).
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  // active two-finger gesture: `origin` = the centroid where it began (joystick origin for thrust);
  // `prevDist` = the previous-move finger-distance (incremental pinch ref); `startDist` = the distance
  // at start (for mode classification); `mode` = locked to pan XOR pinch once movement passes a
  // threshold, so the two intents never cross-talk. null when fewer than two fingers are down.
  const twoFinger = useRef<{ origin: Pt; prevDist: number; startDist: number; mode: "pan" | "pinch" | null } | null>(null);
  // analog fly thrust from a two-finger drag, in WASD convention (z<0 forward, x>0 right); {0,0} when
  // no touch-fly is active. Read in useFrame and ADDED on top of the keyboard fly vector.
  const touchThrust = useRef({ z: 0, x: 0 });

  useEffect(() => {
    ray.current.params.Points = { threshold: 80 };
    euler.current.setFromQuaternion(camera.quaternion);
    const el = gl.domElement;
    const st = useStore.getState;

    const ndc = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    };
    // O(1) GPU colour-ID pick (gpuPick.ts): renders the poet field's colour-encoded indices to an
    // offscreen buffer and reads the pixel under the cursor → the poet there. Replaces the old
    // O(29,808)/hover CPU scan + apparent-size heuristic. null = void (caller pulls a random poem);
    // also null until PoetStars mounts the picker. Coords are converted client → canvas-relative CSS.
    const screenPick = (cx: number, cy: number, includePoems = false) => {
      const r = el.getBoundingClientRect();
      return pickTargets.pick?.(cx - r.left, cy - r.top, includePoems) ?? null;
    };

    // 赠诗线 3D pick: with 赠诗 on + a poet selected, test the cursor against THAT poet's ego-net arcs
    // (the only ones drawn) by projecting each bundled Bézier into screen space → nearest within
    // GIFT_PICK_PX → returns the OTHER poet to hop to. Cheap (a handful of edges, click-only).
    const ZERO = new THREE.Vector3(0, 0, 0);
    const _gp = new THREE.Vector3(), _ga = new THREE.Vector3(), _gb = new THREE.Vector3(), _gc1 = new THREE.Vector3(), _gc2 = new THREE.Vector3();
    const pickGiftEdge = (clientX: number, clientY: number, thresholdPx = GIFT_PICK_PX): PoetRow | null => {
      const s = useStore.getState();
      const from = s.selectedPoet;
      if (!s.showGifts || !from || !giftGraphReady()) return null;
      const links = giftLinks(from.id);
      if (!links.length) return null;
      const r = el.getBoundingClientRect();
      const cx = clientX - r.left, cy = clientY - r.top;
      _ga.set(...poetPosition(from));
      let best: { poet: PoetRow; d: number } | null = null;
      for (const l of links) {
        const other = getPoet(l.other);
        if (!other) continue;
        _gb.set(...poetPosition(other));
        _gc1.copy(_ga).lerp(_gb, 0.33).lerp(ZERO, GIFT_BUNDLE);
        _gc2.copy(_ga).lerp(_gb, 0.67).lerp(ZERO, GIFT_BUNDLE);
        let psx = 0, psy = 0, hasPrev = false;
        for (let k = 0; k <= GIFT_ESTEPS; k++) {
          const t = k / GIFT_ESTEPS, u = 1 - t;
          _gp.set(0, 0, 0)
            .addScaledVector(_ga, u * u * u)
            .addScaledVector(_gc1, 3 * u * u * t)
            .addScaledVector(_gc2, 3 * u * t * t)
            .addScaledVector(_gb, t * t * t);
          const [wx, wz] = spinXZ(_gp.x, _gp.z); // LOCAL → WORLD (the arc group rides the spin)
          _gp.set(wx, _gp.y, wz).project(camera);
          const sx = (_gp.x * 0.5 + 0.5) * r.width, sy = (-_gp.y * 0.5 + 0.5) * r.height;
          const front = _gp.z < 1;
          if (hasPrev && front) {
            const d = distPointSeg(cx, cy, psx, psy, sx, sy);
            if (d < (best?.d ?? Infinity)) best = { poet: other, d };
          }
          psx = sx; psy = sy; hasPrev = front;
        }
      }
      return best && best.d < thresholdPx ? best.poet : null;
    };

    const isTyping = () => {
      const a = document.activeElement;
      return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      keys.current[e.code] = true; // 按住状态(含 Q/E)记在这里,useFrame 每帧读 → hold-to-roll 无需额外状态机
      if (MOVE_KEYS.has(e.code)) {
        st().unlock(); // a movement key frees the locked camera
        ceremonyCam.cancelled = true; // …and hands the ceremony camera back (打断即还政,不回抢)
      }
      // Q/E 滚转:按下即视作用户接管 → 还政(不回抢);但不 unlock(滚转不是移动,不该解跟随)、不入 MOVE_KEYS。
      if (e.code === "KeyQ" || e.code === "KeyE") ceremonyCam.cancelled = true;
    };
    const onKeyUp = (e: KeyboardEvent) => (keys.current[e.code] = false);
    const onDown = (e: PointerEvent) => {
      ceremonyCam.cancelled = true; // any pointer landing on the canvas = user grabbing control → 还政(不回抢)
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      if (pointers.current.size === 1) {
        drag.current = { active: true, lastX: e.clientX, lastY: e.clientY, moved: 0, type: e.pointerType };
      } else if (pointers.current.size === 2) {
        const pts = [...pointers.current.values()];
        // arm the two-finger fly/pinch gesture ONLY when both pointers are fingers — a mouse/pen
        // coexisting with a resting finger on a 2-in-1 must not trip it (F5).
        if (pts.every((p) => p.type === "touch")) {
          const d0 = pinchDistance(pts[0], pts[1]);
          twoFinger.current = { origin: centroid(pts[0], pts[1]), prevDist: d0, startDist: d0, mode: null };
          touchThrust.current = { z: 0, x: 0 };
          drag.current.moved += 99; // a multi-touch gesture is never a tap-pick
          // FREE-FLY: two fingers leave a lock to fly away (mirrors a movement key on desktop).
          // GALAXY-LOCK: two fingers PINCH-ZOOM the current orbit (poet or whole galaxy) — do NOT unlock.
          if (st().freeMove) st().unlock();
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = pointers.current.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      const n = pointers.current.size;

      // ── two-finger fly + pinch (touch) ── centroid drag = analog thrust (joystick: hold to cruise);
      // finger spread/contract = speed (same clamp + role as the wheel). Both axes are independent.
      if (n >= 2 && p) {
        const pts = [...pointers.current.values()];
        const cen = centroid(pts[0], pts[1]);
        const d = pinchDistance(pts[0], pts[1]);
        const tf = twoFinger.current;
        if (tf) {
          if (!st().freeMove) {
            // GALAXY-LOCK: two-finger pinch = ZOOM the orbit distance (the "放大缩小" touch users wanted).
            // No mode classification, no speed change, no thrust — single-finger handles rotation.
            const max = st().lockPoetId ? ORBIT_MAX_POET : ORBIT_MAX_GALAXY;
            lock.current.dist = orbitZoom(lock.current.dist, tf.prevDist, d, ORBIT_MIN, max);
          } else {
            // FREE-FLY: lock the gesture to ONE mode once it moves enough, so a one-handed pinch (whose
            // centroid drifts ~half the spread) can't leak thrust and a pan can't wobble the speed (TG-2).
            if (tf.mode === null) tf.mode = classifyGesture(tf.origin, cen, tf.startDist, d);
            if (tf.mode === "pan") {
              touchThrust.current = thrustFromDrag(tf.origin, cen);
            } else if (tf.mode === "pinch") {
              const sm = pinchSpeed(speedMul.current, tf.prevDist, d);
              if (sm !== speedMul.current) {
                speedMul.current = sm;
                st().setSpeed(sm);
              }
            }
          }
          tf.prevDist = d;
        }
        drag.current.moved += 99; // never a tap
        return;
      }

      // ── one-finger look / lock-orbit (drag) — math unchanged from the mouse path ──
      if (n === 1 && drag.current.active && p) {
        const dx = e.clientX - drag.current.lastX;
        const dy = e.clientY - drag.current.lastY;
        drag.current.lastX = e.clientX;
        drag.current.lastY = e.clientY;
        drag.current.moved += Math.abs(dx) + Math.abs(dy);
        if (st().lockPoetId || !st().freeMove) {
          // orbit mode (a locked poet/poem, OR galaxy-lock with nothing selected) → drag ORBITS the view
          // around the target (yaw/pitch); it does NOT release the lock or free-fly.
          lock.current.yaw -= dx * 0.005;
          lock.current.pitch = Math.max(-1.4, Math.min(1.4, lock.current.pitch + dy * 0.005));
          return;
        }
        const s = 0.0024;
        euler.current.y -= dx * s;
        euler.current.x -= dy * s;
        const lim = Math.PI / 2 - 0.02;
        euler.current.x = Math.max(-lim, Math.min(lim, euler.current.x));
        camera.quaternion.setFromEuler(euler.current);
        return;
      }

      // ── hover (DESKTOP only) ── touch has no hover, and the per-move GPU readback is a sync stall →
      // skip it entirely on coarse pointers. tap-pick (onUp) still resolves poets/planets on touch.
      if (COARSE) return;
      const now = performance.now();
      if (now - lastHover.current > 70) {
        lastHover.current = now;
        const sel = st().selectedPoet;
        const hit = screenPick(e.clientX, e.clientY, !!sel); // include poems only when a poet is selected
        const id = hit?.kind === "poet" ? hit.poet.id : null;
        if (id !== st().hoverPoetId) st().setHover(id);
        // 诗名指引 (item 7): hovering one of the SELECTED poet's planets shows its title near the cursor
        if (hit?.kind === "poem" && sel && hit.poet.id === sel.id) {
          st().setHoverPoem({ title: st().poetPoems?.[hit.poemIdx]?.t || "无题", x: e.clientX, y: e.clientY });
        } else if (st().hoverPoem) st().setHoverPoem(null);
        // 赠诗往来线 hover-highlight (赠诗 on + a poet selected, cursor not on a star/planet) → the arc lights up
        const ghid = st().showGifts && sel && !hit
          ? pickGiftEdge(e.clientX, e.clientY, GIFT_HOVER_PX)?.id ?? null
          : null;
        if (ghid !== st().giftHoverId) st().setGiftHover(ghid);
      }
    };
    // After a finger lifts/cancels mid-gesture (≥1 still down), rebind the active gesture's reference
    // points to the SURVIVING pointers so neither one-finger look (F1/F2) nor two-finger fly (F4) jumps.
    const reseedAfterLift = () => {
      const pts = [...pointers.current.values()];
      if (pts.length === 1) {
        // 2→1: resume one-finger look from the remaining finger's CURRENT position (no view snap)
        drag.current.lastX = pts[0].x;
        drag.current.lastY = pts[0].y;
      } else if (pts.length >= 2) {
        // 3→2: rebind the gesture origin/baseline to the surviving pair + reset thrust/mode (no jump)
        const d0 = pinchDistance(pts[0], pts[1]);
        twoFinger.current = { origin: centroid(pts[0], pts[1]), prevDist: d0, startDist: d0, mode: null };
        touchThrust.current = { z: 0, x: 0 };
      }
    };
    const onUp = (e: PointerEvent) => {
      const had = pointers.current.has(e.pointerId);
      pointers.current.delete(e.pointerId);
      const n = pointers.current.size;
      if (n < 2) {
        twoFinger.current = null;
        touchThrust.current = { z: 0, x: 0 }; // stop flying the instant we drop below two fingers
      }
      if (n > 0) {
        // fingers remain → NOT the last lift, so never finalize a tap and never clear drag.active
        // (clearing it on a 3→2 lift would freeze the last finger's look). Just rebind the gesture.
        reseedAfterLift();
        return;
      }
      // last pointer up (n === 0) → a tap-pick if it barely moved and wasn't part of a multi-touch gesture.
      const slop = drag.current.type === "touch" ? 14 : 6; // finger jitter is larger than a mouse click
      const wasClick = had && drag.current.active && drag.current.moved < slop;
      drag.current.active = false;
      if (!wasClick) return;
      const hit = screenPick(e.clientX, e.clientY, true); // click = poets + poem planets
      // a bright (今日) 认领 meteor under the cursor → open its poem ("耀眼的流星 → 看到诗本身"). Only when
      // nothing solid was hit; takes priority over a 赠诗 arc / void pull. Weak (往日) meteors aren't registered.
      let meteorIndex: string | null = null;
      if (!hit) {
        const r = el.getBoundingClientRect();
        meteorIndex = meteorPick.pick(e.clientX - r.left, e.clientY - r.top, camera, r.width, r.height);
      }
      // void click → the hovered (already-highlighted) 赠诗 arc if any, else a fresh pick at click range
      const hov = useStore.getState().giftHoverId;
      const giftHop = hit || meteorIndex ? null : ((hov ? getPoet(hov) ?? null : null) ?? pickGiftEdge(e.clientX, e.clientY));
      if (hit?.kind === "poet") {
        st().selectPoet(hit.poet);
        st().lockPoet(hit.poet.id); // lock the star in the centre + follow it
        fetchPoetPoems(hit.poet.id);
      } else if (hit?.kind === "poem") {
        // clicked a poem-planet → open its poet panel focused on that poem + light + lock the planet.
        const { poet, poemIdx } = hit;
        st().selectPoet(poet, { poemIdx, title: "", firstLine: "" });
        st().lockPoem(poet.id, poemIdx);
        fetchPoetPoems(poet.id);
        st().pulseAt(poemPosition(poet, poemIdx), true);
      } else if (meteorIndex) {
        // clicked a today's-claim meteor → rebuild its poem from the 全集编号 + open it (no random pull)
        const poem = pulledFromIndex("ziyou", meteorIndex);
        if (poem) {
          st().selectPoem(poem);
          st().setFlyTarget(poem.pos);
        }
      } else if (giftHop) {
        // clicked a 赠诗 arc of the selected poet → fly across it to the other poet (hop + trail)
        st().hopToPoet(giftHop);
        fetchPoetPoems(giftHop.id);
      } else {
        // 生成随机诗 关闭 → 点虚空不再拉随机诗(只看现存的诗)。锁定模式下顺手解除锁定 → 回到诗云整体。
        if (!st().allowRandomPoem) {
          if (st().lockPoetId) st().unlock();
          return;
        }
        const v = ndc(e.clientX, e.clientY);
        ray.current.setFromCamera(v, camera);
        const pt = ray.current.ray.origin.clone().addScaledVector(ray.current.ray.direction, 260);
        // store the void point in the LOCAL galaxy frame so the poem is stable as the galaxy
        // turns and the marker drifts with it. NO camera move on a void click (the glide-focus
        // was inaccurate/disorienting) — just light the star where you clicked.
        const [lx, lz] = unspinXZ(pt.x, pt.z);
        const s = st();
        s.selectPoem(
          pullAt(s.form, [lx, pt.y, lz], {
            lushiOnly: s.lushiFilter,
            // default 虚空捞诗 weights (Zipf) over the top POEM_PULL_K common chars → reads like poetry;
            // the 22k charset's rare tail (锂/镁/… + never-in-poem CJK) stays addressable but out of pulls.
            // 常用字 narrows further to the top COMMON_K.
            commonK: s.commonOnly ? COMMON_K : POEM_PULL_K,
          }),
        );
      }
    };
    const onWheel = (e: WheelEvent) => {
      ceremonyCam.cancelled = true; // scroll = user driving → 还政(不回抢)
      if (st().lockPoetId || !st().freeMove) {
        // orbit mode → wheel adjusts the orbit DISTANCE (zoom in/out on the target / the whole galaxy)
        const max = st().lockPoetId ? ORBIT_MAX_POET : ORBIT_MAX_GALAXY;
        lock.current.dist = Math.min(max, Math.max(ORBIT_MIN, lock.current.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
        return;
      }
      speedMul.current = Math.min(80, Math.max(0.1, speedMul.current * (e.deltaY > 0 ? 0.82 : 1.22)));
      st().setSpeed(speedMul.current);
    };
    // an OS-interrupted touch (notification, palm-reject, app switch) fires pointercancel, NOT pointerup
    // — without this the finger would be left "down" forever, freezing look + flying the camera endlessly.
    const onCancel = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      const n = pointers.current.size;
      if (n < 2) {
        twoFinger.current = null;
        touchThrust.current = { z: 0, x: 0 };
      }
      if (n > 0) {
        reseedAfterLift(); // ≥1 finger remains → rebind so the next move doesn't jump (F1/F4)
        return;
      }
      drag.current.active = false;
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [camera, gl]);

  const tmpUp = useRef(new THREE.Vector3(0, 1, 0));
  const lastCerId = useRef(-1); // last ceremony id whose residual flyTarget we cleared — keyed by ID (not an
  // "engaged" boolean) so BACK-TO-BACK claims (A driving → claim B sets flyTarget(posB) without the block ever
  // exiting) still clear B's residual; otherwise B's natural end would let the flyTarget block yank the camera
  // back to posB (定位点).
  const cerSide = useRef<-1 | 0 | 1>(0); // last frame's ceremonyFrame side, fed back as stickySide so the
  // end-on dead zone can't flip the desired machine position frame-to-frame; 0 = fresh ceremony, no preference.
  useFrame((_, dt) => {
    // ── Q/E 滚转(hold-to-roll,线性)── 按住即每帧 dt 积分,松开即停,和 WASD 同款。roll 是唯一真值,下面各
    // 渲染分支(自由飞 / 环绕 / flyTarget)据它落地姿态。Q/E 已置 ceremonyCam.cancelled,故滚转发生在礼仪块之后。
    if (keys.current["KeyQ"]) roll.current += ROLL_RATE * dt; // Q 正向:机身左倾(星空看起来顺时针)
    if (keys.current["KeyE"]) roll.current -= ROLL_RATE * dt; // E 逆向:机身右倾(星空看起来逆时针)
    const rolling = !!(keys.current["KeyQ"] || keys.current["KeyE"]); // 这帧是否正在滚(决定自由飞是否需重提交姿态)
    // ── CEREMONY CAMERA (highest priority) ── fly a hero-frame that plunges WITH the claimer's own streak
    // toward the heart (fixes 根因①: the camera used to lock onto the streak's START and never follow). The
    // geometry (head/start/end) is published every frame by Meteors in WORLD space — RED LINE: use it RAW, do
    // NOT spinXZ again (opposite of flyTarget, which is LOCAL). 打断即还政: cancelled is set by the input
    // handlers; once set we never re-grab THIS ceremony. Natural end (active=false) leaves the camera where it
    // is (no snap) so normal control resumes seamlessly.
    if (ceremonyCam.active && !ceremonyCam.cancelled && !useStore.getState().cinema) {
      if (ceremonyCam.id !== lastCerId.current) {
        lastCerId.current = ceremonyCam.id;
        cerSide.current = 0; // fresh ceremony → re-pick the framing side from the live geometry
        useStore.getState().setFlyTarget(null); // clear THIS claim's residual 定位 fly so it can't yank us back on exit
      }
      lock.current.key = ""; // a camera move invalidates the orbit seed → a later lock reseeds (no snap)
      const cam = camera as THREE.PerspectiveCamera;
      const fov = cam.isPerspectiveCamera ? cam.fov : 60; // R3F's default camera is a PerspectiveCamera
      const aspect = cam.isPerspectiveCamera ? cam.aspect : 1.6;
      const camPos: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
      const { pos, side } = ceremonyFrame(ceremonyCam.start, ceremonyCam.end, camPos, fov, aspect, cerSide.current);
      cerSide.current = side; // feed back next frame (sticky inside the end-on dead zone)
      const desired = _desired.set(pos[0], pos[1], pos[2]);
      const kp = 1 - Math.pow(0.0015, dt); // SAME family as flyTarget's approach (不发明新手感)
      camera.position.lerp(desired, kp);
      // lookAt the streak head, dt-damped (never a hard per-frame lookAt → no jitter)
      const head = _tgt.set(ceremonyCam.head[0], ceremonyCam.head[1], ceremonyCam.head[2]);
      const m = _mat.lookAt(camera.position, head, tmpUp.current);
      const kl = 1 - Math.pow(0.0025, dt); // gentle orientation damping (lock块同族)
      camera.quaternion.slerp(_quat.setFromRotationMatrix(m), kl);
      euler.current.setFromQuaternion(camera.quaternion); // so free-fly resumes cleanly when the ceremony ends
      return;
    }

    // camera LOCK: keep the selected poet (or one of its orbiting poems) centred + followed. The
    // target's LOCAL position is recomputed every frame (poetPosition / time-aware poemPosition) and
    // rotated into world by the live galaxy spin, so the camera tracks it as the galaxy turns and the
    // planet orbits. Released by a movement key / drag (see handlers). Decoration keeps its faster
    // DECOR_RATE spin → it streams past the held star, creating the sense of motion.
    const lockId = useStore.getState().lockPoetId;
    if (lockId) {
      const lockedPoet = getPoet(lockId);
      if (lockedPoet) {
        const lpi = useStore.getState().lockPoemIdx;
        const [lx, ly, lz] = lpi != null ? poemPosition(lockedPoet, lpi) : poetPosition(lockedPoet);
        const [wx, wz] = spinXZ(lx, lz);
        const target = _tgt.set(wx, ly, wz); // _tgt: held the whole block (lookAt source below)
        const key = lockId + ":" + (lpi ?? -1);
        if (lock.current.key !== key) {
          // new lock → frame it CLOSE (was too far) + seed the orbit angle from the current view (no snap)
          lock.current.key = key;
          lock.current.dist = lpi != null ? 130 : Math.min(1800, poemSystemRadius(lockedPoet.poemCount) * 1.15 + 130);
          const cur = _camOff.subVectors(camera.position, target); // _camOff ≠ _tgt → both read together OK
          const d = cur.length();
          if (d > 1) { lock.current.pitch = Math.asin(Math.max(-1, Math.min(1, cur.y / d))); lock.current.yaw = Math.atan2(cur.x, cur.z); }
          else { lock.current.pitch = 0.32; lock.current.yaw = 0; }
        }
        const { yaw, pitch, dist } = lock.current;
        const cp = Math.cos(pitch);
        // _desired copies _tgt then adds the orbit offset (_off); _desired/_tgt/_off all distinct objects
        const desired = _desired.copy(target).add(_off.set(Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist, Math.cos(yaw) * cp * dist));
        const k = 1 - Math.pow(0.0025, dt); // gentle glide-in then steady follow (drag/wheel adjust orbit)
        camera.position.lerp(desired, k);
        const m = _mat.lookAt(camera.position, target, tmpUp.current); // _tgt still valid here
        _quat.setFromRotationMatrix(m);
        if (roll.current) _quat.multiply(_rollQuat.setFromAxisAngle(_zAxis, roll.current)); // Q/E 滚转:绕视线轴后乘偏移
        camera.quaternion.slerp(_quat, k);
        euler.current.setFromQuaternion(camera.quaternion); // so free-fly resumes cleanly on release (含 roll)
        return;
      }
    }
    const flyTarget = useStore.getState().flyTarget;
    if (flyTarget) {
      lock.current.key = ""; // a fly animation moves the camera → invalidate the orbit seed so a lock reseeds on arrival (no snap)
      // flyTarget is LOCAL (a poet position / canonical void point) — rotate it into world by
      // the live spin so the camera homes onto the star as the galaxy turns.
      const [fwx, fwz] = spinXZ(flyTarget[0], flyTarget[2]);
      const tv = _tgt.set(fwx, flyTarget[1], fwz); // _tgt: held the whole block (lookAt + distanceTo below)
      // approach from the camera's CURRENT side (no jarring swing): pull back along target→camera
      const back = _camOff.subVectors(camera.position, tv); // _camOff ≠ _tgt → both read together OK
      if (back.lengthSq() < 1) back.set(0, 0, 1);
      back.normalize();
      // _desired copies _tgt then folds in back + the (0,70,0) lift (_off); all four objects distinct
      const desired = _desired.copy(tv).addScaledVector(back, 320).add(_off.set(0, 70, 0));
      const k = 1 - Math.pow(0.0015, dt);
      camera.position.lerp(desired, k);
      const m = _mat.lookAt(camera.position, tv, tmpUp.current); // _tgt still valid here
      _quat.setFromRotationMatrix(m);
      if (roll.current) _quat.multiply(_rollQuat.setFromAxisAngle(_zAxis, roll.current)); // Q/E 滚转:绕视线轴后乘偏移
      camera.quaternion.slerp(_quat, k);
      if (camera.position.distanceTo(desired) < 24) {
        euler.current.setFromQuaternion(camera.quaternion); // 含 roll → 落地后自由飞接得上
        useStore.getState().setFlyTarget(null);
      }
      return;
    }
    // GALAXY-LOCK (自由移动 关 — 触屏默认 / 电脑可切): orbit the WHOLE galaxy as one object around the fixed
    // origin. Single-finger drag / mouse-drag = rotate (yaw/pitch, set in onMove), pinch / wheel = zoom
    // (orbit distance). The galaxy keeps spinning within (poets + decoration ride their own spin), so it
    // reads as a turning whole you circle. Seeded from the CURRENT view on entry (no snap). A locked
    // poet/poem (above) and an active flyTarget (above, which clears the seed) take priority.
    if (!useStore.getState().freeMove) {
      const target = _tgt.set(0, 0, 0);
      if (lock.current.key !== "galaxy") {
        lock.current.key = "galaxy";
        const cur = _camOff.subVectors(camera.position, target); // _camOff ≠ _tgt → both read together OK
        const d = cur.length();
        lock.current.dist = Math.min(ORBIT_MAX_GALAXY, Math.max(ORBIT_MIN, d || GALAXY_SEED_DIST));
        if (d > 1) {
          lock.current.pitch = Math.asin(Math.max(-1, Math.min(1, cur.y / d)));
          lock.current.yaw = Math.atan2(cur.x, cur.z);
        } else {
          lock.current.pitch = 0.3;
          lock.current.yaw = 0;
        }
      }
      const { yaw, pitch, dist } = lock.current;
      const cp = Math.cos(pitch);
      const desired = _desired.copy(target).add(_off.set(Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist, Math.cos(yaw) * cp * dist));
      const k = 1 - Math.pow(0.0025, dt);
      camera.position.lerp(desired, k);
      const m = _mat.lookAt(camera.position, target, tmpUp.current);
      _quat.setFromRotationMatrix(m);
      if (roll.current) _quat.multiply(_rollQuat.setFromAxisAngle(_zAxis, roll.current)); // Q/E 滚转:绕视线轴后乘偏移
      camera.quaternion.slerp(_quat, k);
      euler.current.setFromQuaternion(camera.quaternion); // so free-fly resumes cleanly on toggle/release (含 roll)
      return;
    }
    // free-fly (freeMove ON, no lock / no fly): invalidate the orbit seed so re-entering a lock reseeds
    // from the CURRENT camera (no snap).
    lock.current.key = "";
    // Q/E 滚转(自由飞):当前 roll 写进 euler.z(YXZ 序 z = 绕局部前向轴)。放在引力协转之前 —— 引力只 += euler.y
    // 再 setFromEuler,会读到这里写好的 euler.z → roll 不被吃掉(无需另加偏移)。拖拽(onMove)只改 y/x,z 独立保留。
    euler.current.z = roll.current;
    // 引力: once inside the galaxy, orbit the camera WITH the spin (same Δ as the galaxy this
    // frame) so the stars hold still on screen — otherwise close-up stars drift tangentially
    // faster than you can click. Outside the sphere you watch it turn from afar.
    // 奇迹时刻: don't co-rotate the camera with the (now-frozen) spin; manual look/fly still works.
    if (useStore.getState().gravity && !useStore.getState().cinema) {
      const cp = camera.position;
      if (cp.x * cp.x + cp.y * cp.y + cp.z * cp.z < GRAVITY_R * GRAVITY_R) {
        const dA = SPIN_RATE * dt; // matches advanceSpin(dt) in Galaxy
        const c = Math.cos(dA), s = Math.sin(dA);
        const px = cp.x, pz = cp.z;
        cp.x = px * c + pz * s; // RotY(dA): orbit position about the galaxy axis
        cp.z = -px * s + pz * c;
        euler.current.y += dA; // turn heading by the same amount → view stays galaxy-locked
        camera.quaternion.setFromEuler(euler.current);
      }
    }
    // 滚转帧的姿态落地:引力未生效(关/出球)且未拖拽时,euler.z 的变化要在此显式提交(引力若已 setFromEuler
    // 则已含 roll,此为等值重复、无害)。仅在按住 Q/E 时提交,静止/纯 WASD 帧不多做一次 setFromEuler。
    if (rolling) camera.quaternion.setFromEuler(euler.current);
    const k = keys.current;
    const v = _flyV.set(0, 0, 0); // reset the hoisted temp each frame (was a fresh Vector3)
    if (k["KeyW"]) v.z -= 1;
    if (k["KeyS"]) v.z += 1;
    if (k["KeyA"]) v.x -= 1;
    if (k["KeyD"]) v.x += 1;
    if (k["Space"]) v.y += 1;
    if (k["ShiftLeft"] || k["ShiftRight"]) v.y -= 1;
    if (v.lengthSq() > 0) v.normalize(); // keyboard = a digital unit direction
    // two-finger touch thrust (analog: magnitude ∝ how far the fingers pushed) added on top; {0,0} on
    // desktop / when no touch-fly is active, so the WASD behaviour is byte-for-byte unchanged. Clamped to
    // unit magnitude so a diagonal drag isn't ~41% faster than a cardinal one (thrustFromDrag clamps each
    // axis independently → a square region) (TG-3). No allocation.
    const tt = touchThrust.current;
    if (tt.z || tt.x) {
      const tlen = Math.hypot(tt.z, tt.x);
      const tnorm = tlen > 1 ? 1 / tlen : 1;
      v.z += tt.z * tnorm;
      v.x += tt.x * tnorm;
    }
    if (v.lengthSq() > 0) {
      v.multiplyScalar(BASE_SPEED * speedMul.current * Math.min(dt, 0.05));
      v.applyQuaternion(camera.quaternion);
      camera.position.add(v);
    }
  });

  return null;
}
