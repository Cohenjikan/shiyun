import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useStore } from "../state/store";
import { pullAt, COMMON_K } from "../engine/engineApi";
import { loadPoetPoems, getPoet } from "../data/load";
import { giftLinks, giftGraphReady } from "../data/giftGraph";
import { pickTargets } from "./picking";
import { spinXZ, unspinXZ, SPIN_RATE, GALAXY } from "./galaxyParams";
import { poemPosition, poetPosition, poemSystemRadius } from "./positions";

const GRAVITY_R = GALAXY.RADIUS * 1.15; // inside this sphere the camera is "in the galaxy's grip"

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
const GIFT_PICK_PX = 16; // click within this many px of an arc to hop along it

const BASE_SPEED = 140; // world units/sec at speed ×1 (slow, galactic feel)
// pressing any of these releases the camera lock (随意按移动键解除锁定)
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"]);

export function FlyControls() {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const speedMul = useRef(1);
  const drag = useRef({ active: false, lastX: 0, lastY: 0, moved: 0 });
  const ray = useRef(new THREE.Raycaster());
  const lastHover = useRef(0);
  // orbit state while a poet/planet is locked: spherical offset (yaw/pitch/dist) around the target.
  const lock = useRef({ key: "", dist: 600, yaw: 0, pitch: 0.32 });

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
    const pickGiftEdge = (clientX: number, clientY: number) => {
      const s = useStore.getState();
      const from = s.selectedPoet;
      if (!s.showGifts || !from || !giftGraphReady()) return null;
      const links = giftLinks(from.id);
      if (!links.length) return null;
      const r = el.getBoundingClientRect();
      const cx = clientX - r.left, cy = clientY - r.top;
      _ga.set(...poetPosition(from));
      let best: { poet: ReturnType<typeof getPoet>; d: number } | null = null;
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
      return best && best.d < GIFT_PICK_PX ? best.poet : null;
    };

    const isTyping = () => {
      const a = document.activeElement;
      return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      keys.current[e.code] = true;
      if (MOVE_KEYS.has(e.code)) st().unlock(); // a movement key frees the locked camera
    };
    const onKeyUp = (e: KeyboardEvent) => (keys.current[e.code] = false);
    const onDown = (e: PointerEvent) => {
      drag.current = { active: true, lastX: e.clientX, lastY: e.clientY, moved: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (drag.current.active) {
        const dx = e.clientX - drag.current.lastX;
        const dy = e.clientY - drag.current.lastY;
        drag.current.lastX = e.clientX;
        drag.current.lastY = e.clientY;
        drag.current.moved += Math.abs(dx) + Math.abs(dy);
        if (st().lockPoetId) {
          // locked → drag ORBITS the view around the target (does NOT release the lock)
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
      // hover (throttled)
      const now = performance.now();
      if (now - lastHover.current > 70) {
        lastHover.current = now;
        const hit = screenPick(e.clientX, e.clientY); // hover = poets only (cheap; no poem layer)
        const id = hit?.kind === "poet" ? hit.poet.id : null;
        if (id !== st().hoverPoetId) st().setHover(id);
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasClick = drag.current.active && drag.current.moved < 6;
      drag.current.active = false;
      if (!wasClick) return;
      const hit = screenPick(e.clientX, e.clientY, true); // click = poets + poem planets
      const giftHop = hit ? null : pickGiftEdge(e.clientX, e.clientY); // void click → maybe a 赠诗 arc
      if (hit?.kind === "poet") {
        st().selectPoet(hit.poet);
        st().lockPoet(hit.poet.id); // lock the star in the centre + follow it
        loadPoetPoems(hit.poet.id).then((poems) => useStore.getState().setPoetPoems(hit.poet.id, poems));
      } else if (hit?.kind === "poem") {
        // clicked a poem-planet → open its poet panel focused on that poem + light + lock the planet.
        const { poet, poemIdx } = hit;
        st().selectPoet(poet, { poemIdx, title: "", firstLine: "" });
        st().lockPoem(poet.id, poemIdx);
        loadPoetPoems(poet.id).then((poems) => useStore.getState().setPoetPoems(poet.id, poems));
        st().pulseAt(poemPosition(poet, poemIdx), true);
      } else if (giftHop) {
        // clicked a 赠诗 arc of the selected poet → fly across it to the other poet (hop + trail)
        st().hopToPoet(giftHop);
        loadPoetPoems(giftHop.id).then((poems) => useStore.getState().setPoetPoems(giftHop.id, poems));
      } else {
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
            commonK: s.commonOnly ? COMMON_K : undefined,
          }),
        );
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (st().lockPoetId) {
        // locked → wheel adjusts the orbit DISTANCE (zoom in/out on the target)
        lock.current.dist = Math.min(6000, Math.max(40, lock.current.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
        return;
      }
      speedMul.current = Math.min(80, Math.max(0.1, speedMul.current * (e.deltaY > 0 ? 0.82 : 1.22)));
      st().setSpeed(speedMul.current);
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl]);

  const tmpUp = useRef(new THREE.Vector3(0, 1, 0));
  useFrame((_, dt) => {
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
        const target = new THREE.Vector3(wx, ly, wz);
        const key = lockId + ":" + (lpi ?? -1);
        if (lock.current.key !== key) {
          // new lock → frame it CLOSE (was too far) + seed the orbit angle from the current view (no snap)
          lock.current.key = key;
          lock.current.dist = lpi != null ? 130 : Math.min(1800, poemSystemRadius(lockedPoet.poemCount) * 1.15 + 130);
          const cur = new THREE.Vector3().subVectors(camera.position, target);
          const d = cur.length();
          if (d > 1) { lock.current.pitch = Math.asin(Math.max(-1, Math.min(1, cur.y / d))); lock.current.yaw = Math.atan2(cur.x, cur.z); }
          else { lock.current.pitch = 0.32; lock.current.yaw = 0; }
        }
        const { yaw, pitch, dist } = lock.current;
        const cp = Math.cos(pitch);
        const desired = target.clone().add(new THREE.Vector3(Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist, Math.cos(yaw) * cp * dist));
        const k = 1 - Math.pow(0.0025, dt); // gentle glide-in then steady follow (drag/wheel adjust orbit)
        camera.position.lerp(desired, k);
        const m = new THREE.Matrix4().lookAt(camera.position, target, tmpUp.current);
        camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), k);
        euler.current.setFromQuaternion(camera.quaternion); // so free-fly resumes cleanly on release
        return;
      }
    }
    const flyTarget = useStore.getState().flyTarget;
    if (flyTarget) {
      // flyTarget is LOCAL (a poet position / canonical void point) — rotate it into world by
      // the live spin so the camera homes onto the star as the galaxy turns.
      const [fwx, fwz] = spinXZ(flyTarget[0], flyTarget[2]);
      const tv = new THREE.Vector3(fwx, flyTarget[1], fwz);
      // approach from the camera's CURRENT side (no jarring swing): pull back along target→camera
      const back = new THREE.Vector3().subVectors(camera.position, tv);
      if (back.lengthSq() < 1) back.set(0, 0, 1);
      back.normalize();
      const desired = tv.clone().addScaledVector(back, 320).add(new THREE.Vector3(0, 70, 0));
      const k = 1 - Math.pow(0.0015, dt);
      camera.position.lerp(desired, k);
      const m = new THREE.Matrix4().lookAt(camera.position, tv, tmpUp.current);
      camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), k);
      if (camera.position.distanceTo(desired) < 24) {
        euler.current.setFromQuaternion(camera.quaternion);
        useStore.getState().setFlyTarget(null);
      }
      return;
    }
    // 引力: once inside the galaxy, orbit the camera WITH the spin (same Δ as the galaxy this
    // frame) so the stars hold still on screen — otherwise close-up stars drift tangentially
    // faster than you can click. Outside the sphere you watch it turn from afar.
    if (useStore.getState().gravity) {
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
    const k = keys.current;
    const v = new THREE.Vector3();
    if (k["KeyW"]) v.z -= 1;
    if (k["KeyS"]) v.z += 1;
    if (k["KeyA"]) v.x -= 1;
    if (k["KeyD"]) v.x += 1;
    if (k["Space"]) v.y += 1;
    if (k["ShiftLeft"] || k["ShiftRight"]) v.y -= 1;
    if (v.lengthSq() > 0) {
      v.normalize().multiplyScalar(BASE_SPEED * speedMul.current * Math.min(dt, 0.05));
      v.applyQuaternion(camera.quaternion);
      camera.position.add(v);
    }
  });

  return null;
}
