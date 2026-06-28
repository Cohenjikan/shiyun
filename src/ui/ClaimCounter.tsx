import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { hasClaimServer } from "../state/claims";

// A DELIBERATELY low-presence counter of how many poems have been claimed site-wide, tucked under the top
// bar at the right. Growth/counting is NOT 诗云's purpose, so it's small, faint, and easy to ignore — it
// GREETS you once on entry (counting UP to the live total), stays for one minute, then fades out and gets
// out of the way for the rest of the session. Hidden when there's no claim backend, and (being inside App's
// overlay block) in screenshot mode.
const SHOW_MS = 60_000; // visible for one minute after it first appears…
const FADE_MS = 1200; //   …then fades out (matched to .claim-counter.fading's CSS transition) and unmounts.

export function ClaimCounter() {
  const feed = useStore((s) => s.claimFeed);
  const myClaims = useStore((s) => s.myClaims);

  // total = the feed's all-time count, bumped by my own (possibly newer) claim number so it ticks up the
  // instant I claim, before the ~90s feed refresh catches up.
  const target = useMemo(() => {
    const feedTotal = feed?.total ?? 0;
    let myMax = 0;
    for (const c of myClaims) if (c.no != null && c.no > myMax) myMax = c.no;
    return Math.max(feedTotal, myMax);
  }, [feed, myClaims]);

  const [shown, setShown] = useState(0);
  const raf = useRef(0);
  const from = useRef(0);
  useEffect(() => {
    if (target <= 0 || target === from.current) return;
    cancelAnimationFrame(raf.current);
    const a = from.current, b = target, start = performance.now(), DUR = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DUR);
      const v = Math.round(a + (b - a) * (1 - Math.pow(1 - t, 3))); // easeOutCubic
      from.current = v;
      setShown(v);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);

  // Entry presence: stay HIDDEN until we actually have a count to show, then reveal ("in") for one minute,
  // fade ("out"), and unmount ("gone"). Gating the reveal on target>0 means a slow feed doesn't burn the
  // minute before the number is even known.
  const [phase, setPhase] = useState<"hidden" | "in" | "out" | "gone">("hidden");
  useEffect(() => {
    if (phase === "hidden" && target > 0) setPhase("in");
  }, [target, phase]);
  useEffect(() => {
    if (phase !== "in") return;
    const t = setTimeout(() => setPhase("out"), SHOW_MS);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (!hasClaimServer || phase === "hidden" || phase === "gone") return null;
  return (
    <div
      className={phase === "out" ? "claim-counter fading" : "claim-counter"}
      title="诗云中被认领的诗的总数 —— 每一次认领都在此计数"
    >
      已有 <b>{shown.toLocaleString()}</b> 首诗被认领
    </div>
  );
}
