// 诗云 — PREFIX + 诗名 search index (寻诗 增量搜索) so the 寻诗 tab can answer a PARTIAL query the moment
// you start typing — a single char, a half line, or a poem TITLE — instead of only matching a whole line.
//
// The existing lines/ index is keyed by the WHOLE line and hash-bucketed (no prefix locality), so a
// partial line like 「举头望」 (a MID-line of 静夜思) finds nothing until the full line is typed. This index
// holds TWO kinds of key (both hash-bucketed by the key string → an EXACT-key lookup, no scan):
//
//   1. EXACT full TITLE  — every poem's whole title (汉字 only). 诗名搜索 for ANY poem, even an obscure
//      poet's famous piece (张若虚《春江花月夜》) — found the moment the full title is typed. ~1 ref each.
//   2. PREFIX len 1..PREFIX_MAX of a NOTABLE poem's lines + title — incremental / single-char search.
//      Short prefixes AGGREGATE and the MAXREF cap keeps the best-known poems, so 「静」/「举头望」 →
//      李白《静夜思》. The client keys on the first min(len, PREFIX_MAX) chars, so a longer query
//      (举头望明月) still hits the 举头望 prefix and keeps showing 静夜思. Obscure poets are excluded from
//      the prefix keys (they never win a short prefix; their full line is still in the exact lines/ index).
//
//   bucket = fnv32(key) & 0xff   (== the frontend's hashStr → load.ts::sxBucket)
//   value  = [{p:poetId, i:poemIdx, t:title, f:form}, …]   capped MAXREF, famous-first
//
// Built from the existing poems/*.json (no corpus). Disk-staged (like build-fuzzy) so it never has to
// live in RAM. Run: node --max-old-space-size=4096 pipeline/build-search.mjs   (or: npm run build:search)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const POEMS = join(DATA, "poems");
const OUT = join(DATA, "search");
const TMP = join(DATA, "_sxtmp");

// FNV-1a, must match the frontend's hashStr — contract-tested in src/data/shardHash.contract.test.ts.
function fnv32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const bucketOf = (key) => (fnv32(key) & 0xff).toString(16).padStart(2, "0");

const PREFIX_MAX = 3; // longest prefix indexed — mirror load.ts::PREFIX_MAX (the client keys on first ≤3 chars)
const MIN_LINE = 2;   // lines shorter than this are noise; titles index from 1 char
const MAXREF = 12;    // refs kept per key (famous-first) — bounds the index + the result list
// Only FAMOUS poets contribute PREFIX keys (their iconic lines/titles). A poemCount bar can't bound this
// — prolific poets own most of the corpus's poems, so "notable poems" ≈ everything (12 M refs / 800 MB).
// The famous set (≈48 poets, ~30 K poems) keeps every landmark line (李白《静夜思》) while staying tiny.
// To widen single-char/incremental coverage, add names to FAMOUS below + rebuild. (Exact TITLE is ALL poems.)

const HAN = /\p{Script=Han}/u;

const files = readdirSync(POEMS).filter((f) => /^[0-9a-f]{2}\.json$/.test(f)); // skip *.idx.json
if (!files.length) { console.error(`no poems buckets under ${POEMS} — provision the data first.`); process.exit(1); }

// rank score for the per-prefix cap: famous poets win big, then by poemCount (mirrors build-fuzzy/lines).
const poets = JSON.parse(readFileSync(join(DATA, "poets.index.json"), "utf8"));
const FAMOUS = new Set([
  // NOTE: names must match the CORPUS canonical row (陶潜 not 陶渊明 — the latter never matched).
  "屈原", "宋玉", "项羽", "司马相如", "蔡文姬", "曹操", "曹植", "阮籍", "陶潜", "谢灵运", "鲍照", "庾信",
  "杨广", "李白", "杜甫", "王维", "白居易", "李商隐", "杜牧", "李煜", "韦庄", "苏轼", "陆游", "李清照",
  "辛弃疾", "王安石", "萧观音", "元好问", "关汉卿", "马致远", "白朴", "高启", "唐寅", "于谦", "纳兰性德",
  "龚自珍", "袁枚", "秋瑾", "黄遵宪", "毛泽东", "徐志摩", "戴望舒", "闻一多", "艾青", "海子", "北岛", "顾城", "舒婷",
  "食指", "余秀华", "西川", "欧阳江河", "翟永明",
]);
const score = new Map(poets.map((p) => [p.id, (FAMOUS.has(p.name) ? 1e9 : 0) + (p.poemCount || 0)]));

