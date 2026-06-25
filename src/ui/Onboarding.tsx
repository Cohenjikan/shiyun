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
    d: "每位历史诗人是一团真实的星；星与星之间的虚空，是「一切可能的诗」——不被储存，点一下就从噪声里把它算出来。",
  },
  {
    t: "怎么逛",
    d: COARSE
      ? "默认把整个诗云当一个整体：单指拖动转角度看它，双指捏合放大 / 缩小。想自由飞进星海？到右上「更多」打开「自由移动」。"
      : "WASD 飞行穿行，拖动鼠标转视角，滚轮调速；按 H 可隐藏界面截图。想把诗云当整体来回看？到「更多」关掉「自由移动」——拖动转角度、滚轮缩放。",
  },
  {
    t: "点星看真诗 · 点虚空捞诗",
    d: "点亮的星 = 真实诗人，点它读他真写过的诗，镜头会锁定并跟随它；再点另一颗，锁定目标就换成它。点星与星之间的虚空，会从噪声里捞出一首诗，并给出它在全集里那串数十上百位的唯一编号。（不想要随机诗？「更多」里可关掉「生成随机诗」，点虚空就只看现存的诗。）",
  },
  {
    t: "探诗 · 寻诗 · 留影",
    d: "「探诗」逐字填诗或写自由诗立刻得到编号，也能凭编号反查是哪首；「寻诗」按诗句 / 诗名 / 单字找真实的诗。开一首诗可「留影」生成分享卡——左下角能切横 / 竖排、开关顶部文案。",
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
