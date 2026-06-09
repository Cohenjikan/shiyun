// In-page feedback. ALWAYS saved to localStorage (so the app still works as a 100% static build, offline,
// and the owner can read it on-device via the hidden 5-taps-on-logo gesture → FeedbackViewer). Local store
// is capped at 5000 汉字 total (oldest entries drop first).
//
// OPTIONAL server collection: if VITE_FEEDBACK_ENDPOINT is set at BUILD time, each message is ALSO POSTed
// there as fire-and-forget JSON — a shared, cross-device inbox. This is the ONLY place 诗云 talks to a
// server; everything else (index math, rendering, corpus) stays client-side. The POST never blocks or fails
// the submit: localStorage is the source of truth, the network is best-effort. Leave the env var unset to
// keep the build fully static. See docs/DEPLOY.md §feedback for a ~30-line Cloudflare Worker / Formspree.
const KEY = "shiyun_feedback_v1";
const MAX_HAN = 5000;
const HAN = /\p{Script=Han}/gu;
const hanCount = (s: string): number => (s.match(HAN) || []).length;

const ENDPOINT = (import.meta.env.VITE_FEEDBACK_ENDPOINT || "").trim();

/** Best-effort upload to the optional server endpoint. Never throws; never blocks the caller. */
function uploadFeedback(text: string, ts: number): void {
  if (!ENDPOINT) return;
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // keepalive lets the POST survive a navigation/tab-close right after submit
      keepalive: true,
      body: JSON.stringify({ source: "shiyun", message: text, ts }),
    }).catch(() => {
      /* offline / CORS / server down — the local copy already holds it */
    });
  } catch {
    /* malformed endpoint URL or fetch unavailable — ignore, local copy stands */
  }
}

export interface Feedback {
  t: string; // the message
  ts: number; // epoch ms
}

export function getFeedback(): Feedback[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as Feedback[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Append a feedback message; trims oldest until the total is ≤ 5000 汉字. Returns false on empty input. */
export function submitFeedback(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  const msg = clean.slice(0, 5000);
  const ts = Date.now();
  const list = getFeedback();
  list.push({ t: msg, ts });
  let total = list.reduce((n, f) => n + hanCount(f.t), 0);
  while (total > MAX_HAN && list.length > 1) {
    const dropped = list.shift()!;
    total -= hanCount(dropped.t);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — feedback just isn't persisted */
  }
  uploadFeedback(msg, ts); // optional, best-effort; no-op unless VITE_FEEDBACK_ENDPOINT is set
  return true;
}

export function clearFeedback(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Total 汉字 currently stored (for the "x / 5000" indicator). */
export function feedbackHanTotal(): number {
  return getFeedback().reduce((n, f) => n + hanCount(f.t), 0);
}
