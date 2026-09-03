// Hand-recognition worker for the exhibition gesture input. Runs MediaPipe GestureRecognizer off the
// main thread so the star renderer never waits on inference. Protocol (main → worker):
//   INIT  {wasmRoot, modelUrl, backend: "cpu"|"gpu"}  → READY {backend} | ERROR {message, fatal}
//   FRAME {bitmap, ts, seq}                             → RESULT {seq, ts, inferenceMs, hand|null}
//   RESET                                               → tracker re-created (re-detects the largest palm)
//   STOP
//
// Only ONE hand is requested. Measured on the demo machine (CPU/XNNPACK, 640×360 frame): with
// numHands=2 and a single visible hand MediaPipe re-runs the palm DETECTOR every frame while it keeps
// looking for the missing second hand — 174 ms/frame — whereas numHands=1 tracks the hand between
// frames at 56 ms. The one-hand vocabulary in gestureEngine.ts is designed around that.
//
// The GPU delegate (WebGL in this worker via OffscreenCanvas) produced landmarks identical to the CPU
// path but systematically LOWER detector/presence scores on the demo machine's ANGLE/D3D11 stack, so
// it needs looser thresholds and is exposed as an opt-in "实验" backend, never the default.
importScripts("/mediapipe-vision.js");

const { FilesetResolver, GestureRecognizer } = Vision;

const THRESHOLDS = {
  cpu: { minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 },
  gpu: { minHandDetectionConfidence: 0.2, minHandPresenceConfidence: 0.2, minTrackingConfidence: 0.2 },
};

let vision = null;
let recognizer = null;
let config = null;
let lastTs = 0;

async function createRecognizer(backend) {
  const rec = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: config.modelUrl, delegate: backend === "gpu" ? "GPU" : "CPU" },
    runningMode: "VIDEO",
    numHands: 1,
    ...THRESHOLDS[backend],
    cannedGesturesClassifierOptions: { scoreThreshold: 0.3 },
  });
  return rec;
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "INIT") {
      config = { modelUrl: message.modelUrl, backend: message.backend === "gpu" ? "gpu" : "cpu" };
      vision = vision || (await FilesetResolver.forVisionTasks(message.wasmRoot));
      try {
        recognizer = await createRecognizer(config.backend);
      } catch (error) {
        if (config.backend === "gpu") {
          // GPU delegate unavailable (no WebGL2 in workers, driver refused) → silently run on CPU.
          config.backend = "cpu";
          recognizer = await createRecognizer("cpu");
          self.postMessage({ type: "READY", backend: "cpu", fallback: true, message: error instanceof Error ? error.message : String(error) });
          return;
        }
        throw error;
      }
      lastTs = 0;
      self.postMessage({ type: "READY", backend: config.backend, fallback: false });
      return;
    }
    if (message.type === "RESET") {
      if (!recognizer || !config) return;
      recognizer.close();
      recognizer = await createRecognizer(config.backend);
      lastTs = 0;
      self.postMessage({ type: "RESET_DONE" });
      return;
    }
    if (message.type === "STOP") {
      recognizer?.close?.();
      recognizer = null;
      return;
    }
    if (message.type === "FRAME") {
      const bitmap = message.bitmap;
      if (!recognizer) { bitmap.close(); self.postMessage({ type: "RESULT", seq: message.seq, ts: message.ts, inferenceMs: 0, hand: null }); return; }
      // MediaPipe VIDEO mode needs strictly increasing timestamps.
      const ts = Math.max(message.ts, lastTs + 1);
      lastTs = ts;
      const startedAt = performance.now();
      const result = recognizer.recognizeForVideo(bitmap, ts);
      bitmap.close();
      const inferenceMs = performance.now() - startedAt;
      const landmarks = result.landmarks[0];
      const hand = landmarks
        ? {
            landmarks,
            handedness: result.handedness[0]?.[0]?.categoryName ?? "Unknown",
            gesture: result.gestures[0]?.[0]?.categoryName ?? "None",
            score: result.gestures[0]?.[0]?.score ?? 0,
          }
        : null;
      self.postMessage({ type: "RESULT", seq: message.seq, ts: message.ts, inferenceMs, hand });
    }
  } catch (error) {
    message.bitmap?.close?.();
    self.postMessage({ type: "ERROR", message: error instanceof Error ? error.message : "手势识别线程失败", fatal: message.type === "INIT" });
  }
};
