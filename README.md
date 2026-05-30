# tc39-mcp

[![Test](https://github.com/xyzzylabs/tc39-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/xyzzylabs/tc39-mcp/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/tc39-mcp.svg)](https://www.npmjs.com/package/tc39-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

📖 **Docs site** (same origin as the API): [tc39-mcp.chicoxyzzy.workers.dev](https://tc39-mcp.chicoxyzzy.workers.dev) — [Tools](https://tc39-mcp.chicoxyzzy.workers.dev/tools) · [Snapshots](https://tc39-mcp.chicoxyzzy.workers.dev/snapshots) · [Architecture](https://tc39-mcp.chicoxyzzy.workers.dev/architecture) · [Deployment](https://tc39-mcp.chicoxyzzy.workers.dev/deployment) · [Changelog](https://tc39-mcp.chicoxyzzy.workers.dev/changelog)

Structured MCP server for the TC39 specs (ECMA-262 + ECMA-402) —
SHA-pinned clauses, AOID-aware search, in+out cross-references,
edition diffs, history.

A read-only Model Context Protocol server that exposes
[tc39/ecma262](https://github.com/tc39/ecma262) (the core ECMAScript
language) and [tc39/ecma402](https://github.com/tc39/ecma402) (the
Internationalization API, `Intl`) to AI agents and tooling. Returns
**structured clauses** (signature, numbered steps, substeps, notes,
cross-refs) rather than raw HTML, and pins every response to a
specific spec SHA so anything cited is reproducible.

## Quick start

### Option 1: stdio via npx (Claude Code, etc.)

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "tc39": { "command": "npx", "args": ["tc39-mcp"] }
  }
}
```

The first run downloads ~50 MB (the parsed snapshots ship in the
tarball — no separate fetch step needed).

### Option 2: hosted HTTP Worker

For MCP clients that prefer HTTP transport, or for `curl` testing:

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

Smoke-test it from anywhere:

```sh
curl -s -X POST https://tc39-mcp.chicoxyzzy.workers.dev/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"spec.about","arguments":{}}}' \
  | jq '.result.content[0].text | fromjson | .server'
# → {"name": "tc39-mcp", "version": "0.1.0"}
```

### Option 3: global CLI

```sh
npm i -g tc39-mcp
tc39-mcp                     # reads stdio
```

## What it's for

- **Agents and tooling that need to consult the JS spec** —
  `clause.get` + `spec.search` instead of grepping `spec.html`.
- **Reading the spec offline / in a tool** — full structured access
  without scraping or hitting a 4 MB HTML file.
- **Cross-version analysis** — `spec.diff` between any two editions
  back to ES2016; `spec.history` walks the upstream git log.
- **Cross-spec analysis** — `spec.crossrefs { include_cross_spec: true }`
  resolves references that point from ECMA-262 into ECMA-402 (or vice
  versa). Useful for queries like "every 262 op that calls into Intl."
- **Tools that need an AOID → clause-id index** — `spec.search`
  ranks aoid-exact matches first.

## Tools (19 across 5 namespaces)

Every spec-reading tool accepts a `spec` argument (`"262"` default, or
`"402"`) and an `edition` (defaults to `latest`). Full argument
reference in [`docs/tools.md`](docs/tools.md).

### What do you want to do?

| Goal | Use |
|---|---|
| Verify what the server is serving | `spec.about` |
| List available snapshots / historical SHAs | `spec.snapshots` |
| Read a specific clause by id | `clause.get` |
| Find a clause from a name / symptom | `spec.search` · `spec.global_search` (both specs) |
| Resolve `[[X]]` / `%X%` / `~X~` notation | `spec.symbol_resolve` |
| Browse / outline the spec | `clause.list` · `clause.outline` |
| See what changed between editions | `spec.diff` · `spec.history` |
| Walk references (in + out) | `spec.crossrefs` (opt-in cross-spec) |
| Look at the structured tables | `spec.tables` (well-known intrinsics, symbols, completion records, locale data) |
| Look at the grammar | `spec.grammar` · `spec.sdo_index` |
| Enumerate `%X%` intrinsics | `spec.well_known_intrinsics` |
| Find conformance tests | `test262.search` · `test262.get` |
| Look up a proposal | `proposal.list` · `proposal.get` |

### `spec.*` — spec read + analysis (12 tools)

- **`spec.about`** — server self-description: version, per-snapshot pin metadata (`sha`, `fetched_at`, `biblio_commit`, `clause_count`), test262 + proposals index headers. Call this first to know what you're reading.
- **`spec.snapshots`** — enumerate every parsed (spec, edition, sha, fetched_at) snapshot. Useful for discovering historical SHAs queryable via `at:` on the hosted Worker.
- **`spec.search`** — rank clauses by aoid / title / id (optionally step text). Aoid-exact ranks first.
- **`spec.global_search`** — `spec.search` across both 262 + 402 in one call; each hit tagged with its spec.
- **`spec.symbol_resolve`** — `[[Prototype]]`, `%Object.prototype%`, `~number~` → defining clauses.
- **`spec.crossrefs`** — forward (`out`) AND backward (`in`) references. Reverse index is AOID-densified, so "who calls ToNumber" works without `<emu-xref>`. Opt-in `include_cross_spec` resolves 262 ↔ 402.
- **`spec.diff`** — clause-level diff between any two editions of one spec. Reports identical / modified / added / removed + field-level diffs.
- **`spec.history`** — recent commits in the vendored spec checkout that touched a clause's opening tag. Uses git pickaxe.
- **`spec.tables`** — parsed `<emu-table>` content. Authoritative source for the well-known intrinsics table, well-known symbols, completion record fields, locale data tables, etc.
- **`spec.grammar`** — standalone grammar productions captured from `<emu-grammar>`. Three modes: by non-terminal, contains-substring, or list.
- **`spec.sdo_index`** — index of Syntax-Directed Operations by grammar production (default) or by SDO title.
- **`spec.well_known_intrinsics`** — enumerate `%X%` notations with their probable defining clause (title-substring heuristic; honest about confidence).

### `clause.*` — clause-shaped lookups (3 tools)

- **`clause.get`** — full structured clause: signature, numbered steps + substeps, notes, crossrefs.
- **`clause.list`** — browse with filters (`kind`, section prefix, `has_algorithm`). Returns lightweight rows; follow up with `clause.get`.
- **`clause.outline`** — section tree / table of contents for a parsed (spec, edition). `depth` caps tree depth; `under` anchors at a specific clause id.

### `test262.*` — conformance tests (2 tools)

Backed by a single offline index that covers both ECMA-262 and ECMA-402
test262 entries; no auth, no network, no subprocess.

- **`test262.search`** — by free-text query and/or `esid:` front-matter (prefix-matched).
- **`test262.get`** — full source + parsed front-matter for one test by path. Pairs with `test262.search`.

### `proposal.*` — TC39 proposal index (2 tools)

Backed by a static index built from [tc39/proposals](https://github.com/tc39/proposals).

- **`proposal.list`** — filter by `stage` (`'0'`–`'4'` / `'finished'` / `'inactive'`), `champion` substring, or name substring.
- **`proposal.get`** — fetch one proposal by slug (canonical) or name (case-insensitive). Returns authors / champions / URL / test262 feature flag.

## Specs + editions supported

### ECMA-262

| Concrete | Resolves via | Notes |
|---|---|---|
| `es2016` – `es2025` | tagged releases of `tc39/ecma262` | 10 editions; ES5/ES5.1/ES6 are unsupported (no upstream tags) |
| `main` | tracking `main` branch | working draft |

### ECMA-402

tc39/ecma402 doesn't tag annual releases the way tc39/ecma262 does.
The only published refs are a handful of `esYYYY-candidate-*` tags
(release candidates) plus `main`. We expose only what's actually
tagged:

| Concrete | Resolves via | Notes |
|---|---|---|
| `es2025-candidate` | `es2025-candidate-2025-04-01` | 12th-edition release candidate |
| `main` | tracking `main` branch | working draft |

### Aliases

| Alias | Resolves to (262) | Resolves to (402) |
|---|---|---|
| `latest` | current stable release (`es2025`) | `main` (no annual final-release tag exists) |
| `draft` / `next` | `main` | `main` |

`latest` is spec-aware: on 262 it points at the most recent stable
release; on 402 it points at `main` because the upstream repo has
no annual release tagging.

Every tool accepts `spec` and `edition` arguments and resolves aliases
at load time, so responses are deterministic against a specific spec SHA.

## Build from source (contributors)

End users don't need this — the published package and the hosted
Worker are the supported surfaces above. This is for working on the
server itself.

```sh
git clone https://github.com/xyzzylabs/tc39-mcp
cd tc39-mcp

# 1. install deps
npm install

# 2. fetch both specs at every supported edition (~2 min, ~150 MB)
npm run fetch-spec

# 3. parse spec.html → build/spec-<spec>-<edition>.json for each
npm run parse

# 4. (optional but recommended) clone tc39/test262 and build the
#    offline test262 index — enables test262.search + test262.get.
#    ~300 MB clone, ~13 MB index.
npm run fetch-test262
npm run build-test262-index

# 5. (optional) clone tc39/proposals and build the proposals index —
#    enables proposal.list + proposal.get. ~50 MB clone, ~100 KB index.
npm run fetch-proposals
npm run build-proposals-index

# 6. start the stdio MCP server against your source tree
npm run mcp
```

To wire Claude Code at your local source instead of the published bin:

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

## Scope

This server is deliberately narrow:

- **Read-only.** No tool mutates anything. Every response is a
  deterministic function of pinned spec data.
- **No execution.** No spec semantics are evaluated; no JS is run.
  The server is pure parsed-JSON lookup.
- **No auth.** Read-only + no execution = safe to host publicly
  without an auth layer.
- **No corpus vendoring.** `test262.search` works against an
  index built from a local checkout (recommended). It does not
  bundle test262 in the npm package; the index is ~13 MB JSON
  generated once.

These constraints are the design — they're what make the server
small, fast, and trivially deployable behind a Cloudflare Worker
without sandboxing concerns.

## Docs

Hosted at [tc39-mcp.chicoxyzzy.workers.dev](https://tc39-mcp.chicoxyzzy.workers.dev) — searchable, dark-mode-friendly, auto-rebuilt on every refresh so `/snapshots` always shows the live SHAs.

In-repo (source for the hosted site + GitHub-rendered fallback):

- [`docs/architecture.md`](docs/architecture.md) — data pipeline, parser, cache, alias resolution, memory model.
- [`docs/tools.md`](docs/tools.md) — full reference for every tool: inputs, outputs, ranking rules.
- [`docs/editions.md`](docs/editions.md) — spec + edition model and how to add new releases.
- [`docs/deployment.md`](docs/deployment.md) — local stdio, npm CLI, hosted Cloudflare Worker, refresh model, observability.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — what kinds of changes land easily, what won't.
- [`SECURITY.md`](SECURITY.md) — threat model + how to report issues.
- [`CHANGELOG.md`](CHANGELOG.md) — version history + auto-refresh convention.

## License

MIT