if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

// ── phase 1: scatter compact records [prefixKey, id, i, t, f, score] to per-bucket temp files ──
const buf = new Map(); // bucket → string[]
let buffered = 0, strN = 0;
const FLUSH = 1_500_000;
const flush = () => {
  for (const [b, arr] of buf) if (arr.length) { appendFileSync(join(TMP, b), arr.join("\n") + "\n"); arr.length = 0; }
  buffered = 0;
};
const pushKey = (key, id, i, t, f, sc) => {
  const b = bucketOf(key);
  let a = buf.get(b);
  if (!a) { a = []; buf.set(b, a); }
  a.push(JSON.stringify([key, id, i, t, f, sc]));
  if (++buffered >= FLUSH) flush();
};
const emitExact = (raw, id, i, t, f, sc) => {           // whole TITLE → exact-key (any poem)
  const key = [...raw].filter((c) => HAN.test(c)).join("");
  if (!key.length) return;
  strN++;
  pushKey(key, id, i, t, f, sc);
};
const emitPrefixes = (raw, minLen, id, i, t, f, sc) => { // prefixes len 1..PREFIX_MAX (notable poems only)
  const cps = [...raw].filter((c) => HAN.test(c));
  if (cps.length < minLen) return;
  for (let L = 1; L <= Math.min(PREFIX_MAX, cps.length); L++) pushKey(cps.slice(0, L).join(""), id, i, t, f, sc);
};
for (const f of files.sort()) {
  const obj = JSON.parse(readFileSync(join(POEMS, f), "utf8")); // { poetId: [{t,f,p}] }
  for (const id in obj) {
    const sc = score.get(id) || 0;
    const famous = sc >= 1e9;                           // FAMOUS score = 1e9 + poemCount (see `score` above)
    const arr = obj[id];
    for (let i = 0; i < arr.length; i++) {
      const pm = arr[i];
      const t = pm.t || "";
      emitExact(t, id, i, t, pm.f, sc);                 // EXACT full title → 诗名搜索 for ANY poem
      if (!famous) continue;                            // non-famous poets: title-exact only, no prefix keys
      emitPrefixes(t, 1, id, i, t, pm.f, sc);           // notable: title prefixes (incremental 诗名)
      const seen = new Set();                           // dedupe identical lines within one poem
      for (const ln of pm.p) {
        if (seen.has(ln)) continue;
        seen.add(ln);
        emitPrefixes(ln, MIN_LINE, id, i, t, pm.f, sc); // notable: line prefixes (mid-line incremental)
      }
    }
  }
}
flush();

// ── phase 2: per bucket, dedup by (key,p,i) + cap MAXREF (famous-first) → search/{bucket}.json ──
let keyN = 0, refN = 0;
for (let n = 0; n < 256; n++) {
  const b = n.toString(16).padStart(2, "0");
  const tmpf = join(TMP, b);
  if (!existsSync(tmpf)) continue;
  const out = {}; // key → [{p,i,t,f,_c}]
  for (const line of readFileSync(tmpf, "utf8").split("\n")) {
    if (!line) continue;
    const [key, id, i, t, f, sc] = JSON.parse(line);
    let refs = out[key];
    if (!refs) { refs = []; out[key] = refs; keyN++; }
    if (refs.some((r) => r.p === id && r.i === i)) continue; // a poem appears once per key (title+line dedupe)
    if (refs.length < MAXREF) { refs.push({ p: id, i, t, f, _c: sc }); refN++; }
    else {
      let lo = 0;
      for (let k = 1; k < refs.length; k++) if (refs[k]._c < refs[lo]._c) lo = k;
      if (sc > refs[lo]._c) refs[lo] = { p: id, i, t, f, _c: sc };
    }
  }
  for (const key in out) out[key].sort((a, z) => z._c - a._c); // famous-first so the client takes the first N
  writeFileSync(join(OUT, `${b}.json`), JSON.stringify(out, (k, v) => (k === "_c" ? undefined : v)));
}
rmSync(TMP, { recursive: true, force: true });
console.log(`done — ${strN} titles → search/ with ${keyN} keys, ${refN} refs (PREFIX_MAX=${PREFIX_MAX}, MAXREF=${MAXREF}, famous-prefix).`);
