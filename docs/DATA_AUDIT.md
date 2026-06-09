# Data audit — is 诗云's corpus the best/most-complete choice?

> Pre-launch audit (2026-06-09, 8th agent). A multi-agent web survey + adversarial reverse-verification of
> the shipped corpus against every alternative open Chinese-poetry dataset. **Verdict: ship as-is.** This
> file records the evidence so the next agent doesn't have to re-run it.

## TL;DR

| Question | Answer |
|---|---|
| Is it the **optimal fit** for this app? | **Yes.** The only large corpus that is *simultaneously* broad/all-dynasties **+** Simplified **+** permissively-licensed **+** machine-parseable. |
| Is it the **most comprehensive** corpus that exists? | **No.** `ORCHESTRA-simple-1M` holds ~1.09M poems (+28%) — but it's Traditional, license-encumbered, classical-only → a *worse* fit. |
| Is it a **complete** database of extant verse? | **No, and nothing is.** It captures the bulk of the *open* record but is thin on 明/清 — because **no complete 全明诗/全清诗 exists anywhere** (全清诗 was never compiled). A field-wide ceiling, not a 诗云 defect. |
| Is it **mature**? | **Yes** (stable, MIT, self-contained) — though Werneror is a community scrape, not a scholarly-authoritative edition. |
| **Does launch block on a data change?** | **No.** Launch is gated on docs/build hygiene (now fixed), not data. |

## What ships today

`pipeline/build-data.mjs` reads **two** sources (verified in-tree — `grep -i chinese-poetry pipeline/` is empty):

- **[Werneror/Poetry](https://github.com/Werneror/Poetry)** — backbone. MIT, Simplified CSV, 先秦→当代,
  ~853k poems / ~29.3k poets. 1.7k★, last push 2023-08 (stable/frozen, not abandoned).
- **[yuxqiu/modern-poetry](https://github.com/yuxqiu/modern-poetry)** — modern overlay. Apache-2.0,
  +4,494 free-verse poems / +508 poets. Archived 2025-09 but functional.

Shipped totals (`public/data/manifest.json`): **857,877 poems / 29,808 poets / N = 12,877** — a **raw upstream
count** (no formal cross-source dedup).

> ⚠ `chinese-poetry` was **evaluated and dropped** (its ~317k-poem Tang/Song-shi bulk is Traditional → a lossy
> OpenCC pass would perturb N and the 平水韵→格律 map; also no 明, no 近现代/当代). Older copy in README /
> DATA_CONTRACT that listed it as a *live overlay* was stale and has been corrected.

## Alternatives surveyed (and why each loses to "keep Werneror")

| Dataset | Size | License | Verdict for 诗云 |
|---|---|---|---|
| **Werneror/Poetry** (current) | ~853k | MIT | **KEEP** — only corpus that is broad + Simplified + permissive + parseable at once. |
| **yuxqiu/modern-poetry** (current) | +4.5k | Apache-2.0 | **KEEP** — supplies the 现当代自由诗 layer no classical corpus has. |
| `Ayaka/ORCHESTRA-simple-1M` | **1.09M (+28%)** | RISKY (搜韵 origin, non-commercial) | **DON'T SWITCH** — the only *larger* corpus, but Traditional + encumbered + classical-only. A v2 experiment, not a drop-in. |
| `chinese-poetry/chinese-poetry` | ~351k | MIT | **STAY DROPPED** — smaller, narrower (Tang/Song only), Traditional bulk. Optional 词/曲 supplement after OpenCC+dedup. |
| `sheepzh/poetry` (modern) | ~80k / ~3.5k poets | MIT pkg / in-copyright text | **OPTIONAL post-launch** — ~18× the modern layer, Simplified, one-folder-per-poet. Needs a ~30-line `.pt` parser. |
| `殆知阁 Daizhige` | huge | none stated | **NO** — unstructured TXT books, no per-poem rows, no license. |
| `搜韵 sou-yun` (live) | ~830k classical | non-commercial, API-only | **NO** — not bulk-downloadable, can't ship in a static build. |
| 全唐诗/全宋诗/全宋词… (scholarly) | sums ≈ Werneror | mixed/in-copyright | **NO** — fragmented across repos, mixed licenses; Werneror already aggregates them. |

## Reverse-verification (the "is it really complete/mature?" check)

- **Mature?** Werneror is stable and permissive, but a *community aggregate with no documented provenance* — "mature" = usable/stable, **not** scholarly-authoritative. Treat poem counts as upstream, not censused.
- **Complete?** **Refuted.** Scholar-cited extant figures: 全唐诗 ~49k, 全宋诗 ~270k, plus an estimated ~500k Ming and **~8–10M Qing** poems (全清诗 never compiled; largest Qing anthology covers <10% of Qing poets). 诗云 is near-complete on **唐/宋 poet rosters** (唐 2,820 vs ~2,200–3,800; 宋 9,496 vs ~9,000) but captures only a fraction of 明/清 by volume. **There is no permissively-licensed, machine-readable, near-complete Ming/Qing corpus to acquire** — the gap is a ceiling on the entire field.

## Recommendations

**Done at this launch (docs/build, not data):**
1. ✅ Corrected the stale `chinese-poetry`-as-live-overlay copy (README + DATA_CONTRACT).
2. ✅ Reframed "857,877" as a raw upstream count; replaced any "complete" claim with "broadest open Simplified all-dynasties corpus, near-complete on 唐/宋."
3. ✅ Hardened the modern-overlay build: a missing clone now **fails loud** (was a silent desync); opt out with `ALLOW_NO_MODERN=1`.

**Post-launch follow-ups:**
- ✅ **Modern upgrade — DONE (v2, 2026-06-10).** `sheepzh/poetry` imported with a **frozen charset**
  (N=12,877 byte-identical → every existing 编号 permalink stable): +75,980 poems / +2,849 poets after
  cross-source dedup (3,016), junk-folder filter (125) and charset gate (1,597 skipped). New totals:
  **32,657 poets / 933,857 poems**. 余秀华(249)/顾城(489)/海子(323)/食指(43) now in. See PIPELINE.md.
- **Honest count** → one `(normalized 作者+内容)` exact-dedup pass + 互见 clustering + 无名氏 special-casing, to publish a distinct-poem count (classical layer).
- **Do NOT chase 明/清 completeness** — no acquirable source exists. Don't switch to ORCHESTRA/搜韵 unless the app pivots to *maximize classical count* AND accepts Traditional + a non-commercial license.

## How to reproduce this audit

A background `Workflow` (`shiyun-data-audit`) fanned 6 survey agents (chinese-poetry ecosystem, mega-corpora,
authoritative editions, modern/contemporary, HF/Kaggle ML sets, data-quality/dedup) → 2 adversarial verifiers
(completeness lens + fit lens) → 1 synthesis. Re-run by re-invoking that workflow if upstream datasets change.
