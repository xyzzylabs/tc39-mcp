# Get started

This page takes you from zero to a successful spec lookup in five
minutes: pick how you run `tc39-mcp`, wire it into your MCP client,
and call your first tool.

## What is MCP?

The **Model Context Protocol** (MCP) is an open client/server
protocol for giving a language model access to external tools,
resources, and prompts. Servers expose capabilities; clients (chat
apps, IDEs, agents) connect over stdio or HTTP and forward typed
tool calls between the model and the server. See
[modelcontextprotocol.io](https://modelcontextprotocol.io) for the
upstream spec.

`tc39-mcp` is an MCP server. It exposes 19 tools that answer
structured questions about ECMA-262 + ECMA-402 — clause text,
algorithm steps, cross-references, edition diffs, git history,
test262 search, proposal lookup. If your client already speaks MCP
— Claude Desktop, Claude Code, Cursor, the official MCP Inspector —
adding it is one config entry away.

## Pick how you run it

`tc39-mcp` runs two ways, with the same wire protocol either way.
Pick **one**:

|  | [Local (stdio)](#local-stdio) | [Hosted (HTTP)](#hosted-http) |
|---|---|---|
| How | `npx tc39-mcp` as a local subprocess | point your client at a URL |
| Install | Node 20+ | none |
| **Tools** | **all 19** | **17** — no `spec.history` / `test262.get` |
| Latency | local subprocess, fast | one network hop per call |
| Data freshness | live from the Worker on first use, then cached + revalidated ~4 h (bundled subset offline) | live, auto-refreshed every ~4 h |
| Offline use | ✓ for bundled editions (latest + main); fetched-on-first-use otherwise | ✗ |
| Rate limit | none | 30 req / min / IP |

Most people want **Local** for personal use — every tool, and it
works offline. Choose **Hosted** when you can't install Node, when a
team shares one endpoint, or when you want the always-current Worker
pin. The only functional difference is the two tools below: they need
a subprocess or the on-disk test262 corpus, so they run locally only.

## Local (stdio)

Runs `tc39-mcp` as a subprocess of your MCP client through `npx` — no
global install, **all 19 tools**, and the bundled editions answer
offline. Wire it into your client:

::: code-group

```json [Claude Code (.mcp.json)]
{
  "mcpServers": {
    "tc39": {
      "command": "npx",
      "args": ["tc39-mcp"]
    }
  }
}
```

```json [Claude Desktop (claude_desktop_config.json)]
{
  "mcpServers": {
    "tc39": {
      "command": "npx",
      "args": ["tc39-mcp"]
    }
  }
}
```

```json [MCP Inspector / generic stdio client]
{
  "command": "npx",
  "args": ["tc39-mcp"]
}
```

:::

The first call for a given snapshot fetches it from the hosted Worker
and caches it on disk; later calls are served locally, revalidated
against the Worker only after the ~4-hour freshness window. If the
Worker is unreachable, the bundled `latest` + `main` editions still
answer. Restart your client after editing the config.

## Hosted (HTTP)

Point your client at the hosted Cloudflare Worker — zero install, but
**17 of the 19 tools**: everything except `spec.history` (needs a git
subprocess) and `test262.get` (needs the on-disk test262 corpus).

```json
{
  "mcpServers": {
    "tc39": {
      "type": "http",
      "url": "https://mcp.xyzzylabs.ai/tc39/mcp"
    }
  }
}
```

Requests are rate-limited to 30 / minute / IP and every call is a
network hop (no offline mode). Each tool's exact availability is on
the [tool reference](./tools) — look for the **Availability** line.

## Make your first call

This works on **either** transport. A good first call is `clause.get`
against `sec-tonumber` — short input, structured output, no parameters
to guess at.

In a chat / agent client, the natural-language prompt:

> Use `clause.get` to fetch `sec-tonumber` from the latest ECMA-262.
> Show me the algorithm steps.

triggers a call equivalent to:

```json
{ "tool": "clause.get", "arguments": { "id": "sec-tonumber" } }
```

The response is a structured `Clause` object: `meta` (id, aoid,
title, section number, kind), `signatureRaw`, `algorithms[].steps`,
`notes`, and `crossrefs`. The full field list lives on
[`tools.md → clause.get`](./tools#clause-get).

## Verify it's working

Once the call returns, sanity-check the response:

- The `meta.aoid` field should be `"ToNumber"`.
- The `meta.number` field should be `"7.1.4"` (in es2025 and later).
- The first step in `algorithms[0].steps` should match the spec
  prose verbatim — `"If _argument_ is a Number, return _argument_."`

If you got back `null` instead, the clause id was probably wrong;
try [`spec.search`](./tools#spec-search) (`{ query: "ToNumber" }`)
to find the right id.

If the server didn't respond at all, two things to check:

1. **Node version** (Local): tc39-mcp targets Node 20+. Older Node
   refuses to start with a clear error.
2. **MCP transport**: confirm your client logs show a `tools/list`
   handshake. Most MCP clients log this; if you see nothing, the
   stdio server probably never launched, or the hosted URL is wrong.

## Next steps

- **[Tool reference](./tools)** — every tool, every input field,
  every example call, plus each tool's **Availability** (hosted vs
  stdio-only).
- **[Cookbook](./cookbook)** — multi-tool recipes for common
  workflows (cross-spec lookups, prose-drift tracking, etc.).
- **[Editions + specs](./editions)** — which editions and aliases
  are supported and how `latest` resolves per spec.
- **[Architecture](./architecture)** — how the server is wired
  internally and the design constraints that shape the tool surface.
