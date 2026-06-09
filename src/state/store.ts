import { create } from "zustand";
import type { PulledPoem, PullForm } from "../engine/engineApi";
import type { PoetRow, PoemRecord } from "../data/load";
import { DYNASTIES } from "../data/dynasties";
import { WEAK } from "../three/detectQuality";

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
  hoverPoem: { title: string; x: number; y: number } | null; // 诗名指引: hovered planet's title near cursor
  selectedPoet: PoetRow | null;
  poetPoems: PoemRecord[] | null;
  // poetId whose poem fetch FAILED (network) — PoetPanel turns the eternal 载入作品… into an error + 重试
  poetPoemsError: string | null;
  poetFocus: { poemIdx: number; title: string; firstLine: string } | null; // poem to surface (诗句 search)
  // 赠诗 network
  showGifts: boolean;
  // 行星指引线 settings (the 指引 line射向选中诗人的每首诗):
  //   mode     = off(不显示) / flash(点一下闪现 guideSeconds 秒) / hold(常驻,直到换人/关闭)
  //   coverage = all(每首诗都连线,一首不漏) / optimized(数量大时跨全段采样,见 PoemGuides)
  //   seconds  = flash 模式每次显示的时长
  guideMode: "off" | "flash" | "hold";
  guideCoverage: "all" | "optimized";
  guideSeconds: number;
  guideBrightness: number; // 指引线亮度倍率 (default lower; adjustable 0.2..2.0)
  // 诗云设置菜单 (收容 指引 / 行星 / 赠诗 / 引力) open
  settingsOpen: boolean;
  // poem "planets": when ON, every poet shows ALL their poems as orbiting planets (高性能);
  // when OFF, only the selected poet's poems orbit (on-demand 彩蛋). Like 赠诗, a visual toggle.
  showAllPoems: boolean;
  // render quality (scales galaxy particle counts + bloom for weak GPUs)
  quality: "high" | "low";
  // hide ALL overlay UI (screenshot mode) — toggled by a corner button + the H hotkey
  uiHidden: boolean;
  // 奇迹时刻 (cinema): freeze ALL auto-animation (galaxy spin, void-pull lifecycle, highlight fades) and
  // show a framed share card over the still scene to guide a clean screenshot. cinemaCopy = which tagline.
  cinema: boolean;
  cinemaCopy: number;
  // owner-only feedback viewer (opened by a hidden gesture: 5 taps on the 诗云 logo within 10 s)
  feedbackOpen: boolean;
  // 赠诗漫游 (gift-network roaming): a breadcrumb of poets you've HOPPED through along 赠诗 edges.
  // trail[last] = the current poet; consecutive nodes are drawn as persistent "return lines" (GiftTrail).
  // Capped at 11 nodes (= 10 return edges). Reset to [poet] on a NORMAL selectPoet (= 点无关诗人清除);
  // grown by hopToPoet; cleared on 赠诗 off / manual clear.
  giftTrail: string[];
  // pathfinding between two poets over the 赠诗 graph
  pathStart: string | null;
  pathEnd: string | null;
  pathResult: string[] | null; // BFS poet-id path (incl. endpoints), [] = searched but none within range
  pathDimEgo: boolean; // 路径查找时弱化(变暗)个体往来线,突出 path 本身
  giftHoverId: string | null; // 悬停高亮的赠诗往来线(对方 poetId) — easier to click (item 6)
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
  setHoverPoem: (h: { title: string; x: number; y: number } | null) => void;
  selectPoet: (p: PoetRow, focus?: { poemIdx: number; title: string; firstLine: string } | null) => void;
  setPoetPoems: (id: string, poems: PoemRecord[]) => void;
  setPoetPoemsError: (id: string | null) => void;
  clearPoet: () => void;
  hopToPoet: (p: PoetRow) => void; // travel along a 赠诗 edge: select + lock + APPEND to the trail (or
  //   trim back to it if already on the trail). Backed by GiftTrail's persistent return lines.
  clearTrail: () => void;
  setPath: (start: string | null, end: string | null, result: string[] | null) => void;
  toggleGifts: () => void;
  setGuideMode: (m: "off" | "flash" | "hold") => void;
  setGuideCoverage: (c: "all" | "optimized") => void;
  setGuideSeconds: (n: number) => void;
  setGuideBrightness: (n: number) => void;
  resetGuide: () => void;
  toggleSettings: () => void;
  togglePathDimEgo: () => void;
  setGiftHover: (id: string | null) => void;
  toggleAllPoems: () => void;
  toggleQuality: () => void;
  toggleGravity: () => void;
  toggleUI: () => void;
  toggleCinema: () => void;
  setCinemaCopy: (n: number) => void;
  setFeedbackOpen: (b: boolean) => void;
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
  hoverPoem: null,
  selectedPoet: null,
  poetPoems: null,
  poetPoemsError: null,
  poetFocus: null,
  showGifts: false,
  guideMode: "flash",
  guideCoverage: "optimized",
  guideSeconds: 10,
  guideBrightness: 0.7,
  settingsOpen: false,
  giftTrail: [],
  pathStart: null,
  pathEnd: null,
  pathResult: null,
  pathDimEgo: false,
  giftHoverId: null,
  showAllPoems: false,
  // weak / mobile GPUs default to 画质·低 (auto-detected once at module load); the user can still force
  // 画质·高 via the HUD toggle. See three/detectQuality.ts.
  quality: WEAK ? "low" : "high",
  uiHidden: false,
  cinema: false,
  cinemaCopy: 0,
  feedbackOpen: false,
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
  setHoverPoem: (hoverPoem) => set({ hoverPoem }),
  selectPoet: (selectedPoet, focus = null) =>
    // a NORMAL selection (3D star / search / planet) starts a FRESH trail at this poet (点无关诗人清除)
    set({ selectedPoet, poetPoems: null, poetPoemsError: null, poetFocus: focus, selected: null, giftTrail: [selectedPoet.id] }),
  setPoetPoems: (id, poems) =>
    set((s) => (s.selectedPoet?.id === id ? { poetPoems: poems, poetPoemsError: null } : {})),
  setPoetPoemsError: (id) =>
    set((s) => (id === null || s.selectedPoet?.id === id ? { poetPoemsError: id } : {})),
  clearPoet: () => set({ selectedPoet: null, poetPoems: null, poetPoemsError: null, poetFocus: null, lockPoetId: null, lockPoemIdx: null, giftTrail: [], hoverPoem: null }),
  hopToPoet: (poet) =>
    set((s) => {
      const id = poet.id;
      const i = s.giftTrail.indexOf(id);
      // already on the trail → trim back to it (返回); else append, capping at 11 nodes (= 10 return lines)
      const giftTrail = i >= 0 ? s.giftTrail.slice(0, i + 1) : [...s.giftTrail, id].slice(-11);
      return { selectedPoet: poet, poetPoems: null, poetPoemsError: null, poetFocus: null, selected: null, lockPoetId: id, lockPoemIdx: null, giftTrail };
    }),
  clearTrail: () => set((s) => ({ giftTrail: s.selectedPoet ? [s.selectedPoet.id] : [], pathResult: null })),
  setPath: (pathStart, pathEnd, pathResult) => set({ pathStart, pathEnd, pathResult }),
  toggleGifts: () =>
    set((s) => (s.showGifts ? { showGifts: false, giftTrail: [], pathStart: null, pathEnd: null, pathResult: null, giftHoverId: null } : { showGifts: true })),
  setGuideMode: (guideMode) => set({ guideMode }),
  setGuideCoverage: (guideCoverage) => set({ guideCoverage }),
  setGuideSeconds: (guideSeconds) => set({ guideSeconds }),
  setGuideBrightness: (guideBrightness) => set({ guideBrightness }),
  resetGuide: () => set({ guideMode: "flash", guideCoverage: "optimized", guideSeconds: 10, guideBrightness: 0.7 }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  togglePathDimEgo: () => set((s) => ({ pathDimEgo: !s.pathDimEgo })),
  setGiftHover: (giftHoverId) => set((s) => (s.giftHoverId === giftHoverId ? {} : { giftHoverId })),
  // 行星·全部 builds ONE ~857k-point additive layer — fine on a desktop GPU, an instant freeze/OOM on a
  // phone. On weak devices it can be turned OFF but never ON (the SettingsMenu row shows it disabled).
  toggleAllPoems: () => set((s) => (WEAK && !s.showAllPoems ? {} : { showAllPoems: !s.showAllPoems })),
  toggleQuality: () => set((s) => ({ quality: s.quality === "high" ? "low" : "high" })),
  toggleGravity: () => set((s) => ({ gravity: !s.gravity })),
  toggleUI: () => set((s) => ({ uiHidden: !s.uiHidden })),
  toggleCinema: () => set((s) => ({ cinema: !s.cinema })),
  setCinemaCopy: (cinemaCopy) => set({ cinemaCopy }),
  setFeedbackOpen: (feedbackOpen) => set({ feedbackOpen }),
  setSpeed: (speed) => set({ speed }),
  setFlyTarget: (flyTarget) => set({ flyTarget }),
  lockPoet: (id) => set({ lockPoetId: id, lockPoemIdx: null }),
  lockPoem: (id, poemIdx) => set({ lockPoetId: id, lockPoemIdx: poemIdx }),
  unlock: () => set({ lockPoetId: null, lockPoemIdx: null }),
}));
