// Canonical dynasty taxonomy (先秦 → 当代), aligned with the Step-3 data pipeline's
// normalization output (see docs/DATA_CONTRACT.md). `id` = order = filter index =
// the per-star `aDynasty` attribute. Keys here are THE canonical keys the corpus
// 朝代 strings get normalized onto, so frontend and pipeline share one vocabulary.
export interface Dynasty {
  id: number; // 0-based order = innermost(oldest) → outermost(newest) = filter index
  key: string;
  label: string;
  color: string;
  weight: number; // relative star density for the placeholder cloud (∝ corpus size)
  major: boolean; // in the "主要" preset
  group: string; // for presets / color banding
  yearStart: number;
  yearEnd: number;
}

export const DYNASTIES: Dynasty[] = [
  { id: 0, key: "xianqin", label: "先秦", color: "#2fd6cf", weight: 0.3, major: true, group: "early", yearStart: -1100, yearEnd: -221 },
  { id: 1, key: "qinhan", label: "秦汉", color: "#36d09a", weight: 0.3, major: false, group: "early", yearStart: -221, yearEnd: 220 },
  { id: 2, key: "weijin", label: "魏晋", color: "#49c06e", weight: 0.5, major: true, group: "early", yearStart: 220, yearEnd: 420 },
  { id: 3, key: "nanbeichao", label: "南北朝", color: "#7cba52", weight: 0.6, major: false, group: "early", yearStart: 420, yearEnd: 589 },
  { id: 4, key: "sui", label: "隋", color: "#a8b84a", weight: 0.2, major: false, group: "tang_wudai", yearStart: 581, yearEnd: 618 },
  { id: 5, key: "tang", label: "唐", color: "#ffd27a", weight: 2.2, major: true, group: "tang_wudai", yearStart: 618, yearEnd: 907 },
  { id: 6, key: "wudai", label: "五代十国", color: "#ffac5a", weight: 0.4, major: false, group: "tang_wudai", yearStart: 907, yearEnd: 979 },
  { id: 7, key: "song", label: "宋", color: "#6ee7a8", weight: 3.0, major: true, group: "song_era", yearStart: 960, yearEnd: 1279 },
  { id: 8, key: "liao", label: "辽", color: "#8fd0c0", weight: 0.1, major: false, group: "song_era", yearStart: 916, yearEnd: 1125 },
  { id: 9, key: "jin", label: "金", color: "#b0c98a", weight: 0.4, major: false, group: "song_era", yearStart: 1115, yearEnd: 1234 },
  { id: 10, key: "yuan", label: "元", color: "#b794f6", weight: 1.3, major: true, group: "late_imperial", yearStart: 1271, yearEnd: 1368 },
  { id: 11, key: "ming", label: "明", color: "#f6759a", weight: 2.8, major: true, group: "late_imperial", yearStart: 1368, yearEnd: 1644 },
  { id: 12, key: "qing", label: "清", color: "#ff8c5a", weight: 2.0, major: true, group: "late_imperial", yearStart: 1644, yearEnd: 1912 },
  { id: 13, key: "jinxiandai", label: "近现代", color: "#ff6f91", weight: 1.0, major: false, group: "modern", yearStart: 1840, yearEnd: 1949 },
  { id: 14, key: "dangdai", label: "当代", color: "#d96fb0", weight: 0.9, major: false, group: "modern", yearStart: 1949, yearEnd: 2099 },
];

export const DYNASTY_COUNT = DYNASTIES.length;
export const DYNASTY_BY_KEY: Record<string, Dynasty> = Object.fromEntries(
  DYNASTIES.map((d) => [d.key, d]),
);

export const R_MIN = 420;
export const R_MAX = 3400;
const SPAN = (R_MAX - R_MIN) / DYNASTIES.length;

// Radial band [inner, outer] for a dynasty order.
export function bandRadius(order: number): [number, number] {
  const inner = R_MIN + order * SPAN;
  return [inner, inner + SPAN];
}

// Deterministic string hash (FNV-1a, 32-bit) → uint32. Shard-bucket contract with the pipeline's
// fnv32 (build-search/lines/fuzzy) — contract-tested in src/data/shardHash.contract.test.ts.
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A point on a sphere of the given radius, deterministic from a 0..1 pair.
export function spherePoint(radius: number, u: number, v: number): [number, number, number] {
  const theta = u * 2 * Math.PI;
  const phi = Math.acos(2 * v - 1);
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
  ];
}
