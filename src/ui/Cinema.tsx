import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { anyTextIndex } from "../engine/engineApi";
import { resolveCinemaPoem } from "./cinemaResolve";

// 留影(cinema) — a "share card" over the FROZEN scene (the store.cinema flag pauses spin + the void-pull /
// highlight lifecycles in the r3f layers), to guide a screenshot. The overlay itself is pointer-events:none
// EXCEPT its controls + the poem card, so you can still drag the camera through it to compose the shot, then
// screenshot. The poem sits in a RESIZABLE 字体槽 (text slot): drag it to move, drag the corner / pinch /
// wheel to resize the slot, and the poem AUTO-FITS inside — it 竖排-wraps to the slot's width and the font
// binary-searches to the largest size that fills the slot's height. Copy emphasises the 诗云 / 巴别图书馆
// concept; ‹ › cycle it.
const TAGLINES = [
  "一切可能的诗都已写就,藏在这片噪声的星海里。你刚刚,捞起了其中一首。",
  "在诗云里,杰作不被创作,只被找到——它本就在那里,等你给它一个编号。",
  "一个文明算尽了所有的字,写下了每一首可能的诗,却再也认不出哪首最美。而你,遇见了这一首。",
  "这首诗有一个住址,长达数十位——地址几乎和诗本身一样长。目录,即是图书馆。",
  "巴别图书馆收藏了一切可能的诗。这,是它的一件藏品。",
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const vw = () => (typeof window !== "undefined" ? window.innerWidth : 1280);
const vh = () => (typeof window !== "undefined" ? window.innerHeight : 800);
// 字体槽默认尺寸:占屏大半(改掉旧版"太保守"的小占位);clampSlot 限制在视口内的合理范围。
const initSlot = () => ({ w: Math.round(Math.min(vw() * 0.86, 1150)), h: Math.round(Math.min(vh() * 0.72, 780)) });
const clampSlot = (w: number, h: number) => ({ w: clamp(w, 220, vw() * 0.92), h: clamp(h, 150, vh() * 0.9) });

export function Cinema() {
  const cinema = useStore((s) => s.cinema);
  const close = useStore((s) => s.toggleCinema);
  const myClaims = useStore((s) => s.myClaims); // 认领分享卡: if the framed poem is claimed, stamp it
  const selected = useStore((s) => s.selected);
  const poet = useStore((s) => s.selectedPoet);
  const poems = useStore((s) => s.poetPoems);
  const focus = useStore((s) => s.poetFocus);
  const cinemaPoemIdx = useStore((s) => s.cinemaPoemIdx);
  const copyIdx = useStore((s) => s.cinemaCopy);
  const setCopy = useStore((s) => s.setCinemaCopy);
  const showBg = useStore((s) => s.cinemaShowBg);
  const toggleBg = useStore((s) => s.toggleCinemaBg);
  const textColor = useStore((s) => s.cinemaTextColor);
  const setTextColor = useStore((s) => s.setCinemaTextColor);
  const hideTagline = useStore((s) => s.cinemaHideTagline);
  const toggleTagline = useStore((s) => s.toggleCinemaTagline);
  const showHandle = useStore((s) => s.cinemaShowHandle);
  const toggleHandle = useStore((s) => s.toggleCinemaHandle);

  // composition state — resets each time 留影 opens (App mounts <Cinema/> only while `cinema` is true):
  // tx/ty = card position offset; slot = the 字体槽 size the poem auto-fits into.
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [slot, setSlot] = useState(initSlot);
  const [touched, setTouched] = useState(false); // hide the hint after the first interaction
  const [dragging, setDragging] = useState(false);
  const [setOpen, setSetOpen] = useState(false); // 留影设置子菜单展开
  // pointer tracking on the card: 1 pointer = drag-to-move, 2 pointers = pinch-to-resize the slot.
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStart = useRef<{ dist: number; w: number; h: number } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const poemRef = useRef<HTMLDivElement>(null);

  const resolved = cinema ? resolveCinemaPoem({ selected, poet, poems, focus, cinemaPoemIdx, indexer: anyTextIndex }) : null;
  const lines = resolved?.lines ?? null;
  const index = resolved?.index ?? null;
  const digits = resolved?.digits ?? 0;
  const attribution = resolved?.attribution ?? "";
  // 认领分享卡: the card becomes a sharable claim certificate when THIS poem is claimed on this device.
  const claim = index ? myClaims.find((c) => c.index === index && c.no != null) : undefined;

  // AUTO-FIT: pick the largest font-size at which the 竖排-wrapped poem fits the slot (width caps wrapping,
  // height is the binding constraint). Runs after every slot resize / poem change / 背景 toggle (padding).
  useLayoutEffect(() => {
    const poem = poemRef.current, box = slotRef.current;
    if (!poem || !box) return;
    const availW = box.clientWidth, availH = box.clientHeight;
    if (availW < 8 || availH < 8) return;
    let lo = 8, hi = 200, best = 8;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      poem.style.fontSize = mid + "px";
      if (poem.scrollWidth <= availW + 1 && poem.scrollHeight <= availH + 1) {
        best = mid;
        lo = mid;
      } else hi = mid;
    }
    poem.style.fontSize = best + "px";
  }, [slot.w, slot.h, index, showBg]);

  if (!cinema) return null;

  const n = TAGLINES.length;
  const tag = TAGLINES[((copyIdx % n) + n) % n];

  // ── card move + pinch-resize-slot ──
  const onPointerDown = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* non-active pointer id (rare) — drag still works via the bubbled events */
    }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setTouched(true);
    if (ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, w: slot.w, h: slot.h };
      dragStart.current = null; // pinch suspends single-finger drag
    } else {
      dragStart.current = { x: e.clientX, y: e.clientY, tx, ty };
      setDragging(true);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...ptrs.current.values()];
      const r = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinchStart.current.dist;
      setSlot(clampSlot(pinchStart.current.w * r, pinchStart.current.h * r)); // 双指捏合 = 调字体槽大小
    } else if (dragStart.current) {
      setTx(dragStart.current.tx + (e.clientX - dragStart.current.x));
      setTy(dragStart.current.ty + (e.clientY - dragStart.current.y));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchStart.current = null;
    if (ptrs.current.size === 1) {
      const [only] = [...ptrs.current.values()];
      dragStart.current = { x: only.x, y: only.y, tx, ty }; // re-arm move from the finger that remains
    } else if (ptrs.current.size === 0) {
      dragStart.current = null;
      setDragging(false);
    }
  };

  // ── corner handle: free-aspect slot resize (the slot is center-anchored, so each edge moves half the
  //    size change → ×2 the drag delta keeps the corner under the finger). Aspect drives how the poem folds. ──
  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    resizeStart.current = { x: e.clientX, y: e.clientY, w: slot.w, h: slot.h };
    setTouched(true);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeStart.current) return;
    e.stopPropagation();
    const dx = e.clientX - resizeStart.current.x, dy = e.clientY - resizeStart.current.y;
    setSlot(clampSlot(resizeStart.current.w + dx * 2, resizeStart.current.h + dy * 2));
  };
  const onResizeUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    resizeStart.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    setTouched(true);
    const f = e.deltaY < 0 ? 1.06 : 1 / 1.06;
    setSlot((s) => clampSlot(s.w * f, s.h * f)); // 滚轮 = 等比缩放字体槽
  };
  const grow = (f: number) => {
    setTouched(true);
    setSlot((s) => clampSlot(s.w * f, s.h * f));
  };
  const reset = () => {
    setTx(0);
    setTy(0);
    setSlot(initSlot());
    setTouched(false);
  };

  return (
    <div className="cinema">
      {!hideTagline && (
        <div className="cinema-tag">
          <button className="cinema-arrow" onClick={() => setCopy(copyIdx - 1)} aria-label="上一句">‹</button>
          <span className="cinema-tag-text">{tag}</span>
          <button className="cinema-arrow" onClick={() => setCopy(copyIdx + 1)} aria-label="下一句">›</button>
        </div>
      )}

      {/* 字体槽 缩放 / 复位(右上角,与左上角退出相对)。拖诗句本体可移动,拖右下角可改字体槽大小。 */}
      <div className="cinema-tools">
        <button className="cinema-tool" onClick={() => grow(1 / 1.12)} aria-label="字体槽缩小" title="字体槽缩小">−</button>
        <button className="cinema-tool" onClick={() => grow(1.12)} aria-label="字体槽放大" title="字体槽放大">+</button>
        <button className="cinema-tool" onClick={reset} aria-label="复位" title="复位居中 + 默认字体槽">⟲</button>
      </div>

      {lines && (
        <div
          className="cinema-card"
          style={{ transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`, cursor: dragging ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {/* 字体槽:固定 w×h 的框;诗句在内层 .cinema-clip(overflow:hidden)里竖排-折行 + 字号自适应填满。
              手柄是 slot 的直接子级(在 clip 之外),所以不会被裁掉;拖右下角手柄改框大小。 */}
          <div className="cinema-slot" ref={slotRef} style={{ width: slot.w, height: slot.h }}>
            <div className="cinema-clip">
              <div className={showBg ? "cinema-poem with-bg" : "cinema-poem"} ref={poemRef} lang="zh" style={{ color: textColor }}>
                {lines.map((l, i) => (
                  <div key={i} className="cinema-line">{l}</div>
                ))}
              </div>
            </div>
            {showHandle && (
              <div
                className="cinema-resize"
                onPointerDown={onResizeDown}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeUp}
                onPointerCancel={onResizeUp}
                title="拖动调整字体槽大小"
                aria-label="拖动调整字体槽大小"
              >
                ⤡
              </div>
            )}
          </div>
          <div className="cinema-attr">{attribution}</div>
          {index && (
            <div className="cinema-idx">
              <div className="cinema-idx-k">全集编号 · {digits} 位 · 它在诗云里的唯一住址</div>
              <div className="cinema-idx-num">{index}</div>
            </div>
          )}
          {claim && claim.no != null && (
            <div className="cinema-claim">
              <span className="cinema-claim-seal">认领</span>
              <span>这是第 {claim.no.toLocaleString()} 首被诗人认领的诗 · 认领编号 #{claim.no}</span>
            </div>
          )}
        </div>
      )}

      {lines && !touched && <div className="cinema-hint">拖动移动 · 滚轮 / 双指缩放字体槽 · 手柄在设置里开</div>}

      {/* 左下角统一设置按钮 → 点开子菜单:背景衬底(默认关) / 字体调色(无极) / 顶部文案 */}
      <div className="cinema-settings">
        {setOpen && (
          <div className="cinema-set-menu">
            <label className="cinema-set-row">
              <span>背景衬底</span>
              <input type="checkbox" checked={showBg} onChange={toggleBg} />
            </label>
            <label className="cinema-set-row">
              <span>字体颜色</span>
              <input
                type="color"
                className="cinema-color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                title="无极调色 · 拖动取任意颜色"
              />
            </label>
            <label className="cinema-set-row">
              <span>顶部文案</span>
              <input type="checkbox" checked={!hideTagline} onChange={toggleTagline} />
            </label>
            <label className="cinema-set-row">
              <span>调整手柄</span>
              <input type="checkbox" checked={showHandle} onChange={toggleHandle} />
            </label>
          </div>
        )}
        <button
          className={setOpen ? "cinema-set-btn on" : "cinema-set-btn"}
          onClick={() => setSetOpen((o) => !o)}
          title="留影设置"
          aria-label="留影设置"
          aria-expanded={setOpen}
        >
          ⚙ 设置
        </button>
      </div>

      <div className="cinema-brand">诗云 · Poetry Cloud</div>
      <button className="cinema-exit" onClick={close} title="退出留影">截好图 · 退出 ✕</button>
    </div>
  );
}
