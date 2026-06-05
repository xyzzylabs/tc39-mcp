// Pure cross-spec search, shared by the stdio server and the Cloudflare
// Worker so `spec.global_search` ranks + interleaves identically on both
// transports. Builds on the shared single-spec ranker in ./search.ts;
// dependency-free so the Worker bundles it directly.

import {
  searchClauses,
  type SearchableClause,
  type SpecSearchHit,
} from "./search.js";

/** One ranked hit, tagged with the spec it came from. Same shape as
 *  `SpecSearchHit` plus `spec`. */
export interface GlobalSearchHit extends SpecSearchHit {
  spec: string;
}

/** Search every supplied spec's clauses with the shared single-spec
 *  ranker, tag each hit with its spec, then interleave by score (then
 *  section number) and trim to `limit`. Each spec is ranked + capped at
 *  `limit` first, so an over-saturated spec can't shut the other out
 *  before the global trim. */
export function searchAcrossSpecs(
  inputs: { spec: string; clauses: Record<string, SearchableClause> }[],
  opts: { query: string; searchSteps?: boolean; limit?: number },
): GlobalSearchHit[] {
  const limit = opts.limit ?? 20;
  const all: GlobalSearchHit[] = [];
  for (const { spec, clauses } of inputs) {
    const hits = searchClauses(clauses, {
      query: opts.query,
      searchSteps: opts.searchSteps,
      limit,
    });
    for (const h of hits) all.push({ ...h, spec });
  }
  all.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
  return all.slice(0, limit);
}
