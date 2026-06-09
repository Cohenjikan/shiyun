import { useStore } from "../state/store";
import { CopyButton, ShareButton } from "./CopyButton";
import { useSheet } from "./useSheet";

const FORM_LABEL: Record<string, string> = {
  wujue: "五言绝句",
  qijue: "七言绝句",
  wulu: "五言律诗",
  qilu: "七言律诗",
  ziyou: "自由格式 · 词",
};

export function PoemPanel() {
  const selected = useStore((s) => s.selected);
  const close = useStore((s) => s.clearSelection);
  const openCinema = useStore((s) => s.toggleCinema);
  const sheet = useSheet(selected?.babelIndex ?? null);
  if (!selected) return null;
  const isFree = selected.form === "ziyou";

  // mobile: a fresh void-pull stays stashed as a bottom peek bar until tapped (never covers the galaxy)
  if (sheet.collapsed) {
    return (
      <div className="sheet-peek" onClick={sheet.expand}>
        <span className="peek-label">{FORM_LABEL[selected.form]}</span>
        <span className="peek-sub">虚空里捞得一首诗 · {selected.babelDigits} 位编号</span>
        <span className="peek-cue">▲ 展开</span>
        <button className="peek-x" onClick={(e) => { e.stopPropagation(); close(); }} aria-label="关闭">×</button>
      </div>
    );
  }

  return (
    <div className="poem-panel">
      {sheet.mobile && <button className="peek-collapse" onClick={sheet.collapse}>▾ 收起到底部</button>}
      <button className="panel-close" onClick={close} aria-label="关闭">
        ×
      </button>
      <div className="poem-body" lang="zh">
        {selected.lines.map((line, i) => (
          <div className={isFree ? "poem-line wrap" : "poem-line"} key={i}>
            {line}
          </div>
        ))}
      </div>

      <div className="poem-meta">
        <div className="meta-row">
          <span className="meta-k">诗体</span>
          <span className="meta-v">{FORM_LABEL[selected.form]}</span>
        </div>
        <div className="meta-row col">
          <span className="meta-k">
            全集编号
            <span className="meta-sub">唯一 · 跨诗体 · {selected.babelDigits} 位</span>
            <CopyButton text={selected.babelIndex} />
          </span>
          <span className="meta-v idx full" title={`${selected.babelDigits} 位十进制 · 反查请到「编号反查」`}>
            {selected.babelIndex}
          </span>
        </div>
        {!isFree && (
          <div className="meta-row">
            <span className="meta-k">格律编号</span>
            {selected.valid ? (
              <span className="meta-v idx lushi">
                <span className="seal">律</span>
                {selected.lushiIndex}
              </span>
            ) : (
              <span className="meta-v muted">非格律 · 纯随机目录</span>
            )}
          </div>
        )}
      </div>

      <div className="poem-foot">
        {isFree
          ? `换行也写进了编号里 —— 这 ${selected.babelDigits} 位地址既定了字，也定了断句。`
          : `这首诗一直在诗云里，编号 ${selected.babelDigits} 位长 —— 地址几乎和诗本身一样长。`}
        <div className="poem-share">
          <ShareButton />
          <button className="cinema-btn" onClick={openCinema} title="把这首诗框成一张可截图分享的卡片（时间暂停）">
            奇迹时刻
          </button>
        </div>
      </div>
    </div>
  );
}
