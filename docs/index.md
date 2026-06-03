---
layout: home

hero:
  name: tc39-mcp
  text: Structured MCP for the TC39 specs
  tagline: Structural ECMA-262 + ECMA-402 lookup for any MCP-speaking AI agent — SHA-pinned clauses, AOID-aware search, cross-spec references, edition diffs, git history. Locally cached via stdio; HTTP via the hosted Cloudflare Worker.
  actions:
    - theme: brand
      text: Tool reference
      link: /tools
    - theme: alt
      text: GitHub
      link: https://github.com/xyzzylabs/tc39-mcp

features:
  - icon: 🤖
    title: Spec lookup for AI agents
    details: Any MCP client (Claude Code, Claude Desktop, Cursor, MCP Inspector) gets `clause.get`, `spec.search`, `spec.crossrefs`, and 16 more tools — structural JSON answers grounded on real spec text instead of grep'd HTML. Every citation resolves to a specific clause id at a specific SHA.
  - icon: 🎯
    title: 19 tools across 5 namespaces
    details: clause.get / list / outline · spec.about / snapshots / search / global_search / crossrefs / diff / history / symbol_resolve / tables / grammar / sdo_index / well_known_intrinsics · test262.search / get · proposal.list / get
  - icon: 📦
    title: Two specs, every released annual edition
    details: ECMA-262 (es2016 → es2026 + main) and ECMA-402 (es2016 → es2026 + main). Every clause carries its upstream SHA and fetched_at timestamp — full table on the Snapshots page.
  - icon: ✈️
    title: Cached locally, offline-capable
    details: The stdio transport (`npx tc39-mcp`) serves snapshots from a local cache under `~/.cache/tc39-mcp/`, fetching from the hosted Worker on a cold cache and revalidating only after a ~4-hour freshness window; the bundled latest-stable + main editions (plus the proposals and test262 indexes) keep answering offline. Network requests carry R2 object keys, never clause ids. The hosted Worker is the HTTP alternative.
  - icon: 🔌
    title: Three ways to run it
    details: Local stdio via `npx tc39-mcp` (the default), a global CLI, or the hosted Cloudflare Worker over HTTP. Same MCP protocol, three transports.
  - icon: 🔄
    title: Auto-refreshing
    details: A scheduled CI workflow refreshes the hosted Worker from upstream tc39/* every ~4 hours; the npm package re-bakes its bundled snapshots at most monthly (new annual editions ship immediately). Stay current without lifting a finger.
  - icon: 🧪
    title: Deterministic over pinned data
    details: Every response is a function of static parsed JSONs. Same inputs → same bytes out, reproducible across server versions.
  - icon: 🏗️
    title: Production-shaped
    details: LRU-bounded memory, IP-bucketed rate limiting (30/60s/IP), structured per-request logging, post-deploy smoke testing, historical SHA addressing via `at:` on the hosted Worker.
---

## Install + run

::: code-group

```sh [stdio (npx, recommended)]
# Wire into Claude Code via .mcp.json:
{
  "mcpServers": {
    "tc39": { "command": "npx", "args": ["tc39-mcp"] }
  }
}
```

```sh [global CLI]
npm i -g tc39-mcp
tc39-mcp                     # reads stdio
```

```sh [hosted Worker]
# .mcp.json:
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

## What it's for

- **Agents and tooling that need to consult the JS spec** —
  `clause.get` + `spec.search` instead of grepping `spec.html`.
- **Reading the spec offline / in a tool** — full structured access
  without scraping or hitting a 4 MB HTML file.
- **Cross-version analysis** — `spec.diff` between any two editions
  back to ES2016; `spec.history` walks the upstream git log.
- **Cross-spec analysis** — `spec.crossrefs { include_cross_spec: true }`
  resolves references that point from ECMA-262 into ECMA-402 (or vice
  versa). Useful for queries like "every 262 op that calls into Intl."
- **AOID → clause-id lookup** — `spec.search` ranks aoid-exact matches
  first.

## Scope

Deliberately narrow:

- **Read-only.** No tool mutates anything. Every response is a
  deterministic function of pinned spec data.
- **No execution.** No spec semantics evaluated; no JS run. Pure
  parsed-JSON lookup.
- **No auth.** Read-only + no execution = safe to host publicly.
- **No corpus vendoring.** test262 search works against an index built
  from a local checkout (~13 MB JSON).

These constraints are the design — they're what make the server small,
fast, and trivially deployable behind a Cloudflare Worker without
sandboxing concerns.
