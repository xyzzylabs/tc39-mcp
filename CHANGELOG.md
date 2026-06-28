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

## [0.5.0] — 2026-06-28

Adds the MCP `prompts` capability and moves the hosted deployment to its
own domain.

### Added

- **MCP prompts (workflow templates).** Seven reusable prompts —
  `explain-clause`, `compare-editions`, `find-and-read`,
  `trace-crossrefs`, `proposal-status`, `test262-for-feature`,
  `cite-reproducibly` — that steer an agent through the right tool
  sequence. Pure string templates (no execution); advertised on both the
  stdio server and the hosted Worker via `prompts/list` + `prompts/get`.

### Changed

- **Hosted deployment moved to `mcp.xyzzylabs.ai/tc39`.** The docs site,
  the registry MCP endpoint, and the npm package's R2-fetch origin point
  there now. The old `*.workers.dev` URL still serves identical data.
- **Edition aliases normalize.** `ES2025`, `2025`, `es-2025`, `Latest`,
  `MAIN` resolve to canonical editions instead of 404-ing on a missing
  snapshot key — the same tolerance the `ecma262` / `ecma402` spec
  aliases got in 0.4.1. A well-formed but out-of-range edition (`es2015`)
  still reports "unsupported".
- **Discoverability: step-text + test262 linkage.** The server
  instructions now point agents at `spec.search { search_steps: true }`
  for "where is X invoked" queries and at `test262.search { esid }` for a
  clause's conformance tests (a clause id is its esid), and drop the
  hard-coded tool list — the live set comes from `tools/list`.

## [0.4.1] — 2026-06-25

A bug-fix and polish release.

### Fixed

- **Spec aliases now resolve instead of 404-ing.** Tools accept the
  long spec names agents commonly pass — `ecma262` / `ecma402` (plus
  `ECMA-262`, `es`, `intl`) — and normalize them to the canonical
  `262` / `402` before building the snapshot key. Previously
  `spec: "ecma262"` produced a confusing `Missing parsed spec object
  in R2: spec-ecma262-…` error; an unrecognized spec now returns a
  clear `Unknown spec …` message.
- **Clean stdio stream from the documented dev launch config.** The
  `.mcp.json` wiring that runs the server from local source now passes
  `npm run --silent mcp`, so npm's lifecycle banner can't leak onto
  stdout and corrupt the JSON-RPC stream a stdio MCP client reads.

### Changed

- **Reworded the project disclaimer** from "unofficial / community
  project" to "independent project — not an official Ecma International
  or TC39 publication," across the README, docs landing page,
  agent-facing instructions, and the `server.json` registry
  description.

## [0.4.0] — 2026-06-05

The hosted Cloudflare Worker grows from 6 to 17 of the 19 tools. Every
newly-hosted tool shares its logic with the stdio server through a
dependency-free `src/spec/*` (or `src/index/*`) module, so the two
transports answer identically and can't drift.

### Added

- **Eleven more tools on the hosted Worker**, each reading the
  parsed-spec JSON or index it already loads from R2:
  - `spec.grammar`, `spec.tables`, `spec.sdo_index` — grammar
    productions from `<emu-grammar>`, `<emu-table>` content, and the
    Syntax-Directed-Operation-by-production index.
  - `clause.outline`, `spec.global_search` — the section tree, and one
    search across both ECMA-262 and ECMA-402.
  - `spec.snapshots` — the live `(spec, edition, sha, fetched_at)`
    snapshots the Worker serves from R2.
  - `spec.symbol_resolve`, `spec.well_known_intrinsics` — resolve
    notation (`[[Slot]]`, `%Intrinsic%`, `~enum~`) and enumerate
    well-known intrinsics with their defining clauses.
  - `spec.diff` — clause-level diff across two editions of a spec.
  - `spec.crossrefs` — incoming / outgoing references, with the
    AOID-densified reverse index and the opt-in 262 ↔ 402 cross-spec
    pass.
  - `test262.search` — ranked search over the tc39/test262 index,
    served from the same R2 side-index `spec.about` already reads.

  The two tools that stay stdio-only are `spec.history` (shells out to
  `git log` against a vendored checkout) and `test262.get` (reads each
  test's full source from the vendored test262 corpus, which isn't in
  R2).

