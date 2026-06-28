#!/usr/bin/env node
// tc39-mcp — Model Context Protocol server for the TC39 specs
// (ECMA-262 + ECMA-402).
//
// Read-only, SHA-pinned, structured lookup. Runs as a stdio MCP server
// (for local Claude Code use) and is also the basis for the hosted
// Cloudflare Worker deployment.
//
// Wire into Claude Code by adding to your project's `.mcp.json`:
//
//   {
//     "mcpServers": {
//       "tc39": {
//         "type": "stdio",
//         "command": "npx",
//         "args": ["tc39-mcp"]
//       }
//     }
//   }

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { listResources, readResource } from "./resources.js";

// Read version dynamically from the published package.json so the
// `initialize` response reflects whatever the refresh workflow last
// bumped to — not a literal frozen at build time. Same pattern as
// `tools/spec_about.ts` so the two version sources can never drift.
function readPackageVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    const path = req.resolve("../../package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
const SERVER_VERSION = readPackageVersion();
import { clauseGet, clauseGetSchema, clauseList, clauseListSchema } from "./tools/clause.js";
import { clauseOutline, clauseOutlineSchema } from "./tools/clause_outline.js";
import { specSearch, specSearchSchema } from "./tools/spec_search.js";
import { specCrossrefs, specCrossrefsSchema } from "./tools/spec_crossrefs.js";
import { specDiff, specDiffSchema } from "./tools/spec_diff.js";
import { specHistory, specHistorySchema } from "./tools/spec_history.js";
import { specAbout, specAboutSchema } from "./tools/spec_about.js";
import { specSnapshots, specSnapshotsSchema } from "./tools/spec_snapshots.js";
import { specSymbolResolve, specSymbolResolveSchema } from "./tools/spec_symbol.js";
import { specSdoIndex, specSdoIndexSchema } from "./tools/spec_sdo_index.js";
import { specGlobalSearch, specGlobalSearchSchema } from "./tools/spec_global_search.js";
import { specIntrinsics, specIntrinsicsSchema } from "./tools/spec_intrinsics.js";
import { specTables, specTablesSchema } from "./tools/spec_tables.js";
import { specGrammar, specGrammarSchema } from "./tools/spec_grammar.js";
import { test262Search, test262SearchSchema } from "./tools/test262_search.js";
import { test262Get, test262GetSchema } from "./tools/test262_get.js";
import {
  proposalGet,
  proposalGetSchema,
  proposalList,
  proposalListSchema,
} from "./tools/proposal.js";
import { z } from "zod";
import { getPrompt, PROMPT_DEFS } from "./prompts.js";

const server = new McpServer(
  {
    name: "tc39-mcp",
    version: SERVER_VERSION,
  },
  {
    // Surface the agent-facing usage guide via MCP's `instructions`
    // field. Clients that forward `instructions` into the LLM's
    // system prompt get this guidance automatically.
    instructions: SERVER_INSTRUCTIONS,
  },
);

// All tool registrations below use `server.registerTool()` with
// `annotations: { readOnlyHint: true }`. Every tool in this server
// reads structured spec data — none mutate state or write files
// outside the local cache directory. Tools may reach the hosted
// Worker to fetch a snapshot the local cache hasn't seen yet; once
// cached, subsequent calls stay local until the live-key pointer
// goes stale (4 h). The `title` field gives each tool a
// human-readable label that clients display in tool pickers.

server.registerTool(
  "spec.about",
  {
    title: "About this server",
    description:
      "Return self-description of this MCP server: package name + version, per-snapshot pin metadata (sha, fetched_at, biblio_commit, clause_count) for every supported (spec, edition), plus test262 + proposals index headers when present. Lets callers verify freshness and reproducibility without loading the parses themselves.",
    inputSchema: specAboutSchema,
    annotations: { readOnlyHint: true },
  },
  async () => {
    const r = await specAbout();
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.snapshots",
  {
    title: "List spec snapshots",
    description:
      "List every (spec, edition, sha, fetched_at) snapshot this server has parsed. Use to discover what historical SHAs you can query via `at: \"<sha>\"`, or to verify reproducibility across server versions. Optional `spec` / `edition` filters.",
    inputSchema: specSnapshotsSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await specSnapshots(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "clause.get",
  {
    title: "Get spec clause",
    description:
      "Fetch a parsed TC39 clause as structured JSON: metadata, signature, algorithm steps, notes, cross-refs, and outward citations to external specs (Unicode, IETF, WHATWG). `spec` selects '262' (default) or '402'. `edition` defaults to `latest` (current stable release on both specs — es2026 today).",
    inputSchema: clauseGetSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const clause = await clauseGet(args);
    if (!clause) {
      return {
        content: [
          {
            type: "text",
            text: `No such clause: ${args.id} (spec: ${args.spec ?? "262"}, edition: ${args.edition ?? "latest"})`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(clause, null, 2) }],
    };
  },
);

server.registerTool(
  "clause.list",
  {
    title: "List spec clauses",
    description:
      "List parsed spec clauses with optional filters (kind, section prefix, has_algorithm). Returns lightweight rows {id, aoid, title, number, kind, algorithms}; follow up with clause.get for detail. `spec` selects '262' or '402'.",
    inputSchema: clauseListSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const hits = await clauseList(args);
    return {
      content: [{ type: "text", text: JSON.stringify({ hits }, null, 2) }],
    };
  },
);

server.registerTool(
  "clause.outline",
  {
    title: "Spec section outline",
    description:
      "Return the section tree (table of contents) for a parsed (spec, edition). `depth` caps tree depth (1 = top-level only). `under` anchors at a specific clause id so you get just its descendants. Each node carries { id, number, title, kind, children }.",
    inputSchema: clauseOutlineSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await clauseOutline(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.search",
  {
    title: "Search spec",
    description:
      "Search the parsed spec by clause id / aoid / title (and step text when search_steps is true). Returns lightweight hits ranked by match quality — the entry point when you don't know the exact clause id. `spec` selects '262' or '402'. Follow up with clause.get.",
    inputSchema: specSearchSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const hits = await specSearch(args);
    return {
      content: [{ type: "text", text: JSON.stringify({ hits }, null, 2) }],
    };
  },
);

server.registerTool(
  "spec.crossrefs",
  {
    title: "Spec cross-references",
    description:
      "For a clause id, return its outgoing references (clauses it cites) and/or incoming references (clauses that cite it — the back-reference index the parse alone doesn't expose). Direction: 'in' | 'out' | 'both' (default). Outgoing also carries an `external` category: the clause's citations to external specs (Unicode, IETF, WHATWG) as resolvable URLs. Set `include_cross_spec: true` to also resolve outgoing references from ECMA-262 → ECMA-402 (or vice versa).",
    inputSchema: specCrossrefsSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await specCrossrefs(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.diff",
  {
    title: "Diff spec editions",
    description:
      "Clause-level diff across any two editions of one spec. Defaults: from='latest', to='main' (working draft). Reports status (identical / modified / added / removed / missing-from-both) plus a field-level diff: title, signature, step count, per-step reworded indices, notes, crossrefs. `spec` selects '262' or '402'.",
    inputSchema: specDiffSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await specDiff(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.history",
  {
    title: "Clause git history",
    description:
      "Recent commits in the vendored spec checkout that touched a clause's `id=\"...\"` token. Uses git pickaxe (`-S`) so it catches clause creation, deletion, and edits to the opening tag reliably; interior-text-only edits won't show. Returns SHA, date, author, subject per commit. `spec` selects '262' or '402'.",
    inputSchema: specHistorySchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = specHistory(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.symbol_resolve",
  {
    title: "Resolve spec symbol",
    description:
      "Resolve spec notation like `[[Prototype]]` (internal slot), `%Object.prototype%` (well-known intrinsic), or `~number~` (sigil enum) to the clauses that mention or define it. Hits ranked by occurrence count + section-prefix bumps for the canonical definition location. `spec` selects '262' or '402'.",
    inputSchema: specSymbolResolveSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await specSymbolResolve(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.sdo_index",
  {
    title: "Syntax-directed operations index",
    description:
      "Index Syntax-Directed Operations by the grammar production they handle. SDOs are abstract operations (Evaluation, BoundNames, etc.) with one `<emu-alg>` per production. Default by='production' returns { [production]: [{ sdo, id, title }] }; by='sdo' returns { [sdo title]: [productions] }. `filter` substring-narrows keys; `spec` selects '262' or '402'.",
    inputSchema: specSdoIndexSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await specSdoIndex(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.global_search",
  {
    title: "Search both specs",
    description:
      "Run spec.search across both ECMA-262 and ECMA-402 in one call and interleave results by score. Each hit is tagged with the spec it came from. Useful when you don't know which spec defines the symbol (e.g. `Canonicalize` is 262, `CanonicalizeLocaleList` is 402).",
    inputSchema: specGlobalSearchSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const hits = await specGlobalSearch(args);
    return { content: [{ type: "text", text: JSON.stringify({ hits }, null, 2) }] };
  },
);

server.registerTool(
  "spec.well_known_intrinsics",
  {
    title: "Well-known intrinsics",
    description:
      "Enumerate the well-known intrinsics (`%X%` notations) used in the spec, with each one's probable defining clause (chosen by a title-substring heuristic — see `matched_on` per hit). For the canonical 262 well-known intrinsics table, read `clause.get { id: 'sec-well-known-intrinsic-objects' }` directly.",
    inputSchema: specIntrinsicsSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await specIntrinsics(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.tables",
  {
    title: "Spec tables",
    description:
      "List or fetch parsed `<emu-table>` content. Pass `id` to get one table with full columns + rows; omit `id` to list tables (lightweight summaries) optionally filtered by caption/id substring. Authoritative source for the well-known intrinsics table (id='table-well-known-intrinsic-objects'), well-known symbols, completion record fields, etc. `spec` selects '262' or '402'.",
    inputSchema: specTablesSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await specTables(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "spec.grammar",
  {
    title: "Spec grammar productions",
    description:
      "Query standalone `<emu-grammar>` productions from the spec's lexical / syntactic grammar (§11-15 in 262). Three modes: { nonterminal: 'X' } returns every production for X; { contains: 'Y' } returns productions whose RHS or non-terminal name contains Y; neither returns a list of all non-terminals with their production counts. Set include_sdo:true to also surface SDO-attached grammar headers.",
    inputSchema: specGrammarSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await specGrammar(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "test262.search",
  {
    title: "Search test262",
    description:
      "Search tc39/test262 for tests matching a free-text query and/or an esid (clause id, prefix-matched). test262 covers both ECMA-262 and ECMA-402. Served from a parsed test262 index sourced via the loader chain (local cache → hosted Worker → bundled fallback); the index is fetched on first use and cached locally. If no layer can produce the index the result is empty + a hint explaining the one-time local build. No auth, no subprocess.",
    inputSchema: test262SearchSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await test262Search(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "test262.get",
  {
    title: "Get test262 fixture",
    description:
      "Fetch one test's source + parsed front-matter by path within the vendored tc39/test262 checkout. Pairs with test262.search — the paths it returns plug in here directly. Returns { source, front_matter, test262_sha, url } or { hint } if the path can't be resolved.",
    inputSchema: test262GetSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = test262Get(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "proposal.list",
  {
    title: "List TC39 proposals",
    description:
      "List TC39 proposals from a parsed proposals index sourced via the loader chain (local cache → hosted Worker → bundled fallback); the index is fetched on first use and cached locally. Filter by `stage` ('0'|'1'|'2'|'2.7'|'3'|'finished'|'inactive'|'active'), `champion` (substring), or `contains` (name/slug substring). Returns lightweight rows; follow up with `proposal.get`. No auth, no subprocess.",
    inputSchema: proposalListSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await proposalList(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "proposal.get",
  {
    title: "Get TC39 proposal",
    description:
      "Fetch one TC39 proposal by slug (exact) or name (case-insensitive). Returns { slug, name, stage, authors, champions, url, test262_flag, source_file }. Slug is canonical — use what proposal.list returns directly.",
    inputSchema: proposalGetSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await proposalGet(args);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

// Register the `tc39://...` resource family. Clients that prefer
// URI addressing get a parallel surface to `clause.get`. The template
// covers every (spec, edition, clause-id) combination; resources/list
// returns top-level clauses across all loaded snapshots.
server.registerResource(
  "tc39-clause",
  new ResourceTemplate("tc39://{spec}/{edition}/{id}", {
    list: async () => listResources({ per_snapshot: 50 }),
  }),
  {
    description:
      "Parsed TC39 clauses, addressable by URI. Equivalent to calling clause.get; provided as a resources-capability alternative for clients that prefer URI-fetching.",
    mimeType: "application/json",
  },
  async (uri) => readResource(uri.href),
);

// MCP prompts: reusable workflow templates (explain-clause, compare-editions,
// find-and-read, …). Hosts inject the returned messages; the model then calls
// tools. All prompts are pure string templates — no tool execution inside the
// prompt handler itself. Shared catalog with the Worker via prompts.ts.
function optionalStringArg(description: string) {
  return z.string().optional().describe(description);
}

for (const def of PROMPT_DEFS) {
  const argsSchema: Record<string, z.ZodTypeAny> = {};
  for (const a of def.arguments) {
    argsSchema[a.name] = optionalStringArg(a.description);
  }
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
      argsSchema,
    },
    async (args) => {
      // Normalize the SDK's arg map to a flat string record; getPrompt()
      // enforces required args so errors match the Worker path.
      const flat: Record<string, string> = {};
      if (args && typeof args === "object") {
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined && v !== null) flat[k] = String(v);
        }
      }
      return { ...getPrompt(def.name, flat) };
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
