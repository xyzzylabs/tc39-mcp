# Changelog

All notable changes to `tc39-mcp` are recorded here. Versions follow
[Semantic Versioning](https://semver.org/): tool-schema or behavior
changes that aren't backward-compatible bump the major; new tools or
optional schema fields bump the minor; internal fixes bump the patch.

## A note on data-refresh versions

This file records **code changes** — new tools, schema tweaks,
internal fixes. As of 0.2.0, spec-data freshness no longer rides the
npm version: the hosted Worker's R2 data refreshes every ~4 hours and
the stdio server fetches from it on a cold or stale cache (see the
0.2.0 entry below). The npm bundle — the offline fallback — is re-baked
on a slow cadence (at most monthly, or immediately when a new edition
ships). Those PATCH releases carry identical code with a refreshed data
payload and **do not get an entry here**.

To see which SHA a given published version is pinned to:

- **Live** — call `spec.about` or `spec.snapshots`; the response carries
  the per-snapshot `sha` + `fetched_at`.
- **Browse** — the `/snapshots` page on the hosted Worker (same origin
  that serves `/mcp`), regenerated on every refresh, lists every parsed
  `(spec, edition, sha, fetched_at)` tuple.
- **Historical** — the hosted Cloudflare Worker accepts `at: "<sha>"` to
  address a specific upstream commit; the npm tarball pins to whatever
  was current at publish time.

## [Unreleased]

Staged for the v0.2.0 release (not yet cut). The data model moves
from "ship every snapshot in the tarball" to
"cache on first use, fetch from the hosted Worker, fall back to a
bundled subset." The npm version stops tracking spec data and starts
meaning code again.

### Added

- **ECMA-402 reaches edition parity with ECMA-262.** 402 publishes
  each annual edition as an `esYYYY` *branch* (not a tag); the catalog
  now exposes the full `es2016` – `es2025` range plus `main`, where it
  previously had only `es2025-candidate` + `main`. `spec.diff`,
  `spec.history`, and edition-pinned `clause.get` now work across the
  402 annual line.
- **ECMA-402 proposals are indexed.** `proposal.list` / `proposal.get`
  now cover the `ecma402/` proposal set (~32 proposals that were
  entirely missing), and `proposal.list` gains a `spec` filter
  (`{ spec: "402" }`). Every proposal row carries a `spec` tag.

### Changed

- **Snapshots are sourced through a cache → hosted Worker → bundled
  fallback chain** (`loadSnapshot`). The stdio server caches each
  snapshot under `~/.cache/tc39-mcp/` on first network fetch and serves
  it from disk thereafter, revalidating against the Worker only after a
  ~4-hour freshness window (conditional `If-None-Match`).
- **`latest` on ECMA-402 now resolves to `es2025`** (the newest annual
  edition), matching 262's "latest = newest stable" semantics. Use
  `main` / `draft` / `next` for the working draft.
- **The npm tarball shrinks ~70%.** It now bundles only the offline
  fallback — `spec-262-es2025`, `spec-262-main`, `spec-402-es2025`,
  `spec-402-main`, and the proposals + test262 indexes — instead of
  every parsed edition. All other editions are fetched from the Worker
  on demand.
- **Refresh decouples from the npm version.** `refresh.yml` updates R2
  every ~4 hours (live freshness for networked users) and re-bakes the
  npm bundle at most monthly, ending the ~2000-PATCH-bumps-per-year
  flood. A new annual edition still publishes immediately via the
  normal code-release path.
- `@tc39/ecma262-biblio` is pinned to an exact version (per its
  README's "pin a precise version" guidance), so the parse metadata
  layer is reproducible alongside the SHA-pinned spec HTML.
- The 262 parser gained an **HTML-discovery fallback**: since the
  pinned biblio is a snapshot of `main`, it can lag the HTML being
  parsed (a newer `main`, or an older edition carrying clauses since
  dropped). Any `<emu-clause>` the biblio doesn't list is now still
  captured, with metadata synthesized from the element — so a stale or
  mismatched biblio can no longer silently drop a clause.

### Notes

- **stdio now makes HTTPS requests** to source non-cached snapshots
  (by default the hosted Worker; override with `TC39_MCP_BASE_URL` to
  self-host or air-gap). Tool arguments and clause ids never leave the
  process — see [`docs/privacy.md`](docs/privacy.md).
- v0.1.x installs are unaffected; this is a backward-compatible minor
  at the tool/protocol level.

## [0.1.6] — 2026-06-02

Two user-visible changes on top of 0.1.5:

- **`spec.history` validates its `id` argument before the
  subprocess.** The clause id is now bounded by a Zod schema
  (length 1–200; ASCII letters, digits, `.`, `_`, `%`, `-`)
  before being interpolated into the `git log -S` pickaxe
  pattern. Closes a DoS path against the only subprocess
  surface in the server; real spec clause ids (including
  well-known intrinsics like `sec-%throwtypeerror%`) are
  unaffected. Malformed ids surface as Zod validation errors
  at the tool boundary instead of reaching `git`.
- **Hosted Worker: sponsor tier removed.** The optional
  `Authorization: Bearer tcms_…` higher-rate-limit path is
  gone. Every caller is now on the IP-bucketed free tier at
  30 req / 60 s per client IP. The hosted endpoint stays
  publicly free; self-hosters who want a higher cap can raise
  it in their own `wrangler.toml`.

The MCP protocol surface and the parsed-spec contract are
identical to 0.1.5.

### Documentation

- **SECURITY.md** — new "Tool outputs are upstream content"
  section flagging prompt-injection risk via spec text /
  test262 source / commit messages, and a new "Incident
  response" section covering bad-release deprecation, Worker
  rollback, vulnerability triage, and credential rotation.
- **README** — sponsor badge, the Sponsorship section, and
  the `/sponsor` doc link removed (the sponsor tier they
  referred to no longer exists).
- **CONTRIBUTING.md** — added a GitHub Actions pinning
  policy: first-party `actions/*` may use major-version tags;
  third-party Actions must be pinned to commit SHA with the
  version as a trailing comment.

### Internal

- `npm audit signatures` runs in CI now against both the
  root and worker lockfiles.
- New worker CI test pinning the no-credentials CORS
  property so a future change can't accidentally enable
  credentialed cross-origin requests under wildcard
  `Allow-Origin`.
- `refresh.yml` can mint a GitHub App installation token
  (preferred) when `vars.BOT_APP_ID` is set; falls back to
  `WORKFLOW_PAT` or `GITHUB_TOKEN`. No behavior change until
  the App is configured.
- Branch-protection ruleset config checked in at
  `.github/rulesets/main.json`.

## [0.1.5] — 2026-06-02

No runtime behavior change — the MCP server speaks the same
protocol against the same parsed snapshots as 0.1.4. Routine
dependency and CI maintenance since the previous tag:

- **`@typescript/native-preview` (tsgo) bumped** in both the root
  and `worker/` packages to the latest dev build. tsgo is the
  type-checker used by `npm run typecheck` and the build, so
  keeping it current tracks the active TypeScript Go effort.
- **Worker dev-dependency group refreshed** (Wrangler + related
  tooling) as a grouped Dependabot bump.
- **Root dev-dependency group refreshed** as a grouped Dependabot
  bump.
- **`actions/cache` bumped 4 → 5** in the GitHub Actions
  workflows.

## [0.1.3] — 2026-05-31

Two non-runtime additions on top of 0.1.2:

- **`package.json` carries the `mcpName` field** pointing at
  `io.github.xyzzylabs/tc39-mcp`. The MCP Registry uses this to
  verify that the npm package and the registry namespace are
  controlled by the same party; without it, publishing the
  server.json to the registry fails the anti-squatting check.
- **README rebalanced.** 0.1.2 led the README with offline-first;
  this version leads with the agentic spec-lookup framing
  (offline becomes a supporting bullet). The README that lands on
  npmjs.com with this publish is the one currently rendered on
  the docs site.

No runtime behavior change — the MCP server speaks the same
protocol against the same parsed snapshots as 0.1.2.

## [0.1.2] — 2026-05-31

No changes to the published npm package's runtime behavior — the MCP
server speaks the same protocol against the same parsed snapshots as
0.1.1. This release tightens the README to lead with the
**offline-first** positioning, adds new docs site pages, completes
the tool-schema documentation, and ships deployment-side
improvements for the hosted Cloudflare Worker that are exercised
when you self-host or use the public deployment.

### Documentation

- **`docs/getting-started.md`** — new five-minute walkthrough from
  install through wiring an MCP client through making the first
  call and verifying the response.
- **`docs/cookbook.md`** — six multi-tool recipes: cross-spec
  lookups, prose drift across editions, notation → definition,
  test262 coverage for one clause, grammar / SDO joins, and
  proposal-to-clause mapping.
- **`docs/tools.md`** — now auto-generated by
  `src/docs/build_api_reference.ts` (uses the TypeScript Compiler
  API to walk `src/mcp/server.ts` + `src/mcp/tools/*.ts`). Each
  tool section carries a "What it answers" block of co-located
  example calls, full input schema, and the handler's declared
  return type expanded into a field table when it names a local
  interface.
- **`docs/sponsor.md`** — describes the optional sponsorship
  model: anonymous use stays free at 30 req/min/IP; sponsors at
  any tier ≥ $5/mo get a `tcms_…` key giving 300 req/min bucketed
  per-key on the hosted Worker.
- **README rewrite** — leads with offline-first positioning and a
  worked `clause.get sec-tonumber` response example. Drops the
  per-namespace tool breakdown that had grown to duplicate
  `docs/tools.md`. Adds a Sponsorship section.
- **`docs/index.md`** — new ✈️ "Offline-first by default" feature
  card; tagline expanded to lead with the offline angle.

### Tool schemas

Code-side improvements that flow into the regenerated `tools.md`:

- Every tool's input Zod schema now has `.describe()` on every
  field. Shared `spec` / `edition` / `limit` parameters in
  particular were spotty before and are now uniform.
- Every output TypeScript interface (and the shared types in
  `src/parser/schema.ts`) carries JSDoc on every field; the
  generated `tools.md` surfaces this verbatim.
- Each tool file now exports a `<name>Examples` array of
  `{ q, input, note? }` triples. The generator renders these as a
  "What it answers" section under each tool — example calls
  tagged with the natural-language question they answer, with an
  optional italic note.

### Hosted Worker (deployment-only)

These changes ship when the Worker is redeployed; they do not
affect the published npm package:

- **Two-layer read cache in front of R2.** New per-colo edge
  cache wrapping every R2 GET. Per-SHA snapshots cache as
  `public, max-age=86400, immutable`; live mains cache as
  `max-age=300`. Cuts repeat R2 reads dramatically.
- **Tighter rate limiter** — 100 → 30 req/min/IP for anonymous
  traffic. Math sized to keep worst-case per-IP load under the R2
  Class B free allowance even cold.
- **Sponsor auth middleware.** Optional `Authorization: Bearer
  tcms_…` header is checked against a SHA-256 hash in a
  Cloudflare KV namespace (binding `SPONSORS`). Recognized keys
  land in a separate per-key 300/60s rate-limit bucket; missing /
  malformed / unrecognized keys fall through to the anonymous
  path transparently — auth never blocks access.
- **Sponsor key issuance + revocation scripts** in `worker/`:
  `npm run issue-sponsor-key -- --github=<login>` mints a random
  `tcms_…` key, stores its hash + metadata in KV, prints the raw
  key once. `npm run revoke-sponsor-key -- --github=<login>`
  removes the KV entry.

### Internal

- Workflow permissions scoped explicitly on every CI job; CodeQL
  alerts addressed (`actions/missing-workflow-permissions`,
  `js/incomplete-sanitization`).
- Dependabot: pinned `esbuild >= 0.25.0` via `package.json`
  overrides (closes GHSA-67mh-4wv8-2f99).
- `AGENTS.md` rewritten as a standalone project rules file.

## [0.1.0] — 2026-05-30

Initial release. 19 tools across 5 namespaces, two TC39 specs
covered (ECMA-262 + ECMA-402), 13 supported parsed snapshots
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
