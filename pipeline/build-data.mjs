// 诗云 Step-3 data pipeline (Werneror backbone, Simplified, no OpenCC).
// Reads all dynasty CSVs → emits charset + poet index + per-poet poems (bucketed).
// Run: node --max-old-space-size=4096 pipeline/build-data.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseCanonicalBucket, resolveZone } from "./canonicalRules.mjs";

const SRC = process.env.WERNEROR_DIR || "C:/corpus/Werneror-Poetry"; // Werneror/Poetry clone (MIT). Override path via WERNEROR_DIR.
const OUT = fileURLToPath(new URL("../public/data", import.meta.url)); // this project's data dir

// ── 字库 FREEZE (production contract) ──────────────────────────────────────────────────────────
// 诗云 is LIVE: every shared 编号 permalink encodes a poem in radix N+1 over the SHIPPED charset,
// and the charset's ORDER defines each char's symbol id. ANY change to the charset's content or
// order remaps the whole poem↔number bijection and silently breaks every link users have shared.
// So by default the charset is FROZEN: we read the existing public/data/charset.json, re-emit it
// BYTE-IDENTICAL, and SKIP any poem that contains a char outside it (only newly added sources can
// trigger skips — the original sources are what defined the set; a skip from a legacy source means
// upstream drifted and is loudly warned). To intentionally re-derive the charset (a deliberate,
// permalink-breaking major version), run with REFLOW_CHARSET=1.
const REFLOW_CHARSET = process.env.REFLOW_CHARSET === "1";
const USE_CORPUS = process.env.CORPUS_SOURCE === "shiyun-corpus"; // 换源: ingest shiyun-corpus instead of raw C:/corpus
const CORPUS_DIR = process.env.SHIYUN_CORPUS_DIR || "C:/Users/Cohen/Desktop/shiyun-corpus/data";
const CORPUS_MAX = +(process.env.CORPUS_MAX || 0); // smoke-test cap on corpus poems (0 = no cap)
// CJK Unified Ideographs basic block — the principled "all standard modern Chinese" alphabet
// (锂/钠/镁/全元素/方言…). On REFLOW the new charset includes the WHOLE block so any real char is addressable.
const CJK_BASIC = [];
for (let cp = 0x4e00; cp <= 0x9fff; cp++) CJK_BASIC.push(String.fromCodePoint(cp));
let frozenRaw = null;   // exact bytes of the existing charset.json (re-emitted verbatim when frozen)
let frozenSet = null;   // Set<char> for the skip filter (only when NOT reflowing)
let existingChars = []; // current charset chars — a SUPERSET floor on REFLOW (never drop an in-use char)
try {
  frozenRaw = readFileSync(join(OUT, "charset.json"), "utf8");
  existingChars = [...JSON.parse(frozenRaw).chars];
  if (!REFLOW_CHARSET) {
    frozenSet = new Set(existingChars);
    console.log(`charset FROZEN: N=${frozenSet.size} (REFLOW_CHARSET=1 to re-derive — breaks all permalinks)`);
  } else {
    console.log(`REFLOW_CHARSET=1: re-deriving charset = SUPERSET(existing ${existingChars.length} ∪ corpus ∪ CJK基本块 ${CJK_BASIC.length}) — breaks all permalinks`);
  }
} catch {
  console.warn("no existing charset.json — deriving fresh (first build)");
}
let currentSource = "werneror"; // tag for per-source skip stats
const skippedByCharset = new Map(); // source -> count

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
const nfc = (s) => (s || "").normalize("NFC"); // fold compatibility ideographs (U+F9xx→canonical) before indexing
const onlyHan = (s) => [...nfc(s)].filter((c) => HAN.test(c)).join("");
const splitLines = (content) =>
  nfc(content).split(/[，。！？；、\s]+/).map(onlyHan).filter(Boolean);

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
  if (frozenSet) {
    // frozen-charset gate: a poem with ANY out-of-字库 char is skipped whole (dropping single chars
    // would corrupt the poem text; skipping keeps N + every existing 编号 permalink stable).
    for (const l of lines) {
      for (const ch of l) {
        if (!frozenSet.has(ch)) {
          skippedByCharset.set(currentSource, (skippedByCharset.get(currentSource) || 0) + 1);
          return;
        }
      }
    }
  }
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

