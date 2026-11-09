// Build the all-position, single-Han-character search index from poems/*.json.
// Records are staged by shard on disk so corpus size does not dictate peak RAM.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const POEMS = join(DATA, "poems"), OUT = join(DATA, "chars"), TMP = join(DATA, "_chartmp");
const K = 200, PER_POET = 15, BUCKET_BITS = 12, BUCKETS = 1 << BUCKET_BITS;
const HAN = /\p{Script=Han}/u;
function fnv32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const bucketOf = (s) => (fnv32(s) & (BUCKETS - 1)).toString(16).padStart(3, "0");
// Read the canonical frontend list without duplicating it (Node does not need a TS loader).
const famousSource = readFileSync(join(DATA, "..", "..", "src", "data", "famousPoets.ts"), "utf8");
const famous = new Set([...famousSource.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]));
const files = readdirSync(POEMS).filter((f) => /^[0-9a-f]{2}\.json$/.test(f)).sort();
if (!files.length) throw new Error(`no poems buckets under ${POEMS}`);
const poets = JSON.parse(readFileSync(join(DATA, "poets.index.json"), "utf8"));
const score = new Map(poets.map((p) => [p.id, (famous.has(p.name) ? 1e9 : 0) + (p.poemCount || 0)]));
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true }); mkdirSync(OUT, { recursive: true });

// Phase 1: each record is [char,poetId,poemIdx,title,form,matchedLine,score].
const buffers = new Map(); let buffered = 0;
function flush() { for (const [b, a] of buffers) if (a.length) { appendFileSync(join(TMP, b), a.join("\n") + "\n"); a.length = 0; } buffered = 0; }
function emit(ch, id, i, t, f, line, sc) {
  const b = bucketOf(ch); let a = buffers.get(b); if (!a) buffers.set(b, a = []);
  a.push(JSON.stringify([ch, id, i, t, f, line, sc]));
  if (++buffered >= 250_000) flush();
}
for (const file of files) {
  const obj = JSON.parse(readFileSync(join(POEMS, file), "utf8"));
  for (const id in obj) for (let i = 0; i < obj[id].length; i++) {
    const pm = obj[id][i], perChar = new Map();
    for (const line of pm.p || []) for (const ch of new Set([...line].filter((c) => HAN.test(c)))) if (!perChar.has(ch)) perChar.set(ch, line);
    const sc = score.get(id) || 0;
    for (const [ch, line] of perChar) emit(ch, id, i, pm.t || "", pm.f || "other", line, sc);
  }
}
flush();

// Phase 2: rank each character independently; cap poet diversity before K, then serialize compact tuples.
let charCount = 0, cappedChars = 0, kept = 0, rawTotal = 0, gzipTotal = 0, querySizes = [];
for (let n = 0; n < BUCKETS; n++) {
  const b = n.toString(16).padStart(3, "0"), path = join(TMP, b);
  const groups = new Map();
  if (existsSync(path)) for (const row of readFileSync(path, "utf8").split("\n")) {
    if (!row) continue;
    const [ch, p, i, t, f, line, sc] = JSON.parse(row);
    let a = groups.get(ch); if (!a) groups.set(ch, a = []);
    a.push({ p, i, t, f, line, sc });
  }
  const out = {};
  for (const [ch, a] of groups) {
    a.sort((x, y) => y.sc - x.sc || x.p.localeCompare(y.p) || x.i - y.i);
    const perPoet = new Map(), chosen = [];
    for (const r of a) {
      const count = perPoet.get(r.p) || 0;
      if (count >= PER_POET) continue;
      perPoet.set(r.p, count + 1); chosen.push({ r, k: count });
      if (chosen.length === K) break;
    }
    // Interleave (mirror of src/data/charsSearch.ts capCharRecords): every poet's 1st line (best poet
    // first), then every poet's 2nd line, … — one prolific poet (陆游) must not fill the first page.
    chosen.sort((x, y) => x.k - y.k); // stable → score order kept within each per-poet rank
    out[ch] = chosen.map(({ r }) => [r.p, r.i, r.t, r.f, r.line]);
    charCount++; kept += chosen.length; if (chosen.length === K) cappedChars++;
  }
  const json = JSON.stringify(out), raw = Buffer.from(json), gz = gzipSync(raw, { level: 9 });
  writeFileSync(join(OUT, `${b}.json`), raw); writeFileSync(join(OUT, `${b}.json.gz`), gz);
  rawTotal += raw.length; gzipTotal += gz.length; querySizes.push(gz.length);
}
rmSync(TMP, { recursive: true, force: true });
querySizes.sort((a, b) => a - b);
const pct = (p) => querySizes[Math.min(querySizes.length - 1, Math.ceil(p * querySizes.length) - 1)];
console.log(JSON.stringify({ buckets: BUCKETS, K, perPoet: PER_POET, chars: charCount, keptRefs: kept, avgPerChar: kept / charCount, cappedChars, rawBytes: rawTotal, gzipBytes: gzipTotal, queryGzipP50: pct(.5), queryGzipP95: pct(.95), queryGzipMax: Math.max(...querySizes), files: files.length }, null, 2));
