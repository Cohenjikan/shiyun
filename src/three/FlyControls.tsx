import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useStore } from "../state/store";
import { pullAt, COMMON_K } from "../engine/engineApi";
import { loadPoetPoems, getPoet } from "../data/load";
import { pickTargets } from "./picking";
import { spinXZ, unspinXZ, SPIN_RATE, GALAXY } from "./galaxyParams";
import { poemPosition, poetPosition, poemSystemRadius } from "./positions";

const GRAVITY_R = GALAXY.RADIUS * 1.15; // inside this sphere the camera is "in the galaxy's grip"

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
        if (drag.current.moved > 6) st().unlock(); // a real drag (look-around) frees the locked camera
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
        const dist = lpi != null ? 240 : Math.min(2600, poemSystemRadius(lockedPoet.poemCount) * 2.4 + 240);
        const back = new THREE.Vector3().subVectors(camera.position, target);
        if (back.lengthSq() < 1) back.set(0, 0, 1);
        back.normalize();
        const desired = target.clone().addScaledVector(back, dist).add(new THREE.Vector3(0, dist * 0.18, 0));
        const k = 1 - Math.pow(0.0025, dt); // gentle glide-in then steady follow
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