### Changed

- **Every ported tool's logic now lives in a shared, dependency-free
  `src/spec/*` (or `src/index/*`) module** imported by both the stdio
  server and the bundled Worker, replacing what would otherwise be a
  hand-maintained second copy. The stdio tool surface — every schema and
  result shape — is unchanged; this extends the 0.3.1 consolidation
  across every newly-hosted tool.
- **The hosted-vs-stdio tool split is a single source of truth.** Both
  transports' server instructions and the Worker's `tools/list`
  registry derive their tool lists and counts from one `tool_inventory`
  module, so a tool crossing over updates every surface at once.
- **`spec.about`'s metadata scan no longer evicts the Worker's hot
  parsed-spec cache.** The introspection scan that reads every snapshot
  for its pin now uses a parse-and-discard path instead of thrashing
  the capacity-4 LRU that `clause.get` / `spec.search` depend on.
- **The docs now mark transport availability.** The tool reference
  carries a per-tool **Availability** line (hosted Worker vs
  stdio-only), generated from the same `tool_inventory` source of
  truth, and getting-started splits into self-contained Local (stdio)
  and Hosted (HTTP) walkthroughs.

## [0.3.1] — 2026-06-05

The hosted Cloudflare Worker reaches feature parity with the stdio
server, and the stdio ↔ Worker code is unified so the two can't drift
apart again.

### Fixed

- **`spec.search` on the hosted Worker now honors `search_steps`.** It
  previously ranked only aoid / title / id matches; step-text matches
  (the `steps` tier) were silently dropped. The stdio server already
  did this — now both transports rank a query identically.
- **`proposal.list` on the hosted Worker now accepts the `spec` filter**
  (`262` / `402`). It was stdio-only, so the Worker couldn't narrow
  proposals to one spec.

### Changed

- **The spec/edition catalog, the `spec.search` ranking, and the
  `proposal.list` filter are now single shared modules** used by both
  the stdio server and the Worker, replacing hand-maintained copies
  that had drifted. The stdio tool surface is unchanged
  (`docs/tools.md` is identical) — this is internal consolidation plus
  the two Worker fixes above.

## [0.3.0] — 2026-06-03

The `es2026` edition lands on both specs.

### Added

- **ECMA-262 and ECMA-402 add the `es2026` edition.** Both specs now
  cover `es2016` – `es2026` plus `main`. tc39/ecma262 tags `es2026`;
  tc39/ecma402 publishes it as an `esYYYY` branch. `clause.get`,
  `spec.search`, `spec.diff`, `spec.history`, and the rest of the
  edition-aware surface resolve `es2026` on both specs.

### Changed

- **`latest` now resolves to `es2026`** on both ECMA-262 and ECMA-402
  (previously `es2025`). `main` / `draft` / `next` continue to address
  the working draft.
- **The npm bundle tracks the new stable.** The offline fallback now
  ships `spec-262-es2026` + `spec-402-es2026` (replacing the `es2025`
  pair); every other edition is fetched from the hosted Worker on
  demand.

## [0.2.0] — 2026-06-03

The data model moves
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

### Removed

- **Dropped the transient `es2025-candidate` 402 pin.** It predated the
  final `es2025` branch, which now supersedes it. `clause.get`,
  `spec.diff`, and the other edition-aware tools no longer accept
  `edition: "es2025-candidate"` — use `es2025`.

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
- **`cheerio` and `@tc39/ecma262-biblio` move to `devDependencies`.**
  They're only used by the parser at build time (`npm run parse`); the
  running server reads pre-parsed JSON and never imports them. A
  consumer install no longer pulls cheerio's ~20-package HTML-parsing
  tree (~2.4 MB). The published tarball also drops `dist/docs` and
  `dist/refresh` (build/CI-only code that runs from `src/` via tsx,
  never at runtime).
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

### Fixed

- **Conditional revalidation returns `304` from the hosted Worker.** The
  stdio loader sends `If-None-Match` when re-checking a live snapshot
  past its ~4-hour freshness window; the `/r2/` proxy previously ignored
  it and re-sent the full body. It now returns a bodyless `304` on an
  etag match, so a revalidation costs a header round-trip instead of a
  tens-of-MB re-download.

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
