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
