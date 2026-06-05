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
] as const;

/** Tools that run on the stdio server only — filesystem / subprocess
 *  bound: `spec.history` shells out to `git log` against a vendored
 *  checkout, and the `test262.*` tools read the vendored test262 corpus
 *  (far too large to ship in R2). Nothing else stays stdio-only. */
export const STDIO_ONLY_TOOLS = [
  "spec.history",
  "test262.search",
  "test262.get",
] as const;

/** The full stdio tool surface = hosted + stdio-only. */
export const TOTAL_TOOL_COUNT = HOSTED_TOOLS.length + STDIO_ONLY_TOOLS.length;
