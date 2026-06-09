import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { anyTextIndex } from "../engine/engineApi";

// 奇迹时刻 — a "share card" over the FROZEN scene (the store.cinema flag pauses spin + the void-pull /
// highlight lifecycles in the r3f layers), to guide a screenshot. The overlay itself is pointer-events:none
// EXCEPT its controls + the poem card, so you can still drag the camera through it to compose the shot, then
// screenshot. The poem card can be DRAGGED to reposition and pinch/wheel/±-zoomed to resize, so the user
// frames the poem wherever they like in the shot. Copy emphasises the 诗云 / 巴别图书馆 concept; ‹ › cycle it.
const TAGLINES = [
  "一切可能的诗都已写就,藏在这片噪声的星海里。你刚刚,捞起了其中一首。",
  "在诗云里,杰作不被创作,只被找到——它本就在那里,等你给它一个编号。",
  "一个文明算尽了所有的字,写下了每一首可能的诗,却再也认不出哪首最美。而你,遇见了这一首。",
  "这首诗有一个住址,长达数十位——地址几乎和诗本身一样长。目录,即是图书馆。",
  "巴别图书馆收藏了一切可能的诗。这,是它的一件藏品。",
];

const SCALE_MIN = 0.45;
const SCALE_MAX = 3.2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Cinema() {
  const cinema = useStore((s) => s.cinema);
  const close = useStore((s) => s.toggleCinema);
  const selected = useStore((s) => s.selected);
  const poet = useStore((s) => s.selectedPoet);
  const poems = useStore((s) => s.poetPoems);
  const focus = useStore((s) => s.poetFocus);
  const copyIdx = useStore((s) => s.cinemaCopy);
  const setCopy = useStore((s) => s.setCinemaCopy);

  // poem transform (composition): translate offset + scale. Local state — resets each time 奇迹时刻 opens,
  // because App mounts <Cinema/> only while `cinema` is true.
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const [touched, setTouched] = useState(false); // hide the drag hint after the first interaction
  const [dragging, setDragging] = useState(false);
  // pointer tracking: 1 pointer = drag-to-move, 2 pointers = pinch-to-resize.
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);

  if (!cinema) return null;

  // resolve the framed poem: a void pull (the purest 奇迹), else the selected poet's focused real poem.
  let lines: string[] | null = null;
  let index: string | null = null;
  let digits = 0;
  let attribution = "";
  if (selected) {
    lines = selected.lines;
    index = selected.babelIndex;
    digits = selected.babelDigits;
    attribution = "诗云 · 从虚空里捞起";
  } else if (poet && poems && focus && focus.poemIdx >= 0 && poems[focus.poemIdx]) {
    const pm = poems[focus.poemIdx];
    const a = anyTextIndex(pm.p);
    lines = pm.p;
    index = a?.index ?? null;
    digits = a?.digits ?? 0;
    attribution = `${poet.name}《${pm.t || "无题"}》`;
  }
  const n = TAGLINES.length;
  const tag = TAGLINES[((copyIdx % n) + n) % n];

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
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
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
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(clamp((pinchStart.current.scale * dist) / pinchStart.current.dist, SCALE_MIN, SCALE_MAX));
    } else if (dragStart.current) {
      setTx(dragStart.current.tx + (e.clientX - dragStart.current.x));
      setTy(dragStart.current.ty + (e.clientY - dragStart.current.y));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchStart.current = null;
    if (ptrs.current.size === 1) {
      // a finger lifted out of a pinch — re-arm drag from the one that remains
      const [only] = [...ptrs.current.values()];
      dragStart.current = { x: only.x, y: only.y, tx, ty };
    } else if (ptrs.current.size === 0) {
      dragStart.current = null;
      setDragging(false);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    setTouched(true);
    setScale((s) => clamp(s * (e.deltaY < 0 ? 1.08 : 1 / 1.08), SCALE_MIN, SCALE_MAX));
  };
  const zoom = (f: number) => {
    setTouched(true);
    setScale((s) => clamp(s * f, SCALE_MIN, SCALE_MAX));
  };
  const reset = () => {
    setTx(0);
    setTy(0);
    setScale(1);
    setTouched(false);
  };

  return (
    <div className="cinema">
      <div className="cinema-tag">
        <button className="cinema-arrow" onClick={() => setCopy(copyIdx - 1)} aria-label="上一句">‹</button>
        <span className="cinema-tag-text">{tag}</span>
        <button className="cinema-arrow" onClick={() => setCopy(copyIdx + 1)} aria-label="下一句">›</button>
      </div>

      {/* resize / reset controls (top-right, opposite the exit). Drag the poem itself to move it. */}
      <div className="cinema-tools">
        <button className="cinema-tool" onClick={() => zoom(1 / 1.15)} aria-label="缩小" title="缩小">－</button>
        <button className="cinema-tool" onClick={() => zoom(1.15)} aria-label="放大" title="放大">＋</button>
        <button className="cinema-tool" onClick={reset} aria-label="复位" title="复位居中">⟲</button>
      </div>

      {lines && (
        <div
          className="cinema-card"
          style={{
            transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${scale})`,
            cursor: dragging ? "grabbing" : "grab",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {/* classical 竖排: each line is a column, columns flow RIGHT→LEFT (writing-mode in CSS) so a
              long poem spreads sideways instead of getting clipped at the bottom. */}
          <div className="cinema-poem" lang="zh">
            {lines.map((l, i) => (
              <div key={i} className="cinema-line">{l}</div>
            ))}
          </div>
          <div className="cinema-attr">{attribution}</div>
          {index && (
            <div className="cinema-idx">
              <div className="cinema-idx-k">全集编号 · {digits} 位 · 它在诗云里的唯一住址</div>
              <div className="cinema-idx-num">{index}</div>
            </div>
          )}
        </div>
      )}

      {lines && !touched && <div className="cinema-hint">拖动诗句移动 · 滚轮 / 双指缩放</div>}

      <div className="cinema-brand">诗云 · Poetry Cloud</div>
      <button className="cinema-exit" onClick={close} title="退出奇迹时刻">截好图 · 退出 ✕</button>
    </div>
  );
}
