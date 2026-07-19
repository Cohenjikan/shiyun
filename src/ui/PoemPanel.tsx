import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { CopyButton, ShareButton } from "./CopyButton";
import { useSheet } from "./useSheet";
import { addLocalClaim, setLocalClaimResult, listClaims, postClaim, hasClaimServer, claimBadge } from "../state/claims";

// 首次揭示: the first 3 void poems carry a plain-words banner explaining the poem was generated on
// the spot (实测: many visitors assumed pulls came from a database). Counter in localStorage; after
// 3 poems the banner retires for good — the poem-foot line keeps the idea alive. The banner also
// offers 关闭随机出诗 directly (same toggle as 更多 → 生成随机诗), so the escape is taught in context.
const REVEAL_KEY = "shiyun_voidreveal_n";
const REVEAL_MAX = 3;
function revealCount(): number {
  try {
    return Number(localStorage.getItem(REVEAL_KEY)) || 0;
  } catch {
    return REVEAL_MAX; // blocked storage → don't nag on every open
  }
}

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
  // 拾遗: a void pull is irreproducible — let the visitor keep it. babelIndex is the universal 全集编号
  // (anyRank), which doubles as the dedupe key AND the restore key (pulledFromIndex rebuilds it). Subscribe
  // to membership so the toggle flips live. (Real poems are re-findable via their poet → not kept here.)
  const keep = useStore((s) => s.keepShiyi);
  const drop = useStore((s) => s.dropShiyi);
  const kept = useStore((s) => !!selected && s.shiyi.some((e) => e.index === selected.babelIndex));
  // 认领: this device's LOCAL claim on THIS poem (if any). The public feed is index-free by design.
  const myClaims = useStore((s) => s.myClaims);
  const claimFeed = useStore((s) => s.claimFeed);
  const setMyClaims = useStore((s) => s.setMyClaims);
  const setFlyTarget = useStore((s) => s.setFlyTarget);
  const launchClaimCeremony = useStore((s) => s.launchClaimCeremony);
  const [claimingIdx, setClaimingIdx] = useState<string | null>(null);
  const sheet = useSheet(selected?.babelIndex ?? null);
  // 首次揭示条 (see REVEAL_KEY above). Counted once per poem shown; revealOff acknowledges the
  // in-banner 关闭随机出诗 click.
  const allowRandomPoem = useStore((s) => s.allowRandomPoem);
  const toggleRandomPoem = useStore((s) => s.toggleRandomPoem);
  const [reveal, setReveal] = useState(false);
  const [revealOff, setRevealOff] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const n = revealCount();
    setReveal(n < REVEAL_MAX);
    setRevealOff(false);
    if (n < REVEAL_MAX) {
      try {
        localStorage.setItem(REVEAL_KEY, String(n + 1));
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.babelIndex]);
  if (!selected) return null;
  const isFree = selected.form === "ziyou";
  const toggleKeep = () =>
    kept ? drop(selected.babelIndex) : keep({ index: selected.babelIndex, preview: selected.lines[0] ?? "" });

  // claim state for the currently-shown poem
  const myClaim = myClaims.find((c) => c.index === selected.babelIndex);
  const claiming = claimingIdx === selected.babelIndex;
  const badge = claimBadge(myClaim?.no); // 里程碑 / 早期印记 (null for ordinary numbers)
  // 截至此刻全站被认领的诗的总数 ——「诗云中已有 X 首诗被认领」(feed.total). After MY claim, my `no` IS the
  // count at that moment, so derive a fresh total even before the periodic feed refresh catches up. null
  // (→ hide) when there's no backend or the feed hasn't loaded; never blocks claiming.
  const feedTotal = claimFeed?.total ?? null;
  const displayTotal = myClaim?.no != null ? Math.max(feedTotal ?? 0, myClaim.no) : feedTotal;
  const showTotal = hasClaimServer && displayTotal != null && displayTotal > 0;
  // 认领: record locally (so a static build / offline still works + my meteor shows), locate the poem in
  // the void, launch it as a meteor, and POST for the authoritative 全站唯一 认领编号 (patched back on reply).
  // The server request has NO body. Poem text + reversible index stay in this browser (state/claims.ts).
  const doClaim = async () => {
    if (!selected || claiming || myClaim) return;
    const { babelIndex: index, pos } = selected;
    const ts = Date.now();
    setClaimingIdx(index);
    addLocalClaim({ index, ts, preview: selected.lines[0] ?? "" }); // preview stored LOCAL-only (keepsake)
    setMyClaims(listClaims());
    setFlyTarget(pos); // 在虚空中定位
    launchClaimCeremony({ index, pos, ts }); // …然后化作流星没入银河
    try {
      const { no, prizeKey } = await postClaim();
      if (no != null) {
        setLocalClaimResult(index, no, prizeKey); // patch the global claim number (+ 里程碑中奖密钥 if any)
        setMyClaims(listClaims());
      }
    } finally {
      setClaimingIdx((cur) => (cur === index ? null : cur));
    }
  };

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
      {reveal && (
        <div className="void-reveal">
          <strong>这首诗此前并不存在</strong> —— 它是你点下的那一刻，从那个坐标当场算出来的。同一个点，永远捞出同一首。
          {(revealOff || allowRandomPoem) && (
            <div className="void-reveal-row">
              {revealOff ? (
                <span>已关闭 · 在「更多」里可随时再打开</span>
              ) : (
                <>
                  <span>不想点虚空就蹦诗？</span>
                  <button
                    className="void-reveal-off"
                    onClick={() => {
                      toggleRandomPoem();
                      setRevealOff(true);
                    }}
                  >
                    关闭随机出诗
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
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
              <span className="meta-v muted">非格律 · 虚空目录</span>
            )}
          </div>
        )}
      </div>

      <div className="poem-claim">
        {myClaim ? (
          <div className="claim-done">
            <span className="claim-seal">认领</span>
            {myClaim.no != null ? (
              <>
                <span className="claim-no">这是第 {myClaim.no.toLocaleString()} 首被诗人认领的诗</span>
                <span className="claim-id">认领编号 #{myClaim.no}</span>
              </>
            ) : (
              <>
                <span className="claim-no">你已认领这首诗</span>
                <span className="claim-id">本次未联网 · 未取得编号</span>
              </>
            )}
            {badge && <span className={`claim-badge ${badge.tier}`}>✦ {badge.label}</span>}
            <span className="claim-sub">你从虚空里认下了它 —— 此刻它在此定位，化作流星，没入银河。</span>
            {myClaim.prizeKey && myClaim.no != null && (
              <div className="claim-prize">
                <span className="claim-prize-title">🎉 你中奖了 · 第 {myClaim.no.toLocaleString()} 位认领者</span>
                <div className="claim-prize-keyrow">
                  <code className="pi-idx claim-prize-key">{myClaim.prizeKey}</code>
                  <CopyButton text={myClaim.prizeKey} label="复制密钥" />
                </div>
                <span className="claim-prize-note">
                  凭此密钥在抖音 / 小红书 / B站 任一平台私信作者「世界第一裹凉皮」，可领取刘慈欣原著《诗云》实体书一本。密钥仅生成一次，请妥善保存 —— 它已同时存入本机「我的认领」。
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
            <button className="claim-btn" onClick={doClaim} disabled={claiming}>
              {claiming ? "认领中…" : "认领这首诗"}
            </button>
            {showTotal && <div className="claim-total">诗云中已有 {displayTotal!.toLocaleString()} 首诗被认领</div>}
            <div className="claim-note">
              即使这首诗前人已写过，你依然可以认领它 —— 认领只是一枚浪漫印记，不产生著作权、所有权或排他权。它会得到一个从 1 起算、全站唯一的认领编号，随即化作流星，没入银河。
            </div>
            <div className="claim-privacy">
              <strong>诗只留在你手中</strong>
              <span>诗文、预览和可逆的全集编号仅保存在此浏览器，本站不会自动上传，也不会放进公共流星。服务器只保存认领编号和服务器时间；诗歌链接仅写入浏览器 # 片段，不随网页请求进入服务器。只有你主动复制编号或分享链接时，接收方才会得到它。</span>
            </div>
          </>
        )}
      </div>

      <div className="poem-foot">
        {isFree
          ? `换行也写进了编号里 —— 这 ${selected.babelDigits} 位地址既定了字，也定了断句。`
          : `这首诗一直在诗云里，编号 ${selected.babelDigits} 位长 —— 地址几乎和诗本身一样长。`}
        <div className="poem-share">
          <ShareButton />
          <button className="cinema-btn" onClick={openCinema} title="把这首诗框成一张可截图分享的卡片（时间暂停）">
            留影
          </button>
          <button
            className={kept ? "cinema-btn shiyi on" : "cinema-btn shiyi"}
            onClick={toggleKeep}
            title={kept ? "已收进拾遗 · 点此移出（更多 → 拾遗 里可重新捞起）" : "把这首从虚空捞起的诗收进拾遗,稍后还能再找到它"}
          >
            {kept ? "已在拾遗 ✓" : "收进拾遗"}
          </button>
        </div>
      </div>
    </div>
  );
}
