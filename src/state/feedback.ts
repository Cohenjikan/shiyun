// In-page feedback. ALWAYS saved to localStorage (so the app still works as a 100% static build, offline).
// NOTE: there is no on-device feedback reader anymore — the 5-taps-on-logo gesture now opens the 流星 DevTool,
// so pure-static feedback stays in localStorage unread unless the §5 server (docs/DEPLOY.md) is run. Local
// store is capped at 5000 汉字 total (oldest entries drop first).
//
// OPTIONAL server collection: if VITE_FEEDBACK_ENDPOINT is set at BUILD time, only {message} is POSTed to
// the self-hosted inbox. The server creates its own receivedAt time and stores no client timestamp, source,
// IP or User-Agent. LocalStorage remains the source of truth and the upload is best-effort.
const KEY = "shiyun_feedback_v1";
const MAX_HAN = 5000;
const HAN = /\p{Script=Han}/gu;
const hanCount = (s: string): number => (s.match(HAN) || []).length;

const ENDPOINT = (import.meta.env.VITE_FEEDBACK_ENDPOINT || "").trim();

/** True when this build ALSO mirrors each submission to the server inbox (VITE_FEEDBACK_ENDPOINT set). */
export const hasCloudInbox = ENDPOINT !== "";

/** Best-effort upload to the optional server endpoint. Never throws; never blocks the caller. */
function uploadFeedback(text: string): void {
  if (!ENDPOINT) return;
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // keepalive lets the POST survive a navigation/tab-close right after submit
      keepalive: true,
      body: JSON.stringify({ message: text }),
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
  uploadFeedback(msg); // optional, best-effort; no-op unless VITE_FEEDBACK_ENDPOINT is set
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
