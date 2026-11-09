// Reproduce the static index lookups used by load.ts for the requested acceptance queries.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const poets = new Map(JSON.parse(readFileSync(join(DATA, "poets.index.json"), "utf8")).map((p) => [p.id, p]));
const famousSource = readFileSync(join(DATA, "..", "..", "src", "data", "famousPoets.ts"), "utf8");
const famous = new Set([...famousSource.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]));
const HAN = /\p{Script=Han}/u;
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const bucket = (s, mask, width) => (hash(s) & mask).toString(16).padStart(width, "0");
const read = (dir, key, mask, width) => {
  try { return JSON.parse(readFileSync(join(DATA, dir, `${bucket(key, mask, width)}.json`), "utf8"))[key] || []; }
  catch { return []; }
};
const charsFor = (query) => {
  const cs = [...query].filter((c) => HAN.test(c));
  if (cs.length === 1) return read("chars", cs[0], 0xfff, 3).map(([p, i, t, f, line]) => ({ p, i, t, f, line }));
  if (cs.length !== 2) return [];
  const lists = [...new Set(cs)].map((c) => read("chars", c, 0xfff, 3).map(([p, i, t, f, line]) => ({ p, i, t, f, line })));
  return lists.sort((a, b) => a.length - b.length)[0].filter((r) => r.line.includes(cs.join("")));
};
const searchHead = (query) => {
  const cs = [...query].filter((c) => HAN.test(c)), keys = new Set([cs.join(""), cs.slice(0, 3).join("")]);
  const found = new Map();
  for (const key of keys) for (const r of read("search", key, 0xff, 2)) found.set(`${r.p}#${r.i}`, { p: r.p, i: r.i, t: r.t, f: r.f, line: key });
  return [...found.values()];
};
const searchLines = (query) => {
  const cs = [...query].filter((c) => HAN.test(c)), keys = new Set([cs.join("")]);
  for (const n of [7, 6, 5, 4]) if (cs.length > n) keys.add(cs.slice(0, n).join(""));
  const found = new Map();
  for (const key of keys) for (const r of read("lines", key, 0xff, 2)) found.set(`${r.p}#${r.i}`, { p: r.p, i: r.i, t: r.t, f: r.f, line: key });
  return [...found.values()];
};
function existing(query) {
  const merged = new Map();
  for (const r of [...searchLines(query), ...searchHead(query)]) if (!merged.has(`${r.p}#${r.i}`)) merged.set(`${r.p}#${r.i}`, r);
  const rows = [...merged.values()].sort((a, b) =>
    Number(famous.has(poets.get(b.p)?.name || "")) - Number(famous.has(poets.get(a.p)?.name || "")) ||
    (poets.get(b.p)?.poemCount || 0) - (poets.get(a.p)?.poemCount || 0));
  const per = new Map(), out = [];
  for (const r of rows) { const n = per.get(r.p) || 0; if (n >= 2) continue; per.set(r.p, n + 1); out.push(r); if (out.length === 10) break; }
  return out;
}
for (const q of ["青", "月", "霜", "青云", "寻春服感念", "寿楼春"]) {
  const extra = charsFor(q), base = existing(q);
  const baseKeys = new Set(base.map((r) => `${r.p}#${r.i}`));
  const supplemental = extra.filter((r) => !baseKeys.has(`${r.p}#${r.i}`));
  const fmt = (r) => `${poets.get(r.p)?.name || r.p}《${r.t || "无题"}》${r.line ? `「${r.line}」` : ""}`;
  console.log(JSON.stringify({ query: q, existingCount: base.length, existingTop10: base.map(fmt), containsCount: supplemental.length, containsTop10: supplemental.slice(0, 10).map(fmt) }, null, 2));
}

// Exact query-transfer distribution over every indexed one-character and two-character pair.
const charBytes = [];
for (const name of readdirSync(join(DATA, "chars")).filter((n) => /^[0-9a-f]{3}\.json$/.test(n))) {
  const obj = JSON.parse(readFileSync(join(DATA, "chars", name), "utf8"));
  const gz = statSync(join(DATA, "chars", `${name}.gz`)).size;
  for (const ch of Object.keys(obj)) charBytes.push({ ch, bucket: name.slice(0, 3), gz });
}
const sorted = charBytes.map((x) => x.gz).sort((a, b) => a - b), n = sorted.length;
const sameBucketCounts = new Map();
for (const c of charBytes) sameBucketCounts.set(c.bucket, (sameBucketCounts.get(c.bucket) || 0) + 1);
function countAtMost(limit) {
  let count = sorted.filter((v) => v <= limit).length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    while (j > i && sorted[i] + sorted[j] > limit) j--;
    if (j <= i) break;
    count += j - i;
  }
  for (const [b, m] of sameBucketCounts) {
    const size = statSync(join(DATA, "chars", `${b}.json.gz`)).size;
    const pairs = m * (m - 1) / 2;
    if (size <= limit && size + size > limit) count += pairs;
    else if (size + size <= limit && size > limit) count -= pairs;
  }
  return count;
}
const totalQueries = n + n * (n - 1) / 2;
function percentile(p) {
  let lo = 0, hi = sorted.at(-1) * 2;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (countAtMost(mid) >= Math.ceil(totalQueries * p)) hi = mid; else lo = mid + 1; }
  return lo;
}
const perBucket = [...new Map(charBytes.map((c) => [c.bucket, c.gz])).values()].sort((a, b) => b - a);
const maxTwo = perBucket.length > 1 ? perBucket[0] + perBucket[1] : perBucket[0];
console.log(JSON.stringify({ queryTransferBytes: { queryPopulation: totalQueries, p50: percentile(.5), p95: percentile(.95), max: Math.max(sorted.at(-1), maxTwo) } }, null, 2));
