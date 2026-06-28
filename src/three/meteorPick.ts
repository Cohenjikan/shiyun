// Shared mutable singleton for click-picking a bright (今日) meteor — mirrors three/picking.ts's
// `pickTargets` and galaxyParams' `galaxySpin`: the render layer (three/Meteors.tsx) writes the alive
// BRIGHT meteors' WORLD positions here each frame, and FlyControls reads it in its DOM pointer-up handler
// (the click path is raw DOM listeners + a GPU/colour pick, NOT R3F object events, so a singleton is how
// a new pickable layer hooks in without touching the hot camera loop).
//
// Only TODAY's claims are registered (weak/past meteors are non-interactive — they're just glints), so a
// hit resolves to a poem the viewer is meant to be able to read ("耀眼的流星 → 看到诗本身").
import * as THREE from "three";

export interface AliveMeteor {
  x: number; // WORLD position (post galaxy-spin) — project()-ready
  y: number;
  z: number;
  index: string; // the poem's universal 全集编号 → pulledFromIndex rebuilds the poem
}

const _v = new THREE.Vector3();

export const meteorPick = {
  /** Bright meteors alive THIS frame, in world space. Overwritten each frame by Meteors. */
  alive: [] as AliveMeteor[],

  /**
   * Nearest bright meteor within `thresholdPx` of the canvas-relative cursor (cx,cy), or null. A generous
   * default threshold makes a fast streak catchable. width/height are the canvas CSS size.
   */
  pick(
    cx: number,
    cy: number,
    camera: THREE.Camera,
    width: number,
    height: number,
    thresholdPx = 30,
  ): string | null {
    let best: { index: string; d: number } | null = null;
    for (const m of this.alive) {
      _v.set(m.x, m.y, m.z).project(camera);
      if (_v.z >= 1) continue; // behind the camera / past the far plane
      const sx = (_v.x * 0.5 + 0.5) * width;
      const sy = (-_v.y * 0.5 + 0.5) * height;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < thresholdPx && (!best || d < best.d)) best = { index: m.index, d };
    }
    return best ? best.index : null;
  },
};
