import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { DYNASTY_BY_KEY } from "../data/dynasties";
import { collectionNotice } from "../data/collectionStatus";
import { fetchPoetPoems } from "../data/poetPoemsLoader";
import { anyTextIndex } from "../engine/engineApi";
import { poemPosition } from "../three/positions";
import { ShareButton } from "./CopyButton";
import { useSheet } from "./useSheet";

const FORM_LABEL: Record<string, string> = {
  wujue: "五绝",
  qijue: "七绝",
  wulu: "五律",
  qilu: "七律",
  other: "古体/其它",
};
const PAGE = 50; // titles shown before "显示更多"

type IdxInfo = { kind: "full" | "free"; index: string; digits: number; chars?: number; lines?: number } | null;

// A copy button that computes its (possibly huge BigInt) 编号 ONLY on click — keeps the collapsed
// title list cheap (no upfront rank for every poem).
function LazyCopy({ compute, label }: { compute: () => string | null; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy-btn"
      title="复制完整编号"
      onClick={(e) => {
        e.stopPropagation();
        const t = compute();
        if (!t) return;
        navigator.clipboard?.writeText(t).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "已复制 ✓" : label}
    </button>
  );
}

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

// Animated load state for a poet's poems — gold spinner + shimmer skeleton (深色星空美学), plus a REAL
// download progress bar once Content-Length is known (大诗人首访切片可达 2.6MB → 明确的百分比反馈,不再是
// 无尽「载入…」). Pure CSS, no deps; honours prefers-reduced-motion.
function PoemsLoading({ progress }: { progress: { received: number; total: number } | null }) {
  const total = progress?.total ?? 0;
  const received = progress?.received ?? 0;
  const known = total > 0;
  const pct = known ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <div className="loading-row poems-loading">
      <div className="spinner" aria-hidden="true" />
      <div className="loading-label">载入作品…</div>
      {known && (
        <div className="load-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="load-track">
            <div className="load-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="load-pct">{pct}% · {fmtBytes(received)} / {fmtBytes(total)}</div>
        </div>
      )}
      <div className="poem-skeleton" aria-hidden="true">
        {[0, 1, 2, 3].map((k) => (
          <div className="sk-row" key={k} />
        ))}
      </div>
    </div>
  );
}

