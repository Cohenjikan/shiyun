// 认领 (poem-claim) — the client half of the one feature that genuinely needs a backend.
//
// WHAT a claim is: a visitor declares a poem (one pulled from the void — it has a universal 全集编号)
// as theirs. The act mints a GLOBALLY monotonic 认领编号 (claim number, from 1, shared across ALL users)
// — the ONE thing a static client can't produce, so it comes from deploy/claim-server.mjs. The poem then
// "locates in the void" and streaks off as a meteor into the galaxy (three/Meteors.tsx).
//
// PRIVACY RED LINE: the poem AND its reversible 全集编号 are LOCAL-ONLY. The POST has NO body; the server
// creates only {no, ts}, and the public feed returns only {no, ts}. Other people's meteors are visual traces
// seeded by the opaque claim number — they are deliberately not clickable and cannot reconstruct a poem.
//
// STATIC-FIRST, like state/feedback.ts: a claim is ALWAYS recorded in localStorage so the app works as a
// 100% static build and the visitor always sees their OWN meteor. When VITE_CLAIM_ENDPOINT is set, the
// claim is ALSO POSTed; the server's reply carries the authoritative 认领编号, which we patch back onto
// the local record. Offline / no endpoint → the claim stands locally with no=null (this attempt got no number).
//
// This module is PURE where it counts: the local store, the day-bucket classification (今日/往日), and the
// feed↔local pool merge all take their inputs explicitly (storage backend, now-ms, tz offset) so they are
// unit-testable in node (claims.test.ts). The fetch/POST helpers are the only side-effecting part.

const KEY = "shiyun_claims_v1";
const CAP = 500; // a single device won't claim more than a handful; cap generously, drop OLDEST when full

/** One claim THIS device made. `index` is the universal 全集编号 (decimal) — dedupe + restore key. */
export interface MyClaim {
  index: string;
  no: number | null; // 认领编号 from the backend; null = recorded locally, awaiting a server number
  ts: number; // epoch ms when claimed
  preview?: string; // first line, stored LOCALLY ONLY (never sent to the server) for the 我的认领 gallery
  prizeKey?: string; // 里程碑中奖密钥 — minted server-side on a milestone 认领编号, returned ONCE in the POST
                     // reply and persisted here so it survives a reload (the server keeps no per-user copy).
}

// 里程碑中奖密钥 shape (`SY<no>-XXXXX-XXXXX-XXXXX-XXXXX`, Crockford-ish alphabet). Guards what the POST reply
// hands back before it is persisted, and validates hand-edited / legacy local records on read.
const PRIZE_KEY_RE = /^SY\d+-[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/;
export function isPrizeKey(v: unknown): v is string {
  return typeof v === "string" && PRIZE_KEY_RE.test(v);
}

/** A claim as published by the public feed. No poem/index — only an opaque event number + server time. */
export interface FeedClaim {
  no: number;
  ts: number;
}
export interface ClaimFeed {
  total: number; // all-time claim count (so the meteor count can be bounded by it)
  serverNow: number; // server clock (informational)
  claims: FeedClaim[]; // newest-first window
}

/** A claim ready to become a NON-INTERACTIVE meteor. `key` is a drawing seed, never a poem address. */
export interface MeteorClaim {
  key: string;
  no: number | null;
  ts: number;
}

// A minimal Storage shape (mirrors state/shiyi.ts) so tests pass an in-memory stub and the module degrades
// silently when localStorage is unavailable (private mode / SSR / quota).
export interface Storageish {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function defaultStore(): Storageish | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Well-formed local claim? Guards hand-edited / corrupt storage. `no` is a positive int OR null. */
function isMyClaim(v: unknown): v is MyClaim {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  const noOk = e.no === null || (typeof e.no === "number" && Number.isFinite(e.no) && e.no > 0);
  const keyOk = e.prizeKey === undefined || typeof e.prizeKey === "string"; // optional; validated on write
  return typeof e.index === "string" && e.index.length > 0 && noOk
    && typeof e.ts === "number" && Number.isFinite(e.ts) && keyOk;
}

/** This device's claims, NEWEST FIRST. Tolerates missing/corrupt storage (→ []); never throws. */
export function listClaims(store: Storageish | null = defaultStore()): MyClaim[] {
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMyClaim);
  } catch {
    return [];
  }
}

/** The local claim for `index`, if this device claimed it. */
export function getClaim(index: string, store: Storageish | null = defaultStore()): MyClaim | undefined {
  return listClaims(store).find((c) => c.index === index);
}

