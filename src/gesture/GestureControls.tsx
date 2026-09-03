// Exhibition gesture input (opt-in, demo branch). Pipeline:
//
//   camera (getUserMedia, 640×360) ──requestVideoFrameCallback──▶ createImageBitmap ──transfer──▶ Worker
//   Worker: MediaPipe GestureRecognizer, numHands = 1, CPU (default) or GPU (opt-in) ──RESULT──▶ here
//   here: GestureEngine (pure state machine, gestureEngine.ts) ──events──▶ FlyControls via window events
//         cursor: 60 Hz rAF loop writes the DOM directly (dead-reckoned between recognition frames)
//         HUD: React state, throttled to ~12 Hz
//
// What changed vs the first demo build and why it felt laggy ("特别卡"):
//   • numHands 2 → 1. With one visible hand and numHands=2, MediaPipe re-ran the palm detector every
//     frame looking for the second hand: 174 ms/frame measured on the demo machine vs 56 ms tracked.
//   • The duty-cycle throttle (frameInterval = inferenceMs / maxDuty) is gone. Inference already runs on
//     its own thread; the throttle only cut a ~6 Hz stream down to ~3 Hz. Now every camera frame is
//     offered to the worker and the worker simply drops what it cannot keep up with (one in flight).
//   • The cursor no longer goes through React state + a 70 ms CSS transition per recognition frame. A
//     rAF loop eases toward the latest filtered sample and extrapolates with its velocity, so a 17 Hz
//     recognition stream renders as continuous 60 Hz motion.
//   • Fingertip → palm. Landmark 8 is the noisiest point and moves when the hand closes; the palm-top
//     point is stable and a One Euro filter removes the residual jitter without adding lag on fast moves.
//   • Camera preview is the <video> element composited by the browser (CSS mirror), not a per-frame
//     drawImage copy; the canvas above it draws only the skeleton.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { fetchPoetPoems } from "../data/poetPoemsLoader";
import { pickTargets } from "../three/picking";
import { GestureEngine, type EngineFrame, type Pose } from "./gestureEngine";
import { ACQUIRE_BOX, buildHandSample, type GestureLandmark } from "./gestureMath";

interface WorkerHand {
  landmarks: GestureLandmark[];
  handedness: string;
  gesture: string;
  score: number;
}

interface WorkerResult {
  seq: number;
  ts: number;
  inferenceMs: number;
  hand: WorkerHand | null;
}

interface HudState {
  owner: string;
  gesture: string;
  action: string;
  fps: number;
  inferenceMs: number;
  backend: string;
  progress: number;
  tone: "idle" | "ready" | "active" | "warn" | "error";
}

// Cursor state lives outside React: written by processResult, read by the 60 Hz display loop.
interface CursorState {
  visible: boolean;
  target: { x: number; y: number; vx: number; vy: number; t: number };
  display: { x: number; y: number };
  snapped: boolean;
  grab: boolean;
  pinch: number;
  selectingUntil: number;
  lastHandAt: number;
}

// The camera frame rate IS the recognition cap: every delivered frame is offered to the worker, which
// drops what it cannot keep up with. (A separate, lower cap would beat against the camera cadence —
// a 24 Hz cap on a 30 Hz source lands on every other frame = 15 Hz.)
const CAMERA_PROFILES = {
  eco: { cameraFps: 15 },
  balanced: { cameraFps: 24 },
  smooth: { cameraFps: 30 },
} as const;

// gains: engine deltas are screen fractions; FlyControls expects mouse-pixel-like deltas
const ORBIT_PX_PER_SCREEN = 640; // full-width pinch-drag ≈ 183° at FlyControls' 0.005 rad/px
const LOOK_PX_PER_SCREEN = 900; // full-width pinch-drag ≈ 114° at 0.0022 rad/px
const ZOOM_EXPONENT = 1.5; // palm-size ratio → orbit-distance ratio (30 % pull ≈ halve the distance)
const THRUST_DEADZONE = 0.07; // must match the engine's pushDeadzone
const THRUST_SPAN = 0.28; // |size/startSize − 1| for full forward/back thrust
const CURSOR_TAU_MS = 35; // easing time constant of the display loop
const CURSOR_EXTRAPOLATE_MS = 45; // ≈ one recognition interval; more would overshoot when the hand stops
const CURSOR_LEAD_MAX = 0.02; // …and never more than 2 % of the screen width
const CURSOR_HIDE_MS = 700; // hand gone this long → hide the cursor
const SNAP_INTERVAL_MS = 125; // the snap pick is a synchronous GPU readback: ≤ 8 Hz, and only when the hand is slow
const SNAP_MAX_SPEED = 260; // px/s

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const POSE_LABELS: Record<Pose, string> = {
  none: "未检测到手",
  open: "张手",
  point: "指向",
  pinch: "捏合",
  victory: "✌️ V 手势",
  thumbUp: "👍 拇指向上",
  fist: "握拳",
  other: "手",
};

