// 诗云 Step-3 data pipeline (Werneror backbone, Simplified, no OpenCC).
// Reads all dynasty CSVs → emits charset + poet index + per-poet poems (bucketed).
// Run: node --max-old-space-size=4096 pipeline/build-data.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = "C:/corpus/Werneror-Poetry"; // external corpus clone (persists on this machine)
const OUT = fileURLToPath(new URL("../public/data", import.meta.url)); // this project's data dir

// raw 朝代 string → canonical dynasty key (must match src/data/dynasties.ts)
const DYN = {
  先秦: "xianqin",
  秦: "qinhan", 汉: "qinhan",
  魏晋: "weijin", 魏晋末南北朝初: "weijin",
  南北朝: "nanbeichao",
  隋: "sui", 隋末唐初: "tang",
  唐: "tang", 唐末宋初: "tang",
  宋: "song", 宋末金初: "song", 宋末元初: "song",
  辽: "liao",
  金: "jin", 金末元初: "jin",
  元: "yuan", 元末明初: "ming",
  明: "ming", 明末清初: "qing",
  清: "qing", 清末民国初: "jinxiandai", 清末近现代初: "jinxiandai",
  近现代: "jinxiandai", 近现代末当代初: "dangdai", 民国末当代初: "dangdai",
  当代: "dangdai",
};

// minimal RFC4180-ish CSV parser (handles quotes, "" escapes, embedded newlines)
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const HAN = /\p{Script=Han}/u;
const onlyHan = (s) => [...s].filter((c) => HAN.test(c)).join("");
const splitLines = (content) =>
  content.split(/[，。！？；、\s]+/).map(onlyHan).filter(Boolean);

const FORMS = [
  { id: "wujue", lines: 4, per: 5 },
  { id: "qijue", lines: 4, per: 7 },
  { id: "wulu", lines: 8, per: 5 },
  { id: "qilu", lines: 8, per: 7 },
];
function classifyForm(lines) {
  const f = FORMS.find((F) => F.lines === lines.length && lines.every((l) => [...l].length === F.per));
  return f ? f.id : "other";
}

// fast 32-bit FNV-1a → uint32
function fnv32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
// 8-hex poet id, bucketed by first 2 hex chars (256 buckets)
const poetId = (name, dyn) => fnv32(name + "|" + dyn).toString(16).padStart(8, "0");
// 2-hex content bucket (256 shards) for the first-line search index
const lineBucket = (s) => (fnv32(s) & 0xff).toString(16).padStart(2, "0");

// 赠诗 markers: title verbs that mark a poem dedicated/replying to another poet. The
// precision guard is that the text AFTER the marker must literally be a known poet NAME
// (so noisy markers like 和/送 can't fabricate edges from common words). Longest first.
const GIFT_MARKERS = [
  "奉和", "奉寄", "奉赠", "奉酬", "次韵", "次韵和", "和答", "酬答", "寄赠",
  "寄", "赠", "贈", "和", "酬", "答", "呈", "简", "簡", "怀", "懷", "忆", "憶",
  "送", "别", "別", "示", "谢", "謝", "贺", "賀", "挽", "悼", "哭",
];
const HONORIFIC = /^[大老君公侯郎中令丞卿使府监太少卫将军相王爷儿子弟兄翁叟生先]+/;
// non-person strings that collide with obscure poet names (places / roles / counters).
const GIFT_STOP = new Set([
  "钱塘","长安","洛阳","江南","江东","江上","西湖","金陵","扬州","成都","襄阳","山中","城南",
  "故人","主人","诸公","先生","使君","明府","山人","居士","道士","上人","长老","将军","刺史",
  "太守","二首","三首","四首","其二","其三","同年","友人","内子","小儿","幼子","门生","座主",
]);

const freq = new Map(); // char -> count
const poets = new Map(); // id -> {id,name,dynasty,dynastyRaw,count,poems:[]}
const lineIndex = new Map(); // ANY line -> [{p:poetId, i:poemIdx, t:title, f:form}] (content search)
const LINE_CAP = 6; // max poems indexed per identical line (avoid skew on ultra-common lines)
let total = 0;

