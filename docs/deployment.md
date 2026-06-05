# Deployment

`tc39-mcp` runs in three shapes:

| Shape | Use case | Status |
|---|---|---|
| **Local stdio** | Wired into Claude Code via `.mcp.json` | ✅ shipped |
| **Local CLI / npm package** | `npx tc39-mcp` | ✅ shipped |
| **Hosted HTTP** (Cloudflare Worker) | Public endpoint for unaffiliated agents | ✅ shipped |

Those three shapes build from **one source tree, two published
artifacts**:

| Artifact | Package | Ships via | How you reach it |
|---|---|---|---|
| stdio server (and the CLI) | `tc39-mcp` (npm) | `npm publish` | `npx tc39-mcp` · `npm i -g tc39-mcp` |
| HTTP worker | `tc39-mcp-worker` | `wrangler deploy` → Cloudflare | the hosted endpoint URL |

`worker/` is a separate, **private** package. A Cloudflare Worker is a
deployment, not a library, so it is never published to npm: you reach it
over HTTP at the hosted URL, or self-host by cloning the repo and running
`wrangler deploy` yourself. Both artifacts read the same parsed snapshots
and differ only in transport (stdio vs HTTP) and tool surface (all 19
tools vs the hosted subset). The Worker keeps its own `package.json` +
lockfile so its bundle never pulls in the Node-shaped source tree.

## Local stdio (the default)

Used when an agent on the same machine wants to consult the spec.
This is how Claude Code talks to the server.

```json
{
  "mcpServers": {
    "tc39": {
      "type": "stdio",
      "command": "npx",
      "args": ["tc39-mcp"]
    }
  }
}
```

If you're developing the server itself, point at the local source
instead:

```json
{
  "mcpServers": {
    "tc39": {
      "type": "stdio",
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/abs/path/to/tc39-mcp"
    }
  }
}
```

## Local CLI

The npm package ships a `bin: tc39-mcp` that resolves to
`dist/mcp/server.js`:

```sh
# install once
npm i -g tc39-mcp

# run
tc39-mcp                     # reads stdio
```

The CLI does not provide a sub-command surface (no `tc39-mcp clause
get sec-tonumber` etc.) — that would duplicate what the MCP protocol
already does, and the audience for "ad hoc spec lookup from the
terminal" is small. If you want one, file an issue.

## Freshness model

Live data lives in **R2**, not in the npm version. The stdio server
sources each snapshot through `loadSnapshot` (local cache → hosted
Worker R2 → bundled fallback) and re-checks live keys against R2 every
4 hours (`POINTER_TTL_MS`); the hosted Worker reads R2 directly. So
anything reachable over the network is at most ~4 hours stale. The
npm tarball ships a **bundled subset** (latest stable + `main`
editions, plus the proposals and test262 indexes) purely as an
offline cold-start fallback.

Two refresh cadences keep that picture current:

1. **R2 refresh — every 4 hours** (`.github/workflows/refresh.yml`).
   Fetches upstream and diffs SHAs against `.last-refresh.json` — both
   specs' `main`, test262, proposals, plus the current ECMA-402
   release branch (402 publishes editions as branches that can still
   take editorial commits after they're cut; 262's are immutable
   tags). On any movement it commits the new sentinel and dispatches
   `deploy-worker.yml` — which re-parses and uploads fresh snapshots
   to R2. No npm release. This is the live-freshness path for everyone
   with a network. When the **402 release branch** itself is what
   moved, the run also raises a notice and opens an `ecma402-drift` issue
   so the post-publication change gets a human review.

