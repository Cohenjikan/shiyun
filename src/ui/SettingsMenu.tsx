import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../state/store";
import { COARSE, WEAK } from "../three/detectQuality";
import { hasCloudInbox, submitFeedback } from "../state/feedback";
import { ShiyiViewer } from "./ShiyiViewer";
import { replayOnboarding } from "./Onboarding";

// in-page feedback box (collapsed → a single button; expanded → a textarea). Stored locally + (if
// VITE_FEEDBACK_ENDPOINT is set) POSTed to the server inbox, which the owner reads via the token GET.
// See state/feedback.ts. (The 5-tap-on-logo gesture now opens the developer tool, not a feedback viewer.)
function FeedbackBox() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  if (!open) {
    return (
      <button className="set-feedback-open" onClick={() => setOpen(true)}>反馈 · 提个建议或报个 bug</button>
    );
  }
  return (
    <div className="set-feedback">
      <textarea
        className="set-feedback-input"
        placeholder="有什么想法、发现的问题或建议？写在这里…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        spellCheck={false}
      />
      <div className="set-feedback-privacy">
        {hasCloudInbox
          ? "反馈正文会发送到诗云自有服务器，仅保存正文与接收时间；请勿填写手机号、证件、住址等个人信息。"
          : "当前反馈仅保存在此浏览器；请勿填写手机号、证件、住址等个人信息。"}
      </div>
      <div className="set-feedback-act">
        <button className="set-feedback-cancel" onClick={() => { setOpen(false); setText(""); setSent(false); }}>收起</button>
        <button
          className="set-feedback-send"
          disabled={!text.trim()}
          onClick={() => {
            if (submitFeedback(text)) {
              setText("");
              setSent(true);
              setTimeout(() => setSent(false), 2200);
            }
          }}
        >
          {sent ? "已提交 ✓ 谢谢" : "提交反馈"}
        </button>
      </div>
      {sent && <div className="set-feedback-ok">收到啦 —— 感谢你的反馈</div>}
    </div>
  );
}

// 开源致谢 — 诗云站在这些开源项目的肩上。点「开源致谢」弹出,逐一致谢渲染/工具链/语料,附链接与许可。
const CREDITS: { group: string; items: { name: string; url: string; note: string; lic: string }[] }[] = [
  {
    group: "渲染 · 前端",
    items: [
      { name: "three.js", url: "https://threejs.org", note: "WebGL 星空渲染", lic: "MIT" },
      { name: "@react-three/fiber", url: "https://github.com/pmndrs/react-three-fiber", note: "React × three.js 渲染器", lic: "MIT" },
      { name: "@react-three/drei", url: "https://github.com/pmndrs/drei", note: "R3F 辅助组件", lic: "MIT" },
      { name: "@react-three/postprocessing", url: "https://github.com/pmndrs/react-postprocessing", note: "UnrealBloom 辉光后期", lic: "MIT" },
      { name: "React", url: "https://react.dev", note: "界面框架", lic: "MIT" },
      { name: "Zustand", url: "https://github.com/pmndrs/zustand", note: "状态管理", lic: "MIT" },
    ],
  },
  {
    group: "构建 · 工具链",
    items: [
      { name: "Vite", url: "https://vitejs.dev", note: "构建 / 开发服务器", lic: "MIT" },
      { name: "TypeScript", url: "https://www.typescriptlang.org", note: "类型系统", lic: "Apache-2.0" },
      { name: "Vitest", url: "https://vitest.dev", note: "引擎往返测试", lic: "MIT" },
      { name: "opencc-js", url: "https://github.com/nk2028/opencc-js", note: "繁简转换 · 平水韵构建", lic: "MIT" },
      { name: "pinyin-pro", url: "https://github.com/zh-lx/pinyin-pro", note: "拼音 / 声调 · 格律构建", lic: "MIT" },
    ],
  },
  {
    group: "语料 · 数据",
    items: [
      { name: "Werneror/Poetry", url: "https://github.com/Werneror/Poetry", note: "全历代语料骨架 · 先秦→当代", lic: "MIT" },
      { name: "sheepzh/poetry", url: "https://github.com/sheepzh/poetry", note: "汉语现代诗歌语料库 · 现当代主层", lic: "MIT*" },
      { name: "yuxqiu/modern-poetry", url: "https://github.com/yuxqiu/modern-poetry", note: "现代新诗", lic: "Apache-2.0" },
      { name: "chinese_word_rhyme", url: "https://github.com/charlesix59/chinese_word_rhyme", note: "平水韵 · 声调 / 韵部", lic: "MIT" },
      { name: "chinese-poetry", url: "https://github.com/chinese-poetry/chinese-poetry", note: "唐宋语料 · 评估参考", lic: "MIT" },
    ],
  },
];