// index every poem: charset freq, poet aggregation, and EVERY line (so any line is searchable —
// 疑是地上霜 → 静夜思, not just the opening).
function addPoem(title, author, dyn, dynRaw, lines) {
  if (lines.length === 0) return;
  for (const l of lines) for (const ch of l) freq.set(ch, (freq.get(ch) || 0) + 1);
  const id = poetId(author, dyn);
  let p = poets.get(id);
  if (!p) { p = { id, name: author, dynasty: dyn, dynastyRaw: dynRaw, count: 0, poems: [] }; poets.set(id, p); }
  p.count++;
  const f = classifyForm(lines);
  const poemIdx = p.poems.length;
  p.poems.push({ t: title || "", f, p: lines });
  total++;
  const seen = new Set(); // dedupe repeated lines within one poem
  for (const ln of lines) {
    if ([...ln].length < 4 || seen.has(ln)) continue;
    seen.add(ln);
    let arr = lineIndex.get(ln);
    if (!arr) { arr = []; lineIndex.set(ln, arr); }
    if (arr.length < LINE_CAP) arr.push({ p: id, i: poemIdx, t: title || "", f });
  }
}

console.log("reading CSVs from", SRC);
const files = readdirSync(SRC).filter((f) => f.endsWith(".csv"));
for (const file of files) {
  const rows = parseCSV(readFileSync(join(SRC, file), "utf8"));
  // header = 题目,朝代,作者,内容
  for (let r = 1; r < rows.length; r++) {
    const [title, dynRaw, author, content] = rows[r];
    if (!author || !content) continue;
    addPoem(title, author, DYN[dynRaw] || "unknown", dynRaw, splitLines(content));
  }
  console.log(`  ${file}: poems=${total} poets=${poets.size}`);
}

// ── 现代/当代 自由诗 (新诗): yuxqiu/modern-poetry contemporary set (Apache-2.0) — adds 徐志摩/
//    海子/北岛/顾城… that the classical corpus lacks. Free verse → form "other"; lines feed the
//    content-search index. 民国-era poets → 近现代 (matches Werneror), the rest → 当代. ──
const MODERN_JINXIANDAI = new Set([
  "徐志摩","闻一多","郭沫若","戴望舒","朱自清","冯至","卞之琳","何其芳","臧克家","林徽因","废名",
  "李金发","穆旦","郑敏","梁宗岱","刘半农","胡适","俞平伯","汪静之","冰心","宗白华","沈尹默",
  "刘大白","王独清","穆木天","殷夫","蒋光慈","田间","袁可嘉","杜运燮","陈梦家","朱湘","邵洵美",
  "鲁迅","周作人","艾青","纪弦","痖弦","郑愁予","周梦蝶","洛夫","余光中","覃子豪","方思",
]);
const MODERN = "C:/corpus/modern-poetry/China-modern-poetry/contemporary";
const ALLOW_NO_MODERN = process.env.ALLOW_NO_MODERN === "1";
// Resolve the modern file list FIRST. A missing clone is the dangerous case: the git-tracked
// poets.index.json already contains the 508 modern poets, so rebuilding WITHOUT them silently desyncs
// poems/+lines/ from the index (a modern poet then resolves to zero poems — the bug that hit a prior
// agent). Fail loud unless explicitly opted into a Werneror-only build via ALLOW_NO_MODERN=1.
let mfiles = [];
try {
  mfiles = readdirSync(MODERN).filter((f) => /^\d/.test(f) && f.endsWith(".json"));
} catch (e) {
  if (ALLOW_NO_MODERN) {
    console.warn("  modern corpus skipped (ALLOW_NO_MODERN=1):", e.message);
  } else {
    throw new Error(
      `modern corpus not found at ${MODERN} (${e.code || e.message}).\n` +
        `  → clone yuxqiu/modern-poetry there, OR set ALLOW_NO_MODERN=1 to build Werneror-only.\n` +
        `  Building without it would DESYNC poems/+lines/ from the git-tracked poets.index.json (+508 modern poets).`,
    );
  }
}
if (mfiles.length) {
  let mp = 0;
  for (const file of mfiles) {
    // JSON-parse errors here now propagate (fail loud on a corrupt modern file) instead of silently
    // dropping the whole modern set, as the old broad try/catch did.
    const arr = JSON.parse(readFileSync(join(MODERN, file), "utf8"));
    for (const poem of arr) {
      const author = (poem.author || "").trim();
      if (!author || !Array.isArray(poem.paragraphs)) continue;
      const lines = poem.paragraphs.map(onlyHan).filter(Boolean);
      const dyn = MODERN_JINXIANDAI.has(author) ? "jinxiandai" : "dangdai";
      addPoem((poem.title || "").trim(), author, dyn, "现代", lines);
      mp++;
    }
  }
  console.log(`  modern 新诗: poems=${mp} (total=${total} poets=${poets.size})`);
}