if (!USE_CORPUS) console.log("reading CSVs from", SRC);
const files = USE_CORPUS ? [] : readdirSync(SRC).filter((f) => f.endsWith(".csv"));
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
// ⚠ POET-ID STABILITY: poetId = fnv32(name|dynasty), so a poet's `#a=<id>` permalink AND star-cluster
// position depend on this dynasty bucket. Adding a name here flips an EXISTING poet dangdai→jinxiandai,
// changing their id and silently breaking shared links + moving their cluster. So this set is FROZEN at
// the v1 membership — do NOT add names (a v2 attempt added 20 民国 names and moved 17 live poets; reverted).
// The cost of NOT adding them is only that those sheepzh 民国 poets sit in 当代 instead of 近现代 — a
// cosmetic dynasty-shell nicety that is not worth breaking a single shared permalink.
const MODERN_JINXIANDAI = new Set([
  "徐志摩","闻一多","郭沫若","戴望舒","朱自清","冯至","卞之琳","何其芳","臧克家","林徽因","废名",
  "李金发","穆旦","郑敏","梁宗岱","刘半农","胡适","俞平伯","汪静之","冰心","宗白华","沈尹默",
  "刘大白","王独清","穆木天","殷夫","蒋光慈","田间","袁可嘉","杜运燮","陈梦家","朱湘","邵洵美",
  "鲁迅","周作人","艾青","纪弦","痖弦","郑愁予","周梦蝶","洛夫","余光中","覃子豪","方思",
]);
// modern-poem dedup across sources (yuxqiu ships first and is PRESERVED verbatim — its poems keep
// their existing per-poet order/idx; sheepzh then adds only poems whose CONTENT wasn't seen).
const modernSeen = new Map(); // poetId -> Set<content key>
const modernKey = (lines) => lines.join("\n");
const recordModern = (id, lines) => {
  let s = modernSeen.get(id);
  if (!s) { s = new Set(); modernSeen.set(id, s); }
  s.add(modernKey(lines));
};
const MODERN = process.env.MODERN_DIR || "C:/corpus/modern-poetry/China-modern-poetry/contemporary"; // yuxqiu/modern-poetry clone (Apache-2.0). Override via MODERN_DIR.
const ALLOW_NO_MODERN = process.env.ALLOW_NO_MODERN === "1";
// Resolve the modern file list FIRST. A missing clone is the dangerous case: the git-tracked
// poets.index.json already contains the 508 modern poets, so rebuilding WITHOUT them silently desyncs
// poems/+lines/ from the index (a modern poet then resolves to zero poems — the bug that hit a prior
// agent). Fail loud unless explicitly opted into a Werneror-only build via ALLOW_NO_MODERN=1.
let mfiles = [];
if (!USE_CORPUS) try {
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
  currentSource = "yuxqiu";
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
      recordModern(poetId(author, dyn), lines); // so sheepzh below won't re-add the same poem
      mp++;
    }
  }
  console.log(`  modern 新诗 (yuxqiu): poems=${mp} (total=${total} poets=${poets.size})`);
}

