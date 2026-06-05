import { describe, it, expect } from "vitest";
import { searchAcrossSpecs } from "./global_search.js";
import { type SearchableClause } from "./search.js";

const C262: Record<string, SearchableClause> = {
  "sec-canon": {
    meta: { aoid: "Canonicalize", title: "Canonicalize ( ch )", number: "11.1", kind: "op" },
    algorithms: [],
  },
  "sec-tonum": {
    meta: { aoid: "ToNumber", title: "ToNumber ( x )", number: "7.1.4", kind: "op" },
    algorithms: [],
  },
};

const C402: Record<string, SearchableClause> = {
  "sec-canon-locale": {
    meta: {
      aoid: "CanonicalizeLocaleList",
      title: "CanonicalizeLocaleList ( locales )",
      number: "9.2.1",
      kind: "op",
    },
    algorithms: [],
  },
};

const INPUTS = [
  { spec: "262", clauses: C262 },
  { spec: "402", clauses: C402 },
];

describe("searchAcrossSpecs", () => {
  it("interleaves both specs by score and tags each hit", () => {
    const hits = searchAcrossSpecs(INPUTS, { query: "Canonicalize" });
    // 262 Canonicalize (aoid-exact, 100) ranks above 402
    // CanonicalizeLocaleList (aoid-substring, 80).
    expect(hits.map((h) => [h.spec, h.aoid])).toEqual([
      ["262", "Canonicalize"],
      ["402", "CanonicalizeLocaleList"],
    ]);
    expect(hits[0]!.score).toBe(100);
    expect(hits[1]!.score).toBe(80);
  });

  it("lets a high-scoring hit from the second spec win", () => {
    const hits = searchAcrossSpecs(INPUTS, { query: "CanonicalizeLocaleList" });
    // Only 402 matches (262 has no such aoid).
    expect(hits.length).toBe(1);
    expect(hits[0]!.spec).toBe("402");
    expect(hits[0]!.score).toBe(100);
  });

  it("applies the limit across the merged result", () => {
    const hits = searchAcrossSpecs(INPUTS, { query: "Canonicalize", limit: 1 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.aoid).toBe("Canonicalize"); // the top-ranked one
  });

  it("returns [] when nothing matches", () => {
    const hits = searchAcrossSpecs(INPUTS, { query: "no-such-symbol-xyz" });
    expect(hits).toEqual([]);
  });

  it("skips an empty spec list", () => {
    expect(searchAcrossSpecs([], { query: "Canonicalize" })).toEqual([]);
  });
});
