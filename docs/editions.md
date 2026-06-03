# Specs and editions

`tc39-mcp` covers parsed snapshots of every release tag the upstream
`tc39/ecma262` and `tc39/ecma402` repos cut, plus the working drafts
on `main`. At runtime each snapshot is sourced through a local cache
→ hosted Cloudflare Worker → bundled-fallback chain; snapshots
fetched from the Worker are written to `~/.cache/tc39-mcp/` and
served from disk thereafter. The npm package bundles the latest
stable + main editions of both specs plus the proposals and test262
indexes so those stay available offline (served from the package,
not the cache). Aliases like `latest` rebind across releases (and
across specs) so callers don't have to think about it.

Every tool accepts two orthogonal arguments: `spec` (one of `"262"` /
`"402"`) and `edition`. The parsed-spec cache is keyed on the pair, so
`{ spec: "262", edition: "es2026" }` and `{ spec: "262", edition: "latest" }`
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
| `es2026` | tag `es2026` | June 2026 |
| `main`   | branch `main` | rolling draft |

## ECMA-402 editions

tc39/ecma402 publishes each annual edition as an `esYYYY` **branch**
rather than a tag — that's the only structural difference from
tc39/ecma262, which uses `esYYYY` tags. The fetch step resolves a
branch or a tag interchangeably (`git clone --branch` accepts either),
so 402 coverage matches 262: every annual edition `es2016` – `es2026`
plus `main`.

| Edition | tc39/ecma402 ref | Notes |
|---|---|---|
| `es2016` … `es2024` | branch `esYYYY` | annual editions |
| `es2025` | branch `es2025` | 12th edition |
| `es2026` | branch `es2026` | current stable (13th edition) |
| `main` | branch `main` | rolling draft |

## Aliases

| Alias | Resolves to (262) | Resolves to (402) | Stability |
|---|---|---|---|
| `latest` | current stable release (`es2026`) | current stable release (`es2026`) | rebinds when either spec cuts its next edition |
| `draft` | `main` | `main` | tracks upstream HEAD |
| `next` | `main` | `main` | synonym for `draft` |

Aliases are resolved by `resolveEdition(spec, e)` in `src/editions.ts`.
`latest` is **spec-aware**: on each spec it points at that spec's most
recent stable annual release (`es2026` today). `draft` / `next` point
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

When tc39/ecma262 cuts the next release tag (e.g. `es2027` in
June 2027):

```ts
// src/editions.ts

export const RELEASED_262_EDITIONS = [
  ...existing...,
  "es2027",                            // ← add
] as const;

export const LATEST_262_RELEASE: Released262Edition = "es2027"; // ← bump
```

Then:

```sh
npm run fetch-spec           # picks up es2027 via the default $EDITIONS_262
npm run parse                # writes build/spec-262-es2027.json
npm test                     # confirm nothing broke
```

No other code changes are required. Every tool's schema picks up the
new value through `EDITION_VALUES`; the `latest` alias on `spec: "262"`
automatically rebinds; `spec.diff` between any two editions just works.

For deployment, ship the new `build/spec-262-es2027.json` to wherever
your deployment reads from (R2, KV, baked-in, etc.) and the hosted
server serves it without code change.

## Adding the next ES release (ECMA-402)

When tc39/ecma402 cuts the next annual edition branch (e.g. `es2027`):

```ts
// src/editions.ts

export const RELEASED_402_EDITIONS = [
  ...existing...,
  "es2027",                            // ← add the branch name
] as const;

export const LATEST_402_RELEASE: Released402Edition = "es2027"; // ← bump
```

Then:

```sh
npm run fetch-spec           # picks up the new edition via $EDITIONS_402
npm run parse                # writes build/spec-402-es2027.json
npm test
```

`fetch-spec.sh` resolves a branch or a tag interchangeably, so the
recipe is identical to ECMA-262 — only the ref naming differs upstream
(402 uses branches, 262 uses tags).

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
ecma262 es2026     ref: es2026
ecma262 es2026     SHA: 0248456c758431e4bb8e5d26333ff1865123c9cd
ecma262 main       ref: main
ecma262 main       SHA: <upstream HEAD at fetch time>
ecma402 es2026     ref: es2026
ecma402 es2026     SHA: 8ea5ed5bab7165d1ef8ca2612a88582bf2b1ac94
ecma402 main       ref: main
ecma402 main       SHA: <upstream HEAD at fetch time>
```

## Drift between fetches

The `main` branches move; everything else is stable. If you fetch and
re-parse periodically, the `es2016` – `es2026` parses (both specs)
will be bit-identical run-to-run, but
`spec-262-main.json` and `spec-402-main.json` will reflect whatever's
upstream at fetch time. Pin `main`'s SHA explicitly if you need
reproducibility against the draft.