// ── 现代诗 v2: sheepzh/poetry 汉语现代诗歌语料库 (~3.5k poets / ~82k poems). Layout:
//    data/<作者>_<拼音>/<诗名>.pt ; .pt = "title:…\ndate:…\n\n<body lines>" (UTF-8).
//    Tooling MIT; the poem TEXTS remain author-copyrighted, repo README: 非商用 — same exposure
//    class as the existing yuxqiu modern layer; recorded in DATA_CONTRACT/credits.
//    Charset-frozen gate above guarantees this import cannot change N or any existing 编号. ──
const SHEEPZH = process.env.SHEEPZH_DIR || "C:/corpus/sheepzh-poetry/data"; // sheepzh/poetry clone. Override via SHEEPZH_DIR.
const ALLOW_NO_SHEEPZH = process.env.ALLOW_NO_SHEEPZH === "1";
// author folders are community-contributed; keep only plain Han names (+ ethnic-name middle dot)
// to drop handle/junk folders like 666_666, Apple_apple, AT_at.
const HAN_AUTHOR = /^[㐀-䶿一-鿿·]{1,8}$/;
let sdirs = [];
if (!USE_CORPUS) try {
  sdirs = readdirSync(SHEEPZH, { withFileTypes: true }).filter((d) => d.isDirectory());
} catch (e) {
  if (ALLOW_NO_SHEEPZH) {
    console.warn("  sheepzh corpus skipped (ALLOW_NO_SHEEPZH=1):", e.message);
  } else {
    throw new Error(
      `sheepzh corpus not found at ${SHEEPZH} (${e.code || e.message}).\n` +
        `  → git clone https://github.com/sheepzh/poetry C:/corpus/sheepzh-poetry\n` +
        `    (on Windows: git -C C:/corpus/sheepzh-poetry config core.longpaths true && git restore --source=HEAD :/ )\n` +
        `  OR set ALLOW_NO_SHEEPZH=1 to build without it (DESYNCS poems/ from a v2 poets.index.json).`,
    );
  }
}
if (sdirs.length) {
  currentSource = "sheepzh";
  let sp = 0, sDup = 0, sBadName = 0, sNoBody = 0;
  for (const d of sdirs) {
    const cut = d.name.lastIndexOf("_"); // 诗人名_拼音 — names may themselves contain none
    const author = cut > 0 ? d.name.slice(0, cut) : d.name;
    if (!HAN_AUTHOR.test(author)) { sBadName++; continue; }
    const dyn = MODERN_JINXIANDAI.has(author) ? "jinxiandai" : "dangdai";
    const id = poetId(author, dyn);
    let pts;
    try { pts = readdirSync(join(SHEEPZH, d.name)).filter((f) => f.endsWith(".pt")); } catch { continue; }
    for (const f of pts) {
      let raw;
      try { raw = readFileSync(join(SHEEPZH, d.name, f), "utf8"); } catch { continue; } // odd-name files
      const rows = raw.split(/\r?\n/);
      let title = f.slice(0, -3);
      let bodyStart = 0;
      if (rows[0]?.startsWith("title:")) { title = rows[0].slice(6).trim() || title; bodyStart = 1; }
      if (rows[bodyStart]?.startsWith("date:")) bodyStart++;
      const lines = rows.slice(bodyStart).map(onlyHan).filter(Boolean);
      if (!lines.length) { sNoBody++; continue; }
      const key = modernKey(lines);
      const seen = modernSeen.get(id);
      if (seen && seen.has(key)) { sDup++; continue; } // already shipped via yuxqiu (or an earlier file)
      const before = total;
      addPoem(title, author, dyn, "现代", lines);
      if (total > before) { recordModern(id, lines); sp++; } // not skipped by the charset gate
    }
  }
  console.log(
    `  modern 新诗 v2 (sheepzh): poems=+${sp} dup=${sDup} junk-folders=${sBadName} empty=${sNoBody} ` +
      `charset-skipped=${skippedByCharset.get("sheepzh") || 0} (total=${total} poets=${poets.size})`,
  );
}