function write(list: MyClaim[], store: Storageish | null): void {
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — the claim just isn't persisted this session */
  }
}

/**
 * Record a claim locally (optimistic — usually no=null until the server replies). DEDUPES by index: a
 * re-claim of the same poem returns the EXISTING record unchanged (one claim per poem per device — you
 * never spend two 认领编号 on the same poem). Newest-first; caps at CAP (drops OLDEST). Returns the list.
 */
export function addLocalClaim(
  entry: { index: string; no?: number | null; ts?: number; preview?: string; prizeKey?: string },
  store: Storageish | null = defaultStore(),
): MyClaim[] {
  if (!store) return [];
  const index = (entry.index || "").trim();
  if (!index) return listClaims(store);
  const existing = listClaims(store);
  if (existing.some((c) => c.index === index)) return existing; // already claimed → no second number
  const rec: MyClaim = { index, no: entry.no ?? null, ts: entry.ts ?? Date.now() };
  const pv = (entry.preview ?? "").trim(); // LOCAL keepsake preview (first line) — never leaves the device
  if (pv) rec.preview = pv.length > 16 ? pv.slice(0, 16) : pv;
  if (isPrizeKey(entry.prizeKey)) rec.prizeKey = entry.prizeKey; // local legacy import only
  const next = [rec, ...existing].slice(0, CAP);
  write(next, store);
  return next;
}

/**
 * Patch the server claim number (and, on a 里程碑 claim, the 中奖密钥) onto an existing pending local claim.
 * The prizeKey is validated before it is written; a missing/malformed one just lands the 认领编号 alone.
 */
export function setLocalClaimResult(
  index: string,
  no: number,
  prizeKey?: string,
  store: Storageish | null = defaultStore(),
): MyClaim[] {
  if (!store || !index || !Number.isFinite(no) || no <= 0) return listClaims(store);
  const key = isPrizeKey(prizeKey) ? prizeKey : undefined;
  const list = listClaims(store);
  let changed = false;
  const next = list.map((c) => {
    if (c.index === index && c.no == null) {
      changed = true;
      const rec: MyClaim = { ...c, no };
      if (key) rec.prizeKey = key;
      return rec;
    }
    return c;
  });
  if (changed) write(next, store);
  return changed ? next : list;
}

/**
 * Back-compat shim: patch just the 认领编号 (no prize key). Equivalent to setLocalClaimResult(index, no).
 */
export function setLocalClaimNo(
  index: string,
  no: number,
  store: Storageish | null = defaultStore(),
): MyClaim[] {
  return setLocalClaimResult(index, no, undefined, store);
}

// ── day bucket (今日 / 往日) ──────────────────────────────────────────────────────────────────────────
// "以天为单位" relative to the VIEWER's local calendar day: each visitor sees claims made during THEIR
// current day as bright meteors. Pure: callers pass the tz offset (new Date().getTimezoneOffset(), minutes
// to add to local to reach UTC) so this is testable without a clock. localMs = ts - offset*60000 gives the
// viewer's wall-clock ms; flooring by 86_400_000 buckets it to a day index.
export function dayBucket(ts: number, tzOffsetMin: number): number {
  return Math.floor((ts - tzOffsetMin * 60_000) / 86_400_000);
}
/** Was `ts` during the same local day as `now`? (today ⇒ bright meteor; else weak.) */
export function isSameDay(ts: number, now: number, tzOffsetMin: number): boolean {
  return dayBucket(ts, tzOffsetMin) === dayBucket(now, tzOffsetMin);
}

// ── 里程碑 / 早期印记 (milestone & early-adopter badges) ───────────────────────────────────────────────
// A claim number can earn a small honorific: #1 是首位; round milestones (100, 1000, …) are 里程碑; the
// first 100 are 早期认领者. Pure (no clock/storage) → unit-testable. Scarcity/collectibility, never a
// "people leaderboard" (which the anonymous, no-identity design rules out).
export interface ClaimBadge {
  label: string;
  tier: "founder" | "milestone" | "early";
}
const MILESTONES = new Set([100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000]);
export function claimBadge(no: number | null | undefined): ClaimBadge | null {
  if (no == null || !Number.isFinite(no) || no <= 0 || !Number.isInteger(no)) return null;
  if (no === 1) return { label: "诗云首位认领", tier: "founder" };
  if (MILESTONES.has(no)) return { label: `第 ${no.toLocaleString()} 首 · 里程碑`, tier: "milestone" };
  if (no <= 100) return { label: "早期认领者", tier: "early" };
  return null;
}

