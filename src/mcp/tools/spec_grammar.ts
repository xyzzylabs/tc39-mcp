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
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: es2016 … es2025, main. Aliases: latest, draft, next.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Max productions (or non-terminal groups in list mode) returned."),
};

export const specGrammarExamples = [
  {
    q: "Every standalone production for BindingIdentifier",
    input: { nonterminal: "BindingIdentifier" },
  },
  {
    q: "Productions mentioning `yield`",
    input: { contains: "yield" },
  },
] as const;

/** One row in the list-mode summary of `spec.grammar`: one
 *  non-terminal name plus how many productions define it and which
 *  clauses they live in. */
export interface NonterminalSummary {
  /** Left-hand side of the production block (e.g. `BindingIdentifier`). */
  nonterminal: string;
  /** Total number of standalone productions defining this non-terminal. */
  production_count: number;
  /** Spec clause ids that host those productions, deduplicated. */
  clause_ids: string[];
}

/** Output of `spec.grammar`. Two discriminated variants:
 *
 *  - `by_nonterminal` / `contains` modes return matching productions.
 *  - `list` mode returns a summary of every known non-terminal. */
export type SpecGrammarResult =
  | {
      /** `by_nonterminal` when the `nonterminal` arg was given;
       *  `contains` when only the `contains` arg was given. */
      mode: "by_nonterminal" | "contains";
      /** Which TC39 spec the productions came from. */
      spec: Spec;
      /** Matched productions, capped at `limit`. */
      productions: GrammarProduction[];
      /** Total productions matching before the `limit` cap. */
      total: number;
    }
  | {
      /** `list` when neither filter argument was given. */
      mode: "list";
      /** Which TC39 spec the listing came from. */
      spec: Spec;
      /** One summary row per non-terminal, capped at `limit`. */
      nonterminals: NonterminalSummary[];
      /** Total non-terminals before the `limit` cap. */
      total: number;
    };

export async function specGrammar(args: {
  nonterminal?: string;
  contains?: string;
  include_sdo?: boolean;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): Promise<SpecGrammarResult> {
  const spec = args.spec ?? "262";
  const parsed = await loadSpec(spec, args.edition ?? "latest");
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
