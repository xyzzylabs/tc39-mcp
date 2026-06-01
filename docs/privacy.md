# Privacy Policy

**Last updated:** December 1, 2026

tc39-mcp is a read-only lookup service for the TC39 specs (ECMA-262
and ECMA-402). This policy describes what data the server handles,
what it doesn't, and how to reach the maintainer with questions.

## What data tc39-mcp collects

**The stdio transport (`npx tc39-mcp`) collects nothing.** Every
spec snapshot ships inside the npm tarball. Once installed, the
server runs entirely on the user's machine: no network calls per
query, no telemetry, no analytics, no usage reporting. The MCP
client (Claude Code, Claude Desktop, Cursor, MCP Inspector, etc.)
sends a JSON-RPC request over stdin and receives a JSON-RPC
response on stdout; nothing leaves the process.

**The hosted Cloudflare Worker
([tc39-mcp.chicoxyzzy.workers.dev](https://tc39-mcp.chicoxyzzy.workers.dev))
collects only the standard request metadata that any
internet-reachable Cloudflare Worker receives:**

- Source IP address — used solely for per-IP rate limiting
  (100 requests per minute for free traffic) and discarded
  shortly after.
- Request timestamp.
- Request method, path, and headers as forwarded by the
  Cloudflare edge.
- Optional `Authorization: Bearer <key>` header when the caller is
  a sponsor — the server stores the SHA-256 of the key in
  Cloudflare KV so it can validate without keeping the plaintext.

The Worker does **not** log request bodies, MCP tool arguments, or
response payloads. It does **not** set cookies. It does **not**
emit any client-side script or load third-party tracking.

## What tc39-mcp does NOT collect

- No personal information (name, email, address, payment data).
- No browsing history.
- No precise geolocation.
- No identifiers that persist across sessions on the user's device.
- No data about which spec clauses are queried (queries are
  served and forgotten).

## Third parties

tc39-mcp does not share data with third parties. The hosted Worker
runs on Cloudflare's infrastructure; Cloudflare's own [privacy
policy](https://www.cloudflare.com/privacypolicy/) governs the
edge metadata Cloudflare itself processes (DDoS protection, basic
request routing). No other third-party service is contacted at
query time.

The spec data the server returns is parsed from the public
[tc39/ecma262](https://github.com/tc39/ecma262) and
[tc39/ecma402](https://github.com/tc39/ecma402) repositories,
plus [tc39/test262](https://github.com/tc39/test262) and
[tc39/proposals](https://github.com/tc39/proposals). All vendored
content is itself public.

## Data retention

- Stdio transport: nothing is retained because nothing is collected.
- Hosted Worker:
  - Rate-limit counters expire on their natural Cloudflare bucket
    schedule (within 60 seconds for free-tier counters).
  - Sponsor-key hashes are retained in KV for as long as the
    sponsor's subscription is active and are removed when the
    sponsor cancels or revokes the key.
  - Standard Cloudflare access logs follow Cloudflare's retention
    policy.

## Security

- All traffic to the hosted Worker is served over HTTPS.
- No user code is executed by the server; every tool returns a
  pre-parsed view of static spec data.
- Sponsor keys are stored only as SHA-256 hashes server-side. The
  plaintext key never leaves the sponsor's environment after
  issuance.

If you discover a security issue, please report it via
[SECURITY.md](https://github.com/xyzzylabs/tc39-mcp/blob/main/SECURITY.md)
or open a private security advisory on the GitHub repository.

## Children

tc39-mcp is a developer tool for working with the JavaScript spec.
It is not directed at children and does not knowingly collect data
from anyone, including children.

## Changes to this policy

Material changes will be announced in the
[changelog](/changelog) and reflected here with an updated
"Last updated" date.

## Contact

For privacy questions or requests, open an issue on GitHub:
[github.com/xyzzylabs/tc39-mcp/issues](https://github.com/xyzzylabs/tc39-mcp/issues).
Issues labeled `privacy` are triaged with the same priority as
security advisories and a maintainer responds within 30 days.
