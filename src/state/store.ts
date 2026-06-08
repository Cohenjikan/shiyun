import { create } from "zustand";
import type { FormId } from "../engine/engine";
import type { PulledPoem } from "../engine/engineApi";
import type { PoetRow, PoemRecord } from "../data/load";
import { DYNASTIES } from "../data/dynasties";

export interface Pull {
  pos: [number, number, number]; // LOCAL galaxy frame (rotated with the spin)
  valid: boolean;
  t0: number; // birth time (performance.now()/1000) → drives the flare-then-fade glow
}

interface State {
  // data
  loaded: boolean;
  // form + mode
  form: FormId;
  lushiFilter: boolean;
  commonOnly: boolean;
  // dynasty filter
  hidden: Set<string>;
  // void pull (random poem)
  selected: PulledPoem | null;
  pulls: Pull[];
  // poets
  hoverPoetId: string | null;
  selectedPoet: PoetRow | null;
  poetPoems: PoemRecord[] | null;
  // camera
  speed: number; // multiplier
  flyTarget: [number, number, number] | null;

  setLoaded: (b: boolean) => void;
  setForm: (f: FormId) => void;
  toggleLushi: () => void;
  toggleCommon: () => void;
  toggleDynasty: (key: string) => void;
  showAllDynasties: () => void;
  showOnly: (keys: string[]) => void;
  selectPoem: (p: PulledPoem) => void;
  clearSelection: () => void;
  setHover: (id: string | null) => void;
  selectPoet: (p: PoetRow) => void;
  setPoetPoems: (id: string, poems: PoemRecord[]) => void;
  clearPoet: () => void;
  setSpeed: (s: number) => void;
  setFlyTarget: (t: [number, number, number] | null) => void;
}

const MAX_PULLS = 60;
const ALL_KEYS = DYNASTIES.map((d) => d.key);

export const useStore = create<State>((set) => ({
  loaded: false,
  form: "wujue",
  lushiFilter: false,
  commonOnly: false,
  hidden: new Set(),
  selected: null,
  pulls: [],
  hoverPoetId: null,
  selectedPoet: null,
  poetPoems: null,
  speed: 1,
  flyTarget: null,

  setLoaded: (loaded) => set({ loaded }),
  setForm: (form) => set({ form }),
  toggleLushi: () => set((s) => ({ lushiFilter: !s.lushiFilter })),
  toggleCommon: () => set((s) => ({ commonOnly: !s.commonOnly })),
  toggleDynasty: (key) =>
    set((s) => {
      const hidden = new Set(s.hidden);
      hidden.has(key) ? hidden.delete(key) : hidden.add(key);
      return { hidden };
    }),
  showAllDynasties: () => set({ hidden: new Set() }),
  showOnly: (keys) => set({ hidden: new Set(ALL_KEYS.filter((k) => !keys.includes(k))) }),
  selectPoem: (p) =>
    set((s) => ({
      selected: p,
      selectedPoet: null,
      poetPoems: null,
      pulls: [
        ...s.pulls,
        { pos: p.pos, valid: p.valid, t0: performance.now() / 1000 },
      ].slice(-MAX_PULLS),
    })),
  clearSelection: () => set({ selected: null }),
  setHover: (hoverPoetId) => set({ hoverPoetId }),
  selectPoet: (selectedPoet) => set({ selectedPoet, poetPoems: null, selected: null }),
  setPoetPoems: (id, poems) =>
    set((s) => (s.selectedPoet?.id === id ? { poetPoems: poems } : {})),
  clearPoet: () => set({ selectedPoet: null, poetPoems: null }),
  setSpeed: (speed) => set({ speed }),
  setFlyTarget: (flyTarget) => set({ flyTarget }),
}));
