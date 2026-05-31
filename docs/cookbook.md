# Cookbook

Multi-tool recipes — patterns that chain two or three tools to
answer a question no single tool would. The entries on
[`tools.md → What it answers`](./tools) are single-call examples;
this page shows composition.

Each recipe lists the calls in order, the data flow between them,
and what the final result tells you.

[[toc]]

## Recipe 1 — Cross-spec lookup: which ECMA-262 ops does Intl reach into?

When you want to map how the Internationalization API interacts with
the core language, you want every reference from an ECMA-402 clause
that resolves to an ECMA-262 abstract operation.

**Calls:**

```js
// 1. Pick the 402 entry point you care about (e.g. Intl.Collator's compare).
spec.crossrefs({
  id: "sec-intl.collator.prototype.compare",
  spec: "402",
  direction: "out",
  include_cross_spec: true,
})
```

The `outgoing` array now contains both 402-internal references and
the 262 abstract operations the clause cites (`spec: "262"` rows
distinguished from `spec: "402"` ones).

**Variations:**

- For the symmetric query — "every 402 clause that gets called from
  262" — use `direction: "in"` on a known shared op (`ToNumber`,
  `RequireObjectCoercible`).
- To enumerate every 402 → 262 hop in one pass, run `clause.list({
  spec: "402" })` then loop `spec.crossrefs` over each id and
  aggregate.

## Recipe 2 — Prose drift: how did ToNumber change over the past year?

Track the prose-level history of one clause across upstream commits.

**Calls:**

```js
// 1. Recent edits to the clause's opening tag in main:
spec.history({ id: "sec-tonumber", limit: 50 })

// 2. For each adjacent pair of editions you care about, diff the clause:
spec.diff({ id: "sec-tonumber", from: "es2024", to: "es2025" })
spec.diff({ id: "sec-tonumber", from: "es2025", to: "main" })
```

`spec.history` gives commit SHAs + dates that touched the
`id="sec-tonumber"` token. `spec.diff` returns `status` ('modified'
/ 'identical' / etc.) plus per-field diffs (title, signature, step
count, notes, crossrefs).

**Why it matters:** the history alone tells you *when* something
changed; the per-edition diffs tell you *what*.

## Recipe 3 — From notation to definition: what is `[[Realm]]`?

You see `[[Realm]]` mentioned in step text and want both the
defining clause and the clauses that read/write that slot.

**Calls:**

```js
// 1. Classify the notation and find candidate definitions.
spec.symbol_resolve({ notation: "[[Realm]]" })
// → kind: "internal-slot", name: "Realm", hits: [{ id, title, score, … }]

// 2. For the top-ranked hit, pull the full clause for context.
clause.get({ id: <hits[0].id> })

// 3. Optionally: list every clause that mentions this slot.
spec.search({ query: "Realm", search_steps: true, limit: 50 })
```

**Variations:**

- Replace the notation with `%Object.prototype%` to chase a
  well-known intrinsic; `spec.symbol_resolve` classifies it as
  `intrinsic` and ranks `spec.tables({ id: "table-well-known-intrinsic-objects" })`
  rows accordingly.
- For `~enumerate~`-style sigil hints, the classification flips to
  `sigil-enum`.

## Recipe 4 — test262 coverage for one clause

Given a clause id, find the test262 tests that target it.

**Calls:**

```js
// 1. Confirm the clause exists and grab its aoid.
clause.get({ id: "sec-tonumber" })

// 2. Search the local test262 index by esid.
test262.search({ esid: "sec-tonumber", limit: 100 })

// 3. For one or two interesting hits, fetch the full source.
test262.get({ path: <hits[0].path> })
```

`test262.search`'s `esid` field is **prefix-matched**, so
`sec-tonumber` will catch nested ids like `sec-tonumber-applied-to-the-string-type`
without you specifying every variant.

**Why it matters:** combined with `spec.diff` (Recipe 2) you can
spot clauses where the prose changed but no test262 case followed.

## Recipe 5 — Cross-reference a non-terminal's SDOs and productions

For a syntactic non-terminal, find every Syntax-Directed Operation
that implements it.

**Calls:**

```js
// 1. The standalone grammar productions defining the non-terminal.
spec.grammar({ nonterminal: "BindingIdentifier" })

// 2. The SDOs covering productions of that non-terminal.
spec.sdo_index({ by: "production", filter: "BindingIdentifier" })

// 3. (Optional) Pull one SDO's full algorithm for context.
clause.get({ id: <sdo_index.groups[<production>][0].id> })
```

The intersection tells you which SDOs every productions of the
non-terminal participates in (Evaluation, BoundNames,
LexicallyDeclaredNames, …). Useful for spotting an SDO that's
missing a production case.

## Recipe 6 — Map a Stage-3 proposal to the clauses it would touch

When triaging a proposal close to landing, you want a rough surface
area of the spec it would change.

**Calls:**

```js
// 1. Find the proposal metadata + slug.
proposal.list({ stage: "3" })

// 2. Pick one and read its full entry.
proposal.get({ name: <slug> })

// 3. For a hand-picked keyword from the proposal title, search the spec.
spec.search({ query: "<keyword>" })
```

The proposal index has no machine-readable mapping back to clause
ids — but the slug + name + champion list usually gives you enough
of a keyword to drive `spec.search` against `main` and surface the
clauses most likely to need edits.

## Adding your own recipe

Recipes that recur are good candidates for promotion to single-call
tools. If you find yourself running the same 3-call sequence over
and over, that's a signal — open an issue. The contract for a new
tool is in [`AGENTS.md`](https://github.com/xyzzylabs/tc39-mcp/blob/main/AGENTS.md):
read-only, deterministic over pinned data, no execution, no auth.