function Credits() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="set-link" onClick={() => setOpen(true)}>开源致谢</button>
      {open && createPortal((
        <div className="credits-overlay" onClick={() => setOpen(false)}>
          <div className="credits-card" onClick={(e) => e.stopPropagation()}>
            <div className="credits-head">
              <span>开源致谢 · 站在巨人的肩上</span>
              <button className="set-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </div>
            <p className="credits-intro">诗云由这些开源项目共同托起 —— 谨致谢忱。</p>
            {CREDITS.map((g) => (
              <div key={g.group} className="credits-group">
                <div className="credits-gtitle">{g.group}</div>
                <ul className="credits-list">
                  {g.items.map((it) => (
                    <li key={it.name}>
                      <a href={it.url} target="_blank" rel="noopener noreferrer">{it.name}</a>
                      <span className="credits-note">{it.note}</span>
                      <span className="credits-lic">{it.lic}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="credits-foot">
              * 现当代诗歌文本著作权归原作者所有,本站为非商业使用 · 灵感 · 刘慈欣《诗云》 · 博尔赫斯《巴别图书馆》
            </p>
            <section className="credits-legal" aria-label="用户协议、隐私与免责声明">
              <div className="credits-legal-title">宇宙最强免责协议书</div>
              <div className="credits-legal-sub">用户协议 · 隐私说明 · 版权与下架规则 · 2026-07-13 生效</div>

              <details open>
                <summary>一、认领与本地诗歌</summary>
                <p>认领是诗云中的浪漫化纪念，不是著作权登记、财产权凭证或排他性占有。同一文本可能被多人遇见或认领。诗文、预览与可逆全集编号只保存在你的浏览器；认领请求不携带请求正文，服务器只生成并保存全站认领编号与服务器时间，不保存第三个业务字段。发号默认且最高为 1,000,000 次，运营者可下调；达到上限后仍可留下本地纪念，但不再取得云端编号。公共流星只含认领编号与时间，不能点击、不能反查他人的诗。诗歌永久链接只使用不会随 HTTP 请求发送的 # 片段；只有你主动复制编号或分享链接时，接收方才会得到可逆地址。</p>
              </details>

              <details>
                <summary>二、隐私说明</summary>
                <p>个人信息处理者为诗云维护者 Cohenjikan，联系方式见本协议末尾。本站不设置广告追踪，不出售个人信息。拾遗、我的认领及其中的诗文地址使用浏览器 localStorage 保存，可通过清除本站数据删除。你主动提交反馈时，联网版本为接收、处理及回复反馈之目的，仅保存反馈正文与服务器接收时间；点击提交即表示你同意按上述方式处理该内容。请勿填写身份证号、手机号、住址、账户口令等非必要个人信息。</p>
                <p>反馈保存期限按“仍有处理该条反馈的必要”确定：处理完成、确认不再必要或收到有效删除请求后清理。网络主机/CDN 为完成传输、安全防护及履行法定义务，可能在必要期限内处理 IP、User-Agent 与访问日志，但它们不会写入诗云的认领或反馈业务账本。需要查询、更正、删除反馈或兑奖联系信息，可通过作者个人主页或项目 GitHub 联系。</p>
                <p>本站不以处理未满十四周岁未成年人的个人信息为目的。未满十四周岁的使用者请勿自行提交个人信息；确需反馈时应由监护人代为联系。如发现误收，将停止处理并删除。</p>
              </details>

              <details>
                <summary>三、版权、语料与下架</summary>
                <p>古典作品多数已进入公有领域；现当代作品、译文、整理成果及数据库中的具体文本仍可能受著作权保护。上游仓库的开源许可只在其有权许可的范围内有效，不当然替代原作者授权。本站以非商业文化展示、检索与技术研究为目的，不主张取得原作品权利，也不允许使用者借“认领”冒充作者或扩大传播受保护内容。</p>
                <p>权利人认为内容存在权属、署名或收录问题，可经作者主页或 GitHub 提交作品信息、权属说明与处理请求；核实后将及时更正、限制展示或移除相关正文及派生索引。</p>
              </details>

              <details>
                <summary>四、使用边界与法定责任</summary>
                <p>不得利用编号、反馈、认领或分享功能制作、编码、传播违法有害内容，不得刷号、攻击服务、冒用他人身份或侵害他人名誉、隐私、知识产权。服务按现状提供，星图坐标、语料完整性、持续可用性及永久链接不作绝对保证；因浏览器清理、设备更换、网络中断或必要的合规下架导致的本地记录或展示变化，请自行留存。</p>
                <p>这份“宇宙最强”协议不和法律硬刚：任何依法不得排除或限制的责任仍然承担，任何免责声明都不削减使用者、作者和权利人的法定权利。</p>
              </details>

              <div className="credits-legal-contact">
                联系与权利请求：<a href="https://cohenjikan.com" target="_blank" rel="noopener noreferrer">作者主页</a>
                <span> · </span>
                <a href="https://github.com/Cohenjikan/shiyun/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a>
              </div>
            </section>
          </div>
        </div>
      ), document.body)}
    </>
  );
}

// 诗云设置 menu — collects the 指引 / 行星 / 赠诗 / 引力 controls (moved out of the HUD top bar). Opened by
// the HUD 更多 button. 赠诗漫游 stays a separate panel (it only shows when 赠诗 is on). 恢复默认 = the
// app defaults (指引 一次性·优化·10s; 行星 关; 赠诗 关; 引力 开).
const GUIDE_MODES = [
  ["off", "不显示"],
  ["flash", "一次性"],
  ["hold", "常驻"],
] as const;

const GUIDE_STYLES = [
  ["plane", "平面坐标"],
  ["line", "直线(旧版)"],
] as const;

export function SettingsMenu() {
  const open = useStore((s) => s.settingsOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const guideMode = useStore((s) => s.guideMode);
  const setGuideMode = useStore((s) => s.setGuideMode);
  const guideCoverage = useStore((s) => s.guideCoverage);
  const setGuideCoverage = useStore((s) => s.setGuideCoverage);
  const guideSeconds = useStore((s) => s.guideSeconds);
  const setGuideSeconds = useStore((s) => s.setGuideSeconds);
  const guideBrightness = useStore((s) => s.guideBrightness);
  const setGuideBrightness = useStore((s) => s.setGuideBrightness);
  const guideStyle = useStore((s) => s.guideStyle);
  const setGuideStyle = useStore((s) => s.setGuideStyle);
  const resetGuide = useStore((s) => s.resetGuide);
  const showAllPoems = useStore((s) => s.showAllPoems);
  const toggleAllPoems = useStore((s) => s.toggleAllPoems);
  const showGifts = useStore((s) => s.showGifts);
  const toggleGifts = useStore((s) => s.toggleGifts);
  const gravity = useStore((s) => s.gravity);
  const toggleGravity = useStore((s) => s.toggleGravity);
  const freeMove = useStore((s) => s.freeMove);
  const setFreeMove = useStore((s) => s.setFreeMove);
  const allowRandomPoem = useStore((s) => s.allowRandomPoem);
  const toggleRandomPoem = useStore((s) => s.toggleRandomPoem);
  const meteorsOn = useStore((s) => s.meteorsOn);
  const toggleMeteors = useStore((s) => s.toggleMeteors);
  const shiyiCount = useStore((s) => s.shiyi.length);
  const openShiyi = useStore((s) => s.setShiyiOpen);
  const myClaimsCount = useStore((s) => s.myClaims.length);
  const openMyClaims = useStore((s) => s.setMyClaimsOpen);

  // DRAGGABLE (item 2): default below the top bar + left of the right-side panels (诗人/诗 panels), so it
  // never traps behind them — drag the header to move it anywhere and watch the effect live.
  // clamp the initial position into the viewport (a 360px default sits off-screen on a phone). On mobile
  // the responsive CSS overrides this into a bottom sheet via !important, so the inline x/y only matter on
  // desktop / tablet widths — but keep it on-screen there too.
  const [pos, setPos] = useState(() => ({
    x: Math.max(4, Math.min(360, (typeof window !== "undefined" ? window.innerWidth : 1200) - 312)),
    y: 56,
  }));
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      setPos({ x: Math.max(4, e.clientX - dragRef.current.ox), y: Math.max(4, e.clientY - dragRef.current.oy) });
    };
    const onUp = () => (dragRef.current = null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  if (!open) return null;

  const guideDefault = guideMode === "flash" && guideCoverage === "optimized" && guideSeconds === 10 && guideBrightness === 0.7 && guideStyle === "plane";
  const freeMoveDefault = !COARSE; // 触屏默认锁定整体,电脑默认自由移动
  const allDefault = guideDefault && !showAllPoems && !showGifts && gravity && allowRandomPoem && freeMove === freeMoveDefault && meteorsOn;
  const resetAll = () => {
    resetGuide();
    if (showAllPoems) toggleAllPoems();
    if (showGifts) toggleGifts();
    if (!gravity) toggleGravity();
    if (!allowRandomPoem) toggleRandomPoem();
    if (freeMove !== freeMoveDefault) setFreeMove(freeMoveDefault);
    if (!meteorsOn) toggleMeteors();
  };

  return (
    <div className="settings" style={{ left: pos.x, top: pos.y, right: "auto" }}>
      <div
        className="set-head drag"
        onPointerDown={(e) => {
          if (COARSE) return; // dragging is a no-op on the CSS-pinned mobile sheet → don't arm it
          dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
        }}
      >
        <span>更多 ⠿</span>
        <button className="set-close" onClick={toggleSettings} title="关闭">×</button>
      </div>

      <div className="set-group">
        <div className="set-label">行星指引线</div>
        <div className="set-row">
          <span className="set-sub">显示</span>
          <div className="seg">
            {GUIDE_MODES.map(([m, l]) => (
              <button key={m} className={guideMode === m ? "seg-btn on" : "seg-btn"} onClick={() => setGuideMode(m)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <span className="set-sub">样式</span>
          <div className="seg">
            {GUIDE_STYLES.map(([s, l]) => (
              <button
                key={s}
                className={guideStyle === s ? "seg-btn on" : "seg-btn"}
                onClick={() => setGuideStyle(s)}
                disabled={guideMode === "off"}
                title={s === "plane" ? "平面坐标式:两段折线(平面段+垂直段)+ 赤道参考环,更易读" : "直线·旧版:从诗人直射每首诗的光束"}
              >{l}</button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <span className="set-sub">覆盖</span>
          <div className="seg">
            <button className={guideCoverage === "all" ? "seg-btn on" : "seg-btn"} onClick={() => setGuideCoverage("all")} title="每首诗都连线,一首不漏">全部</button>
            <button className={guideCoverage === "optimized" ? "seg-btn on" : "seg-btn"} onClick={() => setGuideCoverage("optimized")} title="数量很大时跨全段采样,更流畅">优化</button>
          </div>
        </div>
        <div className="set-row">
          <span className="set-sub">时长</span>
          <input
            type="range"
            min={2}
            max={60}
            step={1}
            value={guideSeconds}
            disabled={guideMode !== "flash"}
            onChange={(e) => setGuideSeconds(Number(e.target.value))}
            className="set-slider"
          />
          <span className="set-val">{guideMode === "flash" ? `${guideSeconds}s` : guideMode === "hold" ? "常驻" : "—"}</span>
        </div>
        <div className="set-row">
          <span className="set-sub">亮度</span>
          <input
            type="range"
            min={0.2}
            max={2}
            step={0.05}
            value={guideBrightness}
            disabled={guideMode === "off"}
            onChange={(e) => setGuideBrightness(Number(e.target.value))}
            className="set-slider"
          />
          <span className="set-val">{guideBrightness.toFixed(2)}×</span>
        </div>
        <button className="set-reset" onClick={resetGuide} disabled={guideDefault}>指引恢复默认</button>
      </div>

      <div className="set-group">
        <div className="set-label">显示层</div>
        <label className="set-toggle" style={WEAK && !showAllPoems ? { opacity: 0.5 } : undefined}>
          <input
            type="checkbox"
            checked={showAllPoems}
            onChange={toggleAllPoems}
            disabled={WEAK && !showAllPoems}
          />
          {WEAK && !showAllPoems
            ? "行星 · 全部作品环绕（弱设备已禁用,避免卡死）"
            : "行星 · 全部诗人的作品环绕（建议高性能）"}
        </label>
        <label className="set-toggle">
          <input type="checkbox" checked={showGifts} onChange={toggleGifts} />
          赠诗网络 · 开启后左下出现「赠诗漫游」
        </label>
        <label className="set-toggle">
          <input type="checkbox" checked={gravity} onChange={toggleGravity} />
          引力 · 摄像机随星系自转,恒星好点选
        </label>
        <label className="set-toggle">
          <input type="checkbox" checked={meteorsOn} onChange={toggleMeteors} />
          流星 · 认领化作流星划过银河（今日认领更耀眼,仅作纪念、不可反查）
        </label>
      </div>

      <div className="set-group">
        <div className="set-label">漫游 · 交互</div>
        <label className="set-toggle">
          <input type="checkbox" checked={freeMove} onChange={() => setFreeMove(!freeMove)} />
          自由移动 · {COARSE ? "双指飞行漫游" : "WASD 飞行漫游"}（关闭则锁定诗云整体:{COARSE ? "双指缩放 / 单指转角度" : "拖动转角度 / 滚轮缩放"},点诗人或诗歌换锁定目标）
        </label>
        <label className="set-toggle">
          <input type="checkbox" checked={allowRandomPoem} onChange={toggleRandomPoem} />
          生成随机诗 · 点虚空拉一首随机诗（关闭后点虚空不再生成,只看现存的诗）
        </label>
        <button className="set-feedback-open" onClick={() => { toggleSettings(); replayOnboarding(); }}>
          重看新手引导
        </button>
      </div>

      <button className="set-reset wide" onClick={resetAll} disabled={allDefault}>全部恢复默认</button>

      {/* 拾遗 — 从虚空捞起的诗的私人收藏 (仅本机) */}
      <div className="set-group">
        <div className="set-label">拾遗</div>
        <button className="set-feedback-open" onClick={() => openShiyi(true)}>
          {shiyiCount > 0 ? `拾遗 — 我捞起的诗 · ${shiyiCount} 首` : "拾遗 — 我捞起的诗"}
        </button>
      </div>

      {/* 我的认领 — 我认下的诗 (仅本机的纪念册;全站编号在服务器永久) */}
      <div className="set-group">
        <div className="set-label">我的认领</div>
        <button className="set-feedback-open" onClick={() => openMyClaims(true)}>
          {myClaimsCount > 0 ? `我的认领 — 我认下的诗 · ${myClaimsCount} 首` : "我的认领 — 我认下的诗"}
        </button>
      </div>

      {/* 关于 + 页内反馈 (at the very bottom of 更多) */}
      <div className="set-group">
        <div className="set-label">关于 · 反馈</div>
        <div className="set-links">
          <a className="set-link" href="https://cohenjikan.com" target="_blank" rel="noopener noreferrer">个人主页 ↗</a>
          <a className="set-link" href="https://github.com/Cohenjikan" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
          <Credits />
        </div>
        <FeedbackBox />
      </div>

      {/* the 拾遗 revisit overlay — rendered while the 更多 menu stays open behind it (mirrors Credits) */}
      <ShiyiViewer />
    </div>
  );
}
