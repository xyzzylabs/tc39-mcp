// MCP tool: spec.global_search — run `spec.search` across both
// ECMA-262 and ECMA-402 in one call, return merged + sorted hits.
//
// Each hit is tagged with the spec it came from. Useful when the
// caller doesn't know which spec defines the symbol they're looking
// for (e.g. `Canonicalize` lives in 262, `CanonicalizeLocaleList`
// lives in 402 — global search returns both in score order).
//
// The ranking + interleaving lives in `src/spec/global_search.ts`
// (built on the shared single-spec ranker) so the stdio server and the
// Cloudflare Worker rank a cross-spec query identically.

import { z } from "zod";
import { loadSpec } from "./clause.js";
import { searchAcrossSpecs } from "../../spec/global_search.js";
import { type SpecSearchHit } from "../../spec/search.js";
import { SPEC_VALUES, type Spec } from "../../editions.js";

export const specGlobalSearchSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Search text. Matched against clause id, aoid, and title across both specs (and step text when search_steps is true).",
    ),
  search_steps: z
    .boolean()
    .default(false)
    .describe("Also match against algorithm step text. Slower + noisier; off by default."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Total hits across both specs combined."),
};

export const specGlobalSearchExamples = [
  {
    q: "Where is Canonicalize defined across both specs?",
    input: { query: "Canonicalize" },
  },
] as const;

/** One ranked search hit, tagged with the spec it came from. Returned
 *  by `spec.global_search` as an interleaved list across both 262 and
 *  402, sorted by score. Same shape as `SpecSearchHit` plus `spec`. */
export interface GlobalSearchHit extends SpecSearchHit {
  /** Which TC39 spec contains the matching clause: `262` or `402`. */
  spec: Spec;
}

export async function specGlobalSearch(args: {
  query: string;
  search_steps?: boolean;
  limit?: number;
}): Promise<GlobalSearchHit[]> {
  // Load both specs at their own `latest` in parallel so the cold path
  // doesn't pay 2× the snapshot latency. A spec whose parsed JSON is
  // missing locally is skipped rather than crashing the whole call.
  const loaded = await Promise.all(
    SPEC_VALUES.map(async (spec) => {
      try {
        const parsed = await loadSpec(spec, "latest");
        return { spec, clauses: parsed.clauses };
      } catch {
        return null;
      }
    }),
  );
  const inputs = loaded.filter((x): x is NonNullable<typeof x> => x !== null);
  return searchAcrossSpecs(inputs, {
    query: args.query,
    searchSteps: args.search_steps,
    limit: args.limit,
  }) as GlobalSearchHit[];
}
