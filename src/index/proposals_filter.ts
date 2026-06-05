// Pure proposal.list filtering, shared by the stdio server and the
// Cloudflare Worker so both apply the same spec / stage / champion /
// contains filters. Dependency-free (the Worker bundles it directly,
// like ../spec/catalog.ts).

/** The minimal proposal shape the filters read. Structurally satisfied
 *  by the parser's `ProposalEntry` and the Worker's index rows. */
export interface FilterableProposal {
  slug: string;
  name: string;
  stage: string;
  champions: string[];
  spec?: string;
}

export interface ProposalFilters {
  /** Spec the proposal targets: `"262"` or `"402"`. */
  spec?: string;
  /** Exact stage match: `"0"`–`"3"`, `"finished"`, `"inactive"`, `"active"`. */
  stage?: string;
  /** Case-insensitive substring over the champion list. */
  champion?: string;
  /** Case-insensitive substring over the proposal name + slug. */
  contains?: string;
}

/** Apply the proposal.list filters and return the matching subset in
 *  index order. Generic so each caller gets its own element type back;
 *  the caller applies any `limit`. */
export function filterProposals<T extends FilterableProposal>(
  proposals: T[],
  filters: ProposalFilters,
): T[] {
  const champion = filters.champion?.toLowerCase();
  const contains = filters.contains?.toLowerCase();

  let matches = proposals;
  if (filters.spec) matches = matches.filter((p) => p.spec === filters.spec);
  if (filters.stage) matches = matches.filter((p) => p.stage === filters.stage);
  if (champion) {
    matches = matches.filter((p) =>
      p.champions.some((c) => c.toLowerCase().includes(champion)),
    );
  }
  if (contains) {
    matches = matches.filter((p) =>
      (p.name + " " + p.slug).toLowerCase().includes(contains),
    );
  }
  return matches;
}
