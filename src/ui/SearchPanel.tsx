import { useRef, useState } from "react";
import { searchPoets, searchByLine, searchPoems, loadPoetPoems, getPoet, type PoetRow, type LineHit } from "../data/load";
import { DYNASTY_BY_KEY, DYNASTIES } from "../data/dynasties";
import {
  halfIndexAuto,
  pullByIndex,
  pulledFromIndex,
  anyTextIndex,
  inCharset,
  type HalfIndex,
  type IndexPoem,
  type PullForm,
} from "../engine/engineApi";
import { useStore } from "../state/store";
import { poemPosition } from "../three/positions";
import { COARSE } from "../three/detectQuality";
import { CopyButton } from "./CopyButton";

const FORM_LABEL: Record<string, string> = {
  wujue: "五绝",
  qijue: "七绝",
  wulu: "五律",
  qilu: "七律",
  ziyou: "自由",
};
const COMPOSE_FORMS: PullForm[] = ["wujue", "qijue", "wulu", "qilu", "ziyou"];
// rows × chars-per-line for the fill-in grid (the user types chars, the engine computes the 编号)
const GRID: Record<string, { rows: number; cols: number }> = {
  wujue: { rows: 4, cols: 5 },
  qijue: { rows: 4, cols: 7 },
  wulu: { rows: 8, cols: 5 },
  qilu: { rows: 8, cols: 7 },
};
const MAJOR = DYNASTIES.filter((d) => d.major).map((d) => d.key);
const HAN = /\p{Script=Han}/u;
const hanChars = (s: string) => [...s].filter((c) => HAN.test(c)); // keep only 汉字 (drop pinyin / 标点 / 空白)

type Tab = "poet" | "line" | "compose" | "dynasty";
// when a composed / reverse-looked-up poem turns out to be a REAL corpus poem, carry its poet+index so
// 定位 flies to that poet's ACTUAL orbiting planet (item 1) instead of a random void-scatter point.
type RealHit = { name: string; title: string; approx?: boolean; poetId: string; poemIdx: number; firstLine: string } | null;

// Same-length near-match: identical, OR differs by ≤2 chars (and ≥85%) — so popular variants of a real
// poem still register (静夜思「举头望明月」 vs the corpus「举头望山月」; 的/地…). Different-length variants
// need the fuzzy line index (next round). Compared by code point (CJK-safe).
function nearMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = [...a], cb = [...b];
  if (ca.length !== cb.length || !ca.length) return false;
  let diff = 0;
  const cap = Math.max(2, Math.ceil(ca.length * 0.15));
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i] && ++diff > cap) return false;
  return true;
}

// Does the typed poem happen to be a REAL corpus poem (exactly, or a near variant)? (loop closure.)
async function findReal(lines: string[]): Promise<RealHit> {
  if (!lines.length || !lines[0]) return null;
  const text = lines.join("");
  const hits = await searchByLine(lines[0]);
  for (const h of hits.slice(0, 6)) {
    const poems = await loadPoetPoems(h.poetId);
    const corpus = poems[h.poemIdx]?.p.join("") ?? "";
    if (!corpus) continue;
    const base = { name: h.poet?.name ?? "佚名", title: h.title || "无题", poetId: h.poetId, poemIdx: h.poemIdx, firstLine: h.firstLine };
    if (corpus === text) return base;
    if (nearMatch(corpus, text)) return { ...base, approx: true };
  }
  return null;
}