// charset ordered by desc frequency (ties by codepoint)
const chars = [...freq.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].codePointAt(0) - b[0].codePointAt(0))
  .map(([c]) => c);
const N = chars.length;

mkdirSync(join(OUT, "poems"), { recursive: true });

// charset.json
const charsStr = chars.join("");
let hh = 0x811c9dc5;
for (let i = 0; i < charsStr.length; i++) { hh ^= charsStr.charCodeAt(i); hh = Math.imul(hh, 0x01000193); }
writeFileSync(join(OUT, "charset.json"), JSON.stringify({ version: 1, n: N, hash: (hh >>> 0).toString(16), chars: charsStr }));

// poets.index.json (sorted by poemCount desc)
const clusterSize = (n) => Math.min(60, Math.max(2, +(2 + 1.4 * Math.sqrt(n)).toFixed(2)));
const index = [...poets.values()]
  .sort((a, b) => b.count - a.count)
  .map((p) => ({ id: p.id, name: p.name, dynasty: p.dynasty, poemCount: p.count, clusterSize: clusterSize(p.count) }));
writeFileSync(join(OUT, "poets.index.json"), JSON.stringify(index));

// poems bucketed by id[0:2] (256 buckets) -> {id: [{t,f,p}]}
const buckets = new Map();
for (const p of poets.values()) {
  const b = p.id.slice(0, 2);
  let obj = buckets.get(b);
  if (!obj) { obj = {}; buckets.set(b, obj); }
  obj[p.id] = p.poems;
}
// SKIP_HEAVY=1 reuses already-generated poems/+firstline/ (231+75 MB) to iterate fast on
// the lightweight gifts.json / manifest only.
const SKIP_HEAVY = !!process.env.SKIP_HEAVY;

// Write a poems bucket as ONE valid JSON object (so the whole-file fetch still works as a
// fallback) PLUS a byte-offset sidecar `{id:[off,len]}` so the frontend can HTTP **Range**-fetch
// just one poet's record (a few KB) instead of the whole ~0.9 MB bucket (egress saving, #12).
// `off`/`len` are BYTE offsets into the .json file; the sliced bytes [off, off+len) are exactly
// the poet's JSON value (`[{t,f,p},…]`), itself valid JSON — so the client JSON.parses the slice
// directly. body + idx are built in ONE pass so the offsets always match the bytes we write,
// regardless of V8's object-key ordering.
function writeBucket(b, obj) {
  const idx = {};
  let body = "{";
  let off = Buffer.byteLength(body, "utf8"); // bytes before the first key (= 1, the "{")
  let first = true;
  for (const id in obj) {
    const keyPart = (first ? "" : ",") + JSON.stringify(id) + ":";
    const val = JSON.stringify(obj[id]);
    const keyBytes = Buffer.byteLength(keyPart, "utf8");
    const valBytes = Buffer.byteLength(val, "utf8");
    idx[id] = [off + keyBytes, valBytes]; // byte offset + length of the VALUE (the poems array)
    body += keyPart + val;
    off += keyBytes + valBytes;
    first = false;
  }
  body += "}";
  writeFileSync(join(OUT, "poems", `${b}.json`), body);
  writeFileSync(join(OUT, "poems", `${b}.idx.json`), JSON.stringify(idx));
}
if (!SKIP_HEAVY) for (const [b, obj] of buckets) writeBucket(b, obj);

