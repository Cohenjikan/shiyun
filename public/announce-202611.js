/* 诗云 · 2026 年 11 月更新公告横幅 — announce-202611.js
 *
 * 随新版 dist 一起发布(public/ → dist 根目录),由 index.html 里一行 <script defer> 加载。
 * 结构沿用 announce-202607.js:纯 ES5、单个 IIFE、全身 try/catch——横幅出任何岔子都必须静默,
 * 绝不能影响主站。文案逐字取自 docs/devlog/ANNOUNCE-2026-11.md(owner 2026-11-10 定稿);
 * 改文案先改母本,再改这里,并换新文件名(Cloudflare 会边缘缓存 .js)。
 */
(function () {
  try {
    var BAR_ID = "shiyun-announce-202611";
    if (document.getElementById(BAR_ID)) return; // 幂等:重复加载只出一条横幅
    var STYLE_ID = "shiyun-announce-202611-style";
    var HUD_VAR = "--shiyun-ann-h"; // 横幅实测高度,喂给注入样式把顶栏/搜索框整体下推
    var SEEN_KEY = "shiyun_announce_202611"; // localStorage 记「知道了」;隐私模式读写会抛,全包 try/catch
    // 过期自杀:北京时间 2027-01-01 00:00(= 2026-12-31T16:00:00Z)之后一律不渲染。
    var EXPIRE_MS = Date.UTC(2026, 11, 31, 16, 0, 0); // 月份 0 基,11 = 十二月

    if (window.__SHIYUN_UNSUPPORTED__) return; // capability gate 判定跑不动主站 → 不叠横幅
    try {
      if (window.localStorage && localStorage.getItem(SEEN_KEY) === "1") return;
    } catch (e) {}
    if (Date.now() > EXPIRE_MS) return;

    var GOLD = "#ffdf9e";
    var DIM = "#b3a988";
    function tx(node, s) { node.appendChild(document.createTextNode(s)); }
    function em(node, s, color) {
      var e = document.createElement("strong");
      e.textContent = s;
      e.style.cssText = "font-weight:700" + (color ? ";color:" + color : "");
      node.appendChild(e);
      return e;
    }

    var bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "诗云更新公告");
    // z-index 9998 低于主站字库告警的 9999;pointer-events:none 让空白区点击穿透到顶栏,
    // 只在 row / detail 上重新打开 auto(原因详见 announce-202607.js 同处注释)。
    bar.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:9998", "box-sizing:border-box",
      "pointer-events:none", "padding:calc(9px + env(safe-area-inset-top)) 14px 9px",
      "background:rgba(7,8,15,0.94)", "border-bottom:1px solid rgba(216,200,154,0.28)", "color:#d8c89a",
      "font:13px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      "-webkit-backdrop-filter:blur(6px)", "backdrop-filter:blur(6px)"
    ].join(";");

    var row = document.createElement("div");
    row.style.cssText =
      "pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;max-width:960px;margin:0 auto";
    var line = document.createElement("span");
    line.style.cssText = "flex:1 1 220px;min-width:0";
    em(line, "诗云更新", GOLD);
    tx(line, "：修订了一些已知问题，详情请展开；欢迎大家继续反馈问题。");

    function mkBtn(label) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = [
        "flex:0 0 auto", "cursor:pointer", "padding:6px 12px",
        "font:13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif", "color:#d8c89a",
        "background:transparent", "border:1px solid rgba(216,200,154,0.45)", "border-radius:6px", "white-space:nowrap"
      ].join(";");
      return b;
    }
    var detailBtn = mkBtn("查看详情");
    var okBtn = mkBtn("知道了");
    row.appendChild(line);
    row.appendChild(detailBtn);
    row.appendChild(okBtn);

    var detail = document.createElement("div");
    detail.style.cssText = [
      "display:none", "pointer-events:auto", "max-width:960px", "margin:10px auto 2px", "max-height:60vh",
      "overflow-y:auto", "line-height:1.7", "color:#c8bd9c", "border-top:1px solid rgba(216,200,154,0.18)",
      "padding-top:10px"
    ].join(";");
    function mkP(color, size) {
      var p = document.createElement("p");
      p.style.cssText = "margin:0 0 10px" + (size ? ";font-size:" + size : "") + (color ? ";color:" + color : "");
      detail.appendChild(p);
      return p;
    }
    function heading(s) {
      var h = mkP();
      h.style.margin = "4px 0 4px";
      em(h, s, GOLD);
    }
    function list(items) {
      var ul = document.createElement("ul");
      ul.style.cssText = "margin:0 0 10px;padding-left:1.3em";
      for (var i = 0; i < items.length; i++) {
        var li = document.createElement("li");
        li.style.cssText = "margin:0 0 3px";
        li.textContent = items[i];
        ul.appendChild(li);
      }
      detail.appendChild(ul);
    }

    heading("寻诗更好用了");
    tx(mkP(), "输入一个字，比如「青」，会列出含这个字的诗句，可以一直往下翻，适合给名字找字；输入两个字，比如「青云」，会找出这两个字连在一起的句子。词牌加副题的诗，只搜副题也能找到，比如「寻春服感念」。");

    heading("勘误（谢谢大家的反馈）");
    list([
      "李煜、李璟、冯延巳等五代十国诗人，现在标为「五代十国」（如「五代十国·南唐」），朝代筛选里可以单独选。他们在星图上的位置和链接都没变。",
      "补上了纳兰性德《于中好·送梁汾南还为题小影》（握手西风泪不干）。",
      "赠诗网络去掉了 65 条错连。诗题里「周密学」「李中丞」这类称呼是「姓 + 官衔」，之前被误认成了同名诗人。比如司马光《送周密学真定安抚使》是写给周沆的，不是写给周密的。"
    ]);

    heading("新设置");
    tx(mkP(), "「更多」里可以隐藏星图上的诗人名字。诗人详情和搜索结果里仍会显示作者。");

    heading("小修复");
    list([
      "用输入法打字时按回车选字，不会再误跳到别的诗。",
      "开始新的搜索时会先清掉上一轮结果，按回车不会跳到上一轮的诗。",
      "探诗里切换「填字 → 编号」和「凭编号 → 诗」时，会重新计算结果。",
      "分享链接被聊天软件截断或转义坏了，打开也不会报错。",
      "复制失败时会弹出一个可以手动复制的框。",
      "没有拿到全站编号的认领，改为显示「仅本机认领」。"
    ]);
    tx(mkP(DIM, "12.5px"), "以上六项修复由 LouieTang（GitHub：MrTangLuyao）提交，特此感谢。");

    heading("关于投稿");
    tx(mkP(), "收到不少朋友留言，想把自己写的诗放进诗云。这些留言都看到了，我们正在认真考虑怎样做才稳妥。为遵守相关法律法规，目前还没有开放计划。如果你觉得投稿功能对你很有意义，欢迎在反馈里说说。");

    heading("不受影响");
    tx(mkP(), "你的拾遗、认领，以及分享出去的诗和诗人链接，都照常可用。");

    var acctP = mkP(DIM, "12.5px");
    tx(acctP, "更多细节欢迎关注作者视频账号「");
    em(acctP, "世界第一裹凉皮");
    tx(acctP, "」。（抖音/小红书/B站/微博/视频号）");

    bar.appendChild(row);
    bar.appendChild(detail);

    // ── 占位:把主站固定顶栏 .hud-top 与搜索框 .search 整体下推横幅高度(同 07 期) ──
    var ro = null;
    function syncHeight() {
      try { document.documentElement.style.setProperty(HUD_VAR, (bar.offsetHeight || 0) + "px"); } catch (e) {}
    }
    function reserveSpace() {
      try {
        if (!document.getElementById(STYLE_ID)) {
          var st = document.createElement("style");
          st.id = STYLE_ID;
          st.textContent =
            ".hud-top{top:var(" + HUD_VAR + ",0px)!important}" +
            ".search{top:calc(64px + var(" + HUD_VAR + ",0px))!important}" +
            "@media (max-width:600px){.search{top:calc(var(--hud-h,104px) + 8px + var(" +
            HUD_VAR + ",0px))!important}}";
          (document.head || document.documentElement).appendChild(st);
        }
        syncHeight();
        if (typeof ResizeObserver !== "undefined" && !ro) {
          ro = new ResizeObserver(syncHeight);
          ro.observe(bar);
        }
      } catch (e) {}
    }
    function releaseSpace() {
      try { if (ro) { ro.disconnect(); ro = null; } } catch (e) {}
      try { document.documentElement.style.setProperty(HUD_VAR, "0px"); } catch (e) {}
      try {
        var st = document.getElementById(STYLE_ID);
        if (st && st.parentNode) st.parentNode.removeChild(st);
      } catch (e) {}
    }

    var expanded = false;
    detailBtn.onclick = function () {
      expanded = !expanded;
      detail.style.display = expanded ? "block" : "none";
      detailBtn.textContent = expanded ? "收起" : "查看详情";
      syncHeight();
    };
    okBtn.onclick = function () {
      releaseSpace();
      try { if (bar.parentNode) bar.parentNode.removeChild(bar); } catch (e) {}
      try { if (window.localStorage) localStorage.setItem(SEEN_KEY, "1"); } catch (e) {}
      try {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", syncHeight);
        window.removeEventListener("load", syncHeight);
      } catch (e) {}
    };

    // H 键:主站 H 是「隐藏界面」快捷键,横幅跟随显隐;焦点在输入框/可编辑区时忽略。
    function onKey(ev) {
      try {
        if (!ev || (ev.key !== "h" && ev.key !== "H")) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        var t = ev.target;
        if (t) {
          var tag = (t.tagName || "").toLowerCase();
          if (tag === "input" || tag === "textarea" || t.isContentEditable) return;
        }
        bar.style.visibility = bar.style.visibility === "hidden" ? "visible" : "hidden";
      } catch (e) {}
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", syncHeight);
    if (document.readyState !== "complete") window.addEventListener("load", syncHeight);

    function mount() {
      try {
        if (document.body) {
          document.body.appendChild(bar);
          reserveSpace();
        }
      } catch (e) {}
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
  } catch (e) {
    // 任何异常一律吞掉:横幅可以不出现,主站不能因它受影响。
  }
})();