export function PoetPanel() {
  const poet = useStore((s) => s.selectedPoet);
  const aliasNote = useStore((s) => s.poetAliasNote);
  const poems = useStore((s) => s.poetPoems);
  const poemsError = useStore((s) => s.poetPoemsError);
  const progress = useStore((s) => s.poetPoemsProgress);
  const focus = useStore((s) => s.poetFocus);
  const close = useStore((s) => s.clearPoet);
  const pulseAt = useStore((s) => s.pulseAt);
  const lockPoem = useStore((s) => s.lockPoem);
  const openCinema = useStore((s) => s.toggleCinema);
  const openCinemaFor = useStore((s) => s.openCinemaFor);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  // lazy 编号 cache (poemIdx → computed index) so an expanded/copied poem ranks once, not per render.
  const idxCache = useRef<Map<number, IdxInfo>>(new Map());

  // reset per poet load; auto-expand the 诗句-search hit poem
  useEffect(() => {
    idxCache.current = new Map();
    const init = new Set<number>();
    if (focus && focus.poemIdx >= 0) init.add(focus.poemIdx);
    setExpanded(init);
    setShown(PAGE);
  }, [poet?.id, poems, focus]);

  // hit poem first, then the rest in write order — show only the titles (drawer), content on click.
  const order = useMemo(() => {
    if (!poems) return [];
    const fIdx = focus?.poemIdx ?? -1;
    const rest = poems.map((_, i) => i).filter((i) => i !== fIdx);
    return fIdx >= 0 && fIdx < poems.length ? [fIdx, ...rest] : rest;
  }, [poems, focus]);

  const sheet = useSheet(poet?.id ?? null);

  if (!poet) return null;
  const dyn = DYNASTY_BY_KEY[poet.dynasty];
  // 收录状态:诗人级一行灰字(按类拼装,零人名硬编码);头部计数在「全库仅存目」诗人(叶嘉莹)上改说「存目 N 条」。
  const notice = collectionNotice(poet);
  const countLabel = poet.restrictedOnly ? `存目 ${poet.poemCount} 条` : `${poet.poemCount} 首`; // peek 用
  const fullCountLabel = poet.restrictedOnly ? `存目 ${poet.poemCount} 条` : `${poet.poemCount} 首真实作品`; // 头部用

  // mobile: clicking a star stashes the poet as a bottom peek bar (name + 朝代 + 首数), not a full sheet
  // over the galaxy; tap it to open the poem drawer. Re-collapses when a different poet is selected.
  if (sheet.collapsed) {
    return (
      <div className="sheet-peek" onClick={sheet.expand}>
        <span className="peek-label" style={{ color: dyn?.color }}>{poet.name}</span>
        <span className="peek-sub">{dyn?.label ?? poet.dynasty} · {countLabel}</span>
        <span className="peek-cue">▲ 展开</span>
        <button className="peek-x" onClick={(e) => { e.stopPropagation(); close(); }} aria-label="关闭">×</button>
      </div>
    );
  }

  function indexFor(i: number): IdxInfo {
    const cache = idxCache.current;
    if (cache.has(i)) return cache.get(i)!;
    const pm = poems![i];
    // UNIVERSAL 全集编号 for EVERY poem (anyTextIndex over chars+breaks): a 五绝 and its 自由 twin share
    // ONE number, and a number reverses to exactly one poem. No per-form catalog, no collision.
    const a = anyTextIndex(pm.p);
    const res: IdxInfo = a ? { kind: "full", index: a.index, digits: a.digits, chars: a.chars, lines: a.lines } : null;
    cache.set(i, res);
    return res;
  }
  function toggle(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }
  // 目录定位: fly to this poem's planet (a fixed, deterministic spot in the poet's orbit) + light a
  // flare there — without collapsing the panel or changing the selected poet. `i` is the poem's
  // original index, which matches PoemOrbits' per-poem layout, so the flare lands on the right planet.
  function locatePoem(i: number) {
    if (!poet) return;
    pulseAt(poemPosition(poet, i), true);
    lockPoem(poet.id, i); // fly to + follow that orbiting planet
  }

  return (
    <div className="poet-panel">
      {sheet.mobile && <button className="peek-collapse" onClick={sheet.collapse}>▾ 收起到底部</button>}
      <button className="panel-close" onClick={close} aria-label="关闭">×</button>
      <div className="poet-head">
        <span className="poet-name" style={{ color: dyn?.color }}>{poet.name}</span>
        <span className="poet-sub">
          {dyn?.label ?? poet.dynasty} · {fullCountLabel} <ShareButton />
          <button className="cinema-btn" onClick={openCinema} title="留影当前搜中的那首（时间暂停）;目录里每一行也有单独的「留影」按钮">
            留影
          </button>
        </span>
      </div>
      {aliasNote && <div className="poet-alias-note">{aliasNote}</div>}
      {notice && <div className="poet-alias-note poet-collection-note">{notice}</div>}
      {poems === null && poemsError === poet.id ? (
        <div className="loading-row error">
          作品载入失败,可能是网络波动。
          <button className="retry-btn" onClick={() => fetchPoetPoems(poet.id)}>重试</button>
        </div>
      ) : poems === null ? (
        <PoemsLoading progress={progress && progress.id === poet.id ? progress : null} />
      ) : (
        <div className="poem-list">
          {order.slice(0, shown).map((i) => {
            const pm = poems[i];
            const isHit = i === (focus?.poemIdx ?? -1);
            const isOpen = expanded.has(i);
            return (
              <div className={isHit ? "poem-item hit" : "poem-item"} key={i}>
                <div className="pi-row" onClick={() => toggle(i)}>
                  <span className="pi-caret">{isOpen ? "▾" : "▸"}</span>
                  <span className="pi-title">
                    {pm.t || "（无题）"}
                    {isHit && <span className="pi-hit">搜的这首</span>}
                  </span>
                  <span className="pi-form">{FORM_LABEL[pm.f]}</span>
                  <button
                    className="pi-locate"
                    title="飞到这首诗的行星 · 点亮"
                    onClick={(e) => { e.stopPropagation(); locatePoem(i); }}
                  >
                    定位
                  </button>
                  <button
                    className="pi-cinema"
                    title="把这首诗框成一张可截图分享的卡片（时间暂停）"
                    onClick={(e) => { e.stopPropagation(); openCinemaFor(i); }}
                  >
                    留影
                  </button>
                  <LazyCopy compute={() => indexFor(i)?.index ?? null} label="复制编号" />
                </div>
                {isOpen && (
                  <div className="pi-detail">
                    <div className="pi-body">
                      {/* 展示用 d ?? p:含 □ 缺字的原貌;编号/定位/格律等一切计算仍读 pm.p */}
                      {(pm.d ?? pm.p).map((l, j) => (
                        <div key={j} className={pm.f === "other" ? "wrap" : ""}>{l}</div>
                      ))}
                    </div>
                    {pm.d && <div className="pi-idx dim">□ 为原文缺字</div>}
                    {/* 收录状态灰注(同 □ 槽位):正文/编号/定位/留影按钮一律保留(owner 已拍板),仅加一行说明 */}
                    {pm.s === "disputed" && <div className="pi-idx dim">真伪存疑 · {pm.sn}</div>}
                    {pm.s === "restricted" && <div className="pi-idx dim">版权存目 · {pm.sn}</div>}
                    {(() => {
                      const r = indexFor(i);
                      if (!r) return <div className="pi-idx dim">含字库外字符 · 无固定编号</div>;
                      const label = `全集编号 · ${r.chars}字 ${r.lines}行 · ${r.digits}位`;
                      return (
                        <div className="pi-idx-block">
                          <div className="pi-idx-head">{label}<LazyCopy compute={() => r.index} label="复制" /></div>
                          <div className="pi-idx-full">{r.index}</div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
          {order.length > shown && (
            <button className="more-btn" onClick={() => setShown((s) => s + PAGE)}>
              显示更多（剩 {order.length - shown} 首）
            </button>
          )}
          {/* 存目条目(lost):零汉字诗(全 □ / 全外文·数字)进不了 p/编号,列在最末、显示更多之后(打开即见,不随分页)。
              muted、无箭头无按钮不可展开——它没有可编号的正文,只是「存在过」的存目。 */}
          {poet.lost?.map((lo, k) => (
            <div className="poem-item lost" key={`lost-${k}`}>
              <div className="pi-row">
                <span className="pi-title lost-title">{lo.t || "（无题）"}</span>
                <span className="lost-tag">{lo.k === "lacuna" ? "原文已佚 · 存目" : "非汉字内容 · 存目"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
