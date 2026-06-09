import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { COARSE, WEAK } from "../three/detectQuality";
import { submitFeedback } from "../state/feedback";

// in-page feedback box (collapsed → a single button; expanded → a textarea). Stored locally; the owner
// reads it via the hidden 5-tap-on-logo gesture (FeedbackViewer). See state/feedback.ts.
function FeedbackBox() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  if (!open) {
    return (
      <button className="set-feedback-open" onClick={() => setOpen(true)}>反馈 · 提个建议或报个 bug</button>
    );
  }
  return (
    <div className="set-feedback">
      <textarea
        className="set-feedback-input"
        placeholder="有什么想法、发现的问题或建议?写在这里…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        spellCheck={false}
      />
      <div className="set-feedback-act">
        <button className="set-feedback-cancel" onClick={() => { setOpen(false); setText(""); setSent(false); }}>收起</button>
        <button
          className="set-feedback-send"
          disabled={!text.trim()}
          onClick={() => {
            if (submitFeedback(text)) {
              setText("");
              setSent(true);
              setTimeout(() => setSent(false), 2200);
            }
          }}
        >
          {sent ? "已提交 ✓ 谢谢" : "提交反馈"}
        </button>
      </div>
      {sent && <div className="set-feedback-ok">收到啦 —— 感谢你的反馈</div>}
    </div>
  );
}

// 诗云设置 menu — collects the 指引 / 行星 / 赠诗 / 引力 controls (moved out of the HUD top bar). Opened by
// the HUD 更多 button. 赠诗漫游 stays a separate panel (it only shows when 赠诗 is on). 恢复默认 = the
// app defaults (指引 一次性·优化·10s; 行星 关; 赠诗 关; 引力 开).
const GUIDE_MODES = [
  ["off", "不显示"],
  ["flash", "一次性"],
  ["hold", "常驻"],
] as const;

