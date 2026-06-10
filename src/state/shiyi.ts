// 拾遗 — "gleaning": a fully client-side keepsake list for poems pulled from the VOID.
//
// WHY this exists: a void click lands on ONE poem out of an astronomically large catalog, by an
// irreproducible ray into the dark. Close the panel and that poem is gone forever — the only recourse
// today is to manually copy its 编号. 拾遗 lets a visitor quietly keep the ones that struck them, so
// they can be re-surfaced later (via pulledFromIndex on the universal 全集编号, which is a bijection →
// the SAME number always rebuilds the SAME poem).
//
// SCOPE (this round): VOID poems only. Real poems are re-findable through their poet, so they don't
// need this. Extending to real poems later would store {poetId, poemIdx} instead of a bare index and
// restore via selectPoet(poet, {poemIdx}) — deliberately NOT done here.
//
// This is a PURE module: all functions take the storage backend as their last argument (defaulting to
// the page's localStorage) so the logic — add / dedupe / cap / remove / corrupt-JSON tolerance — is
// unit-testable in node with a trivial in-memory stub. Mirrors state/feedback.ts.

const KEY = "shiyun_shiyi_v1";
const CAP = 200; // keep at most this many keepsakes; the OLDEST drop first when full
const PREVIEW_MAX = 14; // first-line preview length (汉字), kept short for the revisit list rows

/** One kept poem. `index` is the universal 全集编号 (decimal string) — the dedupe key AND the restore key. */
export interface ShiyiEntry {
  index: string; // universal anyRank decimal string (== PulledPoem.babelIndex)
  ts: number; // epoch ms when it was kept
  preview: string; // first line, ≤ PREVIEW_MAX 汉字 (for the revisit list)
}

// A minimal Storage shape — just the three methods we use. Lets tests pass an in-memory stub and lets
// the module degrade silently when localStorage is unavailable (private mode, SSR, quota).
export interface Storageish {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** The page's localStorage if present, else null (node / SSR / blocked). */
function defaultStore(): Storageish | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // some browsers throw on access in privacy modes
  }
}

/** Trim + clamp a first line into a list-row preview. Exported for the collect path (PoemPanel). */
export function makePreview(firstLine: string | undefined | null): string {
  const s = (firstLine ?? "").trim();
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) : s;
}

/** Is `v` a well-formed entry? Guards against hand-edited / corrupt localStorage. */
function isEntry(v: unknown): v is ShiyiEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.index === "string" && e.index.length > 0
    && typeof e.ts === "number" && Number.isFinite(e.ts)
    && typeof e.preview === "string";
}

/**
 * The kept list, NEWEST FIRST. Tolerates missing/corrupt/garbage storage by returning [] (and silently
 * dropping any malformed rows from a partially-valid array). Never throws.
 */
export function listShiyi(store: Storageish | null = defaultStore()): ShiyiEntry[] {
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return []; // not JSON, or storage threw — treat as empty
  }
}

/** True if the poem at `index` is already kept. */
export function hasShiyi(index: string, store: Storageish | null = defaultStore()): boolean {
  return listShiyi(store).some((e) => e.index === index);
}

function write(list: ShiyiEntry[], store: Storageish | null): void {
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — the keepsake just isn't persisted this session */
  }
}

/**
 * Keep a poem. Newest-first; DEDUPES by `index` (re-adding moves it to the front + refreshes ts/preview);
 * caps at CAP entries (drops the OLDEST). Returns the new list. No-op-safe on empty index.
 */
export function addShiyi(
  entry: { index: string; preview: string; ts?: number },
  store: Storageish | null = defaultStore(),
): ShiyiEntry[] {
  if (!store) return []; // no backing store → nothing is or can be kept
  const index = (entry.index || "").trim();
  if (!index) return listShiyi(store);
  const ts = entry.ts ?? Date.now();
  const preview = makePreview(entry.preview);
  // drop any existing copy, then unshift the fresh one to the front, then cap to CAP (oldest = tail)
  const next = [{ index, ts, preview }, ...listShiyi(store).filter((e) => e.index !== index)].slice(0, CAP);
  write(next, store);
  return next;
}

/** Forget a poem by index. Returns the new list (unchanged if it wasn't there). */
export function removeShiyi(index: string, store: Storageish | null = defaultStore()): ShiyiEntry[] {
  if (!store) return [];
  const next = listShiyi(store).filter((e) => e.index !== index);
  write(next, store);
  return next;
}
