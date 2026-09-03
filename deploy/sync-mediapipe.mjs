// Copy the MediaPipe runtime the gesture worker needs from node_modules into public/, so the 23 MB of
// wasm never lives in git and always matches the pinned @mediapipe/tasks-vision version.
// Runs automatically before `npm run dev` / `npm run build` (see package.json "predev"/"prebuild");
// also runnable by hand:  node deploy/sync-mediapipe.mjs
//
// What ends up in public/ (git-ignored):
//   public/mediapipe-vision.js                    ← vision_bundle.js (IIFE build, importScripts-able)
//   public/mediapipe-wasm/vision_wasm_internal.{js,wasm}         ← SIMD build (every modern browser)
//   public/mediapipe-wasm/vision_wasm_nosimd_internal.{js,wasm}  ← fallback picked by FilesetResolver
// The "module" variants are ESM-only and unused by the worker, so they are not copied.
//
// NOT copied: public/gesture_recognizer.task — the model is not on npm; it is committed to git.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "@mediapipe", "tasks-vision");
if (!existsSync(pkgDir)) {
  console.error("sync-mediapipe: node_modules/@mediapipe/tasks-vision is missing — run `npm ci` first.");
  process.exit(1);
}
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;

const files = [
  ["vision_bundle.js", "mediapipe-vision.js"],
  ["wasm/vision_wasm_internal.js", "mediapipe-wasm/vision_wasm_internal.js"],
  ["wasm/vision_wasm_internal.wasm", "mediapipe-wasm/vision_wasm_internal.wasm"],
  ["wasm/vision_wasm_nosimd_internal.js", "mediapipe-wasm/vision_wasm_nosimd_internal.js"],
  ["wasm/vision_wasm_nosimd_internal.wasm", "mediapipe-wasm/vision_wasm_nosimd_internal.wasm"],
];

let copied = 0, kept = 0;
for (const [from, to] of files) {
  const src = join(pkgDir, from);
  const dst = join(root, "public", to);
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst) && statSync(dst).size === statSync(src).size && readFileSync(dst).equals(readFileSync(src))) {
    kept++;
    continue;
  }
  copyFileSync(src, dst);
  copied++;
}
const model = join(root, "public", "gesture_recognizer.task");
if (!existsSync(model)) console.warn("sync-mediapipe: WARNING public/gesture_recognizer.task is missing — gesture control will not load.");
console.log(`sync-mediapipe: @mediapipe/tasks-vision ${version} → public/ (${copied} copied, ${kept} already current)`);
