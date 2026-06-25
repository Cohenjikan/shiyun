import { useState } from "react";
import { COARSE } from "../three/detectQuality";

// First-run guide: shown ONCE per browser (localStorage), skippable. Clearing site data shows it
// again. Purely client-side — no account, no backend.
// v2 (2026-06): the interaction model changed (触屏默认锁定诗云整体 + 双指缩放;更多里 自由移动 / 随机诗
// 开关;留影长诗横排/文案开关) → bumped from v1 so users who saw the old guide get the new one once.
const KEY = "shiyun_onboarded_v2";

// Platform-specific copy: touch defaults to galaxy-lock (drag = rotate, pinch = zoom); desktop defaults to
// free-fly (WASD). The guide describes whatever the user actually has.
const STEPS: { t: string; d: string }[] = [
  {
    t: "诗云 · 一切可能的诗",
    d: "每位诗人是一颗星；它们之间是一切可能的诗——不被储存，点一下才算出来。",
  },
  {
    t: "怎么逛",
    d: COARSE
      ? "单指拖动转视角，双指捏合放大 / 缩小。"
      : "WASD 飞行，拖动转视角，滚轮调速。",
  },
  {
    t: "点星 · 点虚空",
    d: "点亮的星是真实诗人，点它读真诗；点星之间的虚空，捞出一首诗和它的唯一编号。",
  },
  {
    t: "探诗 · 寻诗 · 留影",
    d: "写诗得编号、找真实的诗、把一首诗做成分享卡。",
  },
];

function seen(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false; // private mode / blocked storage → just show it (harmless)
  }
}

export function Onboarding() {
  const [step, setStep] = useState(() => (seen() ? -1 : 0));
  if (step < 0) return null;

  const finish = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setStep(-1);
  };
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="onb-overlay">
      <div className="onb-card">
        <div className="onb-step">{step + 1} / {STEPS.length}</div>
        <div className="onb-title">{s.t}</div>
        <div className="onb-body">{s.d}</div>
        <div className="onb-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={i === step ? "on" : ""} />
          ))}
        </div>
        <div className="onb-actions">
          <button className="onb-skip" onClick={finish}>跳过</button>
          <button className="onb-next" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? "开始漫游" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}
