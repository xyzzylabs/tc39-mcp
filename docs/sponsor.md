# Sponsor tc39-mcp

The free anonymous tier of the hosted Worker stays free forever —
30 requests per minute per IP, no API key needed, no signup. The
sponsorship described on this page is **optional** and exists for
two reasons:

1. To keep the hosted Worker running comfortably as usage grows
   (R2 reads, Workers requests, the maintainer's time).
2. To give sponsors a higher per-key rate limit and stable
   per-key bucketing — useful if you're running an agent that
   makes more than the default 30/min, or sharing one egress IP
   between several agents.

If you find tc39-mcp useful, the most helpful thing you can do is
sponsor it on [github.com/sponsors/xyzzylabs](https://github.com/sponsors/xyzzylabs).

## What you get

| Tier | Limit (per key, per minute) | What changes for you |
|---|---|---|
| Anonymous (default) | 30 | Bucketed per source IP. Multiple agents behind one IP share the budget. |
| Sponsor (any tier ≥ $5/mo) | 300 | Bucketed per API key. Same headroom regardless of source IP; multiple machines can share one key. |

The tier doesn't unlock any extra tools — it's the same 19-tool
surface for anonymous users and sponsors. What changes is the rate
limit and the bucketing scope.

## How to start sponsoring

1. Go to [github.com/sponsors/xyzzylabs](https://github.com/sponsors/xyzzylabs)
   and pick any monthly tier ≥ $5/mo.
2. The maintainer issues an API key in the form `tcms_…` and sends
   it to you via the GitHub Sponsors thank-you DM (or the email
   you set in your GitHub Sponsors profile, if you prefer). Expect
   one business day.
3. Add the key to your MCP client config (next section).

## Wiring the key into your MCP client

::: code-group

```json [Claude Code / Claude Desktop (.mcp.json)]
{
  "mcpServers": {
    "tc39": {
      "type": "http",
      "url": "https://tc39-mcp.chicoxyzzy.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer tcms_YOUR_KEY_HERE"
      }
    }
  }
}
```

```sh [Manual curl test]
curl -sS -X POST https://tc39-mcp.chicoxyzzy.workers.dev/mcp \
  -H "authorization: Bearer tcms_YOUR_KEY_HERE" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```ts [MCP Inspector / generic client]
const transport = new StreamableHTTPClientTransport(
  new URL("https://tc39-mcp.chicoxyzzy.workers.dev/mcp"),
  {
    requestInit: {
      headers: {
        Authorization: "Bearer tcms_YOUR_KEY_HERE",
      },
    },
  },
);
```

:::

Restart your client so it picks up the new config. The first
request hits the Worker, the key is validated against a hashed
entry in the sponsor KV namespace, and the higher rate limit
applies from then on.

## Security model

- The raw API key never leaves your client config and the
  Cloudflare Worker's request scope. The Worker only stores the
  SHA-256 hash of the key in KV; if the KV ever leaked, no usable
  keys would leak with it.
- Keys are revokable. If you suspect yours leaked, email the
  maintainer (any GitHub Sponsors DM works) — the old key gets
  removed and a new one issued in the same step.
- Anonymous traffic and sponsor traffic share the same compute
  path. There's no preferential routing or extra data exposed to
  sponsors. The only difference at runtime is the rate-limit
  bucket the request lands in.
- The Worker logs the SHA-256 of any presented key alongside the
  per-request structured log entry (so a misbehaving client can be
  pinpointed without knowing the raw key). Logs are dropped after
  Cloudflare's default retention.

## Cancellation + refunds

Cancel any time on GitHub. Your key keeps working until the end of
the current billing month, then gets revoked automatically the
next time the maintainer runs the sponsor sync (within ~1 week).

The maintainer does not actively process refunds — if you have a
billing issue, GitHub Sponsors' support handles it directly.

## Why "sponsorship" rather than "subscription"

Two reasons:

1. The hosted Worker is and will stay free for anonymous use.
   Sponsorship is the project's way of saying "the cost of keeping
   this lit is real; here's how you can help cover it" — not
   "this server is a paid product and you're a customer".
2. GitHub Sponsors handles taxes, payment methods, and customer
   support far better than the maintainer could on their own as a
   side project.

If sponsorship volume ever justifies a more formal commercial
offering, that'll be a separate decision documented here.
