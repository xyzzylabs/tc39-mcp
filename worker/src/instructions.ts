// Server-level instructions surfaced to MCP clients (and through them
// to LLM agents) during initialization.
//
// This is a Worker-local copy of the stdio server's
// `src/mcp/instructions.ts`. We keep two copies so the Worker bundle
// doesn't depend on the main Node-shaped source tree; the content
// stays in sync via the deploy workflow's typecheck + smoke test.

export const SERVER_INSTRUCTIONS = `
tc39-mcp serves read-only structured data from the TC39 specs
(ECMA-262 + ECMA-402), tc39/test262, and tc39/proposals. Every
response is deterministic over data pinned to specific upstream
SHAs.

This is the hosted Cloudflare Worker deployment. It exposes 6 core
tools: spec.about, clause.get, clause.list, spec.search,
proposal.list, proposal.get. The full 19-tool surface (including
spec.diff, spec.crossrefs, spec.tables, spec.grammar,
spec.symbol_resolve, spec.well_known_intrinsics, spec.sdo_index,
spec.history, clause.outline, spec.global_search, test262.search,
test262.get) is available via the stdio server (npx tc39-mcp).

Common workflow:
  1. \`spec.about\` — call first to see what SHAs and editions the
     server is serving. Returns per-snapshot pin metadata.
  2. \`spec.search\` — find a clause from a name or symptom. Hits
     rank aoid-exact > aoid-substring > title > id; follow up with
     \`clause.get { id }\` to read the full clause.
  3. \`clause.get { id, spec?, edition? }\` — full structured clause.

Edition semantics. \`latest\` is spec-aware:
  - On 262, \`latest\` → current stable release (es2026 today).
  - On 402, \`latest\` → current stable release (es2026 today).
  - \`main\` is always the working draft.

Historical pinning. \`main\` moves. Pass \`at: "<sha>"\` to query a
specific historical snapshot (4-40 hex chars, prefix-matched). The
hosted Worker retains every \`main\` SHA it has deployed since
launch; the live snapshot is \`at\`-less. Pinned editions like
\`es2026\` are already SHA-stable — \`at\` is invalid there.

Missing data is never an error. Tools return null, empty arrays, or
a \`hint:\` field. \`source: "none"\` on \`proposal.list\` means the
offline index isn't present in R2 — surface the hint to the user.

All data is read-only: no tool modifies anything upstream, no tool
runs user-supplied code. Safe to call freely.
`.trim();