// ── 换源: shiyun-corpus JSONL (public + _restricted) — provenance/genre-annotated, 诗云-aligned poetId ──
// canonical 别名层 (G2, corpus 已在 G1 落地标注): corpus 是数据层全保留 (Wikidata 模式 — 重复/组诗总题合并行
// 一行不删,只加字段), 但诗云是统计/浏览层,只走正身。缺省(无 canonical 字段) = canonical = true. 一行只会有
// canonical_id (精确重复 → 指向正身诗行 id) 或 canonical_note (组诗总题合并行) 恰居其一 — 两者都表示"此行
// 不计入诗云统计", 排除只判 canonical===false; canonical_id 另被记录用于 AUTO 别名 (下方 chooseCanonicalBucket)。
let cSkipped = 0;
// AUTO-alias bookkeeping (see the poets.index.json emission below): cross-dynasty exact dedup can zero
// an ENTIRE (name,dynasty) bucket (801 in the 2026-07 rebuild, 97% jinxiandai↔dangdai double-source
// dups) — the poet lives on in the other bucket, but this bucket's poetId would vanish from the index
// and break its old #a= permalink. Record per-bucket (a) that ≥1 line was excluded and (b) which
// canonical_id targets the excluded lines point at, plus WHICH bucket owns每 canonical line, so the
// emission step can majority-vote the mergedInto target entirely from data.
const excludedBuckets = new Map(); // "author|dyn" -> [canonical_id, …] (ids optional — 组诗总题 rows have none)
const lineOwner = new Map(); // corpus canonical line id -> interned "author|dyn" bucket key
const keyIntern = new Map(); // bucket-key string interning (~936k lines share ~33k keys — saves ~50MB)
let corpusCapped = false; // CORPUS_MAX smoke cap tripped → auto-alias skipped (partial data = mass false aliases)
const MERGED_POETS_FILES = USE_CORPUS
  ? [join(CORPUS_DIR, "poets.jsonl"), join(CORPUS_DIR, "_restricted", "poets.jsonl")]
  : [];
if (USE_CORPUS) {
  const corpusFiles = [];
  for (const dir of [CORPUS_DIR, join(CORPUS_DIR, "_restricted")]) {
    let fs2 = [];
    try { fs2 = readdirSync(dir).filter((f) => /^poems\..*\.jsonl$/.test(f)); } catch {}
    for (const f of fs2) corpusFiles.push(join(dir, f));
  }
  if (!corpusFiles.length) throw new Error(`no shiyun-corpus poems under ${CORPUS_DIR} (set SHIYUN_CORPUS_DIR)`);
  currentSource = "shiyun-corpus";
  let cp = 0, cBad = 0;
  outer: for (const fp of corpusFiles) {
    for (const ln of readFileSync(fp, "utf8").split("\n")) {
      if (!ln) continue;
      let o; try { o = JSON.parse(ln); } catch { continue; }
      if (!o.author || !o.body) { cBad++; continue; }
      // corpus.dynasty is ALREADY a canonical key (tang/song/…) → poetId aligns with 诗云's fnv32(name|dynasty)
      const dyn = o.dynasty || DYN[o.dynasty_raw] || "unknown";
      const rawKey = o.author + "|" + dyn;
      let bkey = keyIntern.get(rawKey);
      if (!bkey) { keyIntern.set(rawKey, rawKey); bkey = rawKey; }
      if (o.canonical === false) { // 别名诗行 (精确重复 / 组诗总题合并行) — 统计层跳过, 但记账供 AUTO 别名
        cSkipped++;
        let ex = excludedBuckets.get(bkey);
        if (!ex) { ex = []; excludedBuckets.set(bkey, ex); }
        if (o.canonical_id) ex.push(o.canonical_id);
        continue;
      }
      if (o.id) lineOwner.set(o.id, bkey); // canonical line → its bucket (charset-skips don't matter here)
      addPoem(o.title || "", o.author, dyn, o.dynasty_raw || "", splitLines(o.body));
      cp++;
      if (CORPUS_MAX && cp >= CORPUS_MAX) {
        console.log(`  (CORPUS_MAX=${CORPUS_MAX} smoke cap hit)`);
        corpusCapped = true;
        break outer;
      }
    }
    console.log(`  ${fp.split(/[\\/]/).pop()}: poems=${total} poets=${poets.size}`);
  }
  console.log(`  shiyun-corpus: poems=${cp} skipped-bad=${cBad} skipped-alias(canonical:false)=${cSkipped} (total=${total} poets=${poets.size})`);
}

