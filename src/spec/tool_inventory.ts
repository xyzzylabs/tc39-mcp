// Single source of truth for which tools the hosted Cloudflare Worker
// serves over R2 vs. which run on the stdio server only. Both transports'
// `SERVER_INSTRUCTIONS` build their tool-list sentence from these arrays,
// and the Worker's tools/list registry is asserted against HOSTED_TOOLS
// in a test — so the inventory lives in one place instead of being
// hand-copied into two instruction strings + the registry every time a
// tool crosses over. Dependency-free so the Worker bundles it directly.

/** Tools the hosted Cloudflare Worker reimplements over its R2-backed
 *  parsed-spec data, in rough tools/list order. */
export const HOSTED_TOOLS = [
  "spec.about",
  "clause.get",
  "clause.list",
  "spec.search",
  "proposal.list",
  "proposal.get",
  "spec.grammar",
  "spec.tables",
  "spec.sdo_index",
  "clause.outline",
  "spec.global_search",
  "spec.snapshots",
  "spec.symbol_resolve",
  "spec.well_known_intrinsics",
  "spec.diff",
  "spec.crossrefs",
  "test262.search",
] as const;

/** Tools that run on the stdio server only, because each needs the
 *  filesystem or a subprocess the Worker can't provide: `spec.history`
 *  shells out to `git log` against a vendored checkout, and
 *  `test262.get` reads a test's full source from the vendored test262
 *  corpus (the per-test files aren't in R2 — only the search index is,
 *  which is why `test262.search` is hosted). Nothing else stays
 *  stdio-only. */
export const STDIO_ONLY_TOOLS = [
  "spec.history",
  "test262.get",
] as const;

/** The full stdio tool surface = hosted + stdio-only. */
export const TOTAL_TOOL_COUNT = HOSTED_TOOLS.length + STDIO_ONLY_TOOLS.length;
