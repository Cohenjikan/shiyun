import type * as THREE from "three";
import type { PoetRow } from "../data/load";

// What a pick resolves to: a poet star, or a poem "planet" (with its parent poet + poem index).
export type PickResult =
  | { kind: "poet"; poet: PoetRow }
  | { kind: "poem"; poet: PoetRow; poemIdx: number };

export interface PickSnap {
  x: number;
  y: number;
  target: PickResult;
}

// The currently-pickable poem layer (registered by PoemOrbits). The picker renders this geometry's
// aPickColor in the SAME offscreen pass as the poets (depth-tested → front-most wins), and decodes a
// poem pick-id back to its poet + poem index via `resolve`. Null when no planets are shown.
export interface PoemPickLayer {
  geometry: THREE.BufferGeometry; // position + aPickColor (local poem ids), shared with the visual layer
  sizeScale: number; // MUST match the visual planet vertex shader so the pick disc = the drawn planet
  maxPx: number;
  resolve: (localId: number) => { poet: PoetRow; poemIdx: number } | null;
}

// Shared handle so FlyControls can pick without owning the geometry/renderer. PoetStars builds the
// GPU picker (it has the geometry + renderer); FlyControls just calls `pick`. PoemOrbits registers
// its poem layer here so the same O(1) colour-ID pick also resolves planets. See gpuPick.ts.
export const pickTargets: {
  poets: PoetRow[];
  pick: ((cssX: number, cssY: number, includePoems?: boolean, radiusCss?: number) => PickResult | null) | null;
  snap: ((clientX: number, clientY: number, includePoems?: boolean, radiusCss?: number) => PickSnap | null) | null;
  poemLayer: PoemPickLayer | null;
} = { poets: [], pick: null, snap: null, poemLayer: null };
