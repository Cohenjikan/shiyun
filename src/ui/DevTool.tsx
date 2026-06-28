import { useStore } from "../state/store";

// Owner-only developer tool, opened by the hidden gesture (5 taps on the 诗云 logo within 10 s) — it
// replaces the old feedback inbox that lived behind that gesture. Today it's a meteor console: spawn one
// of each kind on demand (no waiting for the 2–10 s auto cadence) and tune the auto-spawn interval.
export function DevTool() {
  const open = useStore((s) => s.devToolOpen);
  const setOpen = useStore((s) => s.setDevToolOpen);
  const minGap = useStore((s) => s.meteorMinGap);
  const maxGap = useStore((s) => s.meteorMaxGap);
  const setGaps = useStore((s) => s.setMeteorGaps);
  const requestMeteor = useStore((s) => s.requestMeteor);
  const meteorsOn = useStore((s) => s.meteorsOn);
  const toggleMeteors = useStore((s) => s.toggleMeteors);
  const look = useStore((s) => s.meteorLook);
  const setLook = useStore((s) => s.setMeteorLook);
  const feed = useStore((s) => s.claimFeed);
  const mine = useStore((s) => s.myClaims);
  if (!open) return null;

  // keep min ≤ max as either slider moves
  const setMin = (v: number) => setGaps(Math.min(v, maxGap), maxGap);
  const setMax = (v: number) => setGaps(minGap, Math.max(v, minGap));
  const LOOK: { k: "len" | "width" | "bright" | "head"; label: string }[] = [
    { k: "len", label: "拖尾长度" },
    { k: "width", label: "线宽" },
    { k: "bright", label: "亮度" },
    { k: "head", label: "头部大小" },
  ];

  return (
    <div className="devtool">
      <div className="dev-head">
        <span>开发者工具 · 流星</span>
        <button className="set-close" onClick={() => setOpen(false)} title="关闭">×</button>
      </div>

      <div className="dev-group">
        <div className="dev-label">立即生成一颗(免等)</div>
        <div className="dev-btns">
          <button onClick={() => requestMeteor("today")} title="今日认领 · 较亮、可点开看诗">今日·亮</button>
          <button onClick={() => requestMeteor("past")} title="往日认领 · 暗的旧星星">往日·暗</button>
          <button onClick={() => requestMeteor("ceremony")} title="认领当事人 · 保留奔赴感,冲向银心">当事人·奔赴</button>
        </div>
        <div className="dev-hint">无认领数据时也能生成(合成测试流星)。</div>
      </div>

      <div className="dev-group">
        <div className="dev-label">自动生成间隔(随机区间)</div>
        <label className="dev-row">
          <span className="dev-k">最短</span>
          <input type="range" min={0.2} max={10} step={0.1} value={minGap} onChange={(e) => setMin(Number(e.target.value))} />
          <span className="dev-v">{minGap.toFixed(1)}s</span>
        </label>
        <label className="dev-row">
          <span className="dev-k">最长</span>
          <input type="range" min={0.3} max={20} step={0.1} value={maxGap} onChange={(e) => setMax(Number(e.target.value))} />
          <span className="dev-v">{maxGap.toFixed(1)}s</span>
        </label>
        <div className="dev-btns">
          <button onClick={() => setGaps(0.4, 1.2)}>密集 0.4–1.2s</button>
          <button onClick={() => setGaps(2, 10)}>默认 2–10s</button>
        </div>
      </div>

      <div className="dev-group">
        <div className="dev-label">外观(实时,拖到满意为止)</div>
        {LOOK.map(({ k, label }) => (
          <label className="dev-row" key={k}>
            <span className="dev-k" style={{ width: 56 }}>{label}</span>
            <input
              type="range"
              min={0.3}
              max={k === "len" ? 2.5 : 3}
              step={0.05}
              value={look[k]}
              onChange={(e) => setLook({ [k]: Number(e.target.value) })}
            />
            <span className="dev-v">{look[k].toFixed(2)}×</span>
          </label>
        ))}
        <div className="dev-btns">
          <button onClick={() => setLook({ len: 1, width: 1, bright: 1, head: 1 })}>外观恢复默认</button>
        </div>
      </div>

      <div className="dev-group">
        <div className="dev-label">状态</div>
        <div className="dev-stat">
          流星显示:{meteorsOn ? "开" : "关"} · <button className="dev-link" onClick={toggleMeteors}>切换</button>
        </div>
        <div className="dev-stat">已知认领:全站 {feed?.total ?? "—"} · 本机 {mine.length}</div>
      </div>
    </div>
  );
}
