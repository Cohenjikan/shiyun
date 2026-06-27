// 诗云 — standalone 诗句 (all-lines) search-index builder.
//
// Why: `public/data/lines/` (the content-search index — EVERY line → the real poems containing it)
// is git-ignored (~791 MB) and absent on fresh checkouts, so `searchByLine` finds nothing → the
// 诗句 tab shows no real hits AND the "this is a real poem" detector (findReal) silently fails.
// A full `build-data.mjs` run needs the corpus; this script rebuilds `lines/` from the EXISTING
// `poems/*.json` (same data the index was derived from) — no corpus, minutes not the full pipeline.
//
// Run: node --max-old-space-size=4096 pipeline/build-lines.mjs   (or: npm run build:lines)
//
// Matches build-data.mjs EXACTLY: key = the whole line (≥4 codepoints, deduped within a poem),
// bucket = fnv32(line)&0xff (== the frontend's hashStr), ref = {p:poetId, i:poemIdx, t:title, f:form},
// capped at LINE_CAP refs per identical line — the cap KEEPS famous authors FIRST (FAMOUS_NAMES, mirrors
// the frontend's famousPoets.ts), then the most prolific. poemCount alone wasn't enough: 行到水穷处 is
// shared by 12 poems, and 王维《终南别业》(397首) was evicted by monks/compilers with 1800+首 → 寻诗 couldn't
// surface 终南别业 (reported bug). Famous-first keeps 王维 regardless of bucket-scan order or poemCount.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const POEMS = join(DATA, "poems");
const LINES = join(DATA, "lines");

// FNV-1a, must match the frontend's hashStr — contract-tested in src/data/shardHash.contract.test.ts.
function fnv32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const lineBucket = (s) => (fnv32(s) & 0xff).toString(16).padStart(2, "0");
const LINE_CAP = 6; // max refs per identical line (avoid skew on ultra-common lines)

const files = readdirSync(POEMS).filter((f) => /^[0-9a-f]{2}\.json$/.test(f)); // skip *.idx.json
if (!files.length) { console.error(`no poems buckets under ${POEMS} — provision the data first.`); process.exit(1); }

// Per-line cap ranking: famous authors first, then poemCount. FAMOUS_NAMES MUST mirror
// src/data/famousPoets.ts (the frontend ranks 诗句 hits by the same set) — keep the two in sync.
const poets = JSON.parse(readFileSync(join(DATA, "poets.index.json"), "utf8"));
const pc = new Map(poets.map((p) => [p.id, p.poemCount || 0]));
const FAMOUS_NAMES = new Set([
  "屈原", "宋玉", "项羽", "司马相如", "蔡琰", "曹操", "曹植", "阮籍", "陶潜", "谢灵运", "鲍照", "庾信", "杨广",
  "李白", "杜甫", "王维", "白居易", "李商隐", "杜牧", "李煜", "韦庄", "苏轼", "陆游", "李清照", "辛弃疾", "王安石",
  "萧观音", "元好问", "关汉卿", "马致远", "白朴", "高启", "唐寅", "于谦", "纳兰性德", "龚自珍", "袁枚", "秋瑾",
  "黄遵宪", "毛泽东", "徐志摩", "戴望舒", "闻一多", "艾青", "海子", "北岛", "顾城", "舒婷",
]);
const fame = new Map(poets.map((p) => [p.id, FAMOUS_NAMES.has(p.name) ? 1 : 0]));
// rank = famous-first then poemCount: 1e9 ≫ any poemCount, so every famous poet outranks every non-famous.
const rankOf = (id) => (fame.get(id) ? 1e9 : 0) + (pc.get(id) || 0);

mkdirSync(LINES, { recursive: true });
const flBuckets = new Map(); // bucket → { line: [{p,i,t,f,_r}] }
let poemN = 0, refN = 0;
for (const f of files.sort()) {
  const obj = JSON.parse(readFileSync(join(POEMS, f), "utf8")); // { poetId: [{t,f,p}] }
  for (const id in obj) {
    const rank = rankOf(id);
    const arr = obj[id];
    for (let poemIdx = 0; poemIdx < arr.length; poemIdx++) {
      const pm = arr[poemIdx];
      poemN++;
      const seen = new Set(); // dedupe repeated lines within one poem
      for (const ln of pm.p) {
        if ([...ln].length < 4 || seen.has(ln)) continue;
        seen.add(ln);
        const b = lineBucket(ln);
        let bucket = flBuckets.get(b);
        if (!bucket) { bucket = {}; flBuckets.set(b, bucket); }
        let refs = bucket[ln];
        if (!refs) { refs = []; bucket[ln] = refs; }
        if (refs.length < LINE_CAP) {
          refs.push({ p: id, i: poemIdx, t: pm.t || "", f: pm.f, _r: rank });
          refN++;
        } else {
          // full → replace the lowest-ranked ref if this one ranks higher (famous-first, then poemCount —
          // so 王维《终南别业》 is never evicted from 行到水穷处 by a more prolific but non-famous poet).
          let lo = 0;
          for (let k = 1; k < refs.length; k++) if (refs[k]._r < refs[lo]._r) lo = k;
          if (rank > refs[lo]._r) refs[lo] = { p: id, i: poemIdx, t: pm.t || "", f: pm.f, _r: rank };
        }
      }
    }
  }
}

const dropC = (k, v) => (k === "_r" ? undefined : v); // strip the sort-only field on write
for (const [b, obj] of flBuckets) writeFileSync(join(LINES, `${b}.json`), JSON.stringify(obj, dropC));
console.log(`done — ${flBuckets.size} line buckets, ${poemN} poems scanned, ${refN} line-refs written.`);
