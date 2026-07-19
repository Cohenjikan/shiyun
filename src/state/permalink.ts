// Shareable URL state. Two target forms:
//   a=<poetId>   → a poet (restored: select + fly + load poems)
//   p=<index>    → a poem, by its UNIVERSAL 全集编号 (anyRank — the number self-describes its 诗体)
//
// CANONICAL restore = the hash (`#a=…` / `#p=…`). A public poet id is ALSO mirrored into `?a=` so crawlers
// can render a poet share card. A reversible POEM index is NEVER mirrored into `?p=`: fragments stay inside
// the browser and are not sent in HTTP requests or access logs. Legacy query-only links still restore.
import { useStore } from "./store";
import { pulledFromIndex } from "../engine/engineApi";
import { getPoet, resolveCanonicalPoet, poetAliasRedirectNote } from "../data/load";
import { fetchPoetPoems } from "../data/poetPoemsLoader";
import { poetPosition } from "../three/PoetStars";

// ── Pure helpers (unit-tested in permalink.test.ts; no DOM/store access) ────────────────────────

/** The target {kind,value} for the current selection, or null if nothing is selected. */
export type Target = { kind: "a" | "p"; value: string };

/**
 * Build the shareable URL for `target` on top of `base` (a Location-like {pathname,search,hash}).
 *   - poet target → public ?a=… mirror + canonical #a=… hash.
 *   - poem target → canonical #p=… hash ONLY, keeping the reversible coordinate out of HTTP/access logs.
 *   - target null    → strip our own a/p from BOTH query and hash; preserve any UNRELATED query params.
 * Returns a relative URL string (pathname[+search][+hash]) for history.replaceState.
 */
export function buildShareUrl(
  base: { pathname: string; search: string; hash: string },
  target: Target | null,
): string {
  const params = new URLSearchParams(base.search);
  // our params are mutually exclusive — clear both before (re)setting one
  params.delete("a");
  params.delete("p");
  if (target?.kind === "a") params.set("a", target.value);
  const q = params.toString();
  const hash = target ? `#${target.kind}=${target.value}` : "";
  return base.pathname + (q ? "?" + q : "") + hash;
}

/**
 * Parse the share target from a Location-like object. Hash is CANONICAL; the query is only the
 * fallback when the hash carries no target (a fresh link the crawler-server rewrote, or a user who
 * trimmed the fragment). Returns null when neither encodes a target.
 */
export function parseTarget(loc: { search: string; hash: string }): Target | null {
  const fromHash = (h: string): Target | null => {
    const s = h.replace(/^#/, "");
    const eq = s.indexOf("=");
    if (eq < 0) return null;
    const k = s.slice(0, eq);
    if (k !== "a" && k !== "p") return null;
    const value = decodeURIComponent(s.slice(eq + 1));
    return value ? { kind: k, value } : null;
  };
  const h = fromHash(loc.hash);
  if (h) return h;
  const params = new URLSearchParams(loc.search);
  const a = params.get("a");
  if (a) return { kind: "a", value: a };
  const p = params.get("p");
  if (p) return { kind: "p", value: p };
  return null;
}

// ── DOM-bound wrappers (call into the store + history) ──────────────────────────────────────────

/** The hash that represents the current selection (empty if nothing selected). */
export function currentHash(): string {
  const t = currentTarget();
  return t ? `#${t.kind}=${t.value}` : "";
}

/** The current selection as a {kind,value} target (null if nothing selected). */
function currentTarget(): Target | null {
  const s = useStore.getState();
  if (s.selectedPoet) return { kind: "a", value: s.selectedPoet.id };
  if (s.selected) return { kind: "p", value: String(s.selected.babelIndex) };
  return null;
}

/** Keep the address bar in sync (no history spam): query mirror + canonical hash. */
export function syncHash(): void {
  const url = buildShareUrl(location, currentTarget());
  // compare against the current relative URL to avoid redundant replaceState calls
  const cur = location.pathname + location.search + location.hash;
  if (url !== cur) history.replaceState(null, "", url);
}

/** Restore state from the URL at boot (after data is loaded). Hash canonical, query fallback. */
export function applyHash(): void {
  const t = parseTarget(location);
  if (!t) return;
  const st = useStore.getState();
  if (t.kind === "a") {
    const row = getPoet(t.value);
    if (row) {
      // canonical 别名层 (G2): a #a= link to an alias (e.g. 唐温如) resolves to its canonical poet
      // (唐珙) — syncHash then writes the CANONICAL id (= a 301-redirect semantic), so the address bar
      // self-heals to the durable link on the very next update.
      const { canonical } = resolveCanonicalPoet(row);
      st.selectPoet(canonical, null, poetAliasRedirectNote(row));
      st.setFlyTarget(poetPosition(canonical));
      fetchPoetPoems(canonical.id);
    }
  } else if (t.kind === "p") {
    // universal: `p=<index>`. Tolerate a legacy `form.index` by taking the part after the dot.
    const dot = t.value.indexOf(".");
    const idx = dot >= 0 ? t.value.slice(dot + 1) : t.value;
    const poem = pulledFromIndex("ziyou", idx);
    if (poem) {
      st.selectPoem(poem);
      st.setFlyTarget(poem.pos);
    }
  }
}
