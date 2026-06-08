import { useState } from "react";
import { searchPoets, loadPoetPoems, type PoetRow } from "../data/load";
import { DYNASTY_BY_KEY } from "../data/dynasties";
import { useStore } from "../state/store";
import { poetPosition } from "../three/PoetStars";
import { locateQuery, pullByIndex } from "../engine/engineApi";

type Mode = "poet" | "void";

export function SearchPanel() {
  const [mode, setMode] = useState<Mode>("poet");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PoetRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const form = useStore((s) => s.form);
  const selectPoet = useStore((s) => s.selectPoet);
  const setFlyTarget = useStore((s) => s.setFlyTarget);

  function switchMode(m: Mode) {
    setMode(m);
    setResults([]);
    setErr(null);
  }
  function onChange(v: string) {
    setQ(v);
    setErr(null);
    if (mode === "poet") setResults(searchPoets(v, 24));
  }
  function goPoet(p: PoetRow) {
    selectPoet(p);
    setFlyTarget(poetPosition(p));
    loadPoetPoems(p.id).then((poems) => useStore.getState().setPoetPoems(p.id, poems));
    setResults([]);
    setQ(p.name);
  }
  // Reverse-lookup: poem text OR 全集编号 → its fixed point in the void → fly there
  // and light the star (same flare-then-fade marker as a void click).
  function goVoid() {
    const res = locateQuery(form, q);
    if ("error" in res) {
      setErr(res.error);
      return;
    }
    const st = useStore.getState();
    st.setForm(res.form); // align the HUD form with the located poem
    const poem = pullByIndex(res.form, res.index);
    // poem.pos is the index's canonical point, treated as a LOCAL galaxy coordinate
    // (like every stored position) — both the marker (PulledStars' spun group) and the
    // fly-to (FlyControls applies spinXZ) rotate it identically, so the camera homes
    // exactly onto the lit star as the galaxy turns. Do NOT pre-rotate it here.
    st.selectPoem(poem); // PoemPanel + a highlighted pull marker at its void point
    st.setFlyTarget(poem.pos); // tween the camera into the void to it
    setErr(null);
  }

  return (
    <div className="search">
      <div className="search-tabs">
        <button className={mode === "poet" ? "st on" : "st"} onClick={() => switchMode("poet")}>
          诗人
        </button>
        <button className={mode === "void" ? "st on" : "st"} onClick={() => switchMode("void")}>
          诗句 · 编号
        </button>
      </div>
      <input
        value={q}
        placeholder={mode === "poet" ? "搜索诗人…" : "输入诗句或全集编号，回车定位虚空…"}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (mode === "void" && e.key === "Enter") goVoid();
        }}
        spellCheck={false}
      />
      {mode === "void" && err && <div className="search-err">{err}</div>}
      {mode === "poet" && results.length > 0 && (
        <div className="search-results">
          {results.map((p) => {
            const dyn = DYNASTY_BY_KEY[p.dynasty];
            return (
              <button key={p.id} className="search-row" onClick={() => goPoet(p)}>
                <span className="sr-name">{p.name}</span>
                <span className="sr-meta">
                  {dyn?.label ?? p.dynasty} · {p.poemCount}首
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
