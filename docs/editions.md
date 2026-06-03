# Specs and editions

`tc39-mcp` ships with parsed snapshots of every release tag the
upstream `tc39/ecma262` and `tc39/ecma402` repos cut, plus the working
drafts on `main`. Aliases like `latest` rebind across releases (and
across specs) so callers don't have to think about it.

Every tool accepts two orthogonal arguments: `spec` (one of `"262"` /
`"402"`) and `edition`. The parsed-spec cache is keyed on the pair, so
`{ spec: "262", edition: "es2025" }` and `{ spec: "262", edition: "latest" }`
share one in-memory copy.

## ECMA-262 editions

| Edition | tc39/ecma262 ref | Approximate published date |
|---|---|---|
| `es2016` | tag `es2016` | June 2016 |
| `es2017` | tag `es2017` | June 2017 |
| `es2018` | tag `es2018` | June 2018 |
| `es2019` | tag `es2019` | June 2019 |
| `es2020` | tag `es2020` | June 2020 |
| `es2021` | tag `es2021` | June 2021 |
| `es2022` | tag `es2022` | June 2022 |
| `es2023` | tag `es2023` | June 2023 |
| `es2024` | tag `es2024` | June 2024 |
| `es2025` | tag `es2025` | June 2025 |
| `main`   | branch `main` | rolling draft |

## ECMA-402 editions

tc39/ecma402 publishes each annual edition as an `esYYYY` **branch**
rather than a tag — that's the only structural difference from
tc39/ecma262, which uses `esYYYY` tags. The fetch step resolves a
branch or a tag interchangeably (`git clone --branch` accepts either),
so 402 coverage matches 262: every annual edition `es2016` – `es2025`
plus `main`. The repo also tags `esYYYY-candidate` release candidates;
the `es2025-candidate` pin is kept for callers that referenced it
before the final `es2025` branch existed.

| Edition | tc39/ecma402 ref | Notes |
|---|---|---|
| `es2016` … `es2024` | branch `esYYYY` | annual editions |
| `es2025` | branch `es2025` | current stable (12th edition) |
| `es2025-candidate` | tag `es2025-candidate-2025-04-01` | legacy candidate pin; prefer `es2025` |
| `main` | branch `main` | rolling draft |

## Aliases

| Alias | Resolves to (262) | Resolves to (402) | Stability |
|---|---|---|---|
| `latest` | current stable release (`es2025`) | current stable release (`es2025`) | rebinds when either spec cuts its next edition |
| `draft` | `main` | `main` | tracks upstream HEAD |
| `next` | `main` | `main` | synonym for `draft` |

Aliases are resolved by `resolveEdition(spec, e)` in `src/editions.ts`.
`latest` is **spec-aware**: on each spec it points at that spec's most
recent stable annual release (`es2025` today). `draft` / `next` point
at `main` on both specs.

## Why the 262 floor is `es2016`

The earliest tag in `tc39/ecma262` is `es2016`. There is no upstream
support for older editions:

- **ES5 (2009) / ES5.1 (2011)** predate the GitHub repo and the
  modern ecmarkup HTML format entirely. They exist as ECMA standards
  documents (Word / PDF) at <https://ecma-international.org>.
  Supporting them here would require a different parser pipeline and
  scraping a non-canonical source. Out of scope.
- **ES6 / ES2015** was authored in `tc39/ecma262` (it's what motivated
  the move to GitHub + ecmarkup), but the repo doesn't carry an
  `es2015` or `es6` git tag. You could pin a commit close to the
  ES2015 publication date (June 2015) by hand if you needed it, but
  that's an unofficial pin, not an upstream-blessed one.

If you genuinely need older editions, file an issue describing the use
case — we'll either provide a hand-pin recipe or be honest that the
data isn't structured enough for this server's contract.

## Adding the next ES release (ECMA-262)

When tc39/ecma262 cuts the next release tag (e.g. `es2026` in
June 2026):

```ts
// src/editions.ts

export const RELEASED_262_EDITIONS = [
  ...existing...,
  "es2026",                            // ← add
] as const;

export const LATEST_262_RELEASE: Released262Edition = "es2026"; // ← bump
```

Then:

```sh
npm run fetch-spec           # picks up es2026 via the default $EDITIONS_262
npm run parse                # writes build/spec-262-es2026.json
npm test                     # confirm nothing broke
```

No other code changes are required. Every tool's schema picks up the
new value through `EDITION_VALUES`; the `latest` alias on `spec: "262"`
automatically rebinds; `spec.diff` between any two editions just works.

For deployment, ship the new `build/spec-262-es2026.json` to wherever
your deployment reads from (R2, KV, baked-in, etc.) and the hosted
server serves it without code change.

## Adding the next ES release (ECMA-402)

When tc39/ecma402 cuts the next annual edition branch (e.g. `es2026`):

```ts
// src/editions.ts

export const RELEASED_402_EDITIONS = [
  ...existing...,
  "es2026",                            // ← add the branch name
] as const;

export const LATEST_402_RELEASE: Released402Edition = "es2026"; // ← bump
```

Then:

```sh
npm run fetch-spec           # picks up the new edition via $EDITIONS_402
npm run parse                # writes build/spec-402-es2026.json
npm test
```

`fetch-spec.sh` resolves a branch or a tag interchangeably, so the
recipe is identical to ECMA-262 — only the ref naming differs upstream
(402 uses branches, 262 uses tags). The `esYYYY-candidate` tags are
release candidates; the short-name mapping in `fetch-spec.sh`
(`esYYYY-candidate-DATE` → `esYYYY-candidate`) keeps a legacy pin
addressable, but new editions should be added as their final `esYYYY`
branch.

## Tracking specific SHAs

Each parsed JSON carries a `pin: { spec, edition, sha }` field
recording the exact upstream commit. `clause.get` doesn't surface this
to the client by default, but it's available via
`loadSpec(spec, edition).pin` in library code if you need to embed
reproducibility metadata in your own output.

For citation use cases, the SHA of any (spec, edition) is recorded in
`vendor/PINNED.txt` after `npm run fetch-spec`:

```
fetched:    2026-05-30T10:48:45Z

ecma262 es2016     ref: es2016
ecma262 es2016     SHA: b154ce84698377ab53fe88c889633263607f4423
ecma262 es2017     ref: es2017
ecma262 es2017     SHA: 7301daf5ab1f0959b203c2e63ecccb21fe13d5e5
...
ecma262 es2025     ref: es2025
ecma262 es2025     SHA: 84b38ad852ff426795fa29cebc06949027336c64
ecma262 main       ref: main
ecma262 main       SHA: <upstream HEAD at fetch time>
ecma402 es2025-candidate  ref: es2025-candidate-2025-04-01
ecma402 es2025-candidate  SHA: <pinned candidate SHA>
ecma402 main       ref: main
ecma402 main       SHA: <upstream HEAD at fetch time>
```

## Drift between fetches

The `main` branches move; everything else is stable. If you fetch and
re-parse periodically, the `es2016` – `es2025` (262) and
`es2025-candidate` (402) parses will be bit-identical run-to-run, but
`spec-262-main.json` and `spec-402-main.json` will reflect whatever's
upstream at fetch time. Pin `main`'s SHA explicitly if you need
reproducibility against the draft.
