// 赠诗漫游 (gift-network roaming) — graph helpers over the committed 赠诗 edge list (gifts.json).
// Backs the GiftRoam panel (link list + breadcrumb + path search) and the 3D gift-line hop in FlyControls.
// The raw edges are DIRECTED (giver → receiver); we build an UNDIRECTED adjacency for traversal but keep
// the direction per link so the UI can show 赠出 / 收到 and annotate the dedication poem on out-edges.
import { loadGifts, type PoemRecord } from "./load";

export interface GiftLink {
  other: string; // the connected poet's id
  dir: "out" | "in"; // out = THIS poet dedicated to `other`; in = `other` dedicated to this poet
  w: number; // edge weight (number of dedications)
}

let _adj: Map<string, GiftLink[]> | null = null;
let _ready: Promise<void> | null = null;

/** Load gifts.json (once) and build the adjacency. Idempotent + concurrency-safe. */
export function ensureGiftGraph(): Promise<void> {
  if (_adj) return Promise.resolve();
  if (_ready) return _ready;
  _ready = loadGifts().then((edges) => {
    const adj = new Map<string, GiftLink[]>();
    const seen = new Set<string>(); // dedupe (a,b,dir) — a poet may dedicate several poems to one person
    const add = (a: string, b: string, dir: "out" | "in", w: number) => {
      const k = a + ">" + b + dir;
      if (seen.has(k)) {
        const l = adj.get(a)!.find((x) => x.other === b && x.dir === dir);
        if (l) l.w = Math.max(l.w, w);
        return;
      }
      seen.add(k);
      let l = adj.get(a);
      if (!l) { l = []; adj.set(a, l); }
      l.push({ other: b, dir, w });
    };
    for (const [from, to, w] of edges) { add(from, to, "out", w); add(to, from, "in", w); }
    _adj = adj;
  });
  return _ready;
}

/** This poet's 赠诗 links (strongest first). Empty until ensureGiftGraph() has resolved. */
export function giftLinks(poetId: string): GiftLink[] {
  const l = _adj?.get(poetId);
  return l ? [...l].sort((a, b) => b.w - a.w) : [];
}

export const giftGraphReady = (): boolean => _adj !== null;

/** BFS shortest path (undirected) between two poets, at most `maxHops` edges. Returns the poet-id path
 *  INCLUDING both endpoints, or null if unreachable within the budget. The 赠诗 graph is tiny (~4.8k
 *  edges) so this is microseconds even at large budgets. */
export function giftPath(from: string, to: string, maxHops = 10): string[] | null {
  if (!_adj) return null;
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  let frontier = [from];
  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next: string[] = [];
    for (const u of frontier) {
      for (const { other } of _adj.get(u) ?? []) {
        if (seen.has(other)) continue;
        seen.add(other);
        prev.set(other, u);
        if (other === to) {
          const path = [to];
          let c = to;
          while (c !== from) { c = prev.get(c)!; path.push(c); }
          return path.reverse();
        }
        next.push(other);
      }
    }
    frontier = next;
  }
  return null;
}

/** Best-effort: which of the giver's poems is the dedication to `recipientName`? Matches the recipient's
 *  FULL name appearing in a poem title (寄/赠/和/送 + 名). Returns the poemIdx or null. (字号 aliases like
 *  子由→苏辙 — which created some edges — won't match by name; those edges show the link without a poem.) */
export function dedicationPoemIdx(giverPoems: PoemRecord[] | null, recipientName: string): number | null {
  if (!giverPoems || recipientName.length < 2) return null;
  for (let i = 0; i < giverPoems.length; i++) {
    if ((giverPoems[i].t || "").includes(recipientName)) return i;
  }
  return null;
}