// ── content search index: lines/{2-hex content bucket}.json -> {line: [refs]} (ANY line) ──
mkdirSync(join(OUT, "lines"), { recursive: true });
const flBuckets = new Map();
for (const [ln, refs] of lineIndex) {
  const b = lineBucket(ln);
  let obj = flBuckets.get(b);
  if (!obj) { obj = {}; flBuckets.set(b, obj); }
  obj[ln] = refs;
}
if (!SKIP_HEAVY)
  for (const [b, obj] of flBuckets) writeFileSync(join(OUT, "lines", `${b}.json`), JSON.stringify(obj));

// ── 赠诗 network: parse titles for 寄/赠/和/次韵… + a known poet NAME → poet→poet edges ──
// name -> poets with that name (each {id, dynId, count}).
const DYN_ORDER = ["xianqin","qinhan","weijin","nanbeichao","sui","tang","wudai","song","liao","jin","yuan","ming","qing","jinxiandai","dangdai"];
const dynId = (k) => { const i = DYN_ORDER.indexOf(k); return i < 0 ? 99 : i; };
const byName = new Map();
for (const p of poets.values()) {
  let a = byName.get(p.name);
  if (!a) { a = []; byName.set(p.name, a); }
  a.push({ id: p.id, dynId: dynId(p.dynasty), count: p.count });
}

