import { describe, it, expect } from "vitest";
import { buildShareUrl, parseTarget, type Target } from "./permalink";

// Public poet ids may be query-mirrored for crawlers. Reversible poem coordinates are hash-only so they
// remain outside HTTP requests/access logs; legacy query-only links still restore.
const loc = (pathname: string, search: string, hash: string) => ({ pathname, search, hash });

describe("permalink — public poet mirror + local-only poem hash", () => {
  it("a poet target writes BOTH ?a= (mirror) and #a= (canonical)", () => {
    const t: Target = { kind: "a", value: "82a5851c" };
    expect(buildShareUrl(loc("/", "", ""), t)).toBe("/?a=82a5851c#a=82a5851c");
  });

  it("a poem target writes ONLY #p= (never a server-visible query)", () => {
    const t: Target = { kind: "p", value: "123456789" };
    expect(buildShareUrl(loc("/", "", ""), t)).toBe("/#p=123456789");
  });

  it("nothing selected strips our a/p from BOTH query and hash (no leftover)", () => {
    expect(buildShareUrl(loc("/", "?a=82a5851c", "#a=82a5851c"), null)).toBe("/");
    expect(buildShareUrl(loc("/", "?p=999", "#p=999"), null)).toBe("/");
  });

  it("UNRELATED query params are preserved when setting a target", () => {
    const t: Target = { kind: "a", value: "abc" };
    // utm_source must survive; our stale p= is replaced by the new a=
    const out = buildShareUrl(loc("/", "?utm_source=weibo&p=999", "#p=999"), t);
    expect(out).toBe("/?utm_source=weibo&a=abc#a=abc");
  });

  it("UNRELATED query params are preserved when CLEARING the target", () => {
    expect(buildShareUrl(loc("/", "?utm_source=weibo&a=abc", "#a=abc"), null)).toBe("/?utm_source=weibo");
  });

  it("switching from a poet to a poem removes the server-visible query", () => {
    const t: Target = { kind: "p", value: "42" };
    expect(buildShareUrl(loc("/", "?a=old", "#a=old"), t)).toBe("/#p=42");
  });

  it("preserves a non-root pathname", () => {
    const t: Target = { kind: "a", value: "x" };
    expect(buildShareUrl(loc("/sub/", "", ""), t)).toBe("/sub/?a=x#a=x");
  });
});

describe("permalink — parseTarget (hash canonical, query fallback)", () => {
  it("OLD pure-hash link still parses (hash canonical, no query) — bit-for-bit compatible", () => {
    expect(parseTarget(loc("/", "", "#a=82a5851c"))).toEqual({ kind: "a", value: "82a5851c" });
    expect(parseTarget(loc("/", "", "#p=123"))).toEqual({ kind: "p", value: "123" });
  });

  it("query-ONLY link restores the target (the crawler-visible fallback)", () => {
    expect(parseTarget(loc("/", "?a=82a5851c", ""))).toEqual({ kind: "a", value: "82a5851c" });
    expect(parseTarget(loc("/", "?p=123", ""))).toEqual({ kind: "p", value: "123" });
  });

  it("hash WINS over the query when both present (hash is canonical)", () => {
    // a mirrored link has both; should they ever disagree, the canonical hash decides
    expect(parseTarget(loc("/", "?a=fromquery", "#a=fromhash"))).toEqual({ kind: "a", value: "fromhash" });
  });

  it("ignores unrelated query params and unknown hash keys", () => {
    expect(parseTarget(loc("/", "?utm_source=x", ""))).toBeNull();
    expect(parseTarget(loc("/", "", "#z=1"))).toBeNull();
    expect(parseTarget(loc("/", "", ""))).toBeNull();
  });

  it("round-trips: buildShareUrl then parseTarget recovers the same target", () => {
    for (const t of [{ kind: "a", value: "82a5851c" }, { kind: "p", value: "987654321" }] as Target[]) {
      const url = buildShareUrl(loc("/", "", ""), t);
      const [, search = "", hash = ""] = url.match(/^[^?#]*(\?[^#]*)?(#.*)?$/) || [];
      expect(parseTarget(loc("/", search, hash))).toEqual(t);
    }
  });
});
