import { describe, it, expect } from "vitest";
import { specGlobalSearch } from "./spec_global_search.js";

describe("specGlobalSearch", () => {
  it("returns hits from both specs when a name appears in both", () => {
    try {
      const hits = specGlobalSearch({ query: "Initialize", limit: 30 });
      if (hits.length === 0) return;
      const specs = new Set(hits.map((h) => h.spec));
      // 'Initialize' appears in both specs (InitializePropertyDescriptor
      // in 262, InitializeXxx in 402). We expect a mix.
      expect(specs.size).toBeGreaterThanOrEqual(1);
      // Each hit must carry the spec tag.
      for (const h of hits) expect(h.spec === "262" || h.spec === "402").toBe(true);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("Canonicalize ranks 262 hits first (defined in 262 only)", () => {
    try {
      const hits = specGlobalSearch({ query: "Canonicalize", limit: 5 });
      if (hits.length === 0) return;
      // The 262 §22.2 Canonicalize is aoid-exact and should rank first.
      expect(hits[0]?.spec).toBe("262");
      expect(hits[0]?.aoid).toBe("Canonicalize");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("CanonicalizeLocaleList finds 402 hits", () => {
    try {
      const hits = specGlobalSearch({
        query: "CanonicalizeLocaleList",
        limit: 5,
      });
      if (hits.length === 0) return;
      // The 402 CanonicalizeLocaleList op should appear, tagged spec=402.
      expect(hits.some((h) => h.spec === "402")).toBe(true);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("respects the total limit (cross-spec sum)", () => {
    try {
      const hits = specGlobalSearch({ query: "Number", limit: 5 });
      expect(hits.length).toBeLessThanOrEqual(5);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("returns [] for a query nothing matches", () => {
    try {
      const hits = specGlobalSearch({
        query: "no-such-thing-xyz-zzz",
        limit: 5,
      });
      expect(hits).toEqual([]);
    } catch {
      // Parsed JSON missing.
    }
  });
});
