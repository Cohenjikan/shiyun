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
// capped at LINE_CAP refs per identical line — but the cap now KEEPS the most prolific poets, so an
// iconic line (床前明月光) always retains its famous author (李白) regardless of bucket-scan order.
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

// poemCount per poet → so the per-line cap keeps the better-known authors of a shared line.
const poets = JSON.parse(readFileSync(join(DATA, "poets.index.json"), "utf8"));
const pc = new Map(poets.map((p) => [p.id, p.poemCount || 0]));

mkdirSync(LINES, { recursive: true });
const flBuckets = new Map(); // bucket → { line: [{p,i,t,f,_c}] }
let poemN = 0, refN = 0;
for (const f of files.sort()) {
  const obj = JSON.parse(readFileSync(join(POEMS, f), "utf8")); // { poetId: [{t,f,p}] }
  for (const id in obj) {
    const cnt = pc.get(id) || 0;
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
          refs.push({ p: id, i: poemIdx, t: pm.t || "", f: pm.f, _c: cnt });
          refN++;
        } else {
          // full → replace the least-prolific ref if this poet is more prolific (keeps 李白 etc.)
          let lo = 0;
          for (let k = 1; k < refs.length; k++) if (refs[k]._c < refs[lo]._c) lo = k;
          if (cnt > refs[lo]._c) refs[lo] = { p: id, i: poemIdx, t: pm.t || "", f: pm.f, _c: cnt };
        }
      }
    }
  }
}

const dropC = (k, v) => (k === "_c" ? undefined : v); // strip the sort-only field on write
for (const [b, obj] of flBuckets) writeFileSync(join(LINES, `${b}.json`), JSON.stringify(obj, dropC));
console.log(`done — ${flBuckets.size} line buckets, ${poemN} poems scanned, ${refN} line-refs written.`);
