// Pure decision rules for the canonical 别名层 (G2 follow-up) — extracted from build-data.mjs so they
// are unit-testable (pipeline/canonicalRules.test.mjs) without running the full data build. No I/O,
// no globals: both functions are pure (inputs → output).

/**
 * AUTO-alias canonical pick: decide which live bucket a fully-zeroed (name,dynasty) bucket merged into.
 *
 * Background: cross-dynasty exact dedup (corpus `canonical:false` + `canonical_id`) can zero an ENTIRE
 * (name,dynasty) bucket — 801 of them in the 2026-07 rebuild, 97% jinxiandai↔dangdai double-source
 * duplicates. The poet is still alive in the OTHER bucket, but the zeroed bucket's poetId would vanish
 * from poets.index.json and kill every old `#a=` permalink. So build-data emits an ALIAS row for it,
 * and this function picks the mergedInto target — data-driven, never a hardcoded name list:
 *
 *   1) MAJORITY VOTE over the excluded lines' canonical_id targets (each resolved by the caller to the
 *      "author|dynasty" bucket key that owns the canonical line). Only LIVE buckets (≥1 canonical poem
 *      ingested in THIS build) count — a dead target (e.g. its whole bucket was charset-skipped) must
 *      never win, or the alias would redirect to another empty/missing row (a chain/dead redirect).
 *   2) TIE at the top (or no usable targets at all — e.g. only `canonical_note` 组诗总题 lines, which
 *      carry no canonical_id; theoretically组诗 can't zero a whole bucket, this is defensive) →
 *      fall back to the same-NAME bucket with the MOST poems.
 *   3) No same-name live bucket either (theoretically 0 cases) → null: the caller emits a plain
 *      poemCount:0 row WITHOUT mergedInto — the permalink stays alive, the panel is just empty.
 *
 * @param {string[]} targetKeys  "author|dynasty" bucket keys the excluded lines' canonical_id resolved
 *                               to (unresolvable ids already dropped by the caller; may be empty).
 * @param {{key: string, count: number}[]} sameNameCandidates  live buckets sharing the same NAME
 *                               (any dynasty), each with its canonical poem count; may be empty.
 * @param {Set<string>} aliveKeys  every "author|dynasty" bucket key with ≥1 ingested canonical poem.
 * @returns {string|null}  the winning bucket key, or null (emit a plain 0-row, no mergedInto).
 */
export function chooseCanonicalBucket(targetKeys, sameNameCandidates, aliveKeys) {
  // 1) majority vote over canonical_id targets (the corpus's own ground truth for WHERE the dups point)
  const votes = new Map();
  for (const k of targetKeys) if (aliveKeys.has(k)) votes.set(k, (votes.get(k) || 0) + 1);
  let best = null, bestVotes = 0, tied = false;
  for (const [k, v] of votes) {
    if (v > bestVotes) { best = k; bestVotes = v; tied = false; }
    else if (v === bestVotes) tied = true;
  }
  if (best && !tied) return best;
  // 2) tie / no usable targets → most-poems same-name live bucket (strict > keeps the first max, so the
  //    result is deterministic for the caller's iteration order)
  let cBest = null, cCount = -1;
  for (const c of sameNameCandidates) {
    if (aliveKeys.has(c.key) && c.count > cCount) { cBest = c.key; cCount = c.count; }
  }
  return cBest; // 3) null when nothing qualifies → plain 0-row without mergedInto
}

/**
 * 赠诗 bare-name resolution ZONE for a dynasty key.
 *
 * Rationale (2026-07 rebuild audit): the corpus's modern era is SPLIT into two buckets purely by
 * upstream source labels — Werneror 近现代.csv → jinxiandai, yuxqiu/sheepzh → dangdai — not by any real
 * historical boundary. Cross-source exact dedup (canonical:false) then moves a poet's surviving bucket
 * wholesale from one to the other, while the poems that REFERENCE that poet by bare name stay in the
 * original bucket — so the old "bare name resolves only within the SAME dynasty" rule broke 22 real
 * edges (e.g. 龙榆生[dangdai]→陈寅恪[jinxiandai], 郁达夫[dangdai]→鲁迅[jinxiandai]). Treating
 * jinxiandai+dangdai as ONE resolution zone both repairs those and recovers edges that were ALWAYS
 * missed because the two modern buckets never saw each other. Every other dynasty stays its own zone —
 * a bare namesake across pre-modern dynasties is almost always a collision (the original precision
 * argument), and that argument still holds there. The GIFT_ALIAS (号/字) path is unaffected: it was
 * already cross-dynasty by design.
 *
 * @param {string} dynKey  canonical dynasty key (tang/song/…/jinxiandai/dangdai)
 * @returns {string}  the zone id — equal zone ⇔ bare names may resolve across the two buckets.
 */
export function resolveZone(dynKey) {
  return dynKey === "jinxiandai" || dynKey === "dangdai" ? "modern" : dynKey;
}
