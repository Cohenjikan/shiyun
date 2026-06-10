// 诗云 — cold-backup packing script for the git-ignored heavy data (poems/ lines/ search/, ~1.1 GB).
//
// Why: the heavy data is git-ignored, cannot be rebuilt without the C:/corpus corpora, and its only
// off-machine copy is a GitHub-release "cold backup". That backup is hand-made today — hand-tarred,
// hand-checksummed, ~201 assets hand-uploaded (see docs/DEPLOY.md §1.0 Option A′, release
// data-v2-2026-06-10). This script reduces that to: run it, then paste the two printed gh commands.
//
// It produces ONE tarball per included dir (poems.tar.gz / lines.tar.gz / search.tar.gz) plus a
// SHA256SUMS.txt — exactly the asset set Option A′ documents. Tarring is delegated to the system `tar`
// (bsdtar on Windows 10+, GNU tar on linux — both speak `-czf out dir`); checksums are streamed with
// node:crypto so a 1 GB archive never lands in RAM.
//
// Run:  node pipeline/pack-data.mjs                         (or: npm run pack:data)
//       node pipeline/pack-data.mjs --dir public/data --out backup-pack --include poems,lines,search
//
// Args:
//   --dir <data-root>    default public/data    (the dir that holds poems/ lines/ search/ manifest.json)
//   --out <output-dir>   default backup-pack/   (created if absent; it's in .gitignore)
//   --include <list>     default poems,lines,search   comma-separated dir names to pack
//
// Zero-dep node. A REQUESTED dir that's missing is WARNED, not fatal (a fresh worktree has none —
// that's a normal state, not a crash). `tar` missing IS fatal (we cannot make the backup without it).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── tiny arg parser (--flag value), matching the plain style of the other pipeline scripts ──
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else (out[key] = next), i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
// resolve --dir / --out relative to the repo root (so `npm run pack:data` works from anywhere)
const resolveFromRoot = (p) => (isAbsolute(p) ? p : resolve(ROOT, p));
const dataRoot = resolveFromRoot(typeof args.dir === "string" ? args.dir : "public/data");
const outDir = resolveFromRoot(typeof args.out === "string" ? args.out : "backup-pack");
const include = (typeof args.include === "string" ? args.include : "poems,lines,search")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`诗云 cold-backup pack`);
console.log(`  data-root: ${dataRoot}`);
console.log(`  out-dir:   ${outDir}`);
console.log(`  include:   ${include.join(", ")}\n`);

if (!existsSync(dataRoot)) {
  console.error(`FATAL: data-root does not exist: ${dataRoot}`);
  process.exit(1);
}

// ── fail loud if there's no system `tar` (bsdtar on Windows 10+, GNU tar on linux) ──
function findTar() {
  const probe = spawnSync("tar", ["--version"], { encoding: "utf8" });
  if (probe.error) return null;
  const ver = (probe.stdout || probe.stderr || "").split("\n")[0].trim();
  return ver || "tar (version unknown)";
}
const tarVer = findTar();
if (!tarVer) {
  console.error(
    "FATAL: `tar` not found on PATH. Windows 10+ ships bsdtar; on linux install GNU tar. " +
      "This script delegates compression to the system tar.",
  );
  process.exit(1);
}
console.log(`  tar:       ${tarVer}\n`);

// ── manifest summary (eyeball that the pack matches expectations) ──
let manifestVersion = null;
const manifestPath = join(dataRoot, "manifest.json");
if (existsSync(manifestPath)) {
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifestVersion = m.version ?? null;
    console.log("manifest.json:");
    console.log(`  version:    ${m.version ?? "(none)"}`);
    console.log(`  poetCount:  ${m.poetCount ?? "(none)"}`);
    console.log(`  poemCount:  ${m.poemCount ?? "(none)"}\n`);
  } catch (e) {
    console.warn(`WARNING: manifest.json present but unreadable (${e.message}) — continuing without summary.\n`);
  }
} else {
  console.warn(`WARNING: no manifest.json under ${dataRoot} — cannot show poetCount/poemCount summary.\n`);
}

// ── stream SHA-256 of a file (never loads the whole archive into RAM) ──
function sha256File(file) {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    const s = createReadStream(file);
    s.on("error", rej);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => res(h.digest("hex")));
  });
}

