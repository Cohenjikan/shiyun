import { useStore } from "../state/store";
import { pulledFromIndex } from "../engine/engineApi";

// 拾遗 — "我捞起的诗": the revisit panel for VOID-poem keepsakes. Opened from the 更多 menu. Each row
// re-surfaces a kept poem the same way state/permalink.ts::applyHash does for `#p=`: rebuild it from its
// universal 全集编号 (pulledFromIndex — a bijection, so the SAME number always returns the SAME poem),
// select it, and fly the camera to its canonical void point. Mirrors FeedbackViewer's overlay structure.
// (localStorage = this browser only; the footer says so.)
function fmt(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ShiyiViewer() {
  const open = useStore((s) => s.shiyiOpen);
  const close = useStore((s) => s.setShiyiOpen);
  const list = useStore((s) => s.shiyi); // already newest-first
  const drop = useStore((s) => s.dropShiyi);
  const selectPoem = useStore((s) => s.selectPoem);
  const setFlyTarget = useStore((s) => s.setFlyTarget);
  if (!open) return null;

  // restore: rebuild the poem from its universal index, select it, then glide to its void point — the
  // exact sequence applyHash uses for a shared `#p=` link. Closes the panel so the poem is in view.
  const restore = (index: string) => {
    const poem = pulledFromIndex("ziyou", index);
    if (poem) {
      selectPoem(poem);
      setFlyTarget(poem.pos);
    }
    close(false);
  };

  return (
    <div className="fbv-overlay" onClick={() => close(false)}>
      <div className="fbv-card" onClick={(e) => e.stopPropagation()}>
        <div className="fbv-head">
          <span>拾遗 · 我捞起的诗</span>
          <button className="set-close" onClick={() => close(false)} title="关闭">×</button>
        </div>
        {list.length === 0 ? (
          <div className="fbv-empty">虚空尚未为你留下什么 —— 点击星间的黑暗,捞起一首诗,再「收进拾遗」。</div>
        ) : (
          <>
            <div className="shiyi-list">
              {list.map((e) => (
                <div key={e.index} className="shiyi-item">
                  <button
                    className="shiyi-open"
                    onClick={() => restore(e.index)}
                    title="回到这首诗 —— 重新从虚空里把它捞起"
                  >
                    <span className="shiyi-preview" lang="zh">{e.preview || "无题"}</span>
                    <span className="shiyi-time">{fmt(e.ts)}</span>
                  </button>
                  <button
                    className="shiyi-del"
                    onClick={() => drop(e.index)}
                    title="从拾遗里移除"
                    aria-label="删除"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className="shiyi-foot">仅存于此浏览器 · 共 {list.length} 首</div>
          </>
        )}
      </div>
    </div>
  );
}
