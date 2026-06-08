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
  const showGifts = useStore((s) => s.showGifts);
  const toggleGifts = useStore((s) => s.toggleGifts);
  const quality = useStore((s) => s.quality);
  const toggleQuality = useStore((s) => s.toggleQuality);
  const gravity = useStore((s) => s.gravity);
  const toggleGravity = useStore((s) => s.toggleGravity);
  const speed = useStore((s) => s.speed);
  const loaded = useStore((s) => s.loaded);
  const m = getManifest();

  return (
    <>
      <div className="hud-top">
        <div className="title">
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
          className={showGifts ? "filter on" : "filter"}
          onClick={toggleGifts}
          title="显示诗人之间的赠答网络（寄/赠/和/次韵），选中诗人可高亮其往来"
        >
          赠诗
        </button>
        <button
          className={gravity ? "filter on" : "filter"}
          onClick={toggleGravity}
          title="引力：进入星系后摄像机随星系一同自转，恒星相对静止、好点选（默认开）"
        >
          引力
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
