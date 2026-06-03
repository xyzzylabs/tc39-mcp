# tc39-mcp

[![Test](https://github.com/xyzzylabs/tc39-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/xyzzylabs/tc39-mcp/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/tc39-mcp.svg)](https://www.npmjs.com/package/tc39-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

📖 **Docs**: [tc39-mcp.chicoxyzzy.workers.dev](https://tc39-mcp.chicoxyzzy.workers.dev) — [Get started](https://tc39-mcp.chicoxyzzy.workers.dev/getting-started) · [Tools](https://tc39-mcp.chicoxyzzy.workers.dev/tools) · [Cookbook](https://tc39-mcp.chicoxyzzy.workers.dev/cookbook) · [Editions](https://tc39-mcp.chicoxyzzy.workers.dev/editions) · [Architecture](https://tc39-mcp.chicoxyzzy.workers.dev/architecture) · [Hosting](https://tc39-mcp.chicoxyzzy.workers.dev/deployment)

**Give MCP-speaking AI agents structural access to the JS spec.**
Claude Code, Claude Desktop, Cursor, MCP Inspector, and anything
else that speaks the Model Context Protocol can now call
`clause.get sec-tonumber` and get back parsed JSON (algorithm
steps as discrete arrays, cross-references as ids, signatures as
typed values) instead of being handed a 4 MB `spec.html` to grep
through. Tools cover [ECMA-262](https://github.com/tc39/ecma262)
(the core language) and [ECMA-402](https://github.com/tc39/ecma402)
(the `Intl` API): clauses, algorithm steps, cross-references both
ways, edition diffs, upstream git history, test262 search,
proposal lookup. Every response is SHA-pinned to a specific
upstream commit so anything an agent cites stays reproducible.

Offline-first by default: the stdio transport (`npx tc39-mcp`)
ships every parsed snapshot in the tarball, so once installed it
runs entirely offline — no network call per agent query, no
leakage of which clause the agent is reading. The hosted
Cloudflare Worker is the HTTP alternative when you want a shared
network endpoint; it auto-refreshes from upstream every ~4 hours.

## Install + first call

Wire into Claude Code, Claude Desktop, Cursor, or any MCP-speaking
client via `.mcp.json`:

```json
{
  "mcpServers": {
    "tc39": { "command": "npx", "args": ["tc39-mcp"] }
  }
}
```

The first run downloads ~50 MB (the parsed snapshots ship in the
tarball — no separate fetch step needed, and every subsequent call
is served from local disk with no network round-trip). Then in
your client:

> use `clause.get` to read `sec-tonumber` and show me the steps

You should see structured JSON back:

```json
{
  "meta": {
    "id": "sec-tonumber",
    "aoid": "ToNumber",
    "title": "ToNumber ( argument )",
    "number": "7.1.4",
    "kind": "op"
  },
  "signatureRaw": "ToNumber ( _argument_: an ECMAScript language value, ): either a normal completion containing a Number or a throw completion",
  "algorithms": [
    { "steps": [
        { "text": "If _argument_ is a Number, return _argument_." },
        { "text": "If _argument_ is either *undefined* or a Symbol, throw a *TypeError* exception." },
        { "text": "If _argument_ is *null*, return *+0*<sub>𝔽</sub>." },
        "..."
    ]}
  ],
  "crossrefs": ["sec-tonumber-applied-to-the-string-type", "..."]
}
```

Five-minute walkthrough: [`docs/getting-started.md`](docs/getting-started.md).

## Other transports

### Hosted Cloudflare Worker (HTTP)

```json
{
  "mcpServers": {
    "tc39": {
      "type": "http",
      "url": "https://tc39-mcp.chicoxyzzy.workers.dev/mcp"
    }
  }
}
```

Traffic is rate-limited to 30 req/min per IP.

### Global CLI

```sh
npm i -g tc39-mcp
tc39-mcp                     # reads stdio
```

## What it's good at

- **Letting an agent reason about the spec without hallucinating.**
  Structured JSON answers ground the model on real spec text:
  step numbering, cross-reference targets, signature shapes,
  edition deltas, conformance tests. Anything cited resolves to a
  specific clause id at a specific SHA — easy to verify, easy to
  reproduce.
- **Finding the clause you want from a hint.** `spec.search` ranks
  AOID-exact matches first; `spec.symbol_resolve` decodes
  `[[Prototype]]` / `%Object.prototype%` / `~enumerate~`.
- **Following references both ways.** `spec.crossrefs` returns
  what a clause cites AND who cites it. AOID-densified so bare
  mentions in step text count, not just `<emu-xref>` hrefs.
  `include_cross_spec` resolves 262 ↔ 402 hops.
  ([Cookbook recipe 1](docs/cookbook.md#recipe-1-cross-spec-lookup-which-ecma-262-ops-does-intl-reach-into).)
- **Comparing editions and tracking prose drift.** `spec.diff`
  between any two editions back to ES2016; `spec.history` walks
  the upstream git log via pickaxe search.
  ([Cookbook recipe 2](docs/cookbook.md#recipe-2-prose-drift-how-did-tonumber-change-over-the-past-year).)
- **Finding test262 coverage for a clause.** `test262.search`
  with prefix-matched `esid:` catches `sec-tonumber` AND
  `sec-tonumber-applied-to-the-string-type` in one call.
- **Mapping proposals to the spec.** `proposal.list` /
  `proposal.get` from a structured index of `tc39/proposals`,
  covering both ECMA-262 and ECMA-402 (Intl) proposals — filter by
  `spec`. Refreshed on the same 4-hour cadence as the specs.
- **Running entirely offline (stdio).** Once `npx tc39-mcp` has
  installed, every tool call is served from on-disk snapshots —
  no network round-trip per query, no leakage of which clause
  the agent is reading, no upstream rate limit. The hosted
  Worker is the HTTP alternative for shared / multi-tenant use.

## Tools (19 across 5 namespaces)

| Goal | Tool(s) |
|---|---|
| Verify what's being served | `spec.about` · `spec.snapshots` |
| Read a specific clause | `clause.get` |
| Find a clause from a name / symptom | `spec.search` · `spec.global_search` |
| Resolve `[[X]]` / `%X%` / `~X~` notation | `spec.symbol_resolve` |
| Browse / outline | `clause.list` · `clause.outline` |
| Compare editions / commit history | `spec.diff` · `spec.history` |
| Walk references (in + out) | `spec.crossrefs` |
| Read structured tables | `spec.tables` |
| Inspect the grammar | `spec.grammar` · `spec.sdo_index` |
| Enumerate well-known intrinsics | `spec.well_known_intrinsics` |
| Find conformance tests | `test262.search` · `test262.get` |
| Look up a proposal | `proposal.list` · `proposal.get` |

Full reference (input schemas, output types, example calls per
tool): **[`docs/tools.md`](docs/tools.md)** — auto-generated from
the schemas so it never drifts.

## Specs + editions

Every spec-reading tool accepts `spec` (`"262"` or `"402"`, default
`"262"`) and `edition` (default `"latest"`).

- **ECMA-262**: `es2016` – `es2025`, `main`. (ES5 / ES5.1 / ES6
  have no upstream tags and aren't supported.)
- **ECMA-402**: `es2016` – `es2025`, `main`, plus the legacy
  `es2025-candidate` pin. (402 publishes each annual edition as an
  `esYYYY` branch rather than a tag; the fetch step resolves a
  branch or a tag the same way.)
- **Aliases**: `latest` is spec-aware (each spec → its current
  stable release, `es2025` today). `draft` / `next` → `main` on both.

Full table + how to add new releases: [`docs/editions.md`](docs/editions.md).

## Build from source (contributors)

End users don't need this — the npm package and the hosted Worker
are the supported surfaces above. This is for working on the
server itself.

```sh
git clone https://github.com/xyzzylabs/tc39-mcp
cd tc39-mcp
npm install
npm run fetch-spec               # ~2 min, ~150 MB — both specs at every supported edition
npm run parse                    # spec.html → build/spec-<spec>-<edition>.json
npm run fetch-test262            # optional, enables test262.* (~300 MB)
npm run build-test262-index
npm run fetch-proposals          # optional, enables proposal.* (~50 MB)
npm run build-proposals-index
npm run mcp                      # start the stdio MCP server against your source
```

Point Claude Code at your local source instead of the published bin:

```json
{
  "mcpServers": {
    "tc39": {
      "type": "stdio",
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/abs/path/to/tc39-mcp"
    }
  }
}
```

## Docs

Hosted at [tc39-mcp.chicoxyzzy.workers.dev](https://tc39-mcp.chicoxyzzy.workers.dev)
— searchable, dark-mode-friendly, auto-rebuilt on every refresh so
`/snapshots` always reflects the live SHAs.

In-repo (also browseable on GitHub):

- [`docs/getting-started.md`](docs/getting-started.md) — install →
  wire → first call → verify. Five minutes.
- [`docs/tools.md`](docs/tools.md) — every tool, every field, every
  example. Auto-generated from source.
- [`docs/cookbook.md`](docs/cookbook.md) — multi-tool recipes:
  cross-spec lookups, prose-drift tracking, grammar/SDO
  cross-references, test262 coverage, proposal-to-clause mapping.
- [`docs/editions.md`](docs/editions.md) — supported editions +
  alias resolution.
- [`docs/architecture.md`](docs/architecture.md) — data pipeline,
  parser, cache, memory model.
- [`docs/deployment.md`](docs/deployment.md) — local stdio, npm
  CLI, hosted Cloudflare Worker, refresh model, observability.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — what kinds of changes
  land easily, what won't.
- [`SECURITY.md`](SECURITY.md) — threat model + responsible
  disclosure.
- [`CHANGELOG.md`](CHANGELOG.md) — version history + auto-refresh
  convention.

## Privacy Policy

tc39-mcp is a read-only spec lookup service. The stdio transport
(`npx tc39-mcp`) collects nothing — every spec snapshot ships
in the npm tarball and the server runs entirely offline. The
hosted Cloudflare Worker collects only standard request metadata
(IP for rate limiting, timestamps, request headers); it does not
log request bodies, set cookies, or share data with third parties.

Full policy: [tc39-mcp.chicoxyzzy.workers.dev/privacy](https://tc39-mcp.chicoxyzzy.workers.dev/privacy)

For privacy questions, open an issue with the `privacy` label on
[GitHub](https://github.com/xyzzylabs/tc39-mcp/issues).

## License

MIT
