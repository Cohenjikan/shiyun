import { useStore } from "../state/store";
import { DYNASTY_BY_KEY } from "../data/dynasties";
import { textBabelIndex, anyTextIndex } from "../engine/engineApi";
import type { FormId } from "../engine/engine";
import type { PoemRecord } from "../data/load";
import { CopyButton, ShareButton } from "./CopyButton";

const FORM_LABEL: Record<string, string> = {
  wujue: "五绝",
  qijue: "七绝",
  wulu: "五律",
  qilu: "七律",
  other: "古体/其它",
};

export function PoetPanel() {
  const poet = useStore((s) => s.selectedPoet);
  const poems = useStore((s) => s.poetPoems);
  const focus = useStore((s) => s.poetFocus);
  const close = useStore((s) => s.clearPoet);
  if (!poet) return null;
  const dyn = DYNASTY_BY_KEY[poet.dynasty];

  // 诗句 search → surface the EXACT matched poem first (by its index in the poet's poems[],
  // which is the pipeline write order the firstline ref's `i` points at — so duplicate titles
  // / shared openings can't false-match), highlighted; then the rest, capped at 60 total.
  const CAP = 60;
  let ordered: { pm: PoemRecord; hit: boolean }[] = [];
  if (poems) {
    const fIdx = focus?.poemIdx ?? -1;
    const matched: { pm: PoemRecord; hit: boolean }[] = [];
    const rest: { pm: PoemRecord; hit: boolean }[] = [];
    poems.forEach((pm, i) => (i === fIdx ? matched : rest).push({ pm, hit: i === fIdx }));
    ordered = [...matched, ...rest.slice(0, CAP - matched.length)];
  }

  return (
    <div className="poet-panel">
      <button className="panel-close" onClick={close} aria-label="关闭">
        ×
      </button>
      <div className="poet-head">
        <span className="poet-name" style={{ color: dyn?.color }}>
          {poet.name}
        </span>
        <span className="poet-sub">
          {dyn?.label ?? poet.dynasty} · {poet.poemCount} 首真实作品 <ShareButton />
        </span>
      </div>
      {poems === null ? (
        <div className="loading-row">载入作品…</div>
      ) : (
        <div className="poem-list">
          {ordered.map(({ pm, hit }, i) => {
            const isOther = pm.f === "other";
            const idx = !isOther ? textBabelIndex(pm.f as FormId, pm.p.join("")) : null;
            // 新诗/古体: variable length → arbitrary-length 任意长编号 (reversible in 编号反查·任意)
            const anyIdx = isOther ? anyTextIndex(pm.p) : null;
            return (
              <div className={hit ? "poem-item hit" : "poem-item"} key={i}>
                <div className="pi-title">
                  {pm.t || "（无题）"} <span className="pi-form">{FORM_LABEL[pm.f]}</span>
                  {hit && <span className="pi-hit">你搜的这首</span>}
                </div>
                <div className="pi-body">
                  {pm.p.map((l, j) => (
                    <div key={j}>{l}</div>
                  ))}
                </div>
                {idx &&
                  (hit ? (
                    <div className="pi-idx hit-idx" title={`全集编号 · 正序第几首 · ${idx.digits} 位`}>
                      <div className="pi-idx-head">
                        全集编号 · 正序第 {idx.digits} 位长 <CopyButton text={idx.index} />
                      </div>
                      <div className="pi-idx-full">{idx.index}</div>
                    </div>
                  ) : (
                    <div className="pi-idx" title={`全集编号 · ${idx.digits} 位`}>
                      编号 {idx.index.slice(0, 28)}… <CopyButton text={idx.index} label="复制全编号" />
                    </div>
                  ))}
                {anyIdx &&
                  (hit ? (
                    <div className="pi-idx hit-idx" title={`自由编号（任意长）· ${anyIdx.chars} 字 ${anyIdx.lines} 行 · ${anyIdx.digits} 位 · 可在「编号反查·自由」还原`}>
                      <div className="pi-idx-head">
                        自由编号 · {anyIdx.chars} 字 {anyIdx.lines} 行 · {anyIdx.digits} 位{" "}
                        <CopyButton text={anyIdx.index} />
                      </div>
                      <div className="pi-idx-full">{anyIdx.index}</div>
                    </div>
                  ) : (
                    <div className="pi-idx" title={`自由编号（任意长）· ${anyIdx.digits} 位 · 可在「编号反查·自由」还原`}>
                      自由编号 {anyIdx.index.slice(0, 28)}… <CopyButton text={anyIdx.index} label="复制全编号" />
                    </div>
                  ))}
              </div>
            );
          })}
          {poems.length > ordered.length && (
            <div className="more">…共 {poems.length} 首,仅显示前 {ordered.length}</div>
          )}
        </div>
      )}
    </div>
  );
}