// loud per-source charset-skip report — legacy sources skipping ANYTHING means upstream drifted.
for (const [src, n] of skippedByCharset) {
  const legacy = src === "werneror" || src === "yuxqiu";
  (legacy ? console.error : console.log)(
    `  charset-frozen skips from ${src}: ${n}${legacy ? "  ⚠ LEGACY SOURCE DRIFTED — investigate!" : ""}`,
  );
}

mkdirSync(join(OUT, "poems"), { recursive: true });

// charset.json — FROZEN: re-emit the existing file byte-identical (the bijection contract).
// Fresh/REFLOW build: derive by desc frequency (ties by codepoint) as before.
let N;
if (frozenSet) {
  N = frozenSet.size;
  writeFileSync(join(OUT, "charset.json"), frozenRaw);
  console.log(`charset.json re-emitted FROZEN (N=${N}, byte-identical)`);
} else {
  // REFLOW SUPERSET: existing chars ∪ every corpus char (freq) ∪ CJK basic block. Ordered by desc
  // frequency (chars unseen in the corpus get 0), ties by codepoint. Never drops a currently-used char.
  const all = new Set([...existingChars, ...freq.keys(), ...CJK_BASIC]);
  const chars = [...all].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0) || a.codePointAt(0) - b.codePointAt(0));
  N = chars.length;
  const charsStr = chars.join("");
  let hh = 0x811c9dc5;
  for (let i = 0; i < charsStr.length; i++) { hh ^= charsStr.charCodeAt(i); hh = Math.imul(hh, 0x01000193); }
  const newHash = (hh >>> 0).toString(16);
  writeFileSync(join(OUT, "charset.json"), JSON.stringify({ version: 2, n: N, hash: newHash, chars: charsStr }));
  console.log(`charset.json REFLOW SUPERSET: N=${N} (was ${existingChars.length}), hash=${newHash}`);
}

// poets.index.json (sorted by poemCount desc)
const clusterSize = (n) => Math.min(60, Math.max(2, +(2 + 1.4 * Math.sqrt(n)).toFixed(2)));
const index = [...poets.values()]
  .sort((a, b) => b.count - a.count)
  .map((p) => ({ id: p.id, name: p.name, dynasty: p.dynasty, poemCount: p.count, clusterSize: clusterSize(p.count) }));