2. **npm bundle re-bake — at most monthly.** The bundle is only the
   offline fallback, so the refresh job re-publishes it on a slow
   cadence: when ≥ 30 days have passed since the last data publish
   (tracked in `.last-refresh.json`'s `last_npm_publish`), a refresh
   run additionally bumps PATCH + tags, and the tag drives the npm
   publish via `release.yml`. Net: ~12 data publishes/year instead of
   ~2000, and the npm changelog regains meaning — PATCH = a monthly
   data refresh, MINOR/MAJOR = code.

A **new annual edition** doesn't wait for the monthly tick: adding it
is a deliberate catalog change (`src/editions.ts`) — i.e. a code
release — which publishes immediately and re-bakes the bundle with it.
The refresh job only *detects* a new upstream `esYYYY` not yet in the
catalog and surfaces a nudge; it never adds an edition on its own
(each one needs a parser check).

Callers can check what they're looking at with the `spec.about`
tool. It returns per-snapshot `pin` metadata — `sha`, `fetched_at`,
`biblio_commit`, `clause_count` — and `spec.about`'s `source` tag
(`cache` / `network` / `bundle`) says which layer served it. The
freshness contract is in-band.

## Hosted HTTP (Cloudflare Worker)

A minimal Worker lives in [`worker/`](https://github.com/xyzzylabs/tc39-mcp/tree/main/worker) that speaks MCP's
JSON-RPC over HTTP, reads parsed JSONs from a bound R2 bucket, and
ships **15 tools** (`spec.about`, `clause.get`, `clause.list`,
`spec.search`, `proposal.list`, `proposal.get`, `spec.grammar`,
`spec.tables`, `spec.sdo_index`, `clause.outline`,
`spec.global_search`, `spec.snapshots`, `spec.symbol_resolve`,
`spec.well_known_intrinsics`, `spec.diff`). The bundled Worker gzips to
**~8 KB**.

The same Worker also serves the **documentation site** as static
assets (Cloudflare Workers Assets). One origin, one deploy, one URL
for both API and docs.

```
┌────────────────────────────────────────────────────┐
│ HTTPS request to tc39-mcp.<account>.workers.dev    │
└───────────────────┬────────────────────────────────┘
                    │
       ┌────────────┴───────────┐
       │                        │
       ▼                        ▼
┌──────────────┐         ┌──────────────────┐
│ POST /mcp    │         │ GET /, /tools,   │
│ GET  /health │         │ /snapshots, etc. │
│              │         │                  │
│ Worker JS    │         │ Workers Assets   │
│ → dispatch   │         │ → static HTML +  │
│ → R2 reads   │         │   JS/CSS         │
└──────┬───────┘         └──────────────────┘
       │
       ▼
┌────────────────────────┐
│ R2 bucket              │
│   spec-262-main.json   │
│   spec-402-main.json   │
│   ...                  │
│   test262-index.json   │
│   proposals-index.json │
└────────────────────────┘
```

### Endpoints

| Path | Method | Returns |
|---|---|---|
| `/` | GET | docs site landing page (rendered HTML) |
| `/tools`, `/snapshots`, `/architecture`, `/deployment`, `/editions`, `/changelog` | GET | docs site pages |
| `/health` | GET, HEAD | `ok` — liveness probe for uptime monitors |
| `/mcp` | POST | MCP JSON-RPC dispatcher |
| `/mcp` | OPTIONS | CORS preflight |
| Anything else | (any) | Falls through to the assets handler; serves the themed 404 page |

### Setup (one-time, per Cloudflare account)

1. **Authenticate wrangler.**
   ```sh
   cd worker
   npm install
   npx wrangler login
   ```

2. **Create the R2 bucket.**
   ```sh
   npx wrangler r2 bucket create tc39-mcp-specs
   npx wrangler r2 bucket create tc39-mcp-specs-preview   # for `wrangler dev`
   ```

3. **Upload parsed JSONs.** From the repo root, after `npm run parse
   && npm run build-test262-index && npm run build-proposals-index`:
   ```sh
   cd worker
   npm run upload-r2
   ```

4. **Deploy the Worker.**
   ```sh
   cd worker
   npm run deploy
   ```

The Worker is now live at
`https://tc39-mcp.<your-account>.workers.dev/mcp`. Test it:

```sh
curl -s https://<your-worker-url>/health
curl -s -X POST https://<your-worker-url>/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .
```

### Wire into an MCP client

For Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "tc39": {
      "type": "http",
      "url": "https://<your-worker-url>/mcp"
    }
  }
}
```

For any MCP client that supports HTTP transport, point it at the
same URL. The Worker speaks MCP 2024-11-05; the response is the
same JSON shape the stdio server returns.

### CI-driven deploys

`.github/workflows/deploy-worker.yml` runs on every `v*` tag plus
`workflow_dispatch`. It:

1. Fetches upstream specs + builds all parsed JSONs.
2. **Builds the docs site** (`npm run docs:build`) — auto-generates
   the `/snapshots` page from the freshly parsed JSONs.
3. Stages the docs into `worker/public/` so wrangler bundles them as
   Worker static assets.
4. Uploads parsed JSONs + indexes to R2 (ordered: historical pins +
   side indices first, live mains last — see "Atomic-ish deploys"
   below).
5. Deploys the Worker (code + assets in one atomic deploy).
6. Smokes against `vars.WORKER_URL`: `/health`, MCP `initialize`,
   `tools/call spec.about`, plus the docs landing page and the
   `/snapshots` page render. Catches "deployed but R2 contents or
   docs are broken."
7. **Auto-rollback on smoke failure** — if smoke fails and there's a
   prior version available, runs `wrangler rollback` to revert the
   Worker. R2 contents stay updated (they're idempotent), so the
   reverted Worker reads the freshest data — only the code rolls
   back. The workflow still exits with failure so a maintainer
   investigates.

Required repo secrets:

| Name | Source |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens (Edit Cloudflare Workers template) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard URL |

Required repo variable (optional, used for post-deploy health check):

| Name | Example |
|---|---|
| `WORKER_URL` | `https://tc39-mcp.example.workers.dev` |

