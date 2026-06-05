// MCP tool: spec.search — full-text-ish search over the parsed spec so
// agents can find a clause from a symptom ("Canonicalize", "unbound
// this") rather than needing the exact id. clause.get needs the id;
// this is the entry point that produces ids.
//
// Ranking (highest first):
//   exact aoid match > aoid substring > title substring > id substring
//   > step-text substring (only when search_steps is true)
//
// Returns lightweight rows ({id, aoid, title, number, kind, matched_on})
// so a follow-up clause.get fetches the full structured clause.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import { searchClauses } from "../../spec/search.js";
import {
  type Edition,
  type Spec,
} from "../../editions.js";

export const specSearchSchema = {
  query: z
    .string()
    .min(1)
    .describe("Search text. Matched against clause id, aoid, and title (and step text when search_steps is true)."),
  spec: specArg,
  edition: editionArg,
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Max ranked hits returned."),
  search_steps: z
    .boolean()
    .default(false)
    .describe("Also match against algorithm step text. Slower + noisier; off by default."),
};

export type SpecSearchArgs = {
  query: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
  search_steps?: boolean;
};

export const specSearchExamples = [
  {
    q: "Find the clause that defines Canonicalize",
    input: { query: "Canonicalize" },
    note: "Ranks aoid-exact matches first; useful when you have an op name from an error or a prose mention.",
  },
  {
    q: "Where is sloppy-mode unbound `this` resolved?",
    input: { query: "this", search_steps: true },
    note: "`search_steps: true` also scans algorithm step text. Slower + noisier than the default but the only way to catch in-step mentions.",
  },
] as const;

/** One ranked search hit from `spec.search`. Lightweight metadata —
 *  follow up with `clause.get` for the full structured clause. */
export interface SpecSearchHit {
  /** Spec clause id of the matching clause. */
  id: string;
  /** Abstract Operation ID of the matching clause, or `null` if it
   *  isn't an abstract operation. */
  aoid: string | null;
  /** `<h1>` text of the matching clause. */
  title: string;
  /** Section number, e.g. `7.1.4`. */
  number: string;
  /** Clause kind: `op`, `sdo`, `built-in function`, etc. */
  kind: string;
  /** Which field produced the highest-ranked match.
   *  Ordering (high → low): `aoid-exact`, `aoid`, `title`, `id`, `steps`. */
  matched_on: "aoid-exact" | "aoid" | "title" | "id" | "steps";
  /** Relevance score (0–100). Higher = stronger match. */
  score: number;
}

export async function specSearch(args: SpecSearchArgs): Promise<SpecSearchHit[]> {
  const spec = await loadSpec(args.spec ?? "262", args.edition ?? "latest");
  // Ranking lives in the shared, transport-agnostic `searchClauses` so
  // the stdio server and the hosted Worker rank a query identically.
  return searchClauses(spec.clauses, {
    query: args.query,
    searchSteps: args.search_steps,
    limit: args.limit,
  });
}
