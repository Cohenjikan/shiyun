import { useStore } from "../state/store";
import { pulledFromIndex } from "../engine/engineApi";
import { claimBadge } from "../state/claims";
import { CopyButton } from "./CopyButton";

// 我的认领 — this device's claimed poems, a LOCAL keepsake (mirrors 拾遗/ShiyiViewer). Each row re-surfaces
// the poem from its universal 全集编号 (pulledFromIndex — a bijection, same number → same poem), shows its
// 认领编号 (#N / 第 N 首) + any 里程碑 badge, and re-opens it. Stored only in this browser's localStorage
// (never on the server, by design) — the footer says so plainly so a visitor knows clearing storage / a new
// device loses the LIST (the global 认领编号 itself is permanent on the server).
function fmt(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ClaimsViewer() {
  const open = useStore((s) => s.myClaimsOpen);
  const close = useStore((s) => s.setMyClaimsOpen);
  const list = useStore((s) => s.myClaims); // newest-first
  const selectPoem = useStore((s) => s.selectPoem);
  const setFlyTarget = useStore((s) => s.setFlyTarget);
  if (!open) return null;

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
          <span>我的认领 · 我认下的诗</span>
          <button className="set-close" onClick={() => close(false)} title="关闭">×</button>
        </div>
        {list.length === 0 ? (
          <div className="fbv-empty">你还没有认领过诗 —— 点虚空捞起一首诗，在它的面板里「认领这首诗」，它便永远属于你。</div>
        ) : (
          <>
            <div className="shiyi-list">
              {list.map((c) => {
                const preview = c.preview || pulledFromIndex("ziyou", c.index)?.lines[0] || "无题";
                const badge = claimBadge(c.no);
                return (
                  <div key={c.index} className="shiyi-item myclaim-item">
                    <button
                      className="shiyi-open"
                      onClick={() => restore(c.index)}
                      title="回到这首诗 —— 它在诗云里的坐标永远属于你"
                    >
                      <span className="myclaim-row1">
                        <span className="shiyi-preview" lang="zh">{preview}</span>
                        <span className="myclaim-no">{c.no != null ? `#${c.no}` : "待联网"}</span>
                      </span>
                      <span className="myclaim-row2">
                        <span className="shiyi-time">
                          {c.no != null ? `第 ${c.no.toLocaleString()} 首被认领` : "认领编号待联网确认"} · {fmt(c.ts)}
                        </span>
                        {badge && <span className={`claim-badge ${badge.tier} mini`}>✦ {badge.label}</span>}
                      </span>
                    </button>
                    {/* 中奖密钥: shown OUTSIDE the restore <button> (a button can't nest a copy button) so a
                        winner can always re-find + copy it here — 「显示一次就丢」的反面。 */}
                    {c.prizeKey && (
                      <div className="myclaim-prize">
                        <span className="myclaim-prize-tag">🎉 中奖密钥</span>
                        <code className="pi-idx myclaim-prize-key">{c.prizeKey}</code>
                        <CopyButton text={c.prizeKey} label="复制" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="shiyi-foot">
              仅存于此浏览器 · 共 {list.length} 首 —— 清除缓存或更换设备会丢失此列表;但你的认领编号在全站永久保留。
            </div>
          </>
        )}
      </div>
    </div>
  );
}
