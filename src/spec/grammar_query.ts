// Pure `spec.grammar` query logic, shared by the stdio server and the
// Cloudflare Worker so both transports answer a grammar query
// identically. Dependency-free (no node:fs / parser imports) so the
// Worker bundles it directly, the same way it bundles ./search.ts and
// ./catalog.ts.

/** The minimal grammar-production shape this query reads. Structurally
 *  satisfied by the parser's `GrammarProduction`, so each caller passes
 *  its own parsed productions unchanged. */
export interface GrammarRow {
  nonterminal: string;
  parameters: string[];
  rhs: string[];
  clause_id?: string;
  /** False when the block was captured as an SDO algorithm header
   *  rather than a standalone lexical/syntactic definition. */
  standalone: boolean;
}

/** One row in the list-mode summary: a non-terminal name plus how many
 *  productions define it and which clauses host them. */
export interface NonterminalSummary {
  /** Left-hand side of the production block (e.g. `BindingIdentifier`). */
  nonterminal: string;
  /** Total number of productions defining this non-terminal. */
  production_count: number;
  /** Spec clause ids that host those productions, deduplicated. */
  clause_ids: string[];
}

/** Core result of a grammar query, without the echoed `spec` field
 *  (each transport adds that). Two discriminated variants:
 *
 *  - `by_nonterminal` / `contains` modes return matching productions.
 *  - `list` mode returns a summary of every matched non-terminal. */
export type GrammarQueryResult =
  | {
      /** `by_nonterminal` when the `nonterminal` filter was given;
       *  `contains` when only the `contains` filter was given. */
      mode: "by_nonterminal" | "contains";
      /** Matched productions, capped at `limit`. */
      productions: GrammarRow[];
      /** Total productions matching before the `limit` cap. */
      total: number;
    }
  | {
      /** `list` when neither filter was given. */
      mode: "list";
      /** One summary row per non-terminal, capped at `limit`. */
      nonterminals: NonterminalSummary[];
      /** Total non-terminals before the `limit` cap. */
      total: number;
    };

/** Query a spec's captured grammar productions. Three modes, selected
 *  by which filter is present:
 *
 *  1. `nonterminal` → every production whose LHS exactly matches.
 *  2. `contains` → productions whose non-terminal name or an RHS line
 *     contains the substring (case-insensitive).
 *  3. neither → a summary of every non-terminal + its production count.
 *
 *  `includeSdo` controls whether SDO-attached productions are folded in;
 *  off by default, so callers see only the standalone grammar. */
export function queryGrammar(
  grammar: readonly GrammarRow[],
  opts: {
    nonterminal?: string;
    contains?: string;
    includeSdo?: boolean;
    limit?: number;
  },
): GrammarQueryResult {
  const limit = opts.limit ?? 100;
  const includeSdo = opts.includeSdo ?? false;
  const all = grammar.filter((g) => includeSdo || g.standalone);

  if (opts.nonterminal) {
    const matches = all.filter((g) => g.nonterminal === opts.nonterminal);
    return {
      mode: "by_nonterminal",
      total: matches.length,
      productions: matches.slice(0, limit),
    };
  }

  if (opts.contains) {
    const q = opts.contains.toLowerCase();
    const matches = all.filter(
      (g) =>
        g.nonterminal.toLowerCase().includes(q) ||
        g.rhs.some((r) => r.toLowerCase().includes(q)),
    );
    return {
      mode: "contains",
      total: matches.length,
      productions: matches.slice(0, limit),
    };
  }

  // List mode: aggregate by non-terminal name.
  const byNT = new Map<string, NonterminalSummary>();
  for (const g of all) {
    let s = byNT.get(g.nonterminal);
    if (!s) {
      s = { nonterminal: g.nonterminal, production_count: 0, clause_ids: [] };
      byNT.set(g.nonterminal, s);
    }
    s.production_count++;
    if (g.clause_id && !s.clause_ids.includes(g.clause_id)) {
      s.clause_ids.push(g.clause_id);
    }
  }
  const list = Array.from(byNT.values()).sort((a, b) =>
    a.nonterminal.localeCompare(b.nonterminal),
  );
  return { mode: "list", total: list.length, nonterminals: list.slice(0, limit) };
}
