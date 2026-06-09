import { create } from "zustand";
import type { PulledPoem, PullForm } from "../engine/engineApi";
import type { PoetRow, PoemRecord } from "../data/load";
import { DYNASTIES } from "../data/dynasties";

export interface Pull {
  id: number; // stable identity so PulledStars can track per-marker birth/death animation
  pos: [number, number, number];
  valid: boolean;
}

interface State {
  // data
  loaded: boolean;
  // form + mode
  form: PullForm;
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
  poetFocus: { poemIdx: number; title: string; firstLine: string } | null; // poem to surface (诗句 search)
  // 赠诗 network
  showGifts: boolean;
  // 行星指引线常驻: when ON the selected poet's guide lines stay (no 10s auto-fade); only ONE at a time
  // (they follow the selected poet, so picking another poet switches them). OFF = one-shot ~10s flash.
  guideHold: boolean;
  // poem "planets": when ON, every poet shows ALL their poems as orbiting planets (高性能);
  // when OFF, only the selected poet's poems orbit (on-demand 彩蛋). Like 赠诗, a visual toggle.
  showAllPoems: boolean;
  // render quality (scales galaxy particle counts + bloom for weak GPUs)
  quality: "high" | "low";
  // hide ALL overlay UI (screenshot mode) — toggled by a corner button + the H hotkey
  uiHidden: boolean;
  // 赠诗漫游 (gift-network roaming): a breadcrumb of poets you've HOPPED through along 赠诗 edges.
  // trail[last] = the current poet; consecutive nodes are drawn as persistent "return lines" (GiftTrail).
  // Capped at 11 nodes (= 10 return edges). Reset to [poet] on a NORMAL selectPoet (= 点无关诗人清除);
  // grown by hopToPoet; cleared on 赠诗 off / manual clear.
  giftTrail: string[];
  // pathfinding between two poets over the 赠诗 graph
  pathStart: string | null;
  pathEnd: string | null;
  pathResult: string[] | null; // BFS poet-id path (incl. endpoints), [] = searched but none within range
  // camera
  gravity: boolean; // when inside the galaxy, co-rotate the camera with the spin (stars hold still)
  speed: number; // multiplier
  flyTarget: [number, number, number] | null;
  // camera lock: keep a selected poet (or one of its poems) centred + followed until a movement key
  // / drag releases it. lockPoemIdx null = lock the poet star; a number = lock that orbiting planet.
  lockPoetId: string | null;
  lockPoemIdx: number | null;

  setLoaded: (b: boolean) => void;
  setForm: (f: PullForm) => void;
  toggleLushi: () => void;
  toggleCommon: () => void;
  toggleDynasty: (key: string) => void;
  showAllDynasties: () => void;
  showOnly: (keys: string[]) => void;
  selectPoem: (p: PulledPoem) => void;
  pulseAt: (pos: [number, number, number], valid: boolean) => void; // flare a point WITHOUT changing selection
  clearSelection: () => void;
  setHover: (id: string | null) => void;
  selectPoet: (p: PoetRow, focus?: { poemIdx: number; title: string; firstLine: string } | null) => void;
  setPoetPoems: (id: string, poems: PoemRecord[]) => void;
  clearPoet: () => void;
  hopToPoet: (p: PoetRow) => void; // travel along a 赠诗 edge: select + lock + APPEND to the trail (or
  //   trim back to it if already on the trail). Backed by GiftTrail's persistent return lines.
  clearTrail: () => void;
  setPath: (start: string | null, end: string | null, result: string[] | null) => void;
  toggleGifts: () => void;
  toggleGuideHold: () => void;
  toggleAllPoems: () => void;
  toggleQuality: () => void;
  toggleGravity: () => void;
  toggleUI: () => void;
  setSpeed: (s: number) => void;
  setFlyTarget: (t: [number, number, number] | null) => void;
  lockPoet: (id: string) => void;
  lockPoem: (poetId: string, poemIdx: number) => void;
  unlock: () => void;
}

const MAX_PULLS = 24; // small buffer; PulledStars caps the ALIVE markers at 20 + animates removal
const ALL_KEYS = DYNASTIES.map((d) => d.key);
let _pullSeq = 0;

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
  poetFocus: null,
  showGifts: false,
  guideHold: false,
  giftTrail: [],
  pathStart: null,
  pathEnd: null,
  pathResult: null,
  showAllPoems: false,
  quality: "high",
  uiHidden: false,
  gravity: true,
  speed: 1,
  flyTarget: null,
  lockPoetId: null,
  lockPoemIdx: null,

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
      poetFocus: null,
      lockPoetId: null, // a void pull releases any poet/planet lock
      lockPoemIdx: null,
      pulls: [...s.pulls, { id: _pullSeq++, pos: p.pos, valid: p.valid }].slice(-MAX_PULLS),
    })),
  pulseAt: (pos, valid) =>
    set((s) => ({ pulls: [...s.pulls, { id: _pullSeq++, pos, valid }].slice(-MAX_PULLS) })),
  clearSelection: () => set({ selected: null }),
  setHover: (hoverPoetId) => set({ hoverPoetId }),
  selectPoet: (selectedPoet, focus = null) =>
    // a NORMAL selection (3D star / search / planet) starts a FRESH trail at this poet (点无关诗人清除)
    set({ selectedPoet, poetPoems: null, poetFocus: focus, selected: null, giftTrail: [selectedPoet.id] }),
  setPoetPoems: (id, poems) =>
    set((s) => (s.selectedPoet?.id === id ? { poetPoems: poems } : {})),
  clearPoet: () => set({ selectedPoet: null, poetPoems: null, poetFocus: null, lockPoetId: null, lockPoemIdx: null, giftTrail: [] }),
  hopToPoet: (poet) =>
    set((s) => {
      const id = poet.id;
      const i = s.giftTrail.indexOf(id);
      // already on the trail → trim back to it (返回); else append, capping at 11 nodes (= 10 return lines)
      const giftTrail = i >= 0 ? s.giftTrail.slice(0, i + 1) : [...s.giftTrail, id].slice(-11);
      return { selectedPoet: poet, poetPoems: null, poetFocus: null, selected: null, lockPoetId: id, lockPoemIdx: null, giftTrail };
    }),
  clearTrail: () => set((s) => ({ giftTrail: s.selectedPoet ? [s.selectedPoet.id] : [], pathResult: null })),
  setPath: (pathStart, pathEnd, pathResult) => set({ pathStart, pathEnd, pathResult }),
  toggleGifts: () =>
    set((s) => (s.showGifts ? { showGifts: false, giftTrail: [], pathStart: null, pathEnd: null, pathResult: null } : { showGifts: true })),
  toggleGuideHold: () => set((s) => ({ guideHold: !s.guideHold })),
  toggleAllPoems: () => set((s) => ({ showAllPoems: !s.showAllPoems })),
  toggleQuality: () => set((s) => ({ quality: s.quality === "high" ? "low" : "high" })),
  toggleGravity: () => set((s) => ({ gravity: !s.gravity })),
  toggleUI: () => set((s) => ({ uiHidden: !s.uiHidden })),
  setSpeed: (speed) => set({ speed }),
  setFlyTarget: (flyTarget) => set({ flyTarget }),
  lockPoet: (id) => set({ lockPoetId: id, lockPoemIdx: null }),
  lockPoem: (id, poemIdx) => set({ lockPoetId: id, lockPoemIdx: poemIdx }),
  unlock: () => set({ lockPoetId: null, lockPoemIdx: null }),
}));
