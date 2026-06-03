# Security policy

## Supported versions

Only the latest minor of the `0.x` line receives security fixes.

## Reporting a vulnerability

If you find a security issue, please **do not file a public GitHub
issue**. Instead, open a [private security advisory](https://github.com/xyzzylabs/tc39-mcp/security/advisories/new)
on the repository.

I aim to acknowledge new reports within 7 days and ship a fix within 30
days for confirmed issues. If a report is borderline or out of scope,
expect a polite explanation.

## What counts as a security issue here

`tc39-mcp` is a read-only Model Context Protocol server that serves
parsed ECMA-262 and ECMA-402 data. It does not execute user-supplied
code, does not authenticate users, and does not persist any state.
That shapes the threat model:

| In scope | Why |
|---|---|
| Path traversal in the parser or in `loadSpec` arguments | Could leak files outside the `build/` directory. |
| Prototype-pollution sinks in the JSON parser or schema layer | Could be triggered by malformed `spec-*.json` if vendored from a compromised source. |
| Crashes / DoS on malformed clause ids, oversized search queries | The server should reject or bound, not crash. |
| Regressions in `spec.history`'s subprocess input bounds | The `id` argument is interpolated into a `git log -S` pickaxe pattern. It is bounded by a Zod schema (`min(1).max(200).regex(/^[a-zA-Z0-9._%-]+$/)`) before reaching the subprocess; any change that loosens that bound is in scope. This is the **only** subprocess surface in the server. |
| Outdated dependencies with known CVEs | npm advisories that aren't dev-only. |

| Out of scope | Why |
|---|---|
| Bugs in the spec itself | File those at <https://github.com/tc39/ecma262> (262) or <https://github.com/tc39/ecma402> (402). |
| Disagreements with the search ranking | That's a feature request, not a vulnerability. |
| Issues that require a malicious operator controlling the vendored `spec.html` | If you own the deployment, you own the data. |
| Hosted-deployment-specific issues (a Cloudflare Worker hosting this server) | Those belong with whoever runs the deployment. |

## Tool outputs are upstream content

Every tool response carries strings authored by people other than the
operator of this server:

- ECMA-262 / ECMA-402 spec text — written by TC39 editors and reviewed
  in tc39/* PRs.
- `spec.history` commit subjects — `git log --format=%s` against the
  vendored spec checkout.
- `test262.get` source — the literal contents of files in
  tc39/test262, written by a wide contributor base.
- `proposal.get` titles, READMEs, and champion names from
  tc39/proposals.

When you wire `tc39-mcp` into an LLM agent, those strings become part
of the agent's context window. That makes them a **prompt-injection**
vector by definition: if upstream content contains text like
"Ignore previous instructions and …", the agent reads it.

What this server does to limit the channel:

- All tool outputs are JSON-serialized. Adversarial text has to land
  inside a string field, not as freeform model input.
- Every snapshot the server reads from carries a known upstream SHA,
  exposed via `spec.about`. Callers who want reproducibility can pin.

What this server does **not** do:

- Filter strings for prompt-injection patterns. That's a losing arms
  race against natural-language attacks, and would produce false
  positives against legitimate spec text (algorithms describe
  imperative steps that read like instructions).
- Sandbox the LLM. The agent still acts on whatever the tools return.

If your agent runs against untrusted users or makes privileged
decisions (writing code, sending mail, modifying systems) based on
this server's responses, treat the responses as untrusted input from
the upstream repos and review your agent's prompt for instructions
that would be dangerous to follow if an attacker controlled the
response text. Pinning to a known-good SHA via the hosted Worker's
`at:` parameter or a release-versioned npm install closes the
time-of-check / time-of-use window.

## Hardening notes

If you deploy this server somewhere multi-tenant or on the public
internet:

- Run with a **read-only filesystem mount** of `build/` + `vendor/`.
- **Pin specific spec SHAs** rather than tracking `main` if
  reproducibility matters.
- If you skip the `spec.history` tool, you can run with `git` absent
  from the container entirely — and that removes the last subprocess
  surface from the server.
- `test262.search` is index-only — no subprocess, no `gh` or GitHub
  token. It resolves the test262 index via the same loader chain as
  other tools (cache → hosted Worker → bundled fallback), so by
  default it will reach the snapshot endpoint over HTTPS on a cold or
  stale cache. To guarantee no outbound calls in a multi-tenant
  deployment, **block egress** and either mount a pre-populated
  `~/.cache/tc39-mcp/` or point `TC39_MCP_BASE_URL` at an internal
  mirror — the bundle alone only covers the bundled editions when the
  network is already unavailable, it doesn't suppress the attempt.

## Incident response

If the worst happens, the recovery paths are short. This section is a
quick reference rather than a runbook; the linked files are the source
of truth.

### A malicious release lands on npm

A bad publish is the highest-impact failure mode (consumers `npm
install` it on their machines). The recovery:

1. **Deprecate the broken version on npm** — this surfaces a warning
   to anyone installing it. `npm unpublish` is only available within
   72 hours of publish, so deprecation is the universal path:

   ```sh
   npm deprecate tc39-mcp@<bad-version> "Compromised release; install <next-version> instead. Details: <link>"
   ```

   The release workflow runs publish under Trusted Publishing (OIDC),
   so there is no long-lived `NPM_TOKEN` to rotate. Logging into npm
   manually as the package owner is enough to run `deprecate`.
2. **Cut a fixed PATCH release** with the actual fix and let
   `release.yml` publish it.
3. **Update this SECURITY.md** with a short "Past incidents" note (if
   user-visible) so future installers can verify the timeline.

### The hosted Worker is misbehaving

`deploy-worker.yml` includes auto-rollback: if the post-deploy smoke
test fails, the workflow runs `wrangler rollback` to the previous
deployment automatically. For a manual rollback at any other time:

```sh
cd worker
wrangler rollback --message "<reason>"
```

R2 contents are content-addressed and additive (per-SHA snapshots are
immutable, current `*-main.json` files are overwritten on refresh), so
rolling the Worker code back doesn't strand or corrupt R2 state.

### A vulnerability report comes in

Reporters open a [private security advisory](https://github.com/xyzzylabs/tc39-mcp/security/advisories/new).
The expected timeline (already stated above): acknowledge within
7 days, ship a fix within 30 days for confirmed issues.

For triage, in order:

1. Reproduce locally against the reported version. If the issue is
   in `vendor/` content (a tc39/* upstream bug), redirect to the
   right upstream issue tracker and close the advisory as out of
   scope.
2. If in scope, prepare the fix in a private fork off the advisory
   (GitHub's advisory UI offers this directly).
3. Cut a PATCH release. Use `release.yml` as normal — Trusted
   Publishing means the credential surface is the same as any other
   release.
4. Publish the advisory with the CVE-style summary and the version
   range. GitHub then notifies anyone with the affected version in
   their dependency tree.

### A leaked credential

Each long-lived credential the project keeps has a single rotation path:

- **`WORKFLOW_PAT`** / **`BOT_APP_PRIVATE_KEY`** (if used) — regenerate
  in GitHub settings, update the repo secret.
  See [CONTRIBUTING.md](CONTRIBUTING.md) → "Maintainer setup".
- **`CLOUDFLARE_API_TOKEN`** — regenerate in the Cloudflare dashboard
  (Account → API Tokens), update the repo secret.
- **`NPM_TOKEN`** — not used; npm publish runs under OIDC.

If the leak might already be exploited, also: rotate first, then audit
the recent push history (`git log` on `main`, `gh run list`) for
unexpected commits or deploys.

## Automated audits

The repo runs two automated security passes that complement manual
review:

- **CodeQL** — GitHub's first-party static analysis runs via the
  repo's **Default Setup** (Settings → Code security → Code
  scanning). Default queries cover the standard security + quality
  rules; findings appear in the Security tab. Default Setup is
  auto-managed (no workflow file to maintain).
- **Dependabot** (`.github/dependabot.yml`) — weekly grouped PRs for
  npm (root + worker) and GitHub Actions versions. Production
  dependencies and Actions are intentionally kept separate from
  development deps so security-relevant bumps don't get lost in noise.

Both run unauthenticated against the public source — there's no
out-of-band trust path. If either flags something that's a false
positive, suppress with an inline comment explaining why.
