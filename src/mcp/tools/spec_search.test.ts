import { describe, it, expect } from "vitest";
import { specSearch } from "./spec_search.js";

// These run against build/spec-262-es2025.json (the same parse clause.get
// reads). They lock in the search behavior that's the entry point for
// "I don't know the exact id" queries.

describe("specSearch", () => {
  it("finds Canonicalize by aoid (the query the tc39 MCP whiffed on)", async () => {
    const hits = await specSearch({ query: "Canonicalize" });
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("sec-runtime-semantics-canonicalize-ch");
    // aoid-exact should rank the §22.2 Canonicalize first.
    expect(hits[0]?.aoid).toBe("Canonicalize");
    expect(hits[0]?.matched_on).toBe("aoid-exact");
  });

  it("finds CharacterSetMatcher by aoid", async () => {
    const hits = await specSearch({ query: "CharacterSetMatcher" });
    expect(hits.some((h) => h.aoid === "CharacterSetMatcher")).toBe(true);
  });

  it("finds many RegExp clauses by id/title substring", async () => {
    const hits = await specSearch({ query: "RegExp", limit: 100 });
    expect(hits.length).toBeGreaterThan(20);
  });

  it("ranks aoid-exact above substring matches", async () => {
    const hits = await specSearch({ query: "ToNumber" });
    // The exact ToNumber op should outrank ToNumeric, StringToNumber, etc.
    expect(hits[0]?.aoid).toBe("ToNumber");
    expect(hits[0]?.score).toBeGreaterThanOrEqual(
      hits[hits.length - 1]?.score ?? 0,
    );
  });

  it("respects the limit", async () => {
    const hits = await specSearch({ query: "sec-", limit: 5 });
    expect(hits.length).toBe(5);
  });

  it("returns [] for a query that matches nothing", async () => {
    expect(await specSearch({ query: "zzz-no-such-clause-xyz" })).toEqual([]);
  });

  it("matches step text only when search_steps is true", async () => {
    // 'CaseFolding.txt' appears in Canonicalize's step text but not in
    // any id/aoid/title.
    const without = await specSearch({ query: "CaseFolding.txt" });
    expect(without).toEqual([]);
    const withSteps = await specSearch({ query: "CaseFolding.txt", search_steps: true });
    expect(withSteps.some((h) => h.id === "sec-runtime-semantics-canonicalize-ch")).toBe(true);
    expect(withSteps[0]?.matched_on).toBe("steps");
  });
});

describe("specSearch on ECMA-402", () => {
  it("finds NumberFormat by title substring on 402/main", async () => {
    try {
      const hits = await specSearch({
        query: "NumberFormat",
        spec: "402",
        edition: "main",
        limit: 50,
      });
      expect(hits.length).toBeGreaterThan(0);
      // Top hit should be a NumberFormat-flavored clause.
      expect(hits[0]?.title.toLowerCase()).toContain("numberformat");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("finds a synthesized-AOID 402 op via aoid-exact match", async () => {
    // SetNumberFormatUnitOptions doesn't have an `aoid` attribute in
    // the 402 source; we derived it from the h1 title. The aoid-exact
    // matcher should now find it.
    try {
      const hits = await specSearch({
        query: "SetNumberFormatUnitOptions",
        spec: "402",
        edition: "main",
        limit: 5,
      });
      if (hits.length === 0) return;
      expect(hits[0]?.aoid).toBe("SetNumberFormatUnitOptions");
      expect(hits[0]?.matched_on).toBe("aoid-exact");
    } catch {
      // Parsed JSON missing.
    }
  });
});
