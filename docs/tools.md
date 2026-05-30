# Tool reference

Every tool's input is validated by a Zod schema. Defaults match the
"safe boring choice" — `spec` defaults to `"262"`, `edition` defaults
to `"latest"`, limits are generous but bounded, and toggleable
expensive options (like `search_steps` and `include_cross_spec`) are
off by default.

All spec-reading tools accept `spec` (`"262"` | `"402"`) and `edition`
arguments. See [`editions.md`](editions.md) for the value set and how
aliases resolve per spec.

## `clause.get`

Return the full structured clause: signature, numbered steps (with
substeps), notes, cross-refs.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Spec clause id, e.g. `"sec-tonumber"` (262) or `"sec-intl.numberformat"` (402). |
| `spec` | `"262"` \| `"402"` | `"262"` | Which TC39 spec to read. |
| `edition` | Edition | `"latest"` | Edition or alias; resolution is spec-aware. |

### Output

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
    {
      "steps": [
        { "text": "If _argument_ is a Number, return _argument_.", "substeps": [] }
      ]
    }
  ],
  "notes": [],
  "crossrefs": []
}
```

`null` is returned if the clause doesn't exist in the requested
(spec, edition).

## `clause.list`

Browse clauses with filters. Lighter than `clause.get` — returns
metadata rows for follow-up lookups.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `kind` | string | — | Filter to one kind, e.g. `"op"`, `"sdo"`, `"built-in function"`. |
| `section` | string | — | Section-number prefix, e.g. `"22.2"` for RegExp, `"15"` for the locale-aware operations in 402. |
| `has_algorithm` | boolean | — | If true, only clauses with at least one `<emu-alg>`. |
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `limit` | int 1–2500 | 200 | |

### Output

```json
{
  "hits": [
    {
      "id": "sec-tonumber",
      "aoid": "ToNumber",
      "title": "ToNumber ( argument )",
      "number": "7.1.4",
      "kind": "op",
      "algorithms": 1
    }
  ]
}
```

## `spec.search`

The entry point when you don't know the exact clause id. Ranks
matches against id, aoid, title, and (optionally) step text.

Ranking (highest first):
1. `aoid-exact` — case-insensitive equality on the clause's aoid.
2. `aoid` — aoid substring.
3. `title` — title substring.
4. `id` — id substring.
5. `steps` — step text substring (only if `search_steps: true`).

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | Search text. |
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `limit` | int 1–100 | 20 | |
| `search_steps` | boolean | `false` | Also match step text. Slower + noisier. |

### Output

```json
{
  "hits": [
    {
      "id": "sec-runtime-semantics-canonicalize-ch",
      "aoid": "Canonicalize",
      "title": "Canonicalize ( regexpRecord, ch )",
      "number": "22.2.2.7.3",
      "kind": "clause",
      "matched_on": "aoid-exact",
      "score": 100
    }
  ]
}
```

## `spec.crossrefs`

Forward and backward references for a clause. The reverse index is
densified from AOID mentions in step text, so it works even when the
spec doesn't use explicit `<emu-xref>` elements.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Spec clause id. |
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `direction` | `"in"` \| `"out"` \| `"both"` | `"both"` | |
| `include_cross_spec` | boolean | `false` | If true, outgoing references also include AOID mentions that resolve into the OTHER spec (262 ↔ 402). Off by default because it loads both specs. |
| `edition` | Edition | `"latest"` | |
| `limit` | int 1–500 | 100 | Applies separately to incoming and outgoing. |

### Output

```json
{
  "outgoing": [
    { "id": "sec-isstrictlyequal", "aoid": "IsStrictlyEqual", "title": "IsStrictlyEqual ( x, y )", "number": "7.2.14", "spec": "262" }
  ],
  "incoming": [
    { "id": "sec-equality-operators-runtime-semantics-evaluation", "...": "...", "spec": "262" }
  ]
}
```

`outgoing` and `incoming` are present only for the directions you
requested. Both arrays are sorted by spec section number. The `spec`
field on each hit identifies which spec the target clause lives in —
relevant when `include_cross_spec: true` mixes 262 and 402 hits.

The reverse index (`incoming`) is always single-spec; cross-spec
discovery is one-directional (outgoing only), because building a
reverse index across both specs on every call would be expensive for
the common single-spec case.

## `spec.diff`

Clause-level diff across any two editions of one spec.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Spec clause id. |
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `from` | Edition | `"latest"` | The "before" edition. |
| `to` | Edition | `"main"` | The "after" edition. |

### Output

```json
{
  "id": "sec-tonumber",
  "from": "es2024",
  "to": "es2025",
  "same": false,
  "status": "modified",
  "from_summary": { "title": "...", "signatureRaw": "...", "step_count": 10, "note_count": 0 },
  "to_summary":   { "title": "...", "signatureRaw": "...", "step_count": 10, "note_count": 0 },
  "diffs": [
    {
      "field": "steps",
      "before": 10,
      "after": 10,
      "detail": "2 step(s) reworded: #4, #7"
    }
  ]
}
```

`status` is one of: `identical`, `modified`, `added` (only in `to`),
`removed` (only in `from`), `missing-from-both`.

## `spec.history`

Recent commits in the vendored spec that touched a clause's `id="..."`
token. Uses `git log -S` (pickaxe), so it catches creation, deletion,
and edits to the opening tag reliably; interior-text-only edits may not
show.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Spec clause id. |
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `limit` | int 1–100 | 20 | |

### Output

```json
{
  "id": "sec-tonumber",
  "spec": "262",
  "edition": "es2025",
  "vendor_present": true,
  "shallow": true,
  "commits": [],
  "hint": "vendor/ecma262-es2025 is a shallow clone (depth=1 from fetch-spec.sh); only HEAD is visible. Run `git -C vendor/ecma262-es2025 fetch --unshallow` to enable full history."
}
```

The default `fetch-spec.sh` uses `--depth=1` to keep clone size low.
`spec.history` detects this via the `.git/shallow` marker and surfaces
a `hint` field. Run the suggested `fetch --unshallow` to enable deep
history.

## `spec.symbol_resolve`

Resolve spec notation to the clauses that mention or define it.
Classifies the sigil, strips it, counts literal occurrences in
signature + step text + notes per clause, ranks with section-prefix
bumps for the canonical definition location.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `notation` | string (min 2 chars) | — | `"[[Prototype]]"`, `"%Object.prototype%"`, `"~number~"`. |
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `limit` | int 1–50 | 10 | |

### Output

```json
{
  "notation": "[[Prototype]]",
  "kind": "internal-slot",
  "name": "Prototype",
  "hits": [
    {
      "id": "sec-ordinary-object-internal-methods-and-internal-slots",
      "aoid": null,
      "title": "Ordinary Object Internal Methods and Internal Slots",
      "number": "10.1",
      "score": 235,
      "match_count": 21
    }
  ]
}
```

`kind` is one of: `internal-slot` (`[[X]]`), `intrinsic` (`%X%`),
`sigil-enum` (`~X~`), or `unrecognized` if no sigil pattern matches.

Section-prefix bumps (for `spec: "262"`):
- internal-slot: +25 for `6.*` / `10.*` (the slot-table homes)
- intrinsic: +40 for `6.1.7.*` (well-known intrinsics table) + a
  title-match nudge

## `spec.global_search`

Run `spec.search` against both ECMA-262 and ECMA-402 and interleave
the results by score. Each hit is tagged with its source spec. Use
when you don't know which spec defines the symbol you're after —
e.g. `Canonicalize` is 262, `CanonicalizeLocaleList` is 402, both
look like the same word from the outside.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | Search text. |
| `search_steps` | boolean | `false` | Also match step text. |
| `limit` | int 1–100 | 20 | Total hits across both specs combined. |

### Output

```json
{
  "hits": [
    {
      "id": "sec-runtime-semantics-canonicalize-ch",
      "aoid": "Canonicalize",
      "title": "Canonicalize ( regexpRecord, ch )",
      "number": "22.2.2.7.3",
      "kind": "clause",
      "matched_on": "aoid-exact",
      "score": 100,
      "spec": "262"
    },
    {
      "id": "sec-canonicalizelocalelist",
      "aoid": "CanonicalizeLocaleList",
      "title": "CanonicalizeLocaleList ( _locales_: an ECMAScript language value, ): ...",
      "number": "6.2.3",
      "kind": "op",
      "matched_on": "aoid",
      "score": 80,
      "spec": "402"
    }
  ]
}
```

The per-spec `latest` resolves spec-aware: 262 → es2025, 402 → main.

## `spec.sdo_index`

Index Syntax-Directed Operations by the grammar production they
handle. SDOs (Evaluation, BoundNames, ContainsExpression, …) are
abstract operations with one `<emu-alg>` per grammar production. The
parser captures the `<emu-grammar>` text per algorithm; this tool
reindexes it for production / SDO lookups.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `by` | `"production"` \| `"sdo"` | `"production"` | Group by production (default) or by SDO clause title. |
| `filter` | string | — | Case-insensitive substring filter on the group key. |
| `limit` | int 1–500 | 50 | Cap on the number of *groups* returned. Each group can hold many entries. |

### Output

```json
{
  "spec": "262",
  "by": "production",
  "pair_count": 1046,
  "group_count": 47,
  "groups": {
    "ArrowParameters : BindingIdentifier": [
      {
        "id": "sec-runtime-semantics-iteratorbindinginitialization",
        "title": "Runtime Semantics: IteratorBindingInitialization",
        "production": "ArrowParameters : BindingIdentifier"
      }
    ]
  }
}
```

`pair_count` reports total (production, sdo) entries before
filtering / truncation. `group_count` reports unique groups after
filtering.

## `spec.well_known_intrinsics`

Enumerate `%X%` notation references in the spec, with each one's
probable defining clause. Picks the defining clause via a title-
substring heuristic; `matched_on` per hit reports which heuristic
fired so callers can judge confidence.

For the canonical ECMA-262 well-known intrinsics table, read
`clause.get { id: "sec-well-known-intrinsic-objects" }` directly —
that's the authoritative source.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `filter` | string | — | Case-insensitive substring filter on the bare name (e.g. `"object.prototype"`). |
| `limit` | int 1–500 | 100 | |

### Output

```json
{
  "spec": "262",
  "hint": "Defining-clause selection is a title-substring heuristic — see `matched_on` per hit. For the canonical ECMA-262 well-known intrinsics table, read clause.get { id: 'sec-well-known-intrinsic-objects' } directly.",
  "hits": [
    {
      "name": "TypedArray",
      "mention_count": 94,
      "defining_clause": {
        "id": "sec-%typedarray%",
        "title": "%TypedArray% ( )",
        "number": "23.2.1.1",
        "matched_on": "title-literal"
      }
    }
  ]
}
```

`matched_on` is one of:

- `"title-literal"` — clause title contains the literal `%X%` (strongest).
- `"title-bare"` — clause title contains the bare name only.
- `"most-mentions"` — fallback; we picked the clause that mentions it most.

Hits are sorted by `mention_count` descending. The fallback is
deliberately conservative — for intrinsics that don't have a title-
based home, the most-mentioning clause is the best signal we have
without parsing `<emu-table>` content.

## `test262.search`

Search [tc39/test262](https://github.com/tc39/test262) for tests
matching a free-text query and/or an esid (prefix-matched clause id).
test262 covers both ECMA-262 and ECMA-402 — the same index serves
both. **Offline-only** — uses a local index built once from a
vendored checkout. No auth, no network, no subprocess. Returns an
empty hits array + a `hint` field when the index hasn't been built.

### Setup (one-time, recommended)

```sh
npm run fetch-test262         # clone tc39/test262 (~300 MB)
npm run build-test262-index   # parse front-matter → build/test262-index.json (~13 MB)
```

After that the tool serves queries instantly with no network and no
auth. Re-run periodically to refresh; pin a specific test262 SHA via
`TEST262_REF=<sha>` if you need reproducibility.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | Free-text. Multi-word queries match each whitespace-separated token (AND) across description + path. Either `query` or `esid` (or both) must be provided. |
| `esid` | string | — | Filter to tests whose `esid:` front-matter starts with this prefix (case-insensitive). Prefix match handles the common case where test262 uses a more specific esid than the spec section id — e.g. `sec-tonumber` matches both `sec-tonumber` and `sec-tonumber-applied-to-the-string-type`. |
| `limit` | int 1–100 | 20 | |

### Output

```json
{
  "query": "BigInt",
  "esid": "sec-tonumber",
  "source": "index",
  "index_sha": "4249661388e5d3f92a85186213da140a6481490f",
  "hits": [
    {
      "path": "test/built-ins/Number/...",
      "url": "https://github.com/tc39/test262/blob/<index_sha>/...",
      "esid": "sec-tonumber-applied-to-the-string-type",
      "description": "Some short description from the front-matter",
      "features": ["BigInt"],
      "flags": ["strict"]
    }
  ]
}
```

`source` is one of:

| `source` | Meaning |
|---|---|
| `"index"` | Served from the local `build/test262-index.json`. URLs in hits point at the indexed SHA. |
| `"none"` | Index not built. `hits` is empty; `hint` explains how to build it. |

Hosted deployments must ship the index baked in. See
[`deployment.md`](deployment.md) for the build pipeline that produces
the deployed index.

The tool never crashes on absent infrastructure — every error path
returns a structured result.

## `spec.about`

Self-description of the running server: package version + per-snapshot
pin metadata. Call this first when you need to cite the spec or report
what edition / SHA you're reading.

### Input

No parameters. The schema is empty.

### Output

```json
{
  "server": { "name": "tc39-mcp", "version": "0.1.0" },
  "generated_at": "2026-05-30T18:00:00.000Z",
  "snapshots": [
    {
      "spec": "262",
      "edition": "main",
      "present": true,
      "sha": "6dcb70f914e67908abc548b3285dc0583a194910",
      "fetched_at": "2026-05-30T14:50:15.091Z",
      "biblio_commit": "6dcb70f914e67908abc548b3285dc0583a194910",
      "clause_count": 2264,
      "has_tables": true,
      "has_grammar": true,
      "bytes_on_disk": 4344901
    }
  ],
  "test262_index": {
    "test262_sha": "...",
    "generated_at": "...",
    "test_count": 53293,
    "bytes_on_disk": 13800000
  },
  "proposals_index": {
    "proposals_sha": "...",
    "generated_at": "...",
    "proposal_count": 286,
    "bytes_on_disk": 99000
  }
}
```

`test262_index` / `proposals_index` appear only when the corresponding
index has been built. Snapshots that haven't been parsed yet show
`present: false` with no pin fields.

## `spec.snapshots`

Enumerate every (spec, edition, sha, fetched_at) snapshot the server
has parsed. Lightweight pin-only listing — does not load the full
clauses tree.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `spec` | `"262"` \| `"402"` | — | Optional filter. |
| `edition` | string | — | Optional concrete-edition filter (e.g. `"main"`, `"es2025"`). |

### Output

```json
{
  "snapshots": [
    {
      "spec": "262",
      "edition": "main",
      "sha": "6dcb70f914e67908abc548b3285dc0583a194910",
      "fetched_at": "2026-05-30T14:50:15.091Z",
      "biblio_commit": "6dcb70f914...",
      "live": true
    }
  ]
}
```

`live: true` indicates the current live snapshot. On the hosted
Worker, historical SHA-pinned copies appear as `live: false` and
become queryable via `at: "<sha>"` on the spec-reading tools.

## `clause.outline`

Section tree / table of contents for a parsed (spec, edition). Useful
for "show me the top-level shape of ECMA-402" or "list every section
under §22.2".

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `depth` | int 1-10 | — | Max tree depth. Omitted = full tree. |
| `under` | string | — | Anchor at a clause id; only its descendants are returned. |

### Output

```json
{
  "spec": "262",
  "node_count": 37,
  "roots": [
    {
      "id": "scope",
      "number": "1",
      "title": "Scope",
      "kind": "clause",
      "children": []
    }
  ]
}
```

Annexes (`A`, `B`, `C`) sort after numeric sections.

## `spec.tables`

List or fetch parsed `<emu-table>` content. Authoritative source for
the well-known intrinsics table (§6.1.7.4), well-known symbols table
(§6.1.5.1), completion record fields table (§6.2.4), and many 402
locale-data tables.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | If set, return exactly this table. If omitted, list. |
| `filter` | string | — | Case-insensitive substring filter on caption or id (list mode). |
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `limit` | int 1-500 | 50 | List mode only. |

### Output (list mode)

```json
{
  "mode": "list",
  "spec": "262",
  "total": 94,
  "tables": [
    {
      "id": "table-well-known-intrinsic-objects",
      "caption": "Well-Known Intrinsic Objects",
      "columns": ["Intrinsic Name", "Global Name", "ECMAScript Language Association"],
      "row_count": 72,
      "clause_id": "sec-well-known-intrinsic-objects"
    }
  ]
}
```

### Output (get mode)

```json
{
  "mode": "get",
  "spec": "262",
  "table": {
    "id": "table-well-known-intrinsic-objects",
    "caption": "Well-Known Intrinsic Objects",
    "columns": ["Intrinsic Name", "Global Name", "ECMAScript Language Association"],
    "rows": [
      ["%AggregateError%", "`AggregateError`", "The `AggregateError` constructor ()"]
    ],
    "clause_id": "sec-well-known-intrinsic-objects"
  }
}
```

`table` is `null` if the requested id isn't found.

## `spec.grammar`

Query standalone `<emu-grammar>` productions captured from §11-§15
(lexical, syntactic, numeric, …). Three modes:

- `{ nonterminal: "X" }` — every production for X.
- `{ contains: "Y" }` — productions whose non-terminal name or RHS contains Y.
- (no filter) — list all non-terminals with their production counts.

### Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `nonterminal` | string | — | Exact match. |
| `contains` | string | — | Case-insensitive substring. |
| `include_sdo` | boolean | `false` | Also surface productions captured as SDO algorithm headers. |
| `spec` | `"262"` \| `"402"` | `"262"` | |
| `edition` | Edition | `"latest"` | |
| `limit` | int 1-500 | 100 | |

### Output (by_nonterminal mode)

```json
{
  "mode": "by_nonterminal",
  "spec": "262",
  "total": 1,
  "productions": [
    {
      "nonterminal": "BindingIdentifier",
      "parameters": ["Yield", "Await"],
      "rhs": ["Identifier", "`yield`", "`await`"],
      "clause_id": "sec-identifiers",
      "standalone": true
    }
  ]
}
```

## `test262.get`

Fetch one test's full source + parsed front-matter by path. Pairs with
`test262.search` — the paths returned there plug in here directly.

### Input

| Field | Type | Notes |
|---|---|---|
| `path` | string | Path within the test262 checkout, relative to the repo root. |

### Output

```json
{
  "path": "test/built-ins/Number/prototype/toString/...",
  "test262_sha": "...",
  "url": "https://github.com/tc39/test262/blob/<sha>/test/...",
  "source": "// Copyright ...",
  "front_matter": {
    "esid": "sec-tonumber",
    "description": "...",
    "features": ["BigInt"],
    "flags": ["strict"],
    "negative": { "phase": "parse", "type": "SyntaxError" }
  }
}
```

If the path can't be resolved, returns `{ path, hint: "..." }` with
no `source`. Path traversal attempts (`..` segments, absolute paths)
return a `Path rejected` hint without filesystem access.

## `proposal.list`

List TC39 proposals from the static index built from
[tc39/proposals](https://github.com/tc39/proposals). Covers stages 0,
1, 2, 2.7, 3, finished, inactive.

### Input

| Field | Type | Notes |
|---|---|---|
| `stage` | string | `"0"`, `"1"`, `"2"`, `"2.7"`, `"3"`, `"finished"`, `"inactive"`, `"active"`. |
| `champion` | string | Case-insensitive substring match. |
| `contains` | string | Case-insensitive substring match on name + slug. |
| `limit` | int 1-500 | Default 100. |

### Output

```json
{
  "source": "index",
  "proposals_sha": "...",
  "total": 11,
  "proposals": [
    {
      "slug": "regexp-legacy",
      "name": "Legacy RegExp features in JavaScript",
      "stage": "3",
      "authors": ["Claude Pache"],
      "champions": ["Mark Miller", "Claude Pache"],
      "url": "https://github.com/tc39/proposal-regexp-legacy-features",
      "test262_flag": "...",
      "source_file": "README.md"
    }
  ]
}
```

Returns `source: "none"` + a `hint` when the index hasn't been built.

## `proposal.get`

Fetch one proposal by slug (canonical) or name (case-insensitive).

### Input

| Field | Type | Notes |
|---|---|---|
| `name` | string | Slug (preferred) or human name. |

### Output

```json
{
  "source": "index",
  "proposals_sha": "...",
  "proposal": {
    "slug": "temporal",
    "name": "Temporal",
    "stage": "finished",
    "authors": ["Maggie Pint", "Philipp Dunkel"],
    "champions": ["Maggie Pint"],
    "url": "https://github.com/tc39/proposal-temporal",
    "test262_flag": "...",
    "source_file": "finished-proposals.md"
  }
}
```

Returns `proposal: null` when nothing matches.

## Error envelope

Tools that can fail return either `{ hits: [] }` (search-style) or a
top-level error message under `isError: true` (clause-style). No tool
throws an unhandled exception under normal use — malformed inputs are
rejected by Zod with a clear validation message; runtime issues (e.g.
"parsed spec missing for (spec, edition) X") return a structured error
rather than a stack trace.