export function SettingsMenu() {
  const open = useStore((s) => s.settingsOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const guideMode = useStore((s) => s.guideMode);
  const setGuideMode = useStore((s) => s.setGuideMode);
  const guideCoverage = useStore((s) => s.guideCoverage);
  const setGuideCoverage = useStore((s) => s.setGuideCoverage);
  const guideSeconds = useStore((s) => s.guideSeconds);
  const setGuideSeconds = useStore((s) => s.setGuideSeconds);
  const guideBrightness = useStore((s) => s.guideBrightness);
  const setGuideBrightness = useStore((s) => s.setGuideBrightness);
  const resetGuide = useStore((s) => s.resetGuide);
  const showAllPoems = useStore((s) => s.showAllPoems);
  const toggleAllPoems = useStore((s) => s.toggleAllPoems);
  const showGifts = useStore((s) => s.showGifts);
  const toggleGifts = useStore((s) => s.toggleGifts);
  const gravity = useStore((s) => s.gravity);
  const toggleGravity = useStore((s) => s.toggleGravity);

  // DRAGGABLE (item 2): default below the top bar + left of the right-side panels (诗人/诗 panels), so it
  // never traps behind them — drag the header to move it anywhere and watch the effect live.
  // clamp the initial position into the viewport (a 360px default sits off-screen on a phone). On mobile
  // the responsive CSS overrides this into a bottom sheet via !important, so the inline x/y only matter on
  // desktop / tablet widths — but keep it on-screen there too.
  const [pos, setPos] = useState(() => ({
    x: Math.max(4, Math.min(360, (typeof window !== "undefined" ? window.innerWidth : 1200) - 312)),
    y: 56,
  }));
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      setPos({ x: Math.max(4, e.clientX - dragRef.current.ox), y: Math.max(4, e.clientY - dragRef.current.oy) });
    };
    const onUp = () => (dragRef.current = null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  if (!open) return null;

  const guideDefault = guideMode === "flash" && guideCoverage === "optimized" && guideSeconds === 10 && guideBrightness === 0.7;
  const allDefault = guideDefault && !showAllPoems && !showGifts && gravity;
  const resetAll = () => {
    resetGuide();
    if (showAllPoems) toggleAllPoems();
    if (showGifts) toggleGifts();
    if (!gravity) toggleGravity();
  };

  return (
    <div className="settings" style={{ left: pos.x, top: pos.y, right: "auto" }}>
      <div
        className="set-head drag"
        onPointerDown={(e) => {
          if (COARSE) return; // dragging is a no-op on the CSS-pinned mobile sheet → don't arm it
          dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
        }}
      >
        <span>更多 ⠿</span>
        <button className="set-close" onClick={toggleSettings} title="关闭">×</button>
      </div>

      <div className="set-group">
        <div className="set-label">行星指引线</div>
        <div className="set-row">
          <span className="set-sub">显示</span>
          <div className="seg">
            {GUIDE_MODES.map(([m, l]) => (
              <button key={m} className={guideMode === m ? "seg-btn on" : "seg-btn"} onClick={() => setGuideMode(m)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <span className="set-sub">覆盖</span>
          <div className="seg">
            <button className={guideCoverage === "all" ? "seg-btn on" : "seg-btn"} onClick={() => setGuideCoverage("all")} title="每首诗都连线,一首不漏">全部</button>
            <button className={guideCoverage === "optimized" ? "seg-btn on" : "seg-btn"} onClick={() => setGuideCoverage("optimized")} title="数量很大时跨全段采样,更流畅">优化</button>
          </div>
        </div>
        <div className="set-row">
          <span className="set-sub">时长</span>
          <input
            type="range"
            min={2}
            max={60}
            step={1}
            value={guideSeconds}
            disabled={guideMode !== "flash"}
            onChange={(e) => setGuideSeconds(Number(e.target.value))}
            className="set-slider"
          />
          <span className="set-val">{guideMode === "flash" ? `${guideSeconds}s` : guideMode === "hold" ? "常驻" : "—"}</span>
        </div>
        <div className="set-row">
          <span className="set-sub">亮度</span>
          <input
            type="range"
            min={0.2}
            max={2}
            step={0.05}
            value={guideBrightness}
            disabled={guideMode === "off"}
            onChange={(e) => setGuideBrightness(Number(e.target.value))}
            className="set-slider"
          />
          <span className="set-val">{guideBrightness.toFixed(2)}×</span>
        </div>
        <button className="set-reset" onClick={resetGuide} disabled={guideDefault}>指引恢复默认</button>
      </div>

      <div className="set-group">
        <div className="set-label">显示层</div>
        <label className="set-toggle" style={WEAK && !showAllPoems ? { opacity: 0.5 } : undefined}>
          <input
            type="checkbox"
            checked={showAllPoems}
            onChange={toggleAllPoems}
            disabled={WEAK && !showAllPoems}
          />
          {WEAK && !showAllPoems
            ? "行星 · 全部作品环绕（弱设备已禁用,避免卡死）"
            : "行星 · 全部诗人的作品环绕（建议高性能）"}
        </label>
        <label className="set-toggle">
          <input type="checkbox" checked={showGifts} onChange={toggleGifts} />
          赠诗网络 · 开启后左下出现「赠诗漫游」
        </label>
        <label className="set-toggle">
          <input type="checkbox" checked={gravity} onChange={toggleGravity} />
          引力 · 摄像机随星系自转,恒星好点选
        </label>
      </div>

      <button className="set-reset wide" onClick={resetAll} disabled={allDefault}>全部恢复默认</button>

      {/* 关于 + 页内反馈 (at the very bottom of 更多) */}
      <div className="set-group">
        <div className="set-label">关于 · 反馈</div>
        <div className="set-links">
          <a className="set-link" href="https://cohenjikan.com" target="_blank" rel="noopener noreferrer">个人主页 ↗</a>
          <a className="set-link" href="https://github.com/Cohenjikan" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        </div>
        <FeedbackBox />
      </div>
    </div>
  );
}