### How R2 stays current

R2 is the source of truth for the hosted Worker's data. The update
chain is:

```
upstream tc39/* main moves
        ↓
refresh.yml runs every ~4 hours
   diffs upstream SHAs vs .last-refresh.json
   on movement → dispatches deploy-worker.yml (R2 refresh, no npm)
   monthly (≥30 d since last publish) → ALSO tags vX.Y.Z+1
        ↓
        the monthly tag fans out (in parallel) to:
        ↓
   ┌────────────────────┬─────────────────────────┐
   │  release.yml       │  deploy-worker.yml      │
   │  npm publish       │  fetch + parse + build  │
   │                    │  → upload-r2.ts         │
   │                    │  → wrangler r2 put × N  │
   │                    │  → wrangler deploy      │
   │                    │  → /health + tools/call │
   └────────────────────┴─────────────────────────┘
```

So R2 updates **within ~4 hours of an upstream merge, otherwise no-op**.
Manual `workflow_dispatch` lets a maintainer force a refresh or
re-deploy.

### Historical retention

For every `main` snapshot we upload, we ALSO publish a SHA-suffixed
immutable copy:

| Key | Lifetime | Use |
|---|---|---|
| `spec-262-main.json` | Mutable; overwritten each deploy | Live current state |
| `spec-262-main-{sha10}.json` | Immutable per-SHA | Historical pin for `at: "<sha>"` queries |
| `spec-262-es2026.json` | Re-uploaded each deploy; content fixed (262 releases are immutable tags) | Live state of a pinned 262 edition |
| `spec-402-es2026.json` | Re-uploaded each deploy; content may change (402 releases are branches that can drift post-cut) | Live state of the current 402 edition |
| `spec-402-main.json` | Mutable | Live |
| `spec-402-main-{sha10}.json` | Immutable per-SHA | Historical |
| `test262-index.json` | Mutable | Live |
| `proposals-index.json` | Mutable | Live |

A new pin appears only when `main`'s SHA actually changes — a deploy
for an unchanged SHA overwrites the same key — so pins accrue at the
rate upstream `main` moves, on the order of a gigabyte a year. At
R2's $0.015/GB/month that's a few cents, so pins are **kept
indefinitely** rather than pruned: deleting an old one would break
`at:` reproducibility for that SHA, which is the whole reason they
exist.

Released editions (`es2026`) get no SHA-suffixed history — just the
live key. For 262 that key is fixed forever (releases are immutable
tags); for 402 it tracks the release *branch*, which can take
post-publication editorial commits, so the refresh job detects that
drift (see *Freshness model* above) and overwrites the key. Either
way there's no per-SHA history to address with `at`.

