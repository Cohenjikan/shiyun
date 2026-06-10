// ============================================================================
// CHARSET HASH — runtime data↔code version guard.
// ----------------------------------------------------------------------------
// The 字库 (charset.json) is a FROZEN bijection: each character's index IS its
// base-N digit, so every shared 编号 permalink (?p= / #p=) decodes to a poem ONLY
// against the exact same ordered charset this build of the code expects. If a
// deploy serves a DIFFERENT charset (wrong/mixed deploy, stale CDN, a *_v1_backup
// folder), the indices silently shift and every shared link points at the WRONG
// poem — with no error, no crash, just quietly-wrong content.
//
// build-data.mjs computes a hash over the joined chars string with FNV-1a 32-bit
// (offset 0x811c9dc5, prime 0x01000193) and stores it as charset.json.hash (hex).
// We DON'T trust that stored field alone (a mismatched file can carry a matching
// self-hash). Instead we RECOMPUTE the hash from the chars client-side and compare
// it to BOTH the file's own hash AND a frozen constant baked into THIS build.
// ============================================================================

// FNV-1a 32-bit over the raw chars string — byte-identical to build-data.mjs's
// charset-hash loop (`hh ^= charsStr.charCodeAt(i); hh = Math.imul(hh, 0x01000193)`)
// and to dynasties.ts::hashStr. Returns the lowercase hex string build-data writes.
export function charsetHash(chars: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < chars.length; i++) {
    h ^= chars.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// FROZEN: the charset hash THIS build of the code expects (= public/data/charset.json.hash,
// version 1, n=12877). Update ONLY on a deliberate REFLOW_CHARSET rebuild that re-shards all
// permalink-bearing data; a casual bump here silently accepts mismatched data.
export const EXPECTED_CHARSET_HASH = "a392703b";

export interface CharsetCheck {
  ok: boolean;
  /** Hash recomputed from the loaded chars (the source of truth). */
  computed: string;
  /** The hash the running code expects (frozen constant). */
  expected: string;
  /** The hash the file declares about itself (charset.json.hash), if present. */
  fileHash?: string;
}

// Verify a loaded charset against this build's expectation. `ok` is false when the
// RECOMPUTED hash differs from the expected constant (the load-bearing check) OR when
// the file's self-declared hash is present but disagrees with the recomputed value
// (a corrupted/edited file). Pure — no I/O, no console — so callers control reporting.
export function checkCharset(chars: string, fileHash?: string): CharsetCheck {
  const computed = charsetHash(chars);
  const matchesExpected = computed === EXPECTED_CHARSET_HASH;
  const matchesFile = fileHash == null || computed === fileHash;
  return { ok: matchesExpected && matchesFile, computed, expected: EXPECTED_CHARSET_HASH, fileHash };
}
