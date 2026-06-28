// Server-level instructions surfaced to MCP clients (and through them
// to LLM agents) during initialization.
//
// The hosted / stdio-only tool lists are built from the shared
// `src/spec/tool_inventory.ts` so they can't drift from the stdio
// server's instructions or the tools/list registry. The surrounding
// prose is Worker-specific (this is the hosted deployment).

import {
  HOSTED_TOOLS,
  STDIO_ONLY_TOOLS,
  TOTAL_TOOL_COUNT,
} from "../../src/spec/tool_inventory.js";

export const SERVER_INSTRUCTIONS = `
tc39-mcp serves read-only structured data from the TC39 specs
(ECMA-262 + ECMA-402), tc39/test262, and tc39/proposals. Every
response is deterministic over data pinned to specific upstream
SHAs.

Independent project — not an official Ecma International or TC39
publication.

This is the hosted Cloudflare Worker deployment. It exposes ${HOSTED_TOOLS.length} tools:
${HOSTED_TOOLS.join(", ")}. The full ${TOTAL_TOOL_COUNT}-tool surface
(additionally ${STDIO_ONLY_TOOLS.join(", ")}) is available via the stdio
server (npx tc39-mcp).

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
launch; the live snapshot is \`at\`-less. Released editions like
\`es2026\` have no per-SHA history, so \`at\` doesn't apply — it only
addresses \`main\`.

Missing data is never an error. Tools return null, empty arrays, or
a \`hint:\` field. \`source: "none"\` on \`proposal.list\` means the
offline index isn't present in R2 — surface the hint to the user.

MCP prompts (workflow templates) — prefer these when the user wants a
guided multi-tool sequence. Available prompts: explain-clause,
compare-editions, find-and-read, trace-crossrefs, proposal-status,
test262-for-feature, cite-reproducibly. Call prompts/list for their
argument shapes.

All data is read-only: no tool modifies anything upstream, no tool
runs user-supplied code. Safe to call freely.
`.trim();
