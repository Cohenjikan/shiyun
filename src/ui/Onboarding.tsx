import { useState } from "react";

// First-run guide: shown ONCE per browser (localStorage), skippable. Clearing site data shows it
// again. Purely client-side — no account, no backend.
const KEY = "shiyun_onboarded_v1";

const STEPS: { t: string; d: string }[] = [
  {
    t: "诗云 · 一切可能的诗",
    d: "每位历史诗人是一团真实的星;星与星之间的虚空,是「一切可能的近体诗」——不被储存,点一下就从噪声里把它算出来。",
  },
  {
    t: "点星看真诗 · 点虚空捞诗",
    d: "点亮的恒星 = 真实诗人,点它读他真写过的诗;点恒星之间的虚空,会从噪声里捞出一首诗,并给出它在「全集目录」里那串长达数十上百位的编号。",
  },
  {
    t: "探诗 · 寻诗 · 朝代",
    d: "「探诗」里逐字填诗或写自由诗,立刻得到它的编号;「寻诗」能按诗句、诗名或单字找出真实的诗。WASD 飞行、拖拽转向、滚轮调速;按 H 可隐藏全部界面截图。",
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