// ── feed ↔ local pool ────────────────────────────────────────────────────────────────────────────────
/**
 * Merge the index-free public feed with this device's own LOCAL claims into one meteor pool. Confirmed
 * local claims dedupe against the public event by 认领编号; a pending/offline local claim gets a local-only
 * drawing key. No public FeedClaim can ever carry or recover `MyClaim.index`. Newest-first by ts.
 */
export function mergeClaims(feed: readonly FeedClaim[], mine: readonly MyClaim[]): MeteorClaim[] {
  const byKey = new Map<string, MeteorClaim>();
  const fold = (key: string, c: { no: number | null; ts: number }) => {
    if (!key) return;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { key, no: c.no, ts: c.ts });
      return;
    }
    byKey.set(key, {
      key,
      no: prev.no ?? c.no, // keep whichever has a real number
      ts: Math.min(prev.ts, c.ts), // when it was first claimed
    });
  };
  // A local ceremony is inserted into Meteors' spawned-set as `local:<index>`. Keep that identity forever,
  // even after the server assigns a number; otherwise the same claim is re-keyed to `claim:<no>` and the
  // ambient scheduler launches the visitor's poem a second time a few seconds later.
  const localKeyByNo = new Map<number, string>();
  for (const c of mine) {
    if (c.no != null && !localKeyByNo.has(c.no)) localKeyByNo.set(c.no, `local:${c.index}`);
  }
  for (const c of feed) fold(localKeyByNo.get(c.no) ?? `claim:${c.no}`, c);
  for (const c of mine) fold(`local:${c.index}`, c);
  return [...byKey.values()].sort((a, b) => b.ts - a.ts);
}

// ── network (the only side-effecting part; mirrors feedback.ts's optional-endpoint pattern) ────────────
const ENDPOINT = (import.meta.env.VITE_CLAIM_ENDPOINT || "").trim().replace(/\/$/, "");

/** True when this build talks to a claim backend (else claims are local-only, 认领编号 stays null). */
export const hasClaimServer = ENDPOINT !== "";

/**
 * POST a bodyless claim event to the backend; resolves with the authoritative 认领编号 (or null when there's no endpoint,
 * the server is unreachable, or it replied with an error) and, on a 里程碑 claim, the 中奖密钥. Never throws —
 * the local record is the source of truth for "this poem is claimed"; only the NUMBER needs the server.
 *
 * We send NO body at all. The poem text and reversible index never leave the browser. The server creates
 * exactly {no, ts} (+ a server-random `key` on a milestone row) and the public feed contains only {no, ts}.
 * A milestone reply also carries `prizeKey` (validated here) — this is the ONE and only time it is delivered,
 * so the caller must persist it. No endpoint / unreachable / error resolves to {no:null}. Never throws.
 */
export async function postClaim(): Promise<{ no: number | null; prizeKey?: string }> {
  if (!ENDPOINT) return { no: null };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json" },
      keepalive: true, // survive a tab-close right after claiming
    });
    if (!res.ok) return { no: null };
    const j = (await res.json()) as { no?: unknown; prizeKey?: unknown };
    const no = typeof j?.no === "number" && j.no > 0 ? j.no : null;
    return no != null && isPrizeKey(j?.prizeKey) ? { no, prizeKey: j.prizeKey } : { no };
  } catch {
    return { no: null }; // offline / CORS / server down — the local copy already holds the claim
  }
}

/** Fetch the public meteor feed. Returns null when there's no endpoint or the request fails. */
export async function fetchFeed(limit = 500): Promise<ClaimFeed | null> {
  if (!ENDPOINT) return null;
  try {
    const res = await fetch(`${ENDPOINT}/feed?limit=${limit}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<ClaimFeed>;
    if (!j || !Array.isArray(j.claims)) return null;
    const claims: FeedClaim[] = j.claims
      .filter((c): c is FeedClaim =>
        !!c && typeof c.no === "number" && Number.isSafeInteger(c.no) && c.no > 0
        && typeof c.ts === "number" && Number.isFinite(c.ts))
      .map((c) => ({ no: c.no, ts: c.ts }));
    return {
      total: typeof j.total === "number" ? j.total : claims.length,
      serverNow: typeof j.serverNow === "number" ? j.serverNow : Date.now(),
      claims,
    };
  } catch {
    return null;
  }
}
