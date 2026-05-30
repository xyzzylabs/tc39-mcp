# Contributing

Thanks for considering a contribution. This document covers what you
need to know to get a change reviewable.

## Project shape

`tc39-mcp` is **read-only over parsed spec data** — both ECMA-262
and ECMA-402 (Intl). There is no execution surface — no JS
evaluation, no compilation, no shell-out to user-supplied code. That
constraint is deliberate — it's what makes hosting the same code
safe — so changes that introduce execution should have a very strong
rationale.

The codebase is small (~10 source files, ~30 tests). One file per tool,
shared infrastructure in `src/editions.ts` / `src/paths.ts`, parser
under `src/parser/`.

## Local setup

```sh
npm install
npm run fetch-spec       # ~2 min — clones both specs at every supported edition
npm run parse            # ~60s — produces build/spec-<spec>-<edition>.json
npm test                 # < 2 seconds
```

If you're going to iterate on tool code, leave a shell open with:

```sh
npm run mcp              # tsx watches and reloads on change
```

…and point a `.mcp.json` at it from another project for end-to-end
testing.

## What kinds of changes are welcome

| Type | Notes |
|---|---|
| **Parser fixes** | Older spec.html (es2016 → es2020) sometimes parses with mild distortions. Reproductions and fixes against real clauses are gold. |
| **Search ranking improvements** | The aoid-exact > aoid > title > id > steps order is heuristic. PRs with eval cases (input → expected top hit) make these reviewable. |
| **New lookup tools** | If they're (a) read-only, (b) pure over the parsed data, and (c) useful for a real query you can describe, very welcome. Open an issue first so the surface stays small. |
| **Editions** | When tc39/ecma262 cuts the next ES release tag (or tc39/ecma402 cuts a new candidate), the recipe in [`docs/editions.md`](docs/editions.md) walks the bump. |
| **Doc improvements** | Especially: examples in [`docs/tools.md`](docs/tools.md) for queries that surprised you. |

## What kinds of changes are unlikely to land

- **Execution endpoints** — anything that runs user-supplied JS,
  evaluates spec semantics, or shells out with attacker-influenced
  arguments. Belongs in a separate, more cautious project.
- **Server-side state, auth, or accounts.** The whole point is that
  the server is a deterministic function of pinned spec data.
- **Bundling test262 inside the npm package.** The repo is ~300 MB
  uncompressed; users vendor it locally on demand via
  `npm run fetch-test262`.
- **Write endpoints.** No tool mutates anything on disk or upstream.

## How to structure a change

1. **One tool or one bug per PR.** Easier to review, easier to revert.
2. **Tests first** if you're fixing a bug — add a failing test that
   describes the issue, then make it pass.
3. **No new top-level dependencies** without discussion. The current
   deps are intentionally minimal.
4. **Schemas are the contract.** When you change a tool's
   Zod schema, document the change in `CHANGELOG.md` under "Breaking"
   or "Tools".
5. **Spec- and edition-aware code goes through `src/editions.ts`.**
   Don't hardcode `es2025` or `"262"` anywhere; use
   `resolveEdition(spec, e)` + `loadSpec(spec, edition)`.

## Testing

```sh
npm test                    # the whole suite
npx vitest run path/to/test # one file
npx vitest                  # watch mode while iterating
```

Tests run against the on-disk parsed JSON, so anything that depends on
spec content needs `npm run parse` to have completed at least once.

Tool tests live next to the tool (`spec_diff.ts` ↔
`spec_diff_history.test.ts`). Shared concerns
(edition resolution, alias caching) live in `src/editions.test.ts`.

## Commit messages

A subject line under 70 chars, an empty line, then a body that
explains *why*. The diff already explains *what*.

If your change closes an issue, add `Closes #N` on its own line at the
end.

## Releasing

The release pipeline is `.github/workflows/release.yml`, triggered by
pushing a `v*` tag. To cut a release:

1. **Update `CHANGELOG.md`** with the new version + dated entry. Use
   the existing `[0.1.0] — YYYY-MM-DD` shape; describe added /
   changed / removed / fixed under their own sub-headings if there's
   more than a single bullet per category.

2. **Bump `package.json` version**. Follow SemVer:
   - **MAJOR**: tool-schema change, removed tool, or removed field.
   - **MINOR**: new tool, new optional schema field, new edition,
     new spec covered.
   - **PATCH**: bug fix, doc improvement, internal refactor.

3. **Commit** with message `release: vX.Y.Z` and tag `git tag vX.Y.Z`.

4. **Push** the commit + tag. CI runs `release.yml`:
   - `npm ci`
   - `npm run fetch-spec && npm run fetch-test262 && npm run fetch-proposals`
   - `npm run parse && npm run build-test262-index && npm run build-proposals-index`
   - `npm test && npm run typecheck && npm run build`
   - `npm publish --provenance` (authenticated via Trusted Publishing
     OIDC — no long-lived NPM_TOKEN secret. The package's npm-side
     trusted-publisher config points at this workflow file).
   - Post-publish smoke: install from registry, run MCP roundtrip
     (`scripts/smoke-stdio.mjs`).
   - `gh release create vX.Y.Z` with notes extracted from CHANGELOG.

5. The Worker deploy is triggered by the same tag (`deploy-worker.yml`).
   It rebuilds the docs site, stages assets, uploads R2, deploys, then
   smokes `/health` + `tools/call spec.about` + the docs landing page
   and `/snapshots`.

6. **Verify** `npm view tc39-mcp version` returns the new version.

### Safety nets if smoke fails after publish