// 字号/别称 → 本名: famous, near-unambiguous studio-names (号 collide far less than 字). When a
// title names a poet by 号 (e.g. 晦庵 = 朱熹, 东坡 = 苏轼), redirect to the canonical poet —
// otherwise the 号 either collides with a 1-poem namesake or misses the famous target entirely.
const GIFT_ALIAS = {
  // 魏晋南北朝
  靖节:"陶渊明", 五柳先生:"陶渊明", 渊明:"陶渊明", 陶潜:"陶渊明",
  康乐:"谢灵运", 谢康乐:"谢灵运", 玄晖:"谢朓", 谢宣城:"谢朓",
  嗣宗:"阮籍", 叔夜:"嵇康", 太冲:"左思", 明远:"鲍照", 子山:"庾信", 庾子山:"庾信",
  // 唐
  太白:"李白", 青莲居士:"李白", 谪仙:"李白",
  少陵:"杜甫", 杜少陵:"杜甫", 杜工部:"杜甫", 老杜:"杜甫",
  乐天:"白居易", 香山居士:"白居易", 白香山:"白居易", 醉吟先生:"白居易",
  摩诘:"王维", 王右丞:"王维",
  退之:"韩愈", 昌黎:"韩愈", 韩昌黎:"韩愈", 韩文公:"韩愈",
  子厚:"柳宗元", 柳河东:"柳宗元", 柳柳州:"柳宗元",
  梦得:"刘禹锡", 刘宾客:"刘禹锡",
  义山:"李商隐", 玉谿生:"李商隐", 玉溪生:"李商隐", 樊南生:"李商隐",
  牧之:"杜牧", 樊川:"杜牧", 杜樊川:"杜牧", 小杜:"杜牧",
  长吉:"李贺", 昌谷:"李贺", 李长吉:"李贺",
  孟襄阳:"孟浩然", 达夫:"高适", 高常侍:"高适", 季凌:"王之涣",
  少伯:"王昌龄", 王江宁:"王昌龄", 岑嘉州:"岑参", 四明狂客:"贺知章",
  伯玉:"陈子昂", 陈拾遗:"陈子昂", 浪仙:"贾岛", 阆仙:"贾岛",
  东野:"孟郊", 孟东野:"孟郊", 飞卿:"温庭筠", 温八叉:"温庭筠", 仲初:"王建",
  文房:"刘长卿", 刘随州:"刘长卿", 君虞:"李益", 懿孙:"张继", 表圣:"司空图",
  韦苏州:"韦应物", 韦江州:"韦应物", 仲言:"何逊",
  鲁望:"陆龟蒙", 甫里先生:"陆龟蒙", 天随子:"陆龟蒙",
  // 五代
  重光:"李煜", 李后主:"李煜", 南唐后主:"李煜", 正中:"冯延巳", 端己:"韦庄",
  // 宋
  子瞻:"苏轼", 东坡:"苏轼", 东坡居士:"苏轼", 苏东坡:"苏轼", 坡仙:"苏轼",
  子由:"苏辙", 颍滨遗老:"苏辙", 苏栾城:"苏辙",
  明允:"苏洵", 老泉:"苏洵", 苏老泉:"苏洵",
  鲁直:"黄庭坚", 山谷:"黄庭坚", 山谷道人:"黄庭坚", 涪翁:"黄庭坚", 黄山谷:"黄庭坚",
  介甫:"王安石", 半山:"王安石", 临川先生:"王安石", 王荆公:"王安石", 荆公:"王安石",
  永叔:"欧阳修", 醉翁:"欧阳修", 六一居士:"欧阳修", 欧阳永叔:"欧阳修",
  务观:"陆游", 放翁:"陆游", 陆放翁:"陆游",
  幼安:"辛弃疾", 稼轩:"辛弃疾", 辛稼轩:"辛弃疾",
  易安:"李清照", 易安居士:"李清照", 李易安:"李清照",
  致能:"范成大", 石湖:"范成大", 石湖居士:"范成大", 范石湖:"范成大",
  廷秀:"杨万里", 诚斋:"杨万里", 杨诚斋:"杨万里",
  元晦:"朱熹", 晦庵:"朱熹", 晦翁:"朱熹", 紫阳:"朱熹", 考亭:"朱熹", 朱文公:"朱熹",
  去非:"陈与义", 简斋:"陈与义", 陈简斋:"陈与义",
  少游:"秦观", 淮海居士:"秦观", 秦淮海:"秦观",
  美成:"周邦彦", 清真:"周邦彦", 清真居士:"周邦彦", 周清真:"周邦彦",
  同叔:"晏殊", 晏元献:"晏殊", 叔原:"晏几道", 小山:"晏几道", 晏小山:"晏几道",
  耆卿:"柳永", 柳屯田:"柳永", 柳三变:"柳永", 希文:"范仲淹", 范文正:"范仲淹",
  尧夫:"邵雍", 康节:"邵雍", 安乐先生:"邵雍", 无咎:"晁补之", 归来子:"晁补之",
  方回:"贺铸", 贺梅子:"贺铸", 庆湖遗老:"贺铸", 改之:"刘过", 龙洲道人:"刘过", 梅溪:"史达祖",
  尧章:"姜夔", 白石:"姜夔", 白石道人:"姜夔", 姜白石:"姜夔",
  梦窗:"吴文英", 吴梦窗:"吴文英", 碧山:"王沂孙",
  公谨:"周密", 草窗:"周密", 周草窗:"周密",
  履善:"文天祥", 文山:"文天祥", 文文山:"文天祥", 文信国:"文天祥",
  圣俞:"梅尧臣", 宛陵:"梅尧臣", 梅宛陵:"梅尧臣",
  贡父:"刘攽", 后山:"陈师道", 陈后山:"陈师道", 茶山:"曾几", 曾茶山:"曾几", 石屏:"戴复古",
  // 金/元
  裕之:"元好问", 遗山:"元好问", 元遗山:"元好问", 仁近:"仇远",
  伯生:"虞集", 道园:"虞集", 邵庵先生:"虞集", 曼硕:"揭傒斯", 天锡:"萨都剌", 直斋:"萨都剌",
  // 明
  季迪:"高启", 青丘子:"高启", 青邱:"高启", 槎轩:"高启", 高青丘:"高启",
  伯虎:"唐寅", 子畏:"唐寅", 六如居士:"唐寅", 桃花庵主:"唐寅", 唐伯虎:"唐寅",
  元美:"王世贞", 凤洲:"王世贞", 弇州:"王世贞", 弇州山人:"王世贞",
  于鳞:"李攀龙", 沧溟:"李攀龙", 李沧溟:"李攀龙",
  徵仲:"文徵明", 衡山居士:"文徵明", 文衡山:"文徵明",
  希哲:"祝允明", 枝山:"祝允明", 祝枝山:"祝允明",
  献吉:"李梦阳", 空同:"李梦阳", 空同子:"李梦阳", 李空同:"李梦阳",
  仲默:"何景明", 大复:"何景明", 何大复:"何景明",
  阳明:"王守仁", 阳明子:"王守仁", 王阳明:"王守仁",
  用修:"杨慎", 升庵:"杨慎", 杨升庵:"杨慎", 震川:"归有光", 归震川:"归有光",
  中郎:"袁宏道", 石公:"袁宏道", 袁中郎:"袁宏道", 伯修:"袁宗道", 玉蟠:"袁宗道", 小修:"袁中道",
  友夏:"谭元春", 伯敬:"钟惺", 卧子:"陈子龙", 大樽:"陈子龙", 陈大樽:"陈子龙",
  景濂:"宋濂", 潜溪:"宋濂", 伯温:"刘基", 诚意伯:"刘基", 刘诚意:"刘基",
  // 清
  容若:"纳兰性德", 楞伽山人:"纳兰性德", 饮水词人:"纳兰性德", 纳兰容若:"纳兰性德",
  子才:"袁枚", 随园:"袁枚", 随园老人:"袁枚", 仓山居士:"袁枚",
  璱人:"龚自珍", 定盦:"龚自珍", 定庵:"龚自珍", 龚定庵:"龚自珍",
  贻上:"王士禛", 阮亭:"王士禛", 渔洋:"王士禛", 渔洋山人:"王士禛", 王渔洋:"王士禛",
  锡鬯:"朱彝尊", 竹垞:"朱彝尊", 朱竹垞:"朱彝尊",
  其年:"陈维崧", 迦陵:"陈维崧", 陈迦陵:"陈维崧", 梁汾:"顾贞观",
  牧斋:"钱谦益", 虞山:"钱谦益", 钱牧斋:"钱谦益", 梅村:"吴伟业", 骏公:"吴伟业", 吴梅村:"吴伟业",
  舒章:"李雯", 钝翁:"汪琬", 尧峰:"汪琬", 秋谷:"赵执信", 饴山:"赵执信",
  樊榭:"厉鹗", 厉樊榭:"厉鹗", 瓯北:"赵翼", 赵瓯北:"赵翼", 心余:"蒋士铨", 藏园:"蒋士铨",
  仲则:"黄景仁", 鹿菲子:"黄景仁", 黄仲则:"黄景仁", 涤生:"曾国藩", 默深:"魏源",
  伯严:"陈三立", 散原:"陈三立", 散原老人:"陈三立", 半塘:"王鹏运", 半塘老人:"王鹏运",
  夔笙:"况周颐", 蕙风:"况周颐", 叔问:"郑文焯", 大鹤山人:"郑文焯",
  彊村:"朱祖谋", 强村:"朱祖谋", 静安:"王国维", 观堂:"王国维",
};
const isKnown = (s) => byName.has(s) || s in GIFT_ALIAS;
// chars that legitimately END / follow a complete 2-char name: relations, counters, and the
// leading char of an official title/role. So 王巩(end) / 张籍水部 / 王巩二首 are accepted, but a
// truncated longer name (王介+甫, 张元+礼, 陈宗+谕) or surname+role (李道+士) is rejected.
const NAME_END = new Set([
  ..."兄弟姊妹翁叟丈郎公侯君卿氏见之韵作并同赴往行归还赋诗词书札时留别后其等",
  ..."二三四五六七八九十首篇章绝律古绝",
  ..."员中山道学舍补拾司刺太县长参博校正主录评大侍尚给秘著处居上法禅征使明少别判节观转提安经制宣枢翰谏起秀进尉丞簿",
]);
const isHan = (c) => c !== undefined && /[一-鿿]/.test(c);
// greedy-longest known/alias name at cs[start]; a bare 2-char name must be COMPLETE (followed by
// a name-ending char / punctuation / end) so a longer name or name+role isn't silently truncated.
function nameAt(cs, start) {
  for (const len of [4, 3, 2]) {
    if (start + len > cs.length) continue;
    const cand = cs.slice(start, start + len).join("");
    if (GIFT_STOP.has(cand) || !isKnown(cand)) continue;
    if (len === 2 && !(cand in GIFT_ALIAS)) {
      const next = cs[start + len];
      if (isHan(next) && !NAME_END.has(next)) continue; // looks mid-name → reject
    }
    return cand;
  }
  return null;
}
// find the dedicatee right after a marker (raw start, then after an honorific prefix, then +1).
function findName(after) {
  const win = [...after].slice(0, 8);
  let n = nameAt(win, 0);
  if (n) return n;
  const stripped = [...win.join("").replace(HONORIFIC, "")];
  if (stripped.length !== win.length) { n = nameAt(stripped, 0); if (n) return n; }
  return nameAt(win, 1);
}
// resolve a name (or 号/字 alias) to a poet id. Bare names: SAME dynasty only (precision — a bare
// namesake across dynasties is almost always a collision). Aliases: cross-dynasty allowed (the
// reference is unambiguous — a 清人 和东坡 really means 苏轼). Pick the most prolific match.
function resolveTarget(name, authorDynId, fromId) {
  const aliased = name in GIFT_ALIAS;
  const cands = byName.get(aliased ? GIFT_ALIAS[name] : name);
  if (!cands) return null;
  let best = null, bestCount = -1;
  for (const c of cands) {
    if (c.id === fromId) continue;
    if (!aliased && c.dynId !== authorDynId) continue;
    if (c.count > bestCount) { bestCount = c.count; best = c; }
  }
  return best ? best.id : null;
}
// One edge per DISTINCT recipient per poem (兼寄/兼简/兼呈 → multiple). Scan ALL markers and ALL
// their occurrences (no early break) so marker list-order can't drop the primary dedication.
const edgeW = new Map(); // "from|to" -> weight
for (const p of poets.values()) {
  const aDyn = dynId(p.dynasty);
  for (const poem of p.poems) {
    const title = poem.t;
    if (!title) continue;
    const targets = new Set();
    for (const mk of GIFT_MARKERS) {
      let from = 0, at;
      while ((at = title.indexOf(mk, from)) >= 0) {
        from = at + mk.length;
        const name = findName(title.slice(at + mk.length));
        if (name) { const to = resolveTarget(name, aDyn, p.id); if (to) targets.add(to); }
      }
    }
    for (const to of targets) {
      const key = p.id + "|" + to;
      edgeW.set(key, (edgeW.get(key) || 0) + 1);
    }
  }
}
const edges = [...edgeW.entries()]
  .map(([k, w]) => { const [from, to] = k.split("|"); return [from, to, w]; })
  .sort((a, b) => b[2] - a[2]);
writeFileSync(join(OUT, "gifts.json"), JSON.stringify({ version: 1, edgeCount: edges.length, edges }));

// dynasty poet counts
const dynCounts = {};
for (const p of poets.values()) dynCounts[p.dynasty] = (dynCounts[p.dynasty] || 0) + 1;

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  version: 3, n: N, poetCount: poets.size, poemCount: total,
  buckets: [...buckets.keys()].sort(),
  lineBuckets: [...flBuckets.keys()].sort(),
  giftEdges: edges.length,
  poemSidecar: !SKIP_HEAVY, // poems/{b}.idx.json byte-offset sidecars exist → frontend Range-fetches
  dynCounts,
}));
console.log(`\n诗句索引 lines=${lineIndex.size} buckets=${flBuckets.size}  赠诗 edges=${edges.length}`);

console.log(`\nDONE  poets=${poets.size}  poems=${total}  字库 N=${N}  buckets=${buckets.size}`);
console.log("dynasty poet counts:", dynCounts);
