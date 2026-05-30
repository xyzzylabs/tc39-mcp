// MCP tool: spec.global_search — run `spec.search` across both
// ECMA-262 and ECMA-402 in one call, return merged + sorted hits.
//
// Each hit is tagged with the spec it came from. Useful when the
// caller doesn't know which spec defines the symbol they're looking
// for (e.g. `Canonicalize` lives in 262, `CanonicalizeLocaleList`
// lives in 402 — global search returns both in score order).
//
// This is a thin wrapper over `specSearch`; the ranking model is
// identical. The only added behavior is interleaving the two specs'
// results by score and tagging each row.

import { z } from "zod";
import { specSearch, type SpecSearchHit } from "./spec_search.js";
import { SPEC_VALUES, type Spec } from "../../editions.js";

export const specGlobalSearchSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Search text. Matched against clause id, aoid, and title across both specs (and step text when search_steps is true).",
    ),
  /** `latest` per-spec resolution: 262 → es2025; 402 → main. */
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

export interface GlobalSearchHit extends SpecSearchHit {
  spec: Spec;
}

export function specGlobalSearch(args: {
  query: string;
  search_steps?: boolean;
  limit?: number;
}): GlobalSearchHit[] {
  const limit = args.limit ?? 20;
  const search_steps = args.search_steps ?? false;
  const all: GlobalSearchHit[] = [];

  // Per-spec searches use each spec's `latest` resolution (which is
  // spec-aware: es2025 for 262, main for 402). Limit per-spec to
  // `limit` so an over-saturated 262 can't shut 402 out completely;
  // we re-trim after interleaving.
  for (const spec of SPEC_VALUES) {
    try {
      const hits = specSearch({
        query: args.query,
        spec,
        edition: "latest",
        search_steps,
        limit,
      });
      for (const h of hits) all.push({ ...h, spec });
    } catch {
      // Parsed JSON for one spec might be missing locally; skip it
      // rather than crash the whole call.
    }
  }

  // Sort by score desc, then by section number (ascending). Score
  // dominates so cross-spec interleaving is rank-based, not
  // alphabetic-by-spec.
  all.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
  return all.slice(0, limit);
}