Inside the Worker, each isolate caches parsed JSONs in memory (see
`worker/src/r2.ts`'s `specCache` / `test262Cache` / `proposalsCache`).
Cloudflare recycles isolates on its own schedule (typically minutes);
new R2 contents propagate to the next cold-started isolate
automatically. **No code redeploy is needed for data freshness** —
new uploads to R2 are picked up by the next isolate restart.

### Two-layer read cache + free-tier hardening

The R2 reads are wrapped in two cache layers so a cold isolate
doesn't always go to R2:

| Layer | Lifetime | Scope | What it costs |
|---|---|---|---|
| Isolate memory (`specCache`) | Up to isolate recycling (minutes) | One Worker isolate | 0 — RAM |
| Workers Cache API (`caches.default`) | Per `Cache-Control` TTL | One Cloudflare colo | 0 — does not count toward R2 Class B |
| R2 (`env.SPECS.get`) | Authoritative | Global | Counts toward R2 Class B reads |

`worker/src/r2.ts`'s `readTextWithEdgeCache` populates the Cache API
on every cold R2 read. Per-SHA snapshots (`spec-<spec>-<edition>-<sha10>.json`)
are cached `public, max-age=86400, immutable` since the bytes are
pinned forever; live mains (`*-main.json`, `proposals-index.json`)
use `max-age=300` so a refresh-triggered redeploy propagates within
five minutes. `test262-index.json` (13.8 MB) skips the Cache API and
relies on the isolate cache only.

The wrangler-bound rate limiter is sized to keep the worst-case
worst-actor under the R2 Class B free allowance (10 M reads/month):

| Setting | Value | Worst-case load per IP |
|---|---|---|
| `simple.limit` | 30 | 30 req/min |
| `simple.period` | 60 s | × 60 × 24 × 30 = 1.3 M req/month |
| R2 reads per request | up to 3 (with edge cache it's typically 0–1) | ≤ 3.9 M Class B reads/month/IP |

A single sustained attacker can't push the account into paid usage
on R2; an honest agent's traffic is two orders of magnitude below
the limit (~5/min is typical). Tune via the dashboard without
re-deploying by overriding `[[unsafe.bindings]]` in a wrangler
environment.

### Atomic-ish deploys

R2 uploads happen in a deliberate order — historical pins + side
indices first, **live mains last** (`worker/scripts/upload-r2.ts`
+ `classify.ts`). A reader hitting the Worker mid-deploy sees either
the fully-old or fully-new live state, with only a short window
(2-5 s) where a new historical pin is visible while the live mains
are still old.

### R2 update model — operational notes

The model favors simplicity; these are tradeoffs, not correctness gaps:

- Each deploy re-uploads the full snapshot set (~50 MB, ~60-90 s).
- A brief window (2-5 s) during upload can serve mixed-version data.
- Tool responses carry no `Cache-Control`, so Cloudflare's CDN doesn't
  cache JSON-RPC POSTs.
- Stale isolates serve old R2 reads from their in-memory cache until
  Cloudflare recycles them (minutes).

### Which tools run stdio-only?

The stdio server exposes all 19 tools; the hosted Worker currently
ships 15 — the six core lookup tools plus `spec.grammar`,
`spec.tables`, `spec.sdo_index`, `clause.outline`, `spec.global_search`,
`spec.snapshots`, `spec.symbol_resolve`, `spec.well_known_intrinsics`,
and `spec.diff`. The other 4 fall into two buckets:

| Excluded tool | Reason |
|---|---|
| `spec.history` | Shells out to `git log` against a vendored checkout; no FS or subprocess on Workers. |
| `test262.get` | Reads test sources from `vendor/test262/`; the full corpus isn't in R2 and Workers have no FS. |
| `spec.crossrefs`, `test262.search` | Pure functions over data the Worker already loads from R2; being brought to the Worker incrementally (everything else already shipped). |

### Performance baseline

Local `wrangler dev` runs (no real Cloudflare edge, no R2):

| Operation | Throughput | p50 | p95 | p99 |
|---|---|---|---|---|
| `initialize` (handshake only) | ~570 req/s | 4.8 ms | 22.7 ms | 40.5 ms |
| `tools/call spec.about` (no R2) | ~500 req/s | 6-8 ms | 25-35 ms | 45-60 ms |

Production figures will differ — the Cloudflare edge adds 5-15 ms
of network + the R2 round-trip on cold cache misses adds 10-30 ms.
But the per-isolate cache means a warmed-up isolate stays in the
sub-10 ms range for everything except the first hit per snapshot.

Reproduce via `node scripts/load-test.mjs`:

```sh
# Local wrangler dev baseline
node scripts/load-test.mjs --n 200 --c 10

# Hit a real tool (forces R2 reads)
node scripts/load-test.mjs --n 200 --c 10 --method tools/call --tool spec.about

# Stress test against a deployed Worker
node scripts/load-test.mjs --url https://<worker-url>/mcp --n 1000 --c 50
```

The script honors the rate limiter — denied requests are reported
separately from real errors.

### Observability

The Worker emits one structured JSON log line per `/mcp` request via
`console.log`. Cloudflare's Workers Logs dashboard captures these
automatically; `wrangler tail` streams them locally for live
debugging. Log shape:

```json
{
  "ts": "2026-05-30T18:00:00.000Z",
  "request_id": "9k2lf8x4n2rt",
  "method": "tools/call",
  "tool": "spec.about",
  "status": "ok",
  "duration_ms": 12,
  "client_ip": "203.0.113.42"
}
```

`status` values:

| Value | Meaning |
|---|---|
| `ok` | Successful dispatch (any tool, any method) |
| `error` | Tool handler returned a JSON-RPC error |
| `rate-limited` | Limiter denied the request (429 response) |
| `parse-error` | Request body wasn't valid JSON |

On error, the `error` field carries `{ code, message }`.

The same `request_id` is set on the `x-request-id` response header
(exposed via CORS), so a caller seeing a strange response can
correlate against the Worker logs:

```sh
curl -i -X POST https://<worker-url>/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
# < x-request-id: 9k2lf8x4n2rt

wrangler tail | grep '9k2lf8x4n2rt'
```

### Security shape

The Worker has no execution surface beyond reading R2 + computing
search rankings. It does not call out to user-supplied commands. It
does not write anything. The entire value proposition (deterministic
over pinned parsed data) breaks the moment the server can be
tricked into doing something else.

## Self-hosting a private copy

If you want this server inside your own infrastructure without
depending on the public hosted version, the simplest path is:

```sh
git clone https://github.com/xyzzylabs/tc39-mcp
cd tc39-mcp
npm install
npm run fetch-spec
npm run parse
npm run build
node dist/mcp/server.js     # stdio
```

…and wire it into your agents' MCP config however you normally would.
Refresh `vendor/` and re-parse on whatever cadence you need.

For your own hosted Worker, follow the "Setup" steps above against
your Cloudflare account.
