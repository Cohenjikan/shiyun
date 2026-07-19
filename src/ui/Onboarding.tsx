import { useEffect, useState } from "react";
import { COARSE } from "../three/detectQuality";

// First-run guide: shown ONCE per browser (localStorage), skippable. Clearing site data shows it
// again. Purely client-side — no account, no backend.
// v2 (2026-06): interaction model changed → bump so old users see it once more.
// v3 (2026-07): rewritten — 3 steps, one idea per step, plain language; the last step is an ACTION
// GATE (desktop: press W to fly out / touch: drag the sky) instead of a button, so every user has
// performed the core movement before entering. Advanced keys (Q/E/wheel/F) moved out of the guide
// entirely — they live in the HUD bottom hint. 手机/电脑各自独立成套(步数相同,门不同)。
const KEY = "shiyun_onboarded_v3";

// Fired by SettingsMenu「重看新手引导」. Clears the seen-mark and replays from step 0.
const REPLAY_EVENT = "shiyun:replay-onboarding";
export function replayOnboarding() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

// One idea per step. The world → the two clicks → the door. Nothing else.
const STEPS: { t: string; d: string }[] = COARSE
  ? [
      { t: "诗云 · 一切可能的诗", d: "这里的每颗星，是一位真实的诗人。" },
      { t: "点星 · 点虚空", d: "点星，读他的诗；点星与星之间的黑，捞一首这个世界上还没有过的诗。" },
      { t: "出发", d: "" }, // gate step — rendered specially below
    ]
  : [
      { t: "诗云 · 一切可能的诗", d: "这里的每颗星，是一位真实的诗人。" },
      { t: "点星 · 点虚空", d: "点星，读他的诗；点星与星之间的黑，捞一首这个世界上还没有过的诗。" },
      { t: "飞出去", d: "" }, // gate step — rendered specially below
    ];

const GATE = STEPS.length - 1;

function seen(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false; // private mode / blocked storage → just show it (harmless)
  }
}

export function Onboarding() {
  const [step, setStep] = useState(() => (seen() ? -1 : 0));
  // escape hatch on the gate step: after a few seconds, offer a plain button too
  const [fallback, setFallback] = useState(false);

  const finish = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setStep(-1);
  };

  // 「重看新手引导」 (SettingsMenu) → replay from the top
  useEffect(() => {
    const replay = () => {
      setFallback(false);
      setStep(0);
    };
    window.addEventListener(REPLAY_EVENT, replay);
    return () => window.removeEventListener(REPLAY_EVENT, replay);
  }, []);

  // THE GATE. Desktop: pressing W (or ↑) closes the guide — FlyControls already listens on window,
  // so the same keypress starts the flight and the card fades while you're moving. Touch: a real
  // drag closes it — the overlay is pointer-transparent on this step (CSS .gate), so the drag also
  // actually rotates the sky (galaxy-lock default). Threshold keeps a stray tap from counting.
  useEffect(() => {
    if (step !== GATE) return;
    const t = window.setTimeout(() => setFallback(true), 3000);
    if (!COARSE) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "w" || e.key === "W" || e.key === "ArrowUp") finish();
      };
      window.addEventListener("keydown", onKey);
      return () => {
        window.clearTimeout(t);
        window.removeEventListener("keydown", onKey);
      };
    }
    let sx = 0, sy = 0, down = false;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      down = true;
      sx = e.clientX;
      sy = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!down || e.pointerType !== "touch") return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 24) finish();
    };
    const onUp = () => (down = false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (step < 0) return null;
  const s = STEPS[step];
  const gate = step === GATE;

  return (
    <div className={gate && COARSE ? "onb-overlay gate" : "onb-overlay"}>
      <div className="onb-card">
        <div className="onb-step">{step + 1} / {STEPS.length}</div>
        <div className="onb-title">{s.t}</div>
        {gate ? (
          COARSE ? (
            <div className="onb-gate">
              <span className="onb-gesture" aria-hidden>☝️</span>
              <div className="onb-gate-line">拖一下星空，出发。</div>
              <div className="onb-gate-sub">双指捏合，拉近拉远。</div>
            </div>
          ) : (
            <div className="onb-gate">
              <span className="onb-key" aria-hidden>W</span>
              <div className="onb-gate-line">按住 W，飞出去。</div>
              <div className="onb-gate-sub">A/S/D 平移 · 拖动转视角</div>
            </div>
          )
        ) : (
          <div className="onb-body">{s.d}</div>
        )}
        <div className="onb-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={i === step ? "on" : ""} />
          ))}
        </div>
        <div className="onb-actions">
          {gate ? (
            fallback && (
              <button className="onb-skip" onClick={finish}>或点此开始</button>
            )
          ) : (
            <>
              <button className="onb-skip" onClick={finish}>跳过</button>
              <button className="onb-next" onClick={() => setStep(step + 1)}>下一步</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