// canonical 别名诗人行 (G1 merges.jsonl → poets.jsonl mergedInto rows): each is a REDIRECT, not a poet —
// poemCount:0/clusterSize:0 so it never renders a star (PoetStars/gpuPick gate on aSize<0.001) and never
// contributes to dynCounts/poemCount below. `id` is emitted VERBATIM from corpus (== fnv32(name|dynasty),
// same formula as this pipeline's own poetId()) so an existing `#a=<id>` permalink to the alias still
// resolves — the frontend then redirects id → mergedInto (the canonical poet's id, which we resolve HERE
// from mergedInto.author/dynasty via the SAME poetId() so it points at a real row in this build).
let mergedCount = 0;
if (USE_CORPUS) {
  const byIndexId = new Set(index.map((p) => p.id));
  const emittedAliasIds = new Set(); // manual rows win — the AUTO path below must not double-emit an id
  for (const fp of MERGED_POETS_FILES) {
    let text;
    try { text = readFileSync(fp, "utf8"); } catch { continue; } // e.g. no _restricted/poets.jsonl in a public-only build
    for (const ln of text.split("\n")) {
      if (!ln) continue;
      let o; try { o = JSON.parse(ln); } catch { continue; }
      if (!o.mergedInto || !o.id) continue;
      const canonicalId = poetId(o.mergedInto.author, o.mergedInto.dynasty);
      if (!byIndexId.has(canonicalId)) {
        console.warn(`  ⚠ mergedInto dead target: ${o.name}|${o.dynasty} → ${o.mergedInto.author}|${o.mergedInto.dynasty} (not a poet row in this build)`);
      }
      index.push({ id: o.id, name: o.name, dynasty: o.dynasty, poemCount: 0, clusterSize: 0, mergedInto: canonicalId });
      emittedAliasIds.add(o.id);
      mergedCount++;
    }
  }
  console.log(`  canonical 别名诗人行 (手工 merges): +${mergedCount} (mergedInto → 正身 poetId)`);

  // ── AUTO 别名 (cross-dynasty dedup 清零桶): any (name,dynasty) bucket with ZERO canonical poems but
  // ≥1 line excluded as canonical:false lost its poetId from the index — every old #a= permalink to it
  // would die, even though the poet is alive in another bucket (97% jinxiandai↔dangdai double-source
  // dups; 801 buckets in the 2026-07 rebuild). Re-emit each as an alias row via the SAME mergedInto
  // infrastructure as the manual rows above. Target choice is chooseCanonicalBucket (canonicalRules.mjs):
  // majority vote over the excluded lines' canonical_id owners → tie/no-vote falls back to the most-poems
  // same-name live bucket → nothing qualifies (theoretically 0 cases) emits a PLAIN 0-row without
  // mergedInto (permalink alive, panel empty). Data-driven end to end — no hardcoded names.
  let autoAlias = 0, plainZero = 0;
  if (corpusCapped) {
    console.warn("  ⚠ AUTO 别名 skipped: CORPUS_MAX smoke cap truncated ingestion (zero-bucket detection would be garbage)");
  } else {
    const aliveKeys = new Set(); // "name|dynasty" buckets with ≥1 ingested canonical poem
    const byNameAlive = new Map(); // name -> [{key, count}] (same-name fallback candidates)
    for (const p of poets.values()) {
      const k = p.name + "|" + p.dynasty;
      aliveKeys.add(k);
      let a = byNameAlive.get(p.name);
      if (!a) { a = []; byNameAlive.set(p.name, a); }
      a.push({ key: k, count: p.count });
    }
    for (const [bkey, cids] of excludedBuckets) {
      if (aliveKeys.has(bkey)) continue; // bucket still has canonical poems → not zeroed, no alias needed
      const cut = bkey.lastIndexOf("|"); // Han author names can't contain "|" (onlyHan filter upstream)
      const name = bkey.slice(0, cut), dyn = bkey.slice(cut + 1);
      const id = poetId(name, dyn); // == the OLD build's id for this bucket → #a= preserved verbatim
      if (emittedAliasIds.has(id) || byIndexId.has(id)) continue; // manual row / live row already owns this id
      const targetKeys = cids.map((cid) => lineOwner.get(cid)).filter(Boolean);
      const winner = chooseCanonicalBucket(targetKeys, byNameAlive.get(name) || [], aliveKeys);
      if (winner) {
        const wCut = winner.lastIndexOf("|");
        index.push({ id, name, dynasty: dyn, poemCount: 0, clusterSize: 0, mergedInto: poetId(winner.slice(0, wCut), winner.slice(wCut + 1)) });
        autoAlias++;
      } else {
        index.push({ id, name, dynasty: dyn, poemCount: 0, clusterSize: 0 }); // 防御: 链活, 面板空
        plainZero++;
      }
      emittedAliasIds.add(id);
    }
    console.log(`  canonical 别名诗人行 (AUTO 清零桶): +${autoAlias} mergedInto, +${plainZero} plain-zero (无同名有诗桶)`);
  }
}
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
// name -> poets with that name (each {id, zone, count}). `zone` replaces the old per-dynasty dynId gate:
// bare names resolve within a RESOLUTION ZONE (resolveZone, canonicalRules.mjs) — jinxiandai+dangdai are
// ONE zone (the modern era is split into two buckets purely by upstream source labels, and canonical
// dedup moves poets wholesale across them — see resolveZone's doc for the full rationale + examples),
// every other dynasty remains its own zone (bare cross-dynasty namesakes are almost always collisions).
const byName = new Map();
for (const p of poets.values()) {
  let a = byName.get(p.name);
  if (!a) { a = []; byName.set(p.name, a); }
  a.push({ id: p.id, zone: resolveZone(p.dynasty), count: p.count });
}

