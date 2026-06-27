// 诗云 — FUZZY 诗句 index (delete-1 / SymSpell skeletons) so a one-character variant of a line still
// finds the real poem (静夜思 corpus「举头望山月」 vs the popular「举头望明月」). Two same-length strings
// differing by ONE substitution share the (L-1) string formed by DELETING the differing position, so we
// index every line under all its "drop-one-char" skeletons; the client drops each position of the typed
// line and looks the skeletons up. (Also catches a single insertion/deletion.)
//
// The full delete-1 index is multiple GB — too big to hold in RAM — so this STAGES THROUGH DISK:
//   phase 1: append compact JSON records to 256 per-bucket temp files (buffered, bounded memory);
//   phase 2: per bucket, dedup+cap → linesf/{bucket}.json, then delete the temp.
// Built from the existing poems/*.json (no corpus). NOTE: large on disk; fine for LOCAL search. For a
// DEPLOY a curated/server-side fuzzy is better (see HANDOFF) — this is the "works everywhere locally" build.
//
// Run: node pipeline/build-fuzzy.mjs   (or: npm run build:fuzzy)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const POEMS = join(DATA, "poems");
const OUT = join(DATA, "linesf");
const TMP = join(DATA, "_fztmp");

// FNV-1a, must match the frontend's hashStr — contract-tested in src/data/shardHash.contract.test.ts.
function fnv32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
// 4096 buckets (3-hex) so each shard is small (~1 MB) → a fuzzy search loads only a few MB, not tens.
const NBUCKETS = 4096;
const bucketOf = (s) => (fnv32(s) & (NBUCKETS - 1)).toString(16).padStart(3, "0");
const MINLEN = 4, MAXLEN = 10, CAP = 5, FLUSH = 1_500_000;

// Landmark poets (mirror of src/data/famousPoets.ts) — a shared skeleton (e.g. 举头望月, written by
// many) must KEEP its famous author (李白《静夜思》) rather than evict it for a hyper-prolific minor poet
// (王世贞 8009首). So the per-skeleton cap ranks by a score that puts famous poets far above poemCount.
const FAMOUS = new Set([
  "屈原", "宋玉", "项羽", "司马相如", "蔡琰", "曹操", "曹植", "阮籍", "陶潜", "谢灵运", "鲍照", "庾信",
  "杨广", "李白", "杜甫", "王维", "白居易", "李商隐", "杜牧", "李煜", "韦庄", "苏轼", "陆游", "李清照",
  "辛弃疾", "王安石", "萧观音", "元好问", "关汉卿", "马致远", "白朴", "高启", "唐寅", "于谦", "纳兰性德",
  "龚自珍", "袁枚", "秋瑾", "黄遵宪", "毛泽东", "徐志摩", "戴望舒", "闻一多", "艾青", "海子", "北岛", "顾城", "舒婷",
]);

const files = readdirSync(POEMS).filter((f) => /^[0-9a-f]{2}\.json$/.test(f));
if (!files.length) { console.error(`no poems buckets under ${POEMS} — provision the data first.`); process.exit(1); }
const poets = JSON.parse(readFileSync(join(DATA, "poets.index.json"), "utf8"));
// rank score for the per-skeleton cap: famous poets win big, then by poemCount
const score = new Map(poets.map((p) => [p.id, (FAMOUS.has(p.name) ? 1e9 : 0) + (p.poemCount || 0)]));

if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

// ── phase 1: scatter compact records [skeleton,id,i,t,f,cnt] to per-bucket temp files ──
const buf = new Map(); // bucket → string[]
let buffered = 0, lineN = 0;
const flush = () => {
  for (const [b, arr] of buf) if (arr.length) { appendFileSync(join(TMP, b), arr.join("\n") + "\n"); arr.length = 0; }
  buffered = 0;
};
for (const f of files.sort()) {
  const obj = JSON.parse(readFileSync(join(POEMS, f), "utf8"));
  for (const id in obj) {
    const sc = score.get(id) || 0;
    const arr = obj[id];
    for (let i = 0; i < arr.length; i++) {
      const pm = arr[i];
      const seen = new Set();
      for (const ln of pm.p) {
        const cps = [...ln];
        if (cps.length < MINLEN || cps.length > MAXLEN || seen.has(ln)) continue;
        seen.add(ln);
        lineN++;
        const sks = new Set();
        for (let d = 0; d < cps.length; d++) sks.add(cps.slice(0, d).concat(cps.slice(d + 1)).join(""));
        for (const sk of sks) {
          const b = bucketOf(sk);
          let a = buf.get(b);
          if (!a) { a = []; buf.set(b, a); }
          a.push(JSON.stringify([sk, id, i, pm.t || "", pm.f, sc]));
          if (++buffered >= FLUSH) flush();
        }
      }
    }
  }
}
flush();

// ── phase 2: per bucket, dedup + cap (prefer prolific poets) → linesf/{bucket}.json ──
let keyN = 0;
for (let n = 0; n < NBUCKETS; n++) {
  const b = n.toString(16).padStart(3, "0");
  const tmpf = join(TMP, b);
  if (!existsSync(tmpf)) continue;
  const out = {}; // skeleton → [{p,i,t,f}] (+ _c during build)
  for (const line of readFileSync(tmpf, "utf8").split("\n")) {
    if (!line) continue;
    const [sk, id, i, t, f, sc] = JSON.parse(line);
    let refs = out[sk];
    if (!refs) { refs = []; out[sk] = refs; keyN++; }
    if (refs.length < CAP) refs.push({ p: id, i, t, f, _c: sc });
    else { let lo = 0; for (let k = 1; k < refs.length; k++) if (refs[k]._c < refs[lo]._c) lo = k; if (sc > refs[lo]._c) refs[lo] = { p: id, i, t, f, _c: sc }; }
  }
  writeFileSync(join(OUT, `${b}.json`), JSON.stringify(out, (k, v) => (k === "_c" ? undefined : v)));
}
rmSync(TMP, { recursive: true, force: true });
console.log(`done — ${lineN} lines indexed → linesf/ with ${keyN} skeleton keys.`);
