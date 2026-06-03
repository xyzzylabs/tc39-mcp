# Architecture

`tc39-mcp` is a read-only function from `(spec, edition, query) → structured
spec data`. Every endpoint is a thin Zod-validated wrapper around a
library function that reads from on-disk JSON. There's no server-side
state beyond an in-memory parsed-spec cache.

Two TC39 specs are covered: **ECMA-262** (the core ECMAScript language)
and **ECMA-402** (the Internationalization API, `Intl`). The parser
treats them identically — both are ecmarkup-rendered HTML with
`<emu-clause>` trees, AOIDs, and `<emu-xref>` cross-references — and
the same cache + alias machinery serves both.

## Data pipeline

```
   ┌────────────────────────────────────────────────────────────┐
   │  scripts/fetch-spec.sh                                     │
   │     git clone --depth=1 tc39/ecma262 @ <tag>               │
   │     git clone --depth=1 tc39/ecma402 @ <tag>               │
   │     → vendor/ecma<spec>-<edition>/spec.html                │
   └────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
   ┌────────────────────────────────────────────────────────────┐
   │  src/parser/cli.ts (`npm run parse`)                       │
   │     cheerio walks the <emu-clause> tree                    │
   │     @tc39/ecma262-biblio supplies aoid + section metadata  │
   │     → build/spec-<spec>-<edition>.json                     │
   └────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
   ┌────────────────────────────────────────────────────────────┐
   │  src/mcp/tools/clause.ts loadSpec(spec, edition)           │
   │     reads + parses build/spec-<spec>-<edition>.json once   │
   │     caches in-process, keyed on (spec, concrete-edition)   │
   └────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
   ┌────────────────────────────────────────────────────────────┐
   │  src/mcp/server.ts (stdio MCP transport)                   │
   │     19 tools forward to library functions                  │
   │     Zod validates inputs; outputs are JSON                 │
   └────────────────────────────────────────────────────────────┘
```

Steps 1 and 2 happen offline (build-time / fetch-time) and produce
the snapshots the server reads. At runtime the stdio server sources
those snapshots through `src/data/loader.ts` (`loadSnapshot`) — a
local cache → hosted Worker → bundled fallback chain — so the
working set on disk grows lazily as editions are queried. The same
code deploys behind a Cloudflare Worker (see
[`deployment.md`](deployment.md)) where steps 1–2 happen in CI and
the parsed JSON is served from R2 directly.

The 262 parse runs **two passes**: biblio-driven first
(`@tc39/ecma262-biblio` supplies authoritative aoid + section
metadata), then an **HTML-discovery fallback** that captures any
`<emu-clause>` / `<emu-annex>` the pinned biblio didn't list,
synthesizing metadata from the element. Because the biblio is pinned
to one `main` snapshot it can lag the HTML being parsed (a newer
`main`, or an older edition carrying since-removed clauses); the
fallback guarantees a stale or mismatched biblio can never silently
drop a clause. ECMA-402 has no biblio dependency at all — it
synthesizes the same metadata directly from its multi-file
`<emu-import>` walk (`src/parser/synthesize.ts` is shared by both
paths).

## Parsed shape

The parser writes one JSON file per (spec, edition) pair under `build/`.
The shape is recorded in `src/parser/schema.ts`:

```ts
ParsedSpec {
  pin:     { spec, edition, sha }
  clauses: { [id]: Clause }
}

Clause {
  meta:         { id, aoid, title, number, kind }
  signatureRaw: string | null            // the <h1> text for abstract ops
  algorithms:   Algorithm[]              // one per <emu-alg>; SDOs have many
  notes:        string[]
  crossrefs:    string[]                 // raw hrefs from <emu-xref>
}

Algorithm {
  steps:      AlgorithmStep[]
  production: string | undefined         // set for SDO algorithms; the
                                         // associated grammar production
}

AlgorithmStep {
  text:      string                      // verbatim markdown, markup preserved
  substeps:  AlgorithmStep[]
}
```

All clause text retains its in-spec markup (`_argument_`, `*true*`,
`*0*𝔽`, etc.) so downstream tools can re-parse semantically.

## Modules

| Module | Purpose | Files |
|---|---|---|
| **Editions** | Canonical spec + edition catalog, alias resolution, path helpers | `src/editions.ts` |
| **Paths** | Filesystem layout (built JSON, vendor checkouts) | `src/paths.ts` |
| **Parser** | spec.html → ParsedSpec | `src/parser/{schema,biblio,clause,steps,index,cli}.ts` |
| **Tools** | One file per MCP tool; each exports a Zod schema + a library function | `src/mcp/tools/*.ts` |
| **Server** | Wires every tool into the stdio MCP transport | `src/mcp/server.ts` |

