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

The codebase is compact (~50 source files, ~390 tests). One file per tool,
shared infrastructure in `src/editions.ts` / `src/paths.ts`, parser
under `src/parser/`.

## Local setup

```sh
npm install
npm run fetch-spec       # ~2 min — clones both specs at every supported edition
npm run parse            # ~60s — produces build/spec-<spec>-<edition>.json
npm test                 # ~10 seconds
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
| **Editions** | When tc39/ecma262 cuts the next ES release tag (or tc39/ecma402 cuts a new annual edition), the recipe in [`docs/editions.md`](docs/editions.md) walks the bump. |
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
   Don't hardcode `es2026` or `"262"` anywhere; use
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

### Auto-refresh: R2 every ~4 h, npm monthly

The above manual flow is only for **code changes**. Refreshed upstream
spec data is handled automatically by `.github/workflows/refresh.yml` on
two cadences:

- **R2 — every ~4 hours.** SHA-diffs upstream `tc39/ecma262`,
  `tc39/ecma402`, `tc39/test262`, `tc39/proposals` against
  `.last-refresh.json`. On any movement it commits the new sentinel and
  dispatches `deploy-worker.yml`, which re-parses and uploads fresh
  snapshots to R2 — no version bump, no npm publish. This is the
  live-freshness path for networked clients.
- **npm bundle — at most monthly.** The bundle is only the offline
  fallback, so when ≥ 30 days have passed since the last data publish
  (tracked in `.last-refresh.json`'s `last_npm_publish`) a refresh run
  additionally bumps PATCH + tags `vX.Y.Z`; that tag drives the npm
  publish via `release.yml` and the Worker redeploy via
  `deploy-worker.yml`. Net: ~12 data publishes/year instead of ~2000.

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
2. Update `RELEASED_402_EDITIONS` + `LATEST_402_RELEASE` if a new 402 annual edition also lands.
3. Update `vendor/PINNED.txt` references in `docs/editions.md`.
4. Update the editions table in `README.md` + `CHANGELOG.md`.
5. Bump the MINOR version. Run the release workflow.

No tool code changes needed — `EDITION_VALUES` rebinds automatically.

## Maintainer setup: refresh.yml authentication

For `refresh.yml` to fully auto-cascade (bump → tag → publish to npm
→ deploy Worker), it needs a credential that *can* trigger downstream
workflows. GitHub's default `GITHUB_TOKEN` cannot — that's an
anti-recursion safety: `GITHUB_TOKEN`-driven pushes never fire other
workflows. The workflow checks three credentials in this order:

1. **GitHub App installation token** (preferred). Short-lived
   (~60 min), scoped to whichever repos the App is installed on,
   bot identity. The `actions/create-github-app-token@v2` step at
   the top of the workflow mints one when `vars.BOT_APP_ID` is set.
2. **`WORKFLOW_PAT`** — a fine-grained Personal Access Token
   stored as a repo secret. Long-lived, tied to a specific user.
   Works fine; weaker security profile than the App.
3. **`GITHUB_TOKEN`** — last-resort fallback. Refresh still bumps
   the version, commits, and pushes the tag, but `release.yml`
   and `deploy-worker.yml` won't fire automatically. A maintainer
   then has to manually re-push the tag (delete + push) to
   trigger them.

### Preferred: GitHub App

The App's variable + secret are intentionally generic
(`BOT_APP_ID` / `BOT_APP_PRIVATE_KEY`) and stored at the
**org level**, not per-repo. Same App, same credentials, used by
any repo in the org — so future automation (auto-merge of
Dependabot PRs, stale closers, template sync, etc.) plugs into the
same App without renaming or re-keying. Add permissions to the
App as new use-cases appear; existing installations re-confirm on
the next org-admin click.

1. Create the App at the **organization** level so it survives
   creator changes:
   <https://github.com/organizations/xyzzylabs/settings/apps/new>.
   - **GitHub App name**: e.g. `xyzzylabs-ops-bot` — generic so
     future automation can share it.
   - **Homepage URL**: the org URL (or this repo) is fine.
   - **Webhook**: uncheck "Active" (no webhook needed; this
     removes the need for a webhook secret too).
   - **Repository permissions**: **Contents: Read and write** to
     start. Nothing else for refresh.yml. Add other scopes
     (`Pull requests: write`, `Issues: write`, …) later as new
     automation lands.
   - **Where can this GitHub App be installed?**: "Only on this
     account".
2. After creation, note the **App ID** (numeric, visible on the
   App's settings page).
3. **Generate a private key** (button on the same page) —
   downloads a `.pem` file.
4. **Install the App** on `xyzzylabs/tc39-mcp` only for now (other
   repos can be added later from the App's "Install App" page —
   no re-keying needed).
5. Wire credentials **at the org level** so every repo with the
   App installed picks them up by name:
   ```sh
   # Variable holding the App ID — readable by any repo.
   gh variable set BOT_APP_ID \
     --org xyzzylabs \
     --visibility all \
     --body <numeric-app-id>
   # Secret holding the private key — also org-scoped.
   gh secret set BOT_APP_PRIVATE_KEY \
     --org xyzzylabs \
     --visibility all < downloaded-key.pem
   ```
   (Swap `--visibility all` for `--visibility selected --repos tc39-mcp`
   if you want to restrict which repos can read them.)
6. Verify by triggering one refresh manually:
   ```sh
   gh workflow run refresh.yml -R xyzzylabs/tc39-mcp
   ```
   The "Mint GitHub App installation token" step should succeed;
   the subsequent checkout uses that token; if the run bumps a
   version, the pushed tag fires `release.yml`.

The bot's commit author will appear as `<app-name>[bot]` in
history. The private key is the long-lived credential here — keep
it in org secrets, rotate when the App's UI prompts (typically
yearly), and treat a leak the same as a leaked PAT. Periodically
prune the App's permissions to least privilege; adding a permission
requires re-confirmation, but removing one happens silently.

### Fallback: WORKFLOW_PAT

If you don't want the App setup, the legacy PAT path still works:

1. Go to <https://github.com/settings/personal-access-tokens/new> (this
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

### GitHub Actions pinning policy

Every Action currently in use is first-party (`actions/checkout`,
`actions/setup-node`, `actions/cache`, `actions/create-github-app-token`).
Major-version tag pins (`@v6`, `@v5`, …) are fine for these, and
Dependabot keeps them current.

When adding any **third-party** Action — anything outside the
`actions/*` namespace — pin to a commit SHA with the version as a
trailing comment, so Dependabot can still bump it but a major-tag
takeover can't:

```yaml
- uses: some-org/some-action@<40-char-sha>  # vX.Y.Z
```

This protects against the supply-chain shape that landed
`tj-actions/changed-files` in early 2025, where a popular
third-party Action's major tag was retargeted at malicious code.
First-party `actions/*` have a fundamentally different blast
radius — compromise would require compromising GitHub itself — so
the tag pin is acceptable there.

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

## Branch protection on main

The repo's `main` branch ruleset is checked in at
[`.github/rulesets/main.json`](.github/rulesets/main.json) so the
intended policy lives next to the code:

- Pull request required before merge (0 approvals — solo-maintainer
  repo, but the PR shape forces a CI run on the merge candidate).
- Required status check: the `test` job from `.github/workflows/test.yml`.
- Deletion and non-fast-forward pushes blocked.
- Repository admins can bypass — preserves the direct-push release
  flow described above (`release: vX.Y.Z` commit + tag, both pushed
  to `main`) without breaking the cascade into `release.yml`.

The JSON is the source of truth, but GitHub stores the active ruleset
server-side. To apply or sync changes:

```sh
# First time (creates the ruleset):
gh api -X POST repos/xyzzylabs/tc39-mcp/rulesets \
  --input .github/rulesets/main.json

# Subsequent updates (replace existing — needs the ruleset id from
# `gh api repos/xyzzylabs/tc39-mcp/rulesets`):
gh api -X PUT repos/xyzzylabs/tc39-mcp/rulesets/<id> \
  --input .github/rulesets/main.json
```

If the ruleset and the checked-in JSON drift, the JSON is what
review should reference; resync via the commands above.

## License

By contributing, you agree your contributions are licensed under the
MIT License (see `LICENSE`).