export function SearchPanel() {
  const [tab, setTab] = useState<Tab>("poet");
  // mobile: start collapsed → only the tab row shows (the "hint"); tapping a tab expands it. Desktop: open.
  const [collapsed, setCollapsed] = useState(COARSE);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PoetRow[]>([]);
  const [hits, setHits] = useState<LineHit[]>([]);
  const [half, setHalf] = useState<HalfIndex | null>(null);

  // 造诗 tab: compose (fill chars → 编号) or reverse (编号 → 诗)
  const [composeForm, setComposeForm] = useState<PullForm>("wujue");
  const [composeDir, setComposeDir] = useState<"make" | "reverse">("make");
  const [gridText, setGridText] = useState(""); // fixed-form input — ONE field (IME + paste friendly)
  const [freeText, setFreeText] = useState(""); // 自由: one line per textarea row
  const [made, setMade] = useState<{ lines: string[]; index: string; digits: number; chars: number } | null>(null);
  const [madeReal, setMadeReal] = useState<RealHit>(null);
  const [idxInput, setIdxInput] = useState("");
  const [rev, setRev] = useState<IndexPoem | null>(null);
  const [revReal, setRevReal] = useState<RealHit>(null);

  const selectPoet = useStore((s) => s.selectPoet);
  const selectPoem = useStore((s) => s.selectPoem);
  const setFlyTarget = useStore((s) => s.setFlyTarget);
  const pulseAt = useStore((s) => s.pulseAt);
  const lockPoet = useStore((s) => s.lockPoet);
  const lockPoem = useStore((s) => s.lockPoem);
  // dynasty filter (merged in — no separate legend box)
  const hidden = useStore((s) => s.hidden);
  const toggleDynasty = useStore((s) => s.toggleDynasty);
  const showAll = useStore((s) => s.showAllDynasties);
  const showOnly = useStore((s) => s.showOnly);

  const reqRef = useRef(0);
  const madeReqRef = useRef(0);
  const revReqRef = useRef(0);

  // 定位虚空: a known index has ONE fixed canonical point — fly there + light the flare marker.
  function locateInVoid(form: PullForm, indexStr: string) {
    const poem = pulledFromIndex(form, indexStr);
    if (!poem) return;
    selectPoem(poem);
    setFlyTarget(poem.pos);
  }

  function onChangePoet(v: string) {
    setQ(v);
    setResults(searchPoets(v, 24));
  }
  function onChangeLine(v: string) {
    setQ(v);
    setHalf(halfIndexAuto(v));
    const token = ++reqRef.current;
    // 寻诗: 诗句(整句/中段) + 诗名 + 单字 增量搜索, all merged + ranked. (findReal still uses searchByLine.)
    searchPoems(v).then((h) => reqRef.current === token && setHits(h));
  }

  function goPoet(p: PoetRow, focus?: { poemIdx: number; title: string; firstLine: string }) {
    selectPoet(p, focus ?? null);
    lockPoet(p.id); // lock + follow the poet (camera glides in and tracks it)
    loadPoetPoems(p.id).then((poems) => useStore.getState().setPoetPoems(p.id, poems));
    setResults([]);
  }
  function goHit(h: LineHit) {
    if (!h.poet) return;
    goPoet(h.poet, { poemIdx: h.poemIdx, title: h.title, firstLine: h.firstLine });
    // lock the EXACT poem-planet in that poet's system (camera follows it as it orbits) + flare it,
    // so 诗句 search lands you on the star, not just the constellation.
    lockPoem(h.poet.id, h.poemIdx);
    pulseAt(poemPosition(h.poet, h.poemIdx), true);
  }
  // item 1: a composed / reverse poem that IS a real corpus poem flies to that poet's ACTUAL orbiting
  // planet (around 李白 for 赠汪伦), not a random void-scatter point — it already has a real home.
  function goReal(hit: NonNullable<RealHit>) {
    const poet = getPoet(hit.poetId);
    if (!poet) return;
    goPoet(poet, { poemIdx: hit.poemIdx, title: hit.title, firstLine: hit.firstLine });
    lockPoem(poet.id, hit.poemIdx);
    pulseAt(poemPosition(poet, hit.poemIdx), true);
  }

  // ── 造诗·填字 → 编号 ──────────────────────────────────────────────────────
  // Recompute the catalog 编号 from the chars the user typed (fixed grid, or 自由 lines). No number
  // math by the user — they write a poem, the engine reports its address (+ whether it's a real poem).
  function recomputeMake(form: PullForm, gridT: string, free: string) {
    setMadeReal(null);
    if (form === "ziyou") {
      // split on newlines OR punctuation/space, then keep ONLY 字本身 — so pasting
      // 「床前明月光,疑是地上霜.」 works and every line round-trips through the 字库.
      const lines = free.split(/[\n\r，。；！？、,.;!?\s]+/).map((s) => hanChars(s).join("")).filter(Boolean);
      const r = anyTextIndex(lines);
      if (!r) return setMade(null);
      setMade({ lines, index: r.index, digits: r.digits, chars: r.chars });
      const token = ++madeReqRef.current;
      findReal(lines).then((hit) => madeReqRef.current === token && setMadeReal(hit));
      return;
    }
    const g = GRID[form];
    const L = g.rows * g.cols;
    const chars = hanChars(gridT); // only 汉字 (pinyin / 标点 / latin dropped → IME + paste both work)
    if (chars.length < L) return setMade(null); // not enough chars yet
    const use = chars.slice(0, L);
    const lines: string[] = [];
    for (let i = 0; i < g.rows; i++) lines.push(use.slice(i * g.cols, (i + 1) * g.cols).join(""));
    // UNIVERSAL 全集编号 (anyTextIndex over chars+breaks) — the SAME number as this poem's 自由 form, so a
    // 七绝 and its 自由 twin share ONE unique 编号 (no per-form collision, no duplicate).
    const r = anyTextIndex(lines);
    if (!r) return setMade(null); // some char not in 字库
    setMade({ lines, index: r.index, digits: r.digits, chars: use.length });
    const token = ++madeReqRef.current;
    findReal(lines).then((hit) => madeReqRef.current === token && setMadeReal(hit));
  }
  function pickComposeForm(f: PullForm) {
    setComposeForm(f);
    setMade(null);
    setMadeReal(null);
    setRev(null); // clear the other direction's stale poem so its form/label never mismatches
    setRevReal(null);
    if (composeDir === "make") recomputeMake(f, gridText, freeText);
    else if (idxInput) runReverse(f, idxInput);
  }
  function onGridText(v: string) {
    setGridText(v);
    recomputeMake(composeForm, v, freeText);
  }
  function onFreeText(v: string) {
    setFreeText(v);
    recomputeMake(composeForm, gridText, v);
  }

  // ── 造诗·凭编号 → 诗 (reverse) ────────────────────────────────────────────
  function runReverse(form: PullForm, v: string) {
    const r = pullByIndex(form, v); // UNIVERSAL: form arg ignored; the number self-describes its poem
    setRev(r);
    setRevReal(null);
    if (r && r.lines.length) {
      const token = ++revReqRef.current;
      findReal(r.lines).then((hit) => revReqRef.current === token && setRevReal(hit));
    }
  }
  function onChangeIndex(v: string) {
    setIdxInput(v);
    runReverse(composeForm, v);
  }

  function switchTab(t: Tab) {
    setTab(t);
    setCollapsed(false); // tapping a tab expands the panel (on mobile it starts collapsed to the tab row)
    setQ("");
    setResults([]);
    setHits([]);
    setHalf(null);
  }

  const g = composeForm !== "ziyou" ? GRID[composeForm] : null;

  return (
    <div className={collapsed ? "search collapsed" : "search"}>
      <div className="search-tabs">
        <button className={tab === "poet" ? "stab on" : "stab"} onClick={() => switchTab("poet")}>诗人</button>
        <button className={tab === "line" ? "stab on" : "stab"} onClick={() => switchTab("line")}>寻诗</button>
        <button className={tab === "compose" ? "stab on" : "stab"} onClick={() => switchTab("compose")}>探诗</button>
        <button className={tab === "dynasty" ? "stab on" : "stab"} onClick={() => switchTab("dynasty")}>朝代</button>
        <button className="stab collapse" onClick={() => setCollapsed((c) => !c)} title={collapsed ? "展开" : "收起"}>
          {collapsed ? "▾" : "▴"}
        </button>
      </div>

      {!collapsed && (tab === "poet" || tab === "line") && (
        <input
          value={q}
          placeholder={tab === "poet" ? "搜索诗人…（回车飞到第一个）" : "诗句 / 诗名 / 单字,如 静夜思 或 举头望（回车定位）"}
          onChange={(e) => (tab === "poet" ? onChangePoet(e.target.value) : onChangeLine(e.target.value))}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (tab === "poet" && results[0]) goPoet(results[0]);
            else if (tab === "line" && hits[0]) goHit(hits[0]);
          }}
          spellCheck={false}
        />
      )}

      {!collapsed && tab === "poet" && results.length > 0 && (
        <div className="search-results">
          {results.map((p) => {
            const dyn = DYNASTY_BY_KEY[p.dynasty];
            return (
              <button key={p.id} className="search-row" onClick={() => goPoet(p)}>
                <span className="sr-name">{p.name}</span>
                <span className="sr-meta">{dyn?.label ?? p.dynasty} · {p.poemCount}首</span>
              </button>
            );
          })}
        </div>
      )}

      {!collapsed && tab === "line" && half && (
        <div className="line-results">
          {hits.length > 0 && (
            <div className="lr-section">
              <div className="lr-head">真实的诗 · 诗句 / 诗名 / 单字</div>
              {hits.map((h, i) => {
                const dyn = h.poet ? DYNASTY_BY_KEY[h.poet.dynasty] : undefined;
                return (
                  <button key={i} className="search-row" onClick={() => goHit(h)} disabled={!h.poet}>
                    <span className="sr-name">
                      {h.poet?.name ?? "佚名"}<span className="sr-title">《{h.title || "无题"}》</span>
                    </span>
                    <span className="sr-meta">{dyn?.label ?? ""} · {FORM_LABEL[h.form] ?? "古体"}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="lr-section">
            <div className="lr-head">纯随机 · 半编号<CopyButton text={half.index} /></div>
            <div className="half-note">
              前 {half.locked} 字锁定了全集编号的高位 —— 任何以此开头的诗都共享这段前缀:
            </div>
            <div className="half-idx full">{half.index}</div>
            <button className="locate-btn" onClick={() => locateInVoid("ziyou", half.index)}>
              飞到这条高位街区 · 点亮代表星
            </button>
          </div>
        </div>
      )}

      {!collapsed && tab === "compose" && (
        <div className="line-results">
          <div className="lr-section">
            <div className="rev-forms">
              {COMPOSE_FORMS.map((f) => (
                <button key={f} className={composeForm === f ? "seg-btn on" : "seg-btn"} onClick={() => pickComposeForm(f)}>
                  {FORM_LABEL[f]}
                </button>
              ))}
            </div>
            <div className="compose-dir">
              <button
                className={composeDir === "make" ? "seg-btn on" : "seg-btn"}
                onClick={() => setComposeDir("make")}
              >
                填字 → 编号
              </button>
              <button
                className={composeDir === "reverse" ? "seg-btn on" : "seg-btn"}
                onClick={() => setComposeDir("reverse")}
              >
                凭编号 → 诗
              </button>
            </div>
          </div>

          {composeDir === "make" && (
            <div className="lr-section">
              {g ? (
                <>
                  <div className="lr-head">逐字填诗（{g.rows} 行 × {g.cols} 字 · 共 {g.rows * g.cols} 字）</div>
                  {/* ONE input drives the grid — IME (拼音) + 粘贴 work normally; only 汉字 are kept. */}
                  <input
                    className="idx-input compose-text"
                    value={gridText}
                    placeholder="粘贴整首诗…"
                    onChange={(e) => onGridText(e.target.value)}
                    spellCheck={false}
                  />
                  <div className="compose-grid" style={{ gridTemplateColumns: `repeat(${g.cols}, 1fr)` }}>
                    {Array.from({ length: g.rows * g.cols }, (_, i) => {
                      const ch = hanChars(gridText)[i] ?? "";
                      const bad = !!ch && !inCharset(ch);
                      return (
                        <div key={i} className={bad ? "cell bad" : "cell"} title={bad ? "此字不在字库,无法编号" : undefined}>
                          {ch}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="lr-head">自由填诗（回车换行,空行忽略）</div>
                  <textarea
                    className="idx-input"
                    value={freeText}
                    placeholder={"每行一句,如:\n轻轻的我走了\n正如我轻轻的来\n我轻轻的招手\n作别西天的云彩\n那河畔的金柳"}
                    onChange={(e) => onFreeText(e.target.value)}
                    spellCheck={false}
                    rows={5}
                  />
                </>
              )}
              {made ? (
                <div className="rev-poem">
                  <div className="poem-body" lang="zh">
                    {made.lines.map((l, i) => (
                      <div className={composeForm === "ziyou" ? "poem-line wrap" : "poem-line"} key={i}>
                        {l}
                        {composeForm === "ziyou" ? (i === made.lines.length - 1 ? "。" : "，") : ""}
                      </div>
                    ))}
                  </div>
                  <div className="lr-head">
                    全集编号 · {made.digits} 位 · 唯一（跨诗体）
                    <CopyButton text={made.index} />
                  </div>
                  <div className="half-idx full">{made.index}</div>
                  {madeReal ? (
                    <button className="locate-btn real" onClick={() => goReal(madeReal)}>
                      飞到 {madeReal.name}《{madeReal.title}》的真实行星{madeReal.approx ? "（近似）" : ""}
                    </button>
                  ) : (
                    <button className="locate-btn" onClick={() => locateInVoid(composeForm, made.index)}>
                      定位虚空 · 飞过去点亮这首诗
                    </button>
                  )}
                  {madeReal && (
                    <div className="rev-real">
                      {madeReal.approx
                        ? `这几乎就是一首真实的诗(用字略有异文):${madeReal.name}《${madeReal.title}》`
                        : `这正好是一首真实存在的诗:${madeReal.name}《${madeReal.title}》`}
                    </div>
                  )}
                </div>
              ) : (
                <div className="half-note dim">
                  {composeForm === "ziyou"
                    ? "输入至少一句中文,即算出它的自由编号。拼音 / 标点都行,自动只取汉字。"
                    : "把格子填满中文字(都在字库内),即算出全集编号。拼音 / 标点都行,自动只取汉字。"}
                </div>
              )}
            </div>
          )}

          {composeDir === "reverse" && (
            <div className="lr-section">
              <div className="lr-head">粘贴编号 · 反查它是哪首诗（编号唯一,自带诗体）</div>
              <textarea
                className="idx-input"
                value={idxInput}
                placeholder="粘贴一个全集编号(纯数字,任意长)…"
                onChange={(e) => onChangeIndex(e.target.value)}
                spellCheck={false}
                rows={3}
              />
              {rev && rev.lines.length > 0 && (
                <div className="rev-poem">
                  <div className="poem-body" lang="zh">
                    {rev.lines.map((l, i) => (
                      <div className={rev.form === "ziyou" ? "poem-line wrap" : "poem-line"} key={i}>{l}</div>
                    ))}
                  </div>
                  <div className="half-note dim">推断诗体 · {FORM_LABEL[rev.form] ?? "古体/自由"}</div>
                  {revReal ? (
                    <button className="locate-btn real" onClick={() => goReal(revReal)}>
                      飞到 {revReal.name}《{revReal.title}》的真实行星{revReal.approx ? "（近似）" : ""}
                    </button>
                  ) : (
                    <button className="locate-btn" onClick={() => locateInVoid(rev.form, rev.index)}>
                      定位虚空 · 飞过去点亮这首诗
                    </button>
                  )}
                  {revReal && (
                    <div className="rev-real">
                      {revReal.approx
                        ? `这串编号几乎对应一首真实的诗(用字略有异文):${revReal.name}《${revReal.title}》`
                        : `这串编号正好对应一首真实存在的诗:${revReal.name}《${revReal.title}》`}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!collapsed && tab === "dynasty" && (
        <div className="line-results">
          <div className="lr-section">
            <div className="legend-presets">
              {/* 全部 toggles: when everything is shown it deselects all, otherwise it selects all */}
              <button onClick={() => (hidden.size === 0 ? showOnly([]) : showAll())}>
                {hidden.size === 0 ? "全不选" : "全部"}
              </button>
              <button onClick={() => showOnly(MAJOR)}>主要</button>
              <button onClick={() => showOnly(["tang", "wudai", "song"])}>唐宋</button>
            </div>
            <div className="legend-list">
              {DYNASTIES.map((d) => {
                const off = hidden.has(d.key);
                return (
                  <button
                    key={d.key}
                    className={off ? "legend-row off" : "legend-row"}
                    onClick={() => toggleDynasty(d.key)}
                    title={off ? "显示" : "隐藏"}
                  >
                    <span className="dot" style={{ background: d.color }} />
                    <span className="legend-label">{d.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
