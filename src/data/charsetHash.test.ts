import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { charsetHash, checkCharset, EXPECTED_CHARSET_HASH } from "./charsetHash";

// The pure charset-hash helper guards data↔code version skew (a mismatched 字库 deploy silently
// re-maps every 编号 permalink). These tests freeze the algorithm (golden hashes of tiny fixtures)
// and prove mismatch detection, plus that EXPECTED_CHARSET_HASH equals the SHIPPED charset's real value.

describe("charsetHash — frozen FNV-1a over the chars string", () => {
  // FROZEN golden values (literal output of the current charsetHash on each fixture).
  it("ascii fixture", () => expect(charsetHash("abc")).toBe("1a47e90b"));
  it("汉字 fixture", () => expect(charsetHash("不人一")).toBe("a5f19b32"));
  it("empty string → bare FNV offset basis", () => expect(charsetHash("")).toBe("811c9dc5"));
});

describe("checkCharset — mismatch detection", () => {
  // A fixture whose recomputed hash equals its declared field but NOT the expected constant:
  // this is the real-world failure (a coherent but WRONG charset deploy).
  it("flags ok=false when computed != EXPECTED even if the file's self-hash agrees", () => {
    const r = checkCharset("abc", "1a47e90b"); // self-consistent, but not the shipped charset
    expect(r.computed).toBe("1a47e90b");
    expect(r.expected).toBe(EXPECTED_CHARSET_HASH);
    expect(r.ok).toBe(false); // computed != expected
  });

  it("flags ok=false when the file's declared hash disagrees with the recomputed value", () => {
    const r = checkCharset("abc", "deadbeef"); // corrupted/edited self-hash
    expect(r.ok).toBe(false);
    expect(r.fileHash).toBe("deadbeef");
  });

  it("tolerates an absent file hash (checks against EXPECTED only)", () => {
    const r = checkCharset("abc"); // no fileHash → only the EXPECTED comparison gates ok
    expect(r.fileHash).toBeUndefined();
    expect(r.ok).toBe(false); // still false: "abc" isn't the shipped charset
  });
});

// EXPECTED_CHARSET_HASH must equal the SHIPPED charset's real hash, recomputed from its chars —
// this is the test that fails LOUD if someone bumps the constant without a real REFLOW rebuild,
// or if the shipped charset drifts from the constant. Reads the in-repo public/data/charset.json.
describe("EXPECTED_CHARSET_HASH matches the shipped public/data/charset.json", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  it("recomputed hash of the shipped chars == EXPECTED == the file's own hash field", () => {
    const cs = JSON.parse(readFileSync(join(ROOT, "public", "data", "charset.json"), "utf8")) as {
      hash: string;
      chars: string;
    };
    const computed = charsetHash(cs.chars);
    expect(computed).toBe(cs.hash); // the file's self-hash is honest
    expect(computed).toBe(EXPECTED_CHARSET_HASH); // and the code's frozen constant agrees
    expect(checkCharset(cs.chars, cs.hash).ok).toBe(true); // full check passes on the real data
  });
});
