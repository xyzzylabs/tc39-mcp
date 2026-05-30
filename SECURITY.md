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
| Command-injection in `spec.history` (shells out to `git`) | The `id` argument is interpolated into a git argument; needs to be defensively quoted. This is the **only** subprocess surface in the server. |
| Outdated dependencies with known CVEs | npm advisories that aren't dev-only. |

| Out of scope | Why |
|---|---|
| Bugs in the spec itself | File those at <https://github.com/tc39/ecma262> (262) or <https://github.com/tc39/ecma402> (402). |
| Disagreements with the search ranking | That's a feature request, not a vulnerability. |
| Issues that require a malicious operator controlling the vendored `spec.html` | If you own the deployment, you own the data. |
| Hosted-deployment-specific issues (a Cloudflare Worker hosting this server) | Those belong with whoever runs the deployment. |

## Hardening notes

If you deploy this server somewhere multi-tenant or on the public
internet:

- Run with a **read-only filesystem mount** of `build/` + `vendor/`.
- **Pin specific spec SHAs** rather than tracking `main` if
  reproducibility matters.
- If you skip the `spec.history` tool, you can run with `git` absent
  from the container entirely — and that removes the last subprocess
  surface from the server.
- Ship `build/test262-index.json` baked into the deployment. The tool
  is index-only — no subprocess, no network — so you don't need `gh`
  or a GitHub token in the container.

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
