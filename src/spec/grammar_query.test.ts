import { describe, it, expect } from "vitest";
import { queryGrammar, type GrammarRow } from "./grammar_query.js";

const GRAMMAR: GrammarRow[] = [
  {
    nonterminal: "Statement",
    parameters: ["Yield"],
    rhs: ["BlockStatement", "IfStatement"],
    clause_id: "sec-statements",
    standalone: true,
  },
  {
    nonterminal: "Statement",
    parameters: [],
    rhs: ["BreakableStatement"],
    clause_id: "sec-statements",
    standalone: true,
  },
  {
    nonterminal: "BindingIdentifier",
    parameters: ["Yield", "Await"],
    rhs: ["Identifier", "yield", "await"],
    clause_id: "sec-identifiers",
    standalone: true,
  },
  {
    nonterminal: "SdoAttached",
    parameters: [],
    rhs: ["x"],
    clause_id: "sec-sdo",
    standalone: false,
  },
];

describe("queryGrammar — list mode", () => {
  it("aggregates standalone productions by non-terminal, sorted", () => {
    const r = queryGrammar(GRAMMAR, {});
    if (r.mode !== "list") throw new Error("expected list mode");
    // SdoAttached is excluded (standalone:false, include_sdo off).
    expect(r.total).toBe(2);
    expect(r.nonterminals.map((n) => n.nonterminal)).toEqual([
      "BindingIdentifier",
      "Statement",
    ]);
  });

  it("counts productions and dedupes clause ids", () => {
    const r = queryGrammar(GRAMMAR, {});
    if (r.mode !== "list") throw new Error("expected list mode");
    const stmt = r.nonterminals.find((n) => n.nonterminal === "Statement")!;
    expect(stmt.production_count).toBe(2);
    expect(stmt.clause_ids).toEqual(["sec-statements"]);
  });

  it("include_sdo folds in SDO-attached productions", () => {
    const r = queryGrammar(GRAMMAR, { includeSdo: true });
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.total).toBe(3);
  });

  it("respects the limit", () => {
    const r = queryGrammar(GRAMMAR, { limit: 1 });
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.nonterminals.length).toBe(1);
    expect(r.total).toBe(2); // total is pre-cap
  });
});

describe("queryGrammar — by_nonterminal mode", () => {
  it("returns exact-match productions", () => {
    const r = queryGrammar(GRAMMAR, { nonterminal: "Statement" });
    if (r.mode !== "by_nonterminal") throw new Error("expected by_nonterminal");
    expect(r.total).toBe(2);
    expect(r.productions.every((p) => p.nonterminal === "Statement")).toBe(true);
  });

  it("returns empty for an unknown non-terminal", () => {
    const r = queryGrammar(GRAMMAR, { nonterminal: "NoSuchNonterminal" });
    if (r.mode !== "by_nonterminal") throw new Error("expected by_nonterminal");
    expect(r.total).toBe(0);
    expect(r.productions).toEqual([]);
  });
});

describe("queryGrammar — contains mode", () => {
  it("matches on RHS substring (case-insensitive)", () => {
    const r = queryGrammar(GRAMMAR, { contains: "YIELD" });
    if (r.mode !== "contains") throw new Error("expected contains mode");
    // Only BindingIdentifier has 'yield' in its RHS. `contains` does not
    // look at parameters, so Statement (parameters:["Yield"]) is excluded.
    expect(r.total).toBe(1);
    expect(r.productions[0]!.nonterminal).toBe("BindingIdentifier");
  });

  it("matches on the non-terminal name", () => {
    const r = queryGrammar(GRAMMAR, { contains: "statement" });
    if (r.mode !== "contains") throw new Error("expected contains mode");
    // Both Statement productions match by name.
    expect(r.total).toBe(2);
  });
});