Dependencies between modules form a DAG. The parser depends on nothing
in `src/mcp/`. The tools depend on the parser's types and on
`editions.ts`. The server depends on the tools.

## Spec + edition + alias resolution

Tools accept any value from `EDITION_VALUES`. Three of those values are
aliases that resolve to a concrete edition at load time, and resolution
is **spec-aware** because the two specs tag releases differently:

```
                          spec === "262"          spec === "402"
                          ──────────────          ──────────────
   "latest"  ──┐
               ├──► resolveEdition(spec, ed)  ──► LATEST_262_RELEASE  │  LATEST_402_RELEASE
   "draft"   ──┤                                  main                │  main
               │                                  main                │  main
   "next"    ──┘
```

`loadSpec(spec, edition)` caches on the concrete pair, so two requests —
one using `latest`, one using `es2025` — share a single parse in
memory when they refer to the same data.

When tc39 cuts the next ECMA-262 release, you bump
`LATEST_262_RELEASE` in `editions.ts` and re-fetch / re-parse. `latest`
on `spec: "262"` automatically points at the new release. See
[`editions.md`](editions.md) for the full recipe.

ECMA-402 publishes each annual edition as an `esYYYY` *branch* rather
than a tag (ECMA-262 uses tags), but `git clone --branch` resolves
either, so the catalog shape is identical across the two specs.
`latest` on `spec: "402"` resolves to `LATEST_402_RELEASE` (`es2025`
today), symmetric with 262 — not to `main`.

## Cross-reference index

`spec.crossrefs` builds two maps per (spec, edition):

- **Forward**: `clause_id` → set of ids it references.
- **Reverse**: `clause_id` → set of ids that reference it.

The forward index seeds from `clause.crossrefs` (the `<emu-xref>` hrefs
captured at parse time) AND from a scan of every clause's signature +
step text + notes for **AOID mentions** (e.g. the literal token
"`ToNumber`" in a step). The AOID scan is what makes the reverse index
useful — many references in the spec are bare aoid mentions rather than
explicit `<emu-xref>` elements.

Both maps are built lazily on first use of `spec.crossrefs` per
(spec, edition), then cached for the process lifetime.

### Cross-spec opt-in

The default reverse index is single-spec — querying back-refs into
`sec-tonumber` on 262 returns 262 clauses only. Setting
`include_cross_spec: true` on a 262 outgoing query also loads ECMA-402
at its `latest`, scans the source clause's text for AOID tokens that
resolve into that other spec, and appends the hits. This is the
mechanism behind queries like "every ECMA-262 op that calls into the
Intl spec." It's opt-in because loading the other spec on every call
would double parse work for the common single-spec case.

## Memory model

The parsed-spec cache (`src/mcp/tools/clause.ts`) is a **bounded LRU
with default capacity 4**. Each parsed snapshot is ~25-50 MB on the
heap; capping at 4 entries holds the working-set RSS under ~200 MB
even on long-running servers that touch many editions. Override via
the `TC39_MCP_LRU` environment variable.

Per pair memory cost:

| Spec / edition | Parsed JSON on disk | Roughly in memory |
|---|---|---|
| 262 / es2025 | ~7 MB | ~25 MB |
| 262 / main | ~7 MB | ~25 MB |
| 262 / es2016 | ~3 MB | ~10 MB |
| 402 / main | ~0.6 MB | ~3 MB |

The cross-ref index cache (`src/mcp/tools/spec_crossrefs.ts`
`indexCache`) is still unbounded, but it's only populated lazily on
first `spec.crossrefs` call per (spec, edition); steady-state cost is
similar to the spec cache. Bound this too if your workload hits many
distinct pairs.

For the hosted Cloudflare Worker, the cache lives per-isolate (also
a 4-entry LRU in `worker/src/r2.ts`) and is GC'd when the isolate is
recycled.

Re-parsing on every miss would be substantially slower (~5-15 s per
parse) than the memory cost of caching, which is why the LRU is
small — the cost of an eviction-followed-by-rehit isn't free.

## What this is not

- **Not stateful.** Restart the server, lose only the parse cache;
  every response is recomputable from the on-disk JSON and the request.
- **Not authoritative.** It's a structured view of `tc39/ecma262` +
  `tc39/ecma402`. If the upstream spec is wrong, the response is wrong.
- **Not an executor.** No `eval`, no JS engine spawn, no scripting
  endpoint. Hosting is safe because there's nothing to sandbox.
- **Not a writer.** No tool mutates anything. The only side effect of
  any tool is reading files (and, for `spec.history` / `test262.search`,
  a subprocess to `git` / `gh`).
