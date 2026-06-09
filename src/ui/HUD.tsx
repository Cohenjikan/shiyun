import { useLayoutEffect, useRef } from "react";
import { useStore } from "../state/store";
import { getManifest, hasRealGelu } from "../data/load";
import type { PullForm } from "../engine/engineApi";

const FORMS: { id: PullForm; label: string; title?: string }[] = [
  { id: "wujue", label: "五绝" },
  { id: "qijue", label: "七绝" },
  { id: "wulu", label: "五律" },
  { id: "qilu", label: "七律" },
  { id: "ziyou", label: "自由", title: "词 / 自由诗:任意长度、换行也由编号决定;新诗/古体的编号也在这套目录里" },
];

export function HUD() {
  const form = useStore((s) => s.form);
  const setForm = useStore((s) => s.setForm);
  const commonOnly = useStore((s) => s.commonOnly);
  const toggleCommon = useStore((s) => s.toggleCommon);
  const lushi = useStore((s) => s.lushiFilter);
  const toggleLushi = useStore((s) => s.toggleLushi);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const setFeedbackOpen = useStore((s) => s.setFeedbackOpen);
  const quality = useStore((s) => s.quality);
  const toggleQuality = useStore((s) => s.toggleQuality);
  const toggleUI = useStore((s) => s.toggleUI);
  const speed = useStore((s) => s.speed);
  const loaded = useStore((s) => s.loaded);
  const m = getManifest();

  // Publish the LIVE wrapped HUD height (rows + notch safe-area) into --hud-h so the mobile search panel
  // can sit just below it (styles.css) instead of guessing a fixed top — robust to wrap count / notch /
  // font size / orientation. Desktop ignores --hud-h (the search keeps its fixed top there).
  const topRef = useRef<HTMLDivElement>(null);

  // hidden owner gesture: 5 taps on the 诗云 logo within 10 s → open the feedback viewer (see FeedbackViewer)
  const taps = useRef<number[]>([]);
  const onLogoTap = () => {
    const now = Date.now();
    taps.current = taps.current.filter((t) => now - t < 10000);
    taps.current.push(now);
    if (taps.current.length >= 5) {
      taps.current = [];
      setFeedbackOpen(true);
    }
  };

  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => document.documentElement.style.setProperty("--hud-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div className="hud-top" ref={topRef}>
        <div className="title" onClick={onLogoTap} style={{ cursor: "pointer" }}>
          诗云 <span className="title-en">Poetry Cloud</span>
        </div>
        <div className="seg" title="点击虚空时生成的诗体">
          {FORMS.map((f) => (
            <button
              key={f.id}
              className={f.id === form ? "seg-btn on" : "seg-btn"}
              onClick={() => setForm(f.id)}
              title={f.title}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          className={commonOnly ? "filter on" : "filter"}
          onClick={toggleCommon}
          title="只用最常见的字生成,避开生僻乱码"
        >
          常用字
        </button>
        {hasRealGelu() && form !== "ziyou" && (
          <button
            className={lushi ? "filter on" : "filter"}
            onClick={toggleLushi}
            title="只生成合平仄、押韵的诗（平水韵）"
          >
            格律
          </button>
        )}
        <button
          className={settingsOpen ? "filter on" : "filter"}
          onClick={toggleSettings}
          title="更多：指引 / 行星 / 赠诗 / 引力 / 关于 / 反馈"
        >
          更多
        </button>
        <button
          className="filter"
          onClick={toggleQuality}
          title="画质：高=16万粒子+辉光；低=更少粒子、关闭辉光（弱显卡更流畅）"
        >
          {quality === "high" ? "画质·高" : "画质·低"}
        </button>
        {loaded && m && (
          <div className="stat">
            {m.poetCount.toLocaleString()} 诗人 · {m.poemCount.toLocaleString()} 首
          </div>
        )}
        <button
          className="ui-hide-btn"
          onClick={toggleUI}
          title="隐藏全部界面以便截图 · 快捷键 H 恢复"
        >
          隐藏界面 · H
        </button>
      </div>

      <div className="hud-bottom">
        <span className="hint">
          WASD 飞行 · 拖拽转向 · 滚轮调速 · <b>点诗星</b>看其真作 · <b>点虚空</b>从噪声里捞诗
        </span>
        <span className="speed">速度 ×{speed.toFixed(2)} · {(140 * speed).toFixed(0)} 单位/秒</span>
      </div>
    </>
  );
}
