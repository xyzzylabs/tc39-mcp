// Server-level instructions surfaced to MCP clients (and through them
// to LLM agents) during initialization. Designed to answer the questions
// an agent asks before its first tool call:
//
//   - What does this server give me?
//   - When do I call tool X vs tool Y?
//   - How do I read errors / empty results?
//
// Keep this string focused on *workflows* and *invariants*, not on
// individual tool details — those live in the per-tool descriptions
// the agent already sees in tools/list. The hosted vs stdio-only tool
// counts come from the shared `src/spec/tool_inventory.ts` so they
// can't drift from the Worker's copy or the registry.

import {
  HOSTED_TOOLS,
  STDIO_ONLY_TOOLS,
  TOTAL_TOOL_COUNT,
} from "../spec/tool_inventory.js";

export const SERVER_INSTRUCTIONS = `
tc39-mcp serves read-only structured data from the TC39 specs
(ECMA-262 + ECMA-402), tc39/test262, and tc39/proposals. Every
response is deterministic over data pinned to specific upstream
SHAs.

Unofficial, community-maintained — not affiliated with, endorsed by,
or sponsored by Ecma International or TC39.

Common workflow:
  1. \`spec.about\` — call first when you need to cite the spec or
     report what you're reading. Returns per-snapshot pin metadata
     (sha, fetched_at, biblio_commit, clause_count).
  2. \`spec.search\` (single spec) or \`spec.global_search\` (both
     specs) — find a clause from a name or symptom. Hits rank
     aoid-exact > aoid-substring > title > id; follow up with
     \`clause.get { id }\` to read the full clause.
  3. \`clause.get { id, spec?, edition? }\` — full structured clause:
     signature, numbered steps, notes, crossrefs.

Edition semantics. \`latest\` is spec-aware:
  - On 262, \`latest\` → current stable release (es2026 today).
  - On 402, \`latest\` → current stable release (es2026 today).
  - \`main\` is always the working draft.
  - Both specs support es2016 … es2026 + main.

Cross-spec discovery is opt-in. By default everything stays within
one spec. Pass \`include_cross_spec: true\` to \`spec.crossrefs\` to
surface outgoing references that resolve into the other spec
(e.g. an ECMA-402 clause calling ECMA-262's \`OrdinaryCreateFromConstructor\`).

Missing data is never an error. Tools return null, empty arrays, or
a \`hint:\` field. \`source: "none"\` on \`test262.search\` or
\`proposal.list\` means the offline index hasn't been built — surface
the hint to the user, it tells them which command to run. Don't
retry; treat empty as "no match found".

Transport differences:
  - The stdio server (npx tc39-mcp) exposes all ${TOTAL_TOOL_COUNT} tools.
  - The hosted Cloudflare Worker exposes ${HOSTED_TOOLS.length} of them
    (${HOSTED_TOOLS.join(", ")}). The remaining ${STDIO_ONLY_TOOLS.length}
    run stdio-only — each needs the filesystem or a subprocess the
    Worker can't provide: \`spec.history\` shells out to git, and
    \`test262.get\` reads each test's full source from the vendored corpus.

All data is read-only: no tool modifies anything upstream, no tool
runs user-supplied code. Safe to call freely.
`.trim();