const human = (bytes) => {
  const u = ["B", "KB", "MB", "GB"];
  let n = bytes,
    i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

async function main() {
  mkdirSync(outDir, { recursive: true });

  const produced = []; // { name, archive, hash }
  const missing = [];

  for (const name of include) {
    const srcDir = join(dataRoot, name);
    if (!existsSync(srcDir)) {
      missing.push(name);
      continue;
    }
    const archiveName = `${name}.tar.gz`;
    const archivePath = join(outDir, archiveName);
    console.log(`packing ${name}/ → ${archiveName} …`);
    // cwd = dataRoot so the archive holds a top-level `poems/` (not the full path) — extracting in
    // public/data restores public/data/poems/, exactly what Option A′'s `tar -xzf` expects.
    // IMPORTANT: pass the -f path RELATIVE to that cwd. An absolute Windows path like `C:\out\…` has a
    // drive-letter colon, which GNU tar (MSYS/Git-bash) parses as a remote `host:path` spec → "Cannot
    // connect to C". A relative `..\out\…` (or `out/…`) has no colon and works on both GNU tar AND
    // bsdtar; we deliberately avoid GNU-only `--force-local` so the script stays bsdtar-compatible.
    const archiveArg = relative(dataRoot, archivePath) || archiveName;
    const r = spawnSync("tar", ["-czf", archiveArg, name], { cwd: dataRoot, stdio: "inherit" });
    if (r.error) {
      console.error(`FATAL: tar failed to launch for ${name}: ${r.error.message}`);
      process.exit(1);
    }
    if (r.status !== 0) {
      console.error(`FATAL: tar exited ${r.status} packing ${name}/ — aborting.`);
      process.exit(1);
    }
    const size = statSync(archivePath).size;
    const hash = await sha256File(archivePath);
    produced.push({ name, archive: archiveName, hash });
    console.log(`  ${archiveName}  ${human(size)}  sha256=${hash}\n`);
  }

  for (const name of missing) {
    console.warn(
      `WARNING: requested dir "${name}" is MISSING under ${dataRoot} — NOT packed. ` +
        `(A fresh worktree has no git-ignored data; provision it per docs/DEPLOY.md §1.0 before packing for release.)`,
    );
  }

  if (produced.length === 0) {
    console.error(`\nNothing packed — none of [${include.join(", ")}] exist under ${dataRoot}. No SHA256SUMS.txt written.`);
    process.exit(1);
  }

  // ── SHA256SUMS.txt — exact `<hash>  <file>` format (two spaces) that `sha256sum -c` accepts ──
  const sumsPath = join(outDir, "SHA256SUMS.txt");
  const sumsBody = produced.map((p) => `${p.hash}  ${p.archive}`).join("\n") + "\n";
  writeFileSync(sumsPath, sumsBody, "utf8");
  console.log(`wrote SHA256SUMS.txt (${produced.length} entr${produced.length === 1 ? "y" : "ies"}):`);
  process.stdout.write(sumsBody.replace(/^/gm, "  "));
  console.log("");

  // ── print the exact follow-up gh commands (date from manifest version + system date) ──
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const vTag = manifestVersion != null ? `v${manifestVersion}` : "vN";
  const tag = `data-${vTag}-${today}`;
  const assetList = [...produced.map((p) => p.archive), "SHA256SUMS.txt"];
  const assetPaths = assetList.map((a) => `"${join(outDir, a)}"`).join(" ");

  console.log("── next: publish the cold backup ────────────────────────────────────────────");
  console.log(`# verify locally first (from ${outDir}):`);
  console.log(`#   sha256sum -c SHA256SUMS.txt`);
  console.log(`#`);
  console.log(`# create a NEW release for this data version:`);
  console.log(`gh release create ${tag} \\`);
  console.log(`  --repo Cohenjikan/shiyun --title "${tag}" --notes "诗云 data cold backup (${tag})" \\`);
  console.log(`  ${assetPaths}`);
  console.log(`#`);
  console.log(`# …OR re-upload onto an EXISTING release (overwrite same-named assets):`);
  console.log(`gh release upload ${tag} --repo Cohenjikan/shiyun --clobber \\`);
  console.log(`  ${assetPaths}`);
  console.log("─────────────────────────────────────────────────────────────────────────────");
  if (manifestVersion == null) {
    console.log(`(NOTE: no manifest version found — replace the "${vTag}" in the tag with the real data version.)`);
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e?.stack || e}`);
  process.exit(1);
});
