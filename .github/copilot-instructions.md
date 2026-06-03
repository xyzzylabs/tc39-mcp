# Copilot instructions for tc39-mcp

Guidance for GitHub Copilot — including **Copilot code review** — in this
repository.

**The authoritative rules live in [`AGENTS.md`](../AGENTS.md)** (the
cross-tool agent contract; `CLAUDE.md` and this file defer to it). Read
it first. The notes below restate the invariants a review should enforce
and flag the patterns that are intentional here, so reviews stay
signal-heavy.

## What this project is

A read-only, public MCP server for the TC39 specs (ECMA-262 +
ECMA-402). It exposes structured clauses, AOID-aware search, in+out
cross-references, edition diffs, git history, test262 search, and
proposal lookup over the Model Context Protocol — locally over stdio or
hosted as a Cloudflare Worker over HTTP. Data is SHA-pinned and
auto-refreshes from the upstream `tc39/*` mains. **The server is the
product**: code, dependencies, and docs read as if written for any
reader of the TC39 specs, not one downstream consumer.

## When reviewing, enforce these invariants

1. **The tool surface stays narrow.** Every tool is read-only,
   deterministic, and a pure function of SHA-pinned data — no execution,
   no auth, no writes, no user-supplied code. Flag any new tool or schema
   change that breaks this.
2. **Nothing hosted-incompatible in the tool surface.** No shell-out,
   network call, or filesystem write that can't run behind a Cloudflare
   Worker. The *only* subprocess in the whole server is `spec.history`'s
   `git log` against a vendored checkout — flag any new one.
3. **Comments and docs describe the code, in general terms.** Flag
   anything that only makes sense to a specific downstream consumer; it
   should describe the general behavior instead.
4. **Schemas are the contract.** Input schemas use Zod; every exported
   interface field carries a JSDoc comment (the `/tools` page is
   generated from these). A tool-schema change is breaking — flag a
   missing `CHANGELOG.md` entry.
5. **`docs/tools.md` is generated** by `npm run docs:data` from the
   schemas — never hand-edited. Flag manual edits.
6. **Tests are co-located** as `*.test.ts` (worker tests under
   `worker/src/**`). A new tool needs a unit test and, after
   regeneration, a `docs/tools.md` section.

## Patterns that are intentional — do NOT flag

- **The Worker keeps its own copies** of the editions catalog and server
  instructions under `worker/src/`. Deliberate — it keeps the Worker
  bundle free of the Node-shaped source tree; the deploy workflow's
  typecheck + smoke test keep them in sync.
- **Terse comments and docs.** The project defaults to silence: a comment
  that doesn't help a reader understand the code is removed on purpose.
  Don't ask for more prose for its own sake.
- **Defensive guards that currently can't fail** (e.g. `isSupported`,
  now that both specs cover the same edition range) are kept against
  future divergence, not dead code.

## Commit messages, PR titles, and issue text

Public surface — describe what changed and why in general terms, the same
standard as code comments (`AGENTS.md` rule 4).