// 字号/别称 → 本名: famous, near-unambiguous studio-names (号 collide far less than 字). When a
// title names a poet by 号 (e.g. 晦庵 = 朱熹, 东坡 = 苏轼), redirect to the canonical poet —
// otherwise the 号 either collides with a 1-poem namesake or misses the famous target entirely.
const GIFT_ALIAS = {
  // 魏晋南北朝 — corpus canonical name is 陶潜 (陶渊明 does NOT exist as a poet row; the old
  // mapping → "陶渊明" made every 渊明-family alias resolve to nothing).
  靖节:"陶潜", 五柳先生:"陶潜", 渊明:"陶潜", 陶渊明:"陶潜",
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
// validate alias TARGETS against actual corpus names — a target that isn't a poet row makes every
// alias pointing at it resolve to nothing (the 陶渊明 bug). Dead targets are loudly listed.
{
  const dead = [...new Set(Object.values(GIFT_ALIAS))].filter((t) => !byName.has(t));
  if (dead.length) console.warn(`  ⚠ GIFT_ALIAS dead targets (not poet rows): ${dead.join(" ")}`);
}
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
// resolve a name (or 号/字 alias) to a poet id. Bare names: SAME RESOLUTION ZONE only (precision — a
// bare namesake across zones is almost always a collision). Zones == dynasties EXCEPT jinxiandai and
// dangdai, which are one zone: the modern era is split into two buckets purely by upstream source
// labels (Werneror 近现代 vs yuxqiu/sheepzh 当代), and canonical dedup moves a poet's surviving bucket
// wholesale across that boundary while the poems referencing them stay put — the old same-dynasty rule
// broke 22 real edges (龙榆生[dangdai]→陈寅恪[jinxiandai], 郁达夫[dangdai]→鲁迅[jinxiandai], …) and had
// always missed genuine cross-bucket modern edges. See resolveZone (canonicalRules.mjs). Aliases (号/字):
// cross-dynasty allowed as before (a 清人 和东坡 really means 苏轼). Pick the most prolific match.
function resolveTarget(name, authorZone, fromId) {
  const aliased = name in GIFT_ALIAS;
  const cands = byName.get(aliased ? GIFT_ALIAS[name] : name);
  if (!cands) return null;
  let best = null, bestCount = -1;
  for (const c of cands) {
    if (c.id === fromId) continue;
    if (!aliased && c.zone !== authorZone) continue;
    if (c.count > bestCount) { bestCount = c.count; best = c; }
  }
  return best ? best.id : null;
}
// One edge per DISTINCT recipient per poem (兼寄/兼简/兼呈 → multiple). Scan ALL markers and ALL
// their occurrences (no early break) so marker list-order can't drop the primary dedication.
const edgeW = new Map(); // "from|to" -> weight
for (const p of poets.values()) {
  const aZone = resolveZone(p.dynasty);
  for (const poem of p.poems) {
    const title = poem.t;
    if (!title) continue;
    const targets = new Set();
    for (const mk of GIFT_MARKERS) {
      let from = 0, at;
      while ((at = title.indexOf(mk, from)) >= 0) {
        from = at + mk.length;
        const name = findName(title.slice(at + mk.length));
        if (name) { const to = resolveTarget(name, aZone, p.id); if (to) targets.add(to); }
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
  version: 3, n: N, pullK: freq.size, poetCount: poets.size, poemCount: total,
  buckets: [...buckets.keys()].sort(),
  lineBuckets: [...flBuckets.keys()].sort(),
  giftEdges: edges.length,
  poemSidecar: !SKIP_HEAVY, // poems/{b}.idx.json byte-offset sidecars exist → frontend Range-fetches
  dynCounts,
}));
console.log(`\n诗句索引 lines=${lineIndex.size} buckets=${flBuckets.size}  赠诗 edges=${edges.length}`);

console.log(`\nDONE  poets=${poets.size}  poems=${total}  字库 N=${N}  buckets=${buckets.size}`);
console.log("dynasty poet counts:", dynCounts);
