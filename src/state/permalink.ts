// Shareable URL-hash state. Two forms:
//   #a=<poetId>   → a poet (restored: select + fly + load poems)
//   #p=<index>    → a poem, by its UNIVERSAL 全集编号 (anyRank — the number self-describes its 诗体)
// The hash is kept in sync with the current selection (App effect); panels copy location.href.
import { useStore } from "./store";
import { pulledFromIndex } from "../engine/engineApi";
import { getPoet } from "../data/load";
import { fetchPoetPoems } from "../data/poetPoemsLoader";
import { poetPosition } from "../three/PoetStars";

/** The hash that represents the current selection (empty if nothing selected). */
export function currentHash(): string {
  const s = useStore.getState();
  if (s.selectedPoet) return `#a=${s.selectedPoet.id}`;
  if (s.selected) return `#p=${s.selected.babelIndex}`;
  return "";
}

/** Keep the address bar in sync (no history spam). */
export function syncHash(): void {
  const h = currentHash();
  const url = h || location.pathname + location.search;
  if (location.hash !== h) history.replaceState(null, "", url);
}

/** Restore state from the URL hash at boot (after data is loaded). */
export function applyHash(): void {
  const h = location.hash.replace(/^#/, "");
  if (!h) return;
  const eq = h.indexOf("=");
  if (eq < 0) return;
  const k = h.slice(0, eq);
  const val = decodeURIComponent(h.slice(eq + 1));
  const st = useStore.getState();
  if (k === "a") {
    const poet = getPoet(val);
    if (poet) {
      st.selectPoet(poet);
      st.setFlyTarget(poetPosition(poet));
      fetchPoetPoems(poet.id);
    }
  } else if (k === "p") {
    // universal: `#p=<index>`. Tolerate a legacy `form.index` by taking the part after the dot.
    const dot = val.indexOf(".");
    const idx = dot >= 0 ? val.slice(dot + 1) : val;
    const poem = pulledFromIndex("ziyou", idx);
    if (poem) {
      st.selectPoem(poem);
      st.setFlyTarget(poem.pos);
    }
  }
}
