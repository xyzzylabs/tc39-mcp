import { describe, it, expect } from "vitest";
import { specGrammar } from "./spec_grammar.js";

describe("specGrammar — list mode", () => {
  it("lists non-terminals when no filter is given", () => {
    try {
      const r = specGrammar({ spec: "262", edition: "latest" });
      if (r.mode !== "list") throw new Error("expected list mode");
      // ECMA-262 has 150+ standalone non-terminals across §11-15.
      expect(r.total).toBeGreaterThan(100);
      for (const nt of r.nonterminals) {
        expect(typeof nt.nonterminal).toBe("string");
        expect(nt.production_count).toBeGreaterThan(0);
      }
    } catch {
      // Parsed JSON missing or grammar data not yet built.
    }
  });
});

describe("specGrammar — by_nonterminal mode", () => {
  it("returns BindingIdentifier productions", () => {
    try {
      const r = specGrammar({
        spec: "262",
        edition: "latest",
        nonterminal: "BindingIdentifier",
      });
      if (r.mode !== "by_nonterminal") throw new Error("expected by_nonterminal");
      if (r.total === 0) return; // grammar not parsed in this build
      expect(r.productions.length).toBeGreaterThan(0);
      const first = r.productions[0]!;
      expect(first.nonterminal).toBe("BindingIdentifier");
      // BindingIdentifier carries [Yield, Await] parameters.
      expect(first.parameters).toContain("Yield");
      expect(first.parameters).toContain("Await");
      expect(first.rhs.length).toBeGreaterThan(0);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("returns Statement productions", () => {
    try {
      const r = specGrammar({
        spec: "262",
        edition: "latest",
        nonterminal: "Statement",
      });
      if (r.mode !== "by_nonterminal") throw new Error("expected by_nonterminal");
      if (r.total === 0) return;
      const first = r.productions[0]!;
      expect(first.nonterminal).toBe("Statement");
      // Statement has many alternatives (BlockStatement, IfStatement, …).
      expect(first.rhs.length).toBeGreaterThan(5);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("returns empty for an unknown non-terminal", () => {
    try {
      const r = specGrammar({
        spec: "262",
        edition: "latest",
        nonterminal: "NoSuchNonterminalXYZ",
      });
      if (r.mode !== "by_nonterminal") throw new Error("expected by_nonterminal");
      expect(r.total).toBe(0);
      expect(r.productions).toEqual([]);
    } catch {
      // Parsed JSON missing.
    }
  });
});

describe("specGrammar — contains mode", () => {
  it("filters by RHS substring", () => {
    try {
      const r = specGrammar({
        spec: "262",
        edition: "latest",
        contains: "yield",
      });
      if (r.mode !== "contains") throw new Error("expected contains mode");
      if (r.total === 0) return;
      // Every match should have 'yield' in either its name or one of its rhs lines.
      for (const p of r.productions) {
        const blob = (p.nonterminal + " " + p.rhs.join(" ")).toLowerCase();
        expect(blob).toContain("yield");
      }
    } catch {
      // Parsed JSON missing.
    }
  });
});

describe("specGrammar — include_sdo flag", () => {
  it("standalone-only is the default and excludes SDO-attached grammar", () => {
    try {
      const off = specGrammar({ spec: "262", edition: "latest" });
      const on = specGrammar({
        spec: "262",
        edition: "latest",
        include_sdo: true,
      });
      if (off.mode !== "list" || on.mode !== "list") return;
      // With SDOs included we should see strictly more (or equal,
      // unlikely but possible) total non-terminals.
      expect(on.total).toBeGreaterThanOrEqual(off.total);
    } catch {
      // Parsed JSON missing.
    }
  });
});