const initialHud: HudState = {
  owner: "正在准备识别",
  gesture: "—",
  action: "开启后请将一只手放入取景区",
  fps: 0,
  inferenceMs: 0,
  backend: "",
  progress: 0,
  tone: "idle",
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const emptyCursor = (): CursorState => ({
  visible: false,
  target: { x: 0, y: 0, vx: 0, vy: 0, t: 0 },
  display: { x: 0, y: 0 },
  snapped: false,
  grab: false,
  pinch: 0,
  selectingUntil: 0,
  lastHandAt: 0,
});

export function GestureControls({ visible, suspended }: { visible: boolean; suspended: boolean }) {
  const enabled = useStore((s) => s.gestureEnabled);
  const freeMove = useStore((s) => s.freeMove);
  const gestureFps = useStore((s) => s.gestureFps);
  const gestureBackend = useStore((s) => s.gestureBackend);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<GestureEngine>(new GestureEngine());
  const cursorRef2 = useRef<CursorState>(emptyCursor());
  const manualPauseUntilRef = useRef(0);
  const suspendedRef = useRef(suspended);
  const freeMoveRef = useRef(freeMove);
  const visibleRef = useRef(visible);
  const flashRef = useRef({ text: "", until: 0 });
  const [runtime, setRuntime] = useState("正在载入模型并等待摄像头权限");
  const [hud, setHud] = useState<HudState>(initialHud);
  const [streamTick, setStreamTick] = useState(0);

  useEffect(() => { suspendedRef.current = suspended; }, [suspended]);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => {
    freeMoveRef.current = freeMove;
    engineRef.current.reset();
    cursorRef2.current = emptyCursor();
    window.dispatchEvent(new CustomEvent("shiyun:gesture-fly-stop"));
  }, [freeMove]);

  // the preview <video> mounts/unmounts with the HUD; (re)attach the live stream whenever it appears
  useEffect(() => {
    const preview = previewVideoRef.current;
    const stream = streamRef.current;
    if (!preview || !stream) return;
    if (preview.srcObject !== stream) {
      preview.srcObject = stream;
      preview.play().catch(() => { /* autoplay policies never block a muted inline video */ });
    }
  }, [visible, enabled, streamTick]);

  // mouse / keyboard keep priority: any trusted input pauses gesture ACTIONS for 250 ms
  useEffect(() => {
    if (!enabled) return;
    const pause = (event: Event) => {
      if (event.isTrusted) manualPauseUntilRef.current = performance.now() + 250;
    };
    window.addEventListener("pointerdown", pause, true);
    window.addEventListener("wheel", pause, true);
    window.addEventListener("keydown", pause, true);
    return () => {
      window.removeEventListener("pointerdown", pause, true);
      window.removeEventListener("wheel", pause, true);
      window.removeEventListener("keydown", pause, true);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      cursorRef2.current = emptyCursor();
      setHud(initialHud);
      return;
    }
    let cancelled = false;
    let displayRaf = 0;
    let captureRaf = 0;
    let modelReady = false;
    let cameraReady = false;
    let inFlight = false;
    let seq = 0;
    let backendLabel = "";
    let lastHudUpdate = 0;
    let lastSnapQuery = 0;
    let snap: { x: number; y: number; at: number } | null = null;
    let inferenceEma = 0;
    const fpsCounter = { started: performance.now(), frames: 0, value: 0 };
    const profile = CAMERA_PROFILES[gestureFps];
    // Rate limiter as a credit accumulator (not "elapsed ≥ interval"): a camera that ignores the
    // frameRate constraint and delivers 30 Hz against a 24 Hz profile still averages 24 Hz instead
    // of collapsing to every other frame.
    const frameInterval = 1000 / profile.cameraFps;
    let credit = 1;
    let lastFrameTs = 0;
    const engine = engineRef.current;
    engine.reset();
    const cursor = cursorRef2.current;
    if (import.meta.env.DEV) (window as unknown as { __shiyunGesture?: unknown }).__shiyunGesture = { cursor, engine };

    const worker = new Worker("/gesture-worker.js");
    setRuntime("正在载入模型并等待摄像头权限");

    const syncRuntime = () => {
      if (modelReady && cameraReady) setRuntime(`识别已就绪 · ${backendLabel}`);
      else if (modelReady) setRuntime("模型已就绪 · 等待摄像头");
      else if (cameraReady) setRuntime("摄像头已连接 · 正在载入模型");
    };

    // ── preview skeleton (the video itself is composited by the browser) ──
    const drawPreview = (frame: EngineFrame, raw: WorkerHand | null) => {
      const canvas = previewRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = engine.locked ? "rgba(236,190,93,.62)" : "rgba(255,255,255,.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect((1 - ACQUIRE_BOX.x1) * w, ACQUIRE_BOX.y0 * h, (ACQUIRE_BOX.x1 - ACQUIRE_BOX.x0) * w, (ACQUIRE_BOX.y1 - ACQUIRE_BOX.y0) * h);
      ctx.setLineDash([]);
      if (!raw) return;
      const active = !!frame.hand;
      const landmarks = raw.landmarks;
      ctx.strokeStyle = active ? "rgba(244,199,102,.92)" : "rgba(173,180,196,.34)";
      ctx.fillStyle = active ? "#f4c766" : "rgba(190,196,210,.45)";
      ctx.lineWidth = active ? 1.7 : 1;
      for (const [a, b] of HAND_CONNECTIONS) {
        if (!landmarks[a] || !landmarks[b]) continue;
        ctx.beginPath();
        ctx.moveTo((1 - landmarks[a].x) * w, landmarks[a].y * h);
        ctx.lineTo((1 - landmarks[b].x) * w, landmarks[b].y * h);
        ctx.stroke();
      }
      for (const p of landmarks) {
        ctx.beginPath();
        ctx.arc((1 - p.x) * w, p.y * h, active ? 2.1 : 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (active && frame.hand) {
        // palm point (the cursor anchor) and the pinch line
        const palm = frame.hand.palm;
        ctx.strokeStyle = "rgba(255,255,255,.85)";
        ctx.beginPath();
        ctx.arc((1 - palm.x) * w, palm.y * h, 4, 0, Math.PI * 2);
        ctx.stroke();
        const t = landmarks[4], i = landmarks[8];
        if (t && i) {
          ctx.strokeStyle = frame.pinch.active ? "rgba(255,241,189,.95)" : `rgba(246,217,146,${0.25 + frame.pinch.strength * 0.6})`;
          ctx.lineWidth = frame.pinch.active ? 2.2 : 1.2;
          ctx.beginPath();
          ctx.moveTo((1 - t.x) * w, t.y * h);
          ctx.lineTo((1 - i.x) * w, i.y * h);
          ctx.stroke();
        }
      }
    };

    const chooseRandomPoet = () => {
      const st = useStore.getState();
      const candidates = pickTargets.poets.filter((p) => !p.mergedInto && p.poemCount > 0 && !st.hidden.has(p.dynasty) && p.id !== st.selectedPoet?.id);
      if (!candidates.length) {
        flashRef.current = { text: "当前筛选下没有可选诗人", until: performance.now() + 1500 };
        return;
      }
      const poet = candidates[Math.floor(Math.random() * candidates.length)];
      st.selectPoet(poet);
      st.lockPoet(poet.id);
      fetchPoetPoems(poet.id);
      flashRef.current = { text: `✌️ 已随机选中 · ${poet.name}`, until: performance.now() + 1600 };
    };

    const dispatch = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

    // ── per recognition frame ──
    const processResult = (result: WorkerResult) => {
      if (cancelled) return;
      const now = performance.now();
      inferenceEma = inferenceEma ? inferenceEma * 0.85 + result.inferenceMs * 0.15 : result.inferenceMs;
      fpsCounter.frames += 1;
      if (now - fpsCounter.started >= 1000) {
        fpsCounter.value = Math.round((fpsCounter.frames * 1000) / (now - fpsCounter.started));
        fpsCounter.started = now;
        fpsCounter.frames = 0;
      }
      const raw = result.hand;
      const hand = raw ? buildHandSample(raw.landmarks, raw.handedness, raw.gesture, raw.score) : null;
      const paused = now < manualPauseUntilRef.current;
      const blocked = suspendedRef.current || paused;
      const frame = engine.update(hand, now, blocked);
      if (frame.wantsTrackerReset) worker.postMessage({ type: "RESET" });

      const free = freeMoveRef.current;
      const W = window.innerWidth, H = window.innerHeight;

      // ── cursor target ──
      if (frame.hand && frame.pointer) {
        cursor.lastHandAt = now;
        cursor.visible = true;
        let tx = frame.pointer.x * W;
        let ty = frame.pointer.y * H;
        cursor.snapped = false;
        if (!free) {
          // light magnetism toward the front-most star under the cursor (GPU pick, ≤ 11 Hz, never while pinching)
          const slow = Math.hypot(frame.pointer.vx * W, frame.pointer.vy * H) < SNAP_MAX_SPEED;
          if (!frame.pinch.active && slow && now - lastSnapQuery >= SNAP_INTERVAL_MS) {
            lastSnapQuery = now;
            const hit = pickTargets.snap?.(tx, ty, true, 24) ?? null;
            snap = hit ? { x: hit.x, y: hit.y, at: now } : null;
          }
          if (snap && now - snap.at < 220) {
            const d = Math.hypot(snap.x - tx, snap.y - ty);
            if (d <= 32) {
              const strength = clamp(0.46 - d / 140, 0.24, 0.46);
              tx += (snap.x - tx) * strength;
              ty += (snap.y - ty) * strength;
              cursor.snapped = true;
            }
          }
        }
        cursor.target = { x: tx, y: ty, vx: frame.pointer.vx * W, vy: frame.pointer.vy * H, t: now };
        if (!cursor.display.x && !cursor.display.y) cursor.display = { x: tx, y: ty };
        cursor.pinch = frame.pinch.strength;
        cursor.grab = frame.pinch.active && frame.pinch.phase !== "pressed";
      } else {
        cursor.pinch = 0;
        cursor.grab = false;
        if (now - cursor.lastHandAt > CURSOR_HIDE_MS) cursor.visible = false;
      }

      // ── events → app ──
      let action = "";
      for (const ev of frame.events) {
        switch (ev.type) {
          case "tap": {
            const x = free ? W / 2 : cursor.display.x;
            const y = free ? H / 2 : cursor.display.y;
            dispatch("shiyun:gesture-select", { x, y });
            cursor.selectingUntil = now + 260;
            flashRef.current = { text: free ? "捏合 · 已选中准心目标" : "捏合 · 已选中", until: now + 1000 };
            break;
          }
          case "drag": {
            if (free) dispatch("shiyun:gesture-look", { dx: clamp(ev.dx * LOOK_PX_PER_SCREEN, -40, 40), dy: clamp(ev.dy * LOOK_PX_PER_SCREEN, -40, 40) });
            else dispatch("shiyun:gesture-orbit", { dx: clamp(ev.dx * ORBIT_PX_PER_SCREEN, -40, 40), dy: clamp(ev.dy * ORBIT_PX_PER_SCREEN, -40, 40) });
            break;
          }
          case "push": {
            if (free) {
              const dev = ev.sinceStart - 1;
              const past = Math.max(0, Math.abs(dev) - THRUST_DEADZONE);
              const z = -Math.sign(dev) * clamp(past / (THRUST_SPAN - THRUST_DEADZONE), 0, 1);
              dispatch("shiyun:gesture-fly", { x: 0, y: 0, z });
            } else {
              dispatch("shiyun:gesture-zoom", { ratio: clamp(Math.pow(ev.ratio, ZOOM_EXPONENT), 0.9, 1.1) });
            }
            break;
          }
          case "pushEnd":
          case "dragEnd": {
            if (free) dispatch("shiyun:gesture-fly-stop");
            break;
          }
          case "fire": {
            if (ev.hold === "victory") chooseRandomPoet();
            else if (useStore.getState().allowRandomPoem) {
              dispatch("shiyun:gesture-random-poem");
              flashRef.current = { text: "👍 已从中心拉出随机诗", until: now + 1500 };
            } else {
              flashRef.current = { text: "生成随机诗已在设置中关闭", until: now + 1500 };
            }
            break;
          }
          default:
            break;
        }
      }

      // ── HUD text ──
      let tone: HudState["tone"] = engine.locked ? "ready" : "idle";
      if (suspendedRef.current) action = "留影中 · 手势动作已暂停";
      else if (paused) action = "鼠标/键盘优先 · 手势短暂停顿";
      else if (frame.hand) {
        tone = "active";
        if (frame.hold.kind) action = frame.hold.kind === "victory" ? "✌️ 保持以随机选中诗人" : "👍 保持以随机出诗";
        else if (frame.pinch.active) {
          if (frame.pinch.phase === "dragging") action = free ? "捏住拖动 · 环顾视角" : "捏住拖动 · 旋转视角";
          else if (frame.pinch.phase === "pushing") action = free ? (frame.pinch.sinceStart > 1 ? "捏住拉近 · 向前飞行" : "捏住推远 · 向后飞行") : (frame.pinch.sinceStart > 1 ? "捏住拉近 · 放大" : "捏住推远 · 缩小");
          else action = "捏住 · 松开即选中,移动即拖拽";
        } else if (frame.pose === "fist") action = "握拳 · 无动作(捏合才是选中)";
        else action = free ? "移动手掌 · 捏合选中准心" : cursor.snapped ? "光标已吸附前景星体 · 捏合选中" : "移动光标 · 捏合选中";
      } else if (frame.owner === "ignored") {
        tone = "warn";
        action = "检测到的手不在识别框内 · 已忽略";
      } else action = "等待动作";
      if (now < flashRef.current.until) {
        action = flashRef.current.text;
        tone = "active";
      }
      if (visibleRef.current) drawPreview(frame, raw);
      if (now - lastHudUpdate >= 80) {
        lastHudUpdate = now;
        setHud({
          owner: frame.ownerText,
          gesture: frame.hand ? POSE_LABELS[frame.pose] : hand ? "背景手已忽略" : "未检测到手",
          action,
          fps: fpsCounter.value,
          inferenceMs: inferenceEma,
          backend: backendLabel,
          progress: frame.hold.progress,
          tone,
        });
      }
    };

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "READY") {
        modelReady = true;
        backendLabel = message.backend === "gpu" ? "GPU" : message.fallback ? "CPU(GPU 不可用)" : "CPU";
        syncRuntime();
      } else if (message.type === "RESULT") {
        inFlight = false;
        processResult(message as WorkerResult);
      } else if (message.type === "ERROR") {
        inFlight = false;
        if (message.fatal) {
          setRuntime(`识别模型错误 · ${message.message}`);
          setHud((h) => ({ ...h, owner: "手势识别不可用", action: message.message, tone: "error" }));
        }
      }
    };
    worker.postMessage({ type: "INIT", wasmRoot: "/mediapipe-wasm", modelUrl: "/gesture_recognizer.task", backend: gestureBackend });

    // ── camera ──
    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持摄像头识别");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: profile.cameraFps, max: profile.cameraFps },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        const video = sourceVideoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        cameraReady = true;
        setStreamTick((n) => n + 1);
        syncRuntime();
        scheduleCapture();
      } catch (error) {
        const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
        const message = denied ? "摄像头权限未允许 · 请在浏览器地址栏中开启" : error instanceof Error ? error.message : "摄像头启动失败";
        setRuntime(message);
        setHud((h) => ({ ...h, owner: "摄像头不可用", action: message, tone: "error" }));
      }
    };

    // ── capture: one frame in flight, always the freshest camera frame ──
    type RvfcVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const captureFrame = () => {
      if (cancelled) return;
      scheduleCapture();
      const video = sourceVideoRef.current;
      const now = performance.now();
      if (lastFrameTs) credit = Math.min(1.5, credit + (now - lastFrameTs) / frameInterval);
      lastFrameTs = now;
      if (document.hidden || !modelReady || !cameraReady || !video || video.readyState < 2 || inFlight || credit < 1) return;
      credit -= 1;
      inFlight = true;
      const mySeq = ++seq;
      createImageBitmap(video).then(
        (bitmap) => {
          if (cancelled) { bitmap.close(); return; }
          worker.postMessage({ type: "FRAME", bitmap, ts: now, seq: mySeq }, [bitmap]);
        },
        () => { inFlight = false; },
      );
    };
    const scheduleCapture = () => {
      if (cancelled) return;
      const video = sourceVideoRef.current as RvfcVideo | null;
      if (video?.requestVideoFrameCallback && cameraReady) video.requestVideoFrameCallback(captureFrame);
      else captureRaf = requestAnimationFrame(captureFrame);
    };
    void startCamera();
    scheduleCapture();

    // ── 60 Hz cursor display loop ──
    let lastDisplayT = 0;
    let lastClass = "";
    const display = (t: number) => {
      displayRaf = requestAnimationFrame(display);
      const el = cursorRef.current;
      if (!el) return;
      const c = cursor;
      const free = freeMoveRef.current;
      const show = c.visible && visibleRef.current;
      const dt = lastDisplayT ? Math.min(50, t - lastDisplayT) : 16;
      lastDisplayT = t;
      if (show) {
        if (free) {
          c.display = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        } else {
          const age = Math.min(CURSOR_EXTRAPOLATE_MS, Math.max(0, t - c.target.t));
          const speed = Math.hypot(c.target.vx, c.target.vy);
          const maxLead = CURSOR_LEAD_MAX * window.innerWidth;
          const lead = speed > 40 ? Math.min(age / 1000, maxLead / speed) : 0;
          const gx = c.target.x + c.target.vx * lead;
          const gy = c.target.y + c.target.vy * lead;
          const k = 1 - Math.exp(-dt / CURSOR_TAU_MS);
          c.display = {
            x: clamp(c.display.x + (gx - c.display.x) * k, 0, window.innerWidth),
            y: clamp(c.display.y + (gy - c.display.y) * k, 0, window.innerHeight),
          };
        }
        el.style.transform = `translate3d(${c.display.x.toFixed(1)}px, ${c.display.y.toFixed(1)}px, 0)`;
        el.style.setProperty("--pinch", c.pinch.toFixed(3));
      }
      const cls = `gesture-cursor${show ? "" : " hidden"}${t < c.selectingUntil ? " selecting" : ""}${c.snapped ? " snapped" : ""}${c.grab ? " grab" : ""}${free ? " crosshair" : ""}`;
      if (cls !== lastClass) {
        lastClass = cls;
        el.className = cls;
      }
    };
    displayRaf = requestAnimationFrame(display);

    return () => {
      cancelled = true;
      cancelAnimationFrame(displayRaf);
      cancelAnimationFrame(captureRaf);
      worker.postMessage({ type: "STOP" });
      worker.terminate();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const video = sourceVideoRef.current;
      if (video) video.srcObject = null;
      const preview = previewVideoRef.current;
      if (preview) preview.srcObject = null;
      engine.reset();
      cursorRef2.current = emptyCursor();
      window.dispatchEvent(new CustomEvent("shiyun:gesture-fly-stop"));
    };
  }, [enabled, gestureFps, gestureBackend]);

  if (!enabled) return null;

  return (
    <>
      <video ref={sourceVideoRef} className="gesture-video-source" muted playsInline aria-hidden="true" />
      <div ref={cursorRef} className="gesture-cursor hidden" aria-hidden="true"><span /></div>
      {visible && (
        <div className={`gesture-hud ${hud.tone}`} role="status" aria-live="polite">
          <div className="gesture-preview-wrap">
            <video ref={previewVideoRef} muted playsInline aria-hidden="true" />
            <canvas ref={previewRef} width={220} height={124} aria-label="手势识别实时预览" />
            <span className="gesture-live"><i /> LIVE</span>
          </div>
          <div className="gesture-readout">
            <div className="gesture-owner"><i />{hud.owner}</div>
            <div className="gesture-current">
              <strong>{hud.gesture}</strong>
              <span>{hud.action}</span>
            </div>
            <div className="gesture-meta">
              <span>{freeMove ? "WASD 自由移动" : "中心锁定"}</span>
              <span>{hud.fps || "—"} FPS</span>
              <span>{hud.inferenceMs ? `${hud.backend} ${hud.inferenceMs.toFixed(0)}ms` : runtime}</span>
            </div>
            <div className={hud.progress > 0 ? "gesture-progress active" : "gesture-progress"}>
              <span style={{ width: `${Math.round(hud.progress * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
