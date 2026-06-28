// 认领 (poem-claim) — the client half of the one feature that genuinely needs a backend.
//
// WHAT a claim is: a visitor declares a poem (one pulled from the void — it has a universal 全集编号)
// as theirs. The act mints a GLOBALLY monotonic 认领编号 (claim number, from 1, shared across ALL users)
// — the ONE thing a static client can't produce, so it comes from deploy/claim-server.mjs. The poem then
// "locates in the void" and streaks off as a meteor into the galaxy (three/Meteors.tsx).
//
// STATIC-FIRST, like state/feedback.ts: a claim is ALWAYS recorded in localStorage so the app works as a
// 100% static build and the visitor always sees their OWN meteor. When VITE_CLAIM_ENDPOINT is set, the
// claim is ALSO POSTed; the server's reply carries the authoritative 认领编号, which we patch back onto
// the local record. Offline / no endpoint → the claim stands locally with no=null ("待联网确认").
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
}

/** A claim as published by the public feed (deploy/claim-server.mjs GET /api/claim/feed). */
export interface FeedClaim {
  no: number;
  index: string;
  ts: number;
}
export interface ClaimFeed {
  total: number; // all-time claim count (so the meteor count can be bounded by it)
  serverNow: number; // server clock (informational)
  claims: FeedClaim[]; // newest-first window
}

/** A claim ready to become a meteor (feed ∪ local, deduped). */
export interface MeteorClaim {
  index: string;
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
  return typeof e.index === "string" && e.index.length > 0 && noOk
    && typeof e.ts === "number" && Number.isFinite(e.ts);
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
  entry: { index: string; no?: number | null; ts?: number; preview?: string },
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
  const next = [rec, ...existing].slice(0, CAP);
  write(next, store);
  return next;
}

/**
 * Patch the 认领编号 onto an existing local claim once the server replies. No-op if the claim isn't
 * present or already has a number. Returns the (possibly unchanged) list.
 */
export function setLocalClaimNo(
  index: string,
  no: number,
  store: Storageish | null = defaultStore(),
): MyClaim[] {
  if (!store || !index || !Number.isFinite(no) || no <= 0) return listClaims(store);
  const list = listClaims(store);
  let changed = false;
  const next = list.map((c) => {
    if (c.index === index && c.no == null) {
      changed = true;
      return { ...c, no };
    }
    return c;
  });
  if (changed) write(next, store);
  return changed ? next : list;
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
 * Merge the public feed with this device's own claims into one meteor pool, DEDUPED by index. A claim
 * the viewer made but the feed hasn't echoed yet (just claimed, or offline) still appears. Prefers a
 * numeric 认领编号 (server-confirmed) over a pending null, and keeps the EARLIEST ts (when it was claimed).
 * Newest-first by ts.
 */
export function mergeClaims(feed: readonly FeedClaim[], mine: readonly MyClaim[]): MeteorClaim[] {
  const byIndex = new Map<string, MeteorClaim>();
  const fold = (c: { index: string; no: number | null; ts: number }) => {
    if (!c.index) return;
    const prev = byIndex.get(c.index);
    if (!prev) {
      byIndex.set(c.index, { index: c.index, no: c.no, ts: c.ts });
      return;
    }
    byIndex.set(c.index, {
      index: c.index,
      no: prev.no ?? c.no, // keep whichever has a real number
      ts: Math.min(prev.ts, c.ts), // when it was first claimed
    });
  };
  for (const c of feed) fold({ index: c.index, no: c.no, ts: c.ts });
  for (const c of mine) fold(c);
  return [...byIndex.values()].sort((a, b) => b.ts - a.ts);
}

// ── network (the only side-effecting part; mirrors feedback.ts's optional-endpoint pattern) ────────────
const ENDPOINT = (import.meta.env.VITE_CLAIM_ENDPOINT || "").trim().replace(/\/$/, "");

/** True when this build talks to a claim backend (else claims are local-only, 认领编号 stays null). */
export const hasClaimServer = ENDPOINT !== "";

/**
 * POST a claim to the backend; resolves with the authoritative 认领编号 (or null when there's no endpoint,
 * the server is unreachable, or it replied with an error). Never throws — the local record is the source
 * of truth for "this poem is claimed"; only the NUMBER needs the server.
 *
 * We send ONLY {index, ts} — two numbers. The poem text is NEVER transmitted (the server stores only
 * {no, index, ts}; the poem is recomputed client-side from index). See deploy/claim-server.mjs's
 * compliance note.
 */
export async function postClaim(index: string, ts: number): Promise<{ no: number | null }> {
  if (!ENDPOINT) return { no: null };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      keepalive: true, // survive a tab-close right after claiming
      body: JSON.stringify({ index, ts }),
    });
    if (!res.ok) return { no: null };
    const j = (await res.json()) as { no?: unknown };
    return { no: typeof j?.no === "number" && j.no > 0 ? j.no : null };
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
        !!c && typeof c.index === "string" && typeof c.no === "number" && typeof c.ts === "number")
      .map((c) => ({ no: c.no, index: c.index, ts: c.ts }));
    return {
      total: typeof j.total === "number" ? j.total : claims.length,
      serverNow: typeof j.serverNow === "number" ? j.serverNow : Date.now(),
      claims,
    };
  } catch {
    return null;
  }
}
