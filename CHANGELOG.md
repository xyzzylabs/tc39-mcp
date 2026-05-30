# Changelog

All notable changes to `tc39-mcp` are recorded here. Versions follow
[Semantic Versioning](https://semver.org/): tool-schema or behavior
changes that aren't backward-compatible bump the major; new tools or
optional schema fields bump the minor; internal fixes bump the patch.

## A note on auto-refresh PATCH versions

This file only records **code changes** — new tools, schema tweaks,
internal fixes. The `refresh.yml` workflow also publishes PATCH bumps
every few hours when upstream `tc39/ecma262`, `tc39/ecma402`,
`tc39/test262`, or `tc39/proposals` move. Those releases ship identical
code with a refreshed spec-data payload and **do not get an entry
here** — otherwise the file would balloon by dozens of entries per
month, all saying "spec moved."

To see which SHA a given published version is pinned to:

- **Live** — call `spec.about` or `spec.snapshots`; the response carries
  the per-snapshot `sha` + `fetched_at`.
- **Browse** — the `/snapshots` page on the hosted Worker (same origin
  that serves `/mcp`), regenerated on every refresh, lists every parsed
  `(spec, edition, sha, fetched_at)` tuple.
- **Historical** — the hosted Cloudflare Worker accepts `at: "<sha>"` to
  address a specific upstream commit; the npm tarball pins to whatever
  was current at publish time.

## [0.1.0] — 2026-05-30

Initial release. 19 read-only tools across 5 namespaces, two TC39
specs covered (ECMA-262 + ECMA-402), 13 supported parsed snapshots
in total (11 for 262 + 2 for 402), plus offline indices for test262
and tc39/proposals.

Three deploy shapes:

- **Local stdio** via `npx tc39-mcp` (default — wires into Claude
  Code via `.mcp.json`).
- **Local CLI** via `npm i -g tc39-mcp` + the `tc39-mcp` bin.
- **Hosted HTTP** via the Cloudflare Worker in `worker/`. Bundles to
  ~12 KB; reads parsed JSONs from R2; ships 6 of the 19 tools (the
  rest are stdio-only for v0.1). The same Worker also serves the
  docs site as static assets — one origin for both `/mcp` and `/`.
  See `docs/deployment.md`.

Freshness is **automatic**: `.github/workflows/refresh.yml` runs
every 4 hours, diffs upstream tc39/* mains against the last
published SHAs, and republishes a PATCH bump when anything moved.
The hosted Worker rebuilds both API + docs together on every PATCH.

### Tools

Every spec-reading tool accepts a `spec` argument selecting `"262"`
(default) or `"402"`.

| Tool | Notes |
|---|---|
| `spec.about` | Self-describe the running server: package version, per-snapshot pin metadata, test262 + proposals index headers. Use first to verify what you're reading. |
| `spec.snapshots` | Enumerate every (spec, edition, sha, fetched_at) parsed snapshot the server has available. Useful for discovering historical SHAs queryable via `at:` (hosted Worker only in v0.1). |
| `clause.get` | Full structured clause: signature, numbered steps + substeps, notes, crossrefs. |
| `clause.list` | Browse by `kind` / `section` prefix / `has_algorithm`. |
| `clause.outline` | Section tree / table of contents for a parsed (spec, edition). `depth` + `under` controls. |
| `spec.search` | aoid / title / id ranking; optional step-text scan via `search_steps`. |
| `spec.crossrefs` | Forward AND backward refs. Reverse index is AOID-densified (catches "who calls ToNumber" without `<emu-xref>`). Opt-in `include_cross_spec` resolves outgoing 262 ↔ 402 references. |
| `spec.diff` | Generic clause-level diff with `from` / `to` editions of a single spec. |
| `spec.history` | Recent commits in the vendored spec that touched a clause's opening tag (git pickaxe). |
| `spec.symbol_resolve` | Resolve `[[X]]` / `%X%` / `~X~` notation to defining clauses. |
| `spec.tables` | Parsed `<emu-table>` content (well-known intrinsics, symbols, completion record fields, etc.). |
| `spec.grammar` | Standalone `<emu-grammar>` productions captured from §11-15. |
| `spec.global_search` | Cross-spec search across both 262 + 402, results tagged by spec. Convenience over running `spec.search` twice. |
| `spec.sdo_index` | Index Syntax-Directed Operations by grammar production (or by SDO title). |
| `spec.well_known_intrinsics` | Enumerate `%X%` notations + probable defining clause (title-substring heuristic, honest about confidence). |
| `test262.search` | Reads `build/test262-index.json` (built from a vendored test262 checkout). test262 covers both 262 and 402. Index-only — no auth, no network, no subprocess. `esid` is a case-insensitive prefix match; multi-word `query` is token-AND across description + path. |
| `test262.get` | Fetch one test's source + parsed front-matter by path. Pairs with `test262.search`. |
| `proposal.list` | List TC39 proposals from a static index built from tc39/proposals. Filter by stage / champion / name substring. |
| `proposal.get` | Fetch one TC39 proposal by slug (canonical) or name (case-insensitive). |

### Specs + editions

ECMA-262:

| Resolved at load | Value(s) |
|---|---|
| Concrete releases | `es2016`, `es2017`, `es2018`, `es2019`, `es2020`, `es2021`, `es2022`, `es2023`, `es2024`, `es2025` |
| Working draft | `main` |

ECMA-402:

| Resolved at load | Value(s) |
|---|---|
| Concrete candidates | `es2025-candidate` |
| Working draft | `main` |

Aliases (resolved spec-aware):

| Alias | Resolves to (262) | Resolves to (402) |
|---|---|---|
| `latest` | current stable release (`es2025` today) | `main` (no annual final-release tag exists upstream) |
| `draft` / `next` | `main` | `main` |

Floor for ECMA-262 is `es2016` because tc39/ecma262 has no earlier
release tag. ES5/ES5.1 predate the GitHub repo; ES2015/ES6 was
authored there but never tagged.

ECMA-402 doesn't tag annual releases at all — the candidates plus
`main` are the entire universe of published refs.

### Notes

- The `loadSpec` cache is keyed on (spec, concrete edition), so
  `{ spec: "262", edition: "latest" }` and `{ spec: "262", edition: "es2025" }`
  share one in-memory parse.
- `spec.history` detects shallow vendor clones (the default
  `fetch-spec.sh` uses `--depth=1`) and returns a `hint` field telling
  the caller to `git fetch --unshallow` for deep history.
- `test262.search` is offline-tolerant: if the index hasn't been built
  it returns an empty hit list with a `hint` field pointing at the
  setup command. No subprocess fallback — local and hosted behave
  identically.

### Docs included

- `README.md` — quick start + tool table + edition table.
- `docs/architecture.md` — pipeline, modules, edition + alias resolution.
- `docs/tools.md` — full reference for every tool.
- `docs/editions.md` — spec + edition model, adding new releases.
- `docs/deployment.md` — local stdio, npm CLI, hosted Cloudflare Worker sketch.
- `CONTRIBUTING.md` — change-shape guidance.
- `SECURITY.md` — threat model + reporting path.

### Out of scope

This release deliberately ships no execution, no write paths, no
authentication. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
boundary.
