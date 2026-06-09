import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { getPoet, loadPoetPoems, type PoetRow } from "../data/load";
import { ensureGiftGraph, giftLinks, giftPath, dedicationPoemIdx, giftGraphReady } from "../data/giftGraph";
import { poemPosition } from "../three/positions";

const MAX_LINKS = 40; // cap the link list for hub poets (苏轼/白居易 have many) — strongest first
const MAX_HOPS = 10; // BFS budget for 赠诗 path search (the graph is tiny; safely raisable)

// travel to a poet along a 赠诗 edge: append to the trail + lock-follow, then load its poems.
function hop(poet: PoetRow) {
  useStore.getState().hopToPoet(poet);
  loadPoetPoems(poet.id).then((poems) => useStore.getState().setPoetPoems(poet.id, poems));
}

export function GiftRoam() {
  const showGifts = useStore((s) => s.showGifts);
  const selectedPoet = useStore((s) => s.selectedPoet);
  const poetPoems = useStore((s) => s.poetPoems);
  const trail = useStore((s) => s.giftTrail);
  const pathStart = useStore((s) => s.pathStart);
  const pathEnd = useStore((s) => s.pathEnd);
  const pathResult = useStore((s) => s.pathResult);
  const setPath = useStore((s) => s.setPath);
  const clearTrail = useStore((s) => s.clearTrail);
  const pulseAt = useStore((s) => s.pulseAt);

  const [ready, setReady] = useState(giftGraphReady());
  useEffect(() => {
    if (showGifts && !ready) ensureGiftGraph().then(() => setReady(true));
  }, [showGifts, ready]);

  if (!showGifts) return null;

  const links = selectedPoet && ready ? giftLinks(selectedPoet.id) : [];
  const name = (id: string) => getPoet(id)?.name ?? "佚名";

  const runPath = () => {
    if (!pathStart || !pathEnd) return;
    const p = giftPath(pathStart, pathEnd, MAX_HOPS);
    setPath(pathStart, pathEnd, p ?? []);
  };

  return (
    <div className="giftroam">
      <div className="gr-title">赠诗漫游{selectedPoet ? <span className="gr-sub"> · {selectedPoet.name}</span> : null}</div>

      {/* ── 往来: this poet's 赠诗 links — click to fly across the line to the other poet ── */}
      <div className="gr-section">
        <div className="gr-head">往来 {links.length ? `(${links.length})` : ""}</div>
        {!selectedPoet ? (
          <div className="gr-dim">先选中一位诗人,这里列出他的赠答往来</div>
        ) : !ready ? (
          <div className="gr-dim">载入赠诗网络…</div>
        ) : links.length === 0 ? (
          <div className="gr-dim">这位诗人暂无可考的赠答记录</div>
        ) : (
          <div className="gr-links">
            {links.slice(0, MAX_LINKS).map((l, i) => {
              const other = getPoet(l.other);
              const dedi = l.dir === "out" ? dedicationPoemIdx(poetPoems, name(l.other)) : null;
              return (
                <div key={i} className="gr-link">
                  <button className="gr-link-go" onClick={() => other && hop(other)} title="飞跃到这位诗人">
                    <span className={l.dir === "out" ? "gr-dir out" : "gr-dir in"}>{l.dir === "out" ? "赠出→" : "←收到"}</span>
                    <span className="gr-link-name">{name(l.other)}</span>
                    {l.w > 1 && <span className="gr-w">×{l.w}</span>}
                  </button>
                  {dedi != null && selectedPoet && (
                    <button
                      className="gr-dedi"
                      title="点亮这首赠诗"
                      onClick={() => pulseAt(poemPosition(selectedPoet, dedi), true)}
                    >
                      《{poetPoems?.[dedi]?.t || "无题"}》
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 足迹: the breadcrumb of hops; click a node to return to it; persistent gold lines in 3D ── */}
      {trail.length > 1 && (
        <div className="gr-section">
          <div className="gr-head">
            足迹 <span className="gr-dim-inline">({trail.length - 1} 跳)</span>
            <button className="gr-clear" onClick={clearTrail} title="清除返回线足迹">清除</button>
          </div>
          <div className="gr-trail">
            {trail.map((id, i) => (
              <span key={i}>
                {i > 0 && <span className="gr-arrow">→</span>}
                <button
                  className={i === trail.length - 1 ? "gr-node cur" : "gr-node"}
                  onClick={() => { const p = getPoet(id); if (p) hop(p); }}
                  title={i === trail.length - 1 ? "当前" : "沿来线返回这里"}
                >
                  {name(id)}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── 路径: find a chain of 赠诗 edges between two poets (≤MAX_HOPS) ── */}
      <div className="gr-section">
        <div className="gr-head">路径查找</div>
        <div className="gr-path-set">
          <button
            className="gr-set"
            disabled={!selectedPoet}
            onClick={() => selectedPoet && setPath(selectedPoet.id, pathEnd, null)}
          >
            设为起点
          </button>
          <span className="gr-slot">{pathStart ? name(pathStart) : "—"}</span>
          <span className="gr-arrow">→</span>
          <span className="gr-slot">{pathEnd ? name(pathEnd) : "—"}</span>
          <button
            className="gr-set"
            disabled={!selectedPoet}
            onClick={() => selectedPoet && setPath(pathStart, selectedPoet.id, null)}
          >
            设为终点
          </button>
        </div>
        <div className="gr-path-act">
          <button className="gr-find" disabled={!pathStart || !pathEnd} onClick={runPath}>查找路径</button>
          {pathResult && pathResult.length === 0 && <span className="gr-dim-inline">≤{MAX_HOPS} 跳内无连接</span>}
          {pathResult && pathResult.length > 0 && <span className="gr-dim-inline">{pathResult.length - 1} 跳</span>}
        </div>
        {pathResult && pathResult.length > 0 && (
          <div className="gr-trail">
            {pathResult.map((id, i) => (
              <span key={i}>
                {i > 0 && <span className="gr-arrow">→</span>}
                <button className="gr-node path" onClick={() => { const p = getPoet(id); if (p) hop(p); }} title="飞到这一站">
                  {name(id)}
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
