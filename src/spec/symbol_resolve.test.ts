import { describe, it, expect } from "vitest";
import {
  classifySymbol,
  resolveSymbol,
  type SymbolResolveClause,
} from "./symbol_resolve.js";

function clause(
  meta: { aoid?: string | null; title?: string; number?: string },
  stepText: string,
): SymbolResolveClause {
  return {
    meta: { aoid: meta.aoid ?? null, title: meta.title ?? "", number: meta.number ?? "" },
    signatureRaw: meta.title ?? null,
    notes: [],
    algorithms: [{ steps: [{ text: stepText, substeps: [] }] }],
  };
}

describe("classifySymbol", () => {
  it("recognizes the three sigils + unrecognized", () => {
    expect(classifySymbol("[[Prototype]]")).toEqual({ kind: "internal-slot", name: "Prototype" });
    expect(classifySymbol("%Object.prototype%")).toEqual({ kind: "intrinsic", name: "Object.prototype" });
    expect(classifySymbol("~number~")).toEqual({ kind: "sigil-enum", name: "number" });
    expect(classifySymbol("plain")).toEqual({ kind: "unrecognized", name: "plain" });
  });
});

describe("resolveSymbol", () => {
  const clauses: Record<string, SymbolResolveClause> = {
    "sec-ordinary": clause(
      { title: "Ordinary [[Get]]", number: "10.1.8" },
      "Return the value of the [[Prototype]] slot.",
    ),
    "sec-type": clause(
      { title: "Object Type", number: "6.1.7" },
      "The [[Prototype]] internal slot ... [[Prototype]] again.",
    ),
    "sec-unrelated": clause({ title: "ToString", number: "7.1.17" }, "No slots here."),
  };

  it("ranks clauses by occurrence + a definition-section bump", () => {
    const r = resolveSymbol(clauses, { notation: "[[Prototype]]" });
    expect(r.kind).toBe("internal-slot");
    expect(r.name).toBe("Prototype");
    expect(r.hits.map((h) => h.id)).not.toContain("sec-unrelated");
    // sec-type: 2 mentions ×10 + §6 bump 25 = 45; sec-ordinary: 1×10 + §10
    // bump 25 = 35. sec-type ranks first.
    expect(r.hits[0]!.id).toBe("sec-type");
    expect(r.hits[0]!.match_count).toBe(2);
  });

  it("respects the limit", () => {
    const r = resolveSymbol(clauses, { notation: "[[Prototype]]", limit: 1 });
    expect(r.hits.length).toBe(1);
  });

  it("returns no hits for an absent notation", () => {
    const r = resolveSymbol(clauses, { notation: "[[Nonexistent]]" });
    expect(r.hits).toEqual([]);
  });
});
