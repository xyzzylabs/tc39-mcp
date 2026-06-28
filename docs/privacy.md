# Privacy Policy

**Last updated:** June 3, 2026

tc39-mcp is a read-only lookup service for the TC39 specs (ECMA-262
and ECMA-402). This policy describes what data the server handles,
what it doesn't, and how to reach the maintainer with questions.

## What data tc39-mcp collects

**The stdio transport (`npx tc39-mcp`) sends no telemetry and
never transmits your queries.** The server runs on the user's
machine and answers tool calls from locally-available data —
either snapshots bundled in the npm package (the latest stable and
main editions of ECMA-262 and ECMA-402, plus the proposals and
test262 indexes) or snapshots cached on disk under
`~/.cache/tc39-mcp/`. It does reach the network to *source* those
snapshots (see the paragraph below), but never to report what you
look up. The MCP client
(Claude Code, Claude Desktop, Cursor, MCP Inspector, etc.) sends
a JSON-RPC request over stdin and receives a JSON-RPC response on
stdout; nothing leaves the process.

The server reaches the network in one narrow way: to source a
snapshot it doesn't have cached. On the first call for a given
snapshot — or once a cached copy is older than ~4 hours — it
issues an HTTPS request to the configured snapshot endpoint (by
default the hosted Cloudflare Worker at
`https://mcp.xyzzylabs.ai/tc39/r2/<key>`, overridable
via `TC39_MCP_BASE_URL`). A stale copy is revalidated with a
conditional `If-None-Match` request — a `304 Not Modified` when
nothing changed, so usually no bytes move; a cold cache fetches
the snapshot in full. Between those checks, calls are served from
disk. The request carries the R2 object key and standard HTTP
headers; it does not carry clause ids, tool arguments, or any
identifier beyond the underlying TCP/TLS metadata. To avoid the
network entirely, point `TC39_MCP_BASE_URL` at a private mirror,
or restrict yourself to the bundled editions and block egress.

**The hosted Cloudflare Worker
([mcp.xyzzylabs.ai/tc39](https://mcp.xyzzylabs.ai/tc39))
collects only the standard request metadata that any
internet-reachable Cloudflare Worker receives:**

- Source IP address — used solely for per-IP rate limiting
  (30 requests per minute) and discarded shortly after.
- Request timestamp.
- Request method, path, and headers as forwarded by the
  Cloudflare edge.

The Worker does **not** log request bodies, MCP tool arguments, or
response payloads. It does **not** set cookies. It does **not**
emit any client-side script or load third-party tracking.

## What tc39-mcp does NOT collect

- No personal information (name, email, address, payment data).
- No browsing history.
- No precise geolocation.
- No identifiers that persist across sessions on the user's device.
- No data about which spec clauses are queried (queries are
  served and forgotten — the hosted Worker only sees the R2
  object keys the stdio cache fetches or revalidates, never the
  clause ids the agent is reading).

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

- Stdio transport: nothing is retained because nothing is
  collected; locally-cached snapshots under `~/.cache/tc39-mcp/`
  are managed by the user (deleting them simply triggers a
  re-fetch on next use).
- Hosted Worker:
  - Rate-limit counters expire on their natural Cloudflare bucket
    schedule (within 60 seconds).
  - Standard Cloudflare access logs follow Cloudflare's retention
    policy.

## Security

- All traffic to the hosted Worker is served over HTTPS.
- No user code is executed by the server; every tool returns a
  pre-parsed view of static spec data.

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
