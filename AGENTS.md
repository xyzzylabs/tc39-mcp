# Project rules for AI agents

This file follows the cross-tool [AGENTS.md](https://agents.md/)
convention. Tool-specific alias files (`CLAUDE.md`, etc.) import
this file via `@AGENTS.md` so every agent reads the same rules
with no drift.

## What tc39-mcp is

A general-purpose, public MCP server for the TC39 specs
(ECMA-262 + ECMA-402). It exposes structured clauses, AOID-aware
search, in+out cross-references, edition diffs, git history, test262
search, and proposal lookup over the Model Context Protocol —
locally over stdio or hosted as a Cloudflare Worker over HTTP. The
data is SHA-pinned and auto-refreshes every ~4 hours from the
upstream tc39/* mains.

The server is the product. Tools, dependencies, and documentation
should read as if written for any reader interested in the TC39
specs, not for one specific downstream consumer.

## Hard rules

1. **The tool surface stays narrow.** Read-only, deterministic, no
   execution, no auth, no writes. New tools land only if they expose
   structured spec data and meet that contract — see
   [`CONTRIBUTING.md`](CONTRIBUTING.md) § "What kinds of changes are
   welcome".

2. **No subprocess fallbacks for hosted-incompatible paths.**
   Anything that can't run behind a Cloudflare Worker (shell-out,
   network call, filesystem write) doesn't belong in the tool
   surface. The only subprocess in the whole server is
   `spec.history`'s `git log` against a vendored checkout; nothing
   else.

3. **Comments and docs describe the code, not a downstream
   workflow.** Anything that would only make sense to someone
   familiar with a specific consumer of this server gets rewritten
   to describe the general behavior instead.

4. **Commit messages, PR descriptions, and issue titles are part of
   the project's public surface.** Same standard as code comments —
   describe what changed and why in general terms.

## Code conventions

- TypeScript everywhere. Strict mode. Zod for input schemas. JSDoc
  on every exported interface field — the `/tools` page is generated
  from these.
- Source of truth for tool docs lives next to the schema. The
  generated `docs/tools.md` page is rebuilt by
  `src/docs/build_api_reference.ts` on every `npm run docs:data`;
  don't hand-edit it.
- Co-locate examples with the schema as `<name>Examples` arrays —
  the generator picks them up automatically.
- Tests live next to source as `*.test.ts`. Worker tests under
  `worker/src/**`. `vitest run` runs both.
- Generated artifacts (`docs/snapshots.md`, `docs/changelog.md`) are
  gitignored. `docs/tools.md` is tracked so a fresh clone or
  GitHub browser sees the full reference without a build step.

## What you can reference

- Upstream TC39 repos: `tc39/ecma262`, `tc39/ecma402`,
  `tc39/test262`, `tc39/proposal-*` — anything publicly authoritative.
- Tooling that publicly consumes the MCP protocol: Claude Code,
  Claude Desktop, MCP Inspector, Cursor, and other public agent
  frameworks.
- The hosted Cloudflare Worker deployment of THIS server (when it
  exists).
- General-purpose ecosystem packages: `@tc39/ecma262-biblio`,
  `cheerio`, `@modelcontextprotocol/sdk`, etc.
- Specs adjacent to TC39 that the tools structurally cite, e.g.
  WHATWG, Unicode, IETF RFCs.

## When in doubt

Default to silence. If a comment doesn't help someone reading the
code understand the code, delete it. If a doc page implies a
specific use case rather than describing the capability, rewrite it
to describe the capability.
