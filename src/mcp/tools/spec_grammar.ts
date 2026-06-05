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
//
// The query logic lives in `src/spec/grammar_query.ts` so the stdio
// server and the Cloudflare Worker answer it identically.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import {
  type Edition,
  type Spec,
} from "../../editions.js";
import {
  queryGrammar,
  type GrammarQueryResult,
  type NonterminalSummary,
} from "../../spec/grammar_query.js";

export type { NonterminalSummary };

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
  spec: specArg,
  edition: editionArg,
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

/** Output of `spec.grammar`: the shared grammar-query result plus which
 *  TC39 spec it was drawn from. */
export type SpecGrammarResult = { spec: Spec } & GrammarQueryResult;

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
  const core = queryGrammar(parsed.grammar ?? [], {
    nonterminal: args.nonterminal,
    contains: args.contains,
    includeSdo: args.include_sdo,
    limit: args.limit,
  });
  return { spec, ...core };
}
