// MCP tool: spec.grammar — query standalone grammar productions
// captured by the parser.
//
// ECMA-262's §11–§15 + Annex B define the lexical and syntactic
// grammars in `<emu-grammar>` blocks. The parser captures each one as
// a structured `{ nonterminal, parameters, rhs[], clause_id }`. This
// tool serves them.
//
// Three query modes:
//
//   1. `{ nonterminal: "BindingIdentifier" }`
//      → return every production whose left-hand side is BindingIdentifier.
//   2. `{ contains: "yield" }`
//      → return productions whose RHS lines or non-terminal name contain
//      this substring (case-insensitive).
//   3. neither → list all known non-terminals + their production counts
//      (lightweight summary; follow up with mode #1 for a specific one).
//
// `include_sdo` controls whether SDO-attached productions are included.
// By default we return only standalone definitions, which is what most
// callers want when asking "what does BindingIdentifier look like?".

import { z } from "zod";
import { loadSpec } from "./clause.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  type Edition,
  type Spec,
} from "../../editions.js";
import type { GrammarProduction } from "../../parser/schema.js";

export const specGrammarSchema = {
  nonterminal: z
    .string()
    .optional()
    .describe(
      "Filter to productions defining this non-terminal (exact match). Example: 'BindingIdentifier'.",
    ),
  contains: z
    .string()
    .optional()
    .describe(
      "Filter to productions whose RHS lines or non-terminal name contain this substring (case-insensitive).",
    ),
  include_sdo: z
    .boolean()
    .default(false)
    .describe(
      "If true, also include productions captured as SDO algorithm headers. Off by default — most callers want the standalone lexical/syntactic grammar definitions.",
    ),
  spec: z
    .enum(SPEC_VALUES)
    .default("262")
    .describe(
      "Which TC39 spec to read: '262' (core language, default) or '402' (Internationalization API).",
    ),
  edition: z
    .enum(EDITION_VALUES)
    .default("latest")
    .describe(
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: main, es2025-candidate. Aliases: latest, draft, next.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Max productions (or non-terminal groups in list mode) returned."),
};

export interface NonterminalSummary {
  nonterminal: string;
  production_count: number;
  clause_ids: string[];
}

export type SpecGrammarResult =
  | {
      mode: "by_nonterminal" | "contains";
      spec: Spec;
      productions: GrammarProduction[];
      total: number;
    }
  | {
      mode: "list";
      spec: Spec;
      nonterminals: NonterminalSummary[];
      total: number;
    };

export function specGrammar(args: {
  nonterminal?: string;
  contains?: string;
  include_sdo?: boolean;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): SpecGrammarResult {
  const spec = args.spec ?? "262";
  const parsed = loadSpec(spec, args.edition ?? "latest");
  const limit = args.limit ?? 100;
  const includeSdo = args.include_sdo ?? false;

  const all = (parsed.grammar ?? []).filter((g) => includeSdo || g.standalone);

  if (args.nonterminal) {
    const matches = all.filter((g) => g.nonterminal === args.nonterminal);
    return {
      mode: "by_nonterminal",
      spec,
      total: matches.length,
      productions: matches.slice(0, limit),
    };
  }

  if (args.contains) {
    const q = args.contains.toLowerCase();
    const matches = all.filter((g) => {
      if (g.nonterminal.toLowerCase().includes(q)) return true;
      for (const r of g.rhs) {
        if (r.toLowerCase().includes(q)) return true;
      }
      return false;
    });
    return {
      mode: "contains",
      spec,
      total: matches.length,
      productions: matches.slice(0, limit),
    };
  }

  // List mode: aggregate by non-terminal name.
  const byNT = new Map<string, NonterminalSummary>();
  for (const g of all) {
    if (!byNT.has(g.nonterminal)) {
      byNT.set(g.nonterminal, {
        nonterminal: g.nonterminal,
        production_count: 0,
        clause_ids: [],
      });
    }
    const s = byNT.get(g.nonterminal)!;
    s.production_count++;
    if (g.clause_id && !s.clause_ids.includes(g.clause_id)) {
      s.clause_ids.push(g.clause_id);
    }
  }
  const list = Array.from(byNT.values()).sort((a, b) =>
    a.nonterminal.localeCompare(b.nonterminal),
  );
  return {
    mode: "list",
    spec,
    total: list.length,
    nonterminals: list.slice(0, limit),
  };
}
