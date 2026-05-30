# Project rules for AI agents

This file follows the cross-tool [AGENTS.md](https://agents.md/)
convention for agent-instruction files. `CLAUDE.md` is a symlink to
this file, so Claude Code reads the same rules without diverging.

`tc39-mcp` is a **general-purpose, public, read-only MCP server** for
the TC39 specs (ECMA-262 + ECMA-402). It stands alone — it has no
sibling project, no parent project, no private codebase it's
extracted from. Treat it that way when you work in this directory.

## Hard rules

1. **Never reference, hint at, or link to other projects** that may
   consume this server. The server is the product; what consumes it is
   none of its business.
2. **Never add tools, dependencies, or docs that imply a specific
   downstream use case.** The criterion for "should this tool exist?"
   is *"does it expose structured TC39 spec data?"* — not *"is it
   useful for X downstream workflow?"*.
3. **Specifically forbidden names** in any file in this repo
   (source, tests, docs, comments, commit messages):
   - `pragmatist`
   - `coq`, `rocq`, `Lean`, `Agda`, `K` framework
   - `findings`, `audit`, `verifier`, `verify-finding`
   - `engine differential`, `engines.diff`, `audit-engines`
   - `playbook`, `eval set`, `eval harness`
   - any reference to closed-source tooling that uses this server
4. **The tool surface stays narrow.** Read-only, deterministic, no
   execution, no auth, no writes. New tools land only if they expose
   structured spec data and meet that contract — see
   `CONTRIBUTING.md` § "What kinds of changes are welcome".
5. **No subprocess fallbacks for hosted-incompatible paths.** Anything
   that can't run behind a Cloudflare Worker (shell-out, network call,
   filesystem write) doesn't belong in the tool surface. The only
   subprocess in the whole server is `spec.history`'s `git log`
   against a vendored checkout; nothing else.

## Why this rule exists

This server is designed to be useful to **anyone** auditing,
visualizing, or tooling against the TC39 specs. Tying it to one
downstream workflow — even mentioning that workflow in comments —
narrows the perceived audience, invites scope creep, and leaks
information that has no business being here.

If you find yourself writing "this would be useful for X" in a
comment, delete the X and keep the rest.

## Allowed references

- Upstream TC39 repos: `tc39/ecma262`, `tc39/ecma402`, `tc39/test262`,
  `tc39/proposal-*` — anything publicly authoritative.
- Tooling that publicly consumes the MCP protocol: Claude Code, MCP
  Inspector, other public agent frameworks.
- The hosted Cloudflare Worker deployment of THIS server (when it
  exists).
- General-purpose ecosystem packages (`@tc39/ecma262-biblio`,
  `cheerio`, `@modelcontextprotocol/sdk`, etc.).

## When in doubt

Default to silence. Adding *no* mention of a downstream project is
always safer than adding the wrong mention. If a comment doesn't
help someone reading the code understand the code, delete it.
