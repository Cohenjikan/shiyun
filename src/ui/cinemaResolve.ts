// Pure resolution of the poem 留影(cinema) frames, extracted from <Cinema/> so the precedence is
// unit-testable without a Canvas / loaded dataset.
//
// Precedence (highest first):
//   1. explicit cinemaPoemIdx  — the per-poem 留影 button in PoetPanel picked THIS poem (its ORIGINAL
//      index into the poet's loaded poems). Takes priority so a lingering void `selected` can never
//      shadow a deliberate choice.
//   2. selected (void pull)    — the purest 奇迹: a poem captured 从虚空.
//   3. poetFocus.poemIdx       — the 搜的这首 hit, when arriving via a 诗句 search / planet click.
//
// `indexer(lines)` computes the 全集编号 (anyTextIndex in the app; a stub in tests). It may return null
// (glyph outside the 字库) — the card still renders, just without an 编号 block.

export interface ResolvedCinemaPoem {
  lines: string[];
  index: string | null;
  digits: number;
  attribution: string;
}

export interface AnyIndexLike {
  index: string;
  digits: number;
}

export interface CinemaResolveArgs {
  // void pull
  selected: { lines: string[]; babelIndex: string; babelDigits: number } | null;
  // selected poet + its loaded poems (null while loading)
  poet: { name: string } | null;
  poems: { t: string; p: string[] }[] | null;
  // 搜的这首 focus (search hit)
  focus: { poemIdx: number } | null;
  // explicit per-poem 留影 target (PoetPanel row button)
  cinemaPoemIdx: number | null;
  // 全集编号 computer (anyTextIndex)
  indexer: (lines: string[]) => AnyIndexLike | null;
}

function fromPoetPoem(
  poet: { name: string },
  pm: { t: string; p: string[] },
  indexer: CinemaResolveArgs["indexer"],
): ResolvedCinemaPoem {
  const a = indexer(pm.p);
  return {
    lines: pm.p,
    index: a?.index ?? null,
    digits: a?.digits ?? 0,
    attribution: `${poet.name}《${pm.t || "无题"}》`,
  };
}

export function resolveCinemaPoem(args: CinemaResolveArgs): ResolvedCinemaPoem | null {
  const { selected, poet, poems, focus, cinemaPoemIdx, indexer } = args;
  // 1. explicit per-poem target (PoetPanel 留影 button) — highest priority
  if (poet && poems && cinemaPoemIdx != null && cinemaPoemIdx >= 0 && poems[cinemaPoemIdx]) {
    return fromPoetPoem(poet, poems[cinemaPoemIdx], indexer);
  }
  // 2. void pull (the purest 奇迹)
  if (selected) {
    return {
      lines: selected.lines,
      index: selected.babelIndex,
      digits: selected.babelDigits,
      attribution: "诗云 · 从虚空里捞起",
    };
  }
  // 3. 搜的这首 focus poem
  if (poet && poems && focus && focus.poemIdx >= 0 && poems[focus.poemIdx]) {
    return fromPoetPoem(poet, poems[focus.poemIdx], indexer);
  }
  return null;
}