- **npm**: if post-publish smoke fails, the workflow exits red.
  Trusted Publishing's OIDC scope covers `npm publish` but not
  `npm deprecate`, and keeping a long-lived NPM_TOKEN just for the
  failure path would defeat the win. Manual cleanup is one command:

  ```sh
  npm deprecate tc39-mcp@X.Y.Z "Post-publish smoke failed; see CI run X"
  ```

  `npm unpublish` is blocked after 72 h so deprecation is the
  universally-applicable rollback.

- **Worker**: if `deploy-worker.yml`'s post-deploy smoke fails AND
  the deploy itself succeeded (so a prior version exists),
  `wrangler rollback` reverts the Worker to its previous version
  automatically. R2 contents are idempotent — they stay at the new SHAs.

In both cases the workflow run ends in failure, so you get an email
+ a red mark in the Actions tab. Investigate the failing smoke,
ship a fixed PATCH.

### Auto-refresh PATCH releases

The above manual flow is only for **code changes**. PATCH versions that
only carry refreshed upstream spec data are handled automatically by
`.github/workflows/refresh.yml`:

- Runs every 4 hours; SHA-diffs upstream `tc39/ecma262`,
  `tc39/ecma402`, `tc39/test262`, `tc39/proposals` against the last
  published.
- If anything moved, bumps PATCH, tags `vX.Y.Z`, pushes. That tag
  triggers `release.yml` (npm publish) and `deploy-worker.yml`
  (R2 + Worker redeploy).

**Do not add a `CHANGELOG.md` entry for these releases** — they ship
identical code with a fresher spec payload, and recording every refresh
would balloon the file by dozens of entries per month. The note at the
top of `CHANGELOG.md` documents this convention for readers.

The live SHA of any published version is queryable via `spec.about` /
`spec.snapshots` and visible on the hosted Worker's `/snapshots` page
(same origin that serves `/mcp`).

### When a new ES release tags

When tc39/ecma262 cuts the next annual release (e.g. `es2026`):

1. Update `src/editions.ts` — add `es2026` to `RELEASED_262_EDITIONS`,
   bump `LATEST_262_RELEASE`.
2. Update `RELEASED_402_EDITIONS` if a new candidate also lands.
3. Update `vendor/PINNED.txt` references in `docs/editions.md`.
4. Update the editions table in `README.md` + `CHANGELOG.md`.
5. Bump the MINOR version. Run the release workflow.

No tool code changes needed — `EDITION_VALUES` rebinds automatically.

## Maintainer setup: WORKFLOW_PAT secret

For `refresh.yml` to fully auto-cascade (bump → tag → publish to npm
→ deploy Worker), the repo needs a Personal Access Token stored as
the secret `WORKFLOW_PAT`.

**Why**: GitHub's default `GITHUB_TOKEN` cannot trigger downstream
workflows when it pushes commits or tags — an anti-recursion safety.
A PAT (or GitHub App) is the standard workaround.

**Without it**: refresh still bumps the version, commits, and pushes
the tag — but `release.yml` and `deploy-worker.yml` won't fire. A
maintainer would have to manually re-push the tag (delete + push)
to trigger them. The workflow comment in `refresh.yml` documents
this fallback explicitly.

**How to create the PAT**:

1. Go to https://github.com/settings/personal-access-tokens/new (this
   is the fine-grained PAT page — preferred over Classic).
2. Settings:
   | Field | Value |
   |---|---|
   | Token name | `tc39-mcp refresh chain` |
   | Resource owner | the org/user that owns this repo (`xyzzylabs`) |
   | Expiration | 1 year |
   | Repository access | **Only select repositories** → `tc39-mcp` |
   | Repository permissions | **Contents: Read and write**, **Workflows: Read and write** |
3. **Generate token** → copy the value (starts with `github_pat_…`).
4. Save it to the repo:
   ```sh
   gh secret set WORKFLOW_PAT -R xyzzylabs/tc39-mcp
   # paste the github_pat_… value at the prompt
   ```

After this, the next refresh tick that finds upstream-moved SHAs will
bump → tag → publish to npm → deploy Worker, all without human
intervention. Verify by triggering one manually:

```sh
gh workflow run refresh.yml -R xyzzylabs/tc39-mcp
```

Rotate the PAT every year (or sooner if your org policy requires it);
the workflow tolerates the fallback to `GITHUB_TOKEN` if the secret
expires, so a missed rotation just disables auto-cascade — it doesn't
break the refresh itself.

## Automated maintenance PRs

`.github/dependabot.yml` opens grouped PRs every Monday for:

- Root npm dependencies (production + development; minor/patch grouped, major individual).
- Worker npm dependencies (wrangler, workers-types, etc.).
- GitHub Actions versions used across all workflows.

These PRs are labelled `dependencies` and prefixed `deps:` / `deps(worker):` /
`ci:` in the commit message. Treat them like any other PR — the same
test workflow gates them, and the PR template's contract checklist
still applies. Reject anything that would require a MAJOR bump of an
exported tool's schema; let the rest through after a glance.

## Security scanning

CodeQL JS/TS analysis runs via GitHub's **Default Setup** (enabled in
**Settings → Code security → Code scanning** when the repo went
public). It runs on every push, every PR, and on a weekly schedule;
results land in the **Security** tab. Anything that surfaces there
should either be fixed or explicitly suppressed with an inline
comment explaining why.

We don't ship a custom `codeql.yml` workflow — Default Setup is
auto-managed (queries auto-update, triggers are sensible defaults),
and Advanced Setup (workflow-based) cannot coexist with it.

## License

By contributing, you agree your contributions are licensed under the
MIT License (see `LICENSE`).
