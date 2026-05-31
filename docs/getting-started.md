# Get started

This page walks you from zero to a successful spec lookup in five
minutes. By the end you'll have `tc39-mcp` wired into your MCP
client, you'll have called one tool from it, and you'll know where to
go next.

## What is MCP?

The **Model Context Protocol** (MCP) is an open client/server
protocol for giving a language model access to external tools,
resources, and prompts. Servers expose capabilities; clients (chat
apps, IDEs, agents) connect over stdio or HTTP and forward typed
tool calls between the model and the server. See
[modelcontextprotocol.io](https://modelcontextprotocol.io) for the
upstream spec.

`tc39-mcp` is an MCP server. It exposes 19 read-only tools that
answer structured questions about ECMA-262 + ECMA-402 — clause text,
algorithm steps, cross-references, edition diffs, git history,
test262 search, proposal lookup. It runs locally over stdio or
hosted as a Cloudflare Worker over HTTP; either way the wire
protocol is the same.

If your client already speaks MCP — Claude Desktop, Claude Code,
Cursor, the official MCP Inspector — adding `tc39-mcp` is one config
entry away.

## Step 1: Pick a transport

|  | stdio (local) | hosted Worker (HTTP) |
|---|---|---|
| Setup cost | `npx tc39-mcp` runs immediately | zero — point your client at a URL |
| Latency | local subprocess, fast | one network hop per call |
| Data freshness | whatever the installed version baked in | live, auto-refreshed every ~4 h |
| Rate limit | none | 100 req / min / IP |
| Offline use | ✓ | ✗ |

Most users want **stdio** for personal local use. Pick HTTP when
several teammates share one server, when you can't install Node
locally, or when you want the always-current Worker pin.

## Step 2: Wire it into your MCP client

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

```json [Hosted Worker (HTTP transport)]
{
  "mcpServers": {
    "tc39": {
      "type": "http",
      "url": "https://tc39-mcp.<account>.workers.dev/mcp"
    }
  }
}
```

:::

Restart your client so it picks up the new config. The server runs
read-only over the wire — no auth, no writes, no shell, no network
fetches. See [Architecture](./architecture) for the full security
story.

## Step 3: Make your first call

A good first call is `clause.get` against `sec-tonumber` — short
input, structured output, no parameters to guess at.

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

## Step 4: Verify it's working

Once the call returns, sanity-check the response:

- The `meta.aoid` field should be `"ToNumber"`.
- The `meta.number` field should be `"7.1.4"` (in es2025 and later).
- The first step in `algorithms[0].steps` should match the spec
  prose verbatim — `"If _argument_ is a Number, return _argument_."`

If you got back `null` instead, the clause id was probably wrong;
try [`spec.search`](./tools#spec-search) (`{ query: "ToNumber" }`)
to find the right id.

If the server didn't start at all, two things to check:

1. **Node version**: tc39-mcp targets Node 20+. Older Node will
   refuse to start with a clear error.
2. **MCP transport**: confirm your client logs show a `tools/list`
   handshake. Most stdio MCP clients log this; if you see no logs at
   all the server probably never got launched.

## Next steps

- **[Tool reference](./tools)** — every tool, every input field,
  every example call. The list of "What it answers" entries per tool
  is the easiest way to discover what you can ask.
- **[Cookbook](./cookbook)** — multi-tool recipes for common
  workflows (cross-spec lookups, prose-drift tracking, etc.).
- **[Editions + specs](./editions)** — which editions and aliases
  are supported and how `latest` resolves per spec.
- **[Architecture](./architecture)** — how the server is wired
  internally and why the constraints (read-only, no execution, no
  auth) are the design.
