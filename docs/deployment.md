# Deployment

`tc39-mcp` runs in three shapes:

| Shape | Use case | Status |
|---|---|---|
| **Local stdio** | Wired into Claude Code via `.mcp.json` | ✅ shipped |
| **Local CLI / npm package** | `npx tc39-mcp` | ✅ shipped |
| **Hosted HTTP** (Cloudflare Worker) | Public endpoint for unaffiliated agents | ✅ shipped |

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

When you publish v0.1.0, the parsed JSON artifacts in `build/` are
**baked into the npm tarball** at the SHAs upstream had on publish
day. Until a new version is published, `npx tc39-mcp` always sees the
same SHAs.

`tc39-mcp` ships **two automatic refresh paths** so the deployed
state doesn't go stale:

1. **Scheduled npm republish** (`.github/workflows/refresh.yml`).
   Runs **every 4 hours**. Fetches upstream tc39/* mains, diffs SHAs
   against `.last-refresh.json`, and if any upstream changed, bumps
   PATCH + tags + publishes. Net effect: `npx tc39-mcp@latest`
   reflects upstream `main` within ~4 hours.

2. **R2 live updates + docs rebuild** (hosted Worker). The tag push
   from refresh.yml triggers `deploy-worker.yml`, which uploads new
   parsed JSONs to R2 *and* rebuilds the docs site (the `/snapshots`
   page is regenerated from those same JSONs) and redeploys the
   Worker. Hosted API and hosted docs always reflect the same SHAs.

Callers can check what they're looking at with the `spec.about`
tool. It returns per-snapshot `pin` metadata — `sha`, `fetched_at`,
`biblio_commit`, `clause_count`. The freshness contract is in-band.

## Hosted HTTP (Cloudflare Worker)

A minimal Worker lives in [`worker/`](https://github.com/xyzzylabs/tc39-mcp/tree/main/worker) that speaks MCP's
JSON-RPC over HTTP, reads parsed JSONs from a bound R2 bucket, and
ships **6 core tools** (`spec.about`, `clause.get`, `clause.list`,
`spec.search`, `proposal.list`, `proposal.get`). The bundled Worker
gzips to **~12 KB**.

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
refresh.yml runs every 4 hours
   diffs upstream SHAs vs .last-refresh.json
   bumps PATCH + tags vX.Y.Z+1 + pushes
        ↓
        tag push triggers (in parallel)
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
| `spec-262-es2025.json` | Mutable but stable (tagged release) | Live current state of a pinned edition |
| `spec-402-main.json` | Mutable | Live |
| `spec-402-main-{sha10}.json` | Immutable per-SHA | Historical |
| `test262-index.json` | Mutable | Live |
| `proposals-index.json` | Mutable | Live |

Storage cost is modest: 50 MB × 6 refreshes/day × 30 days ≈ 9 GB,
which at R2's $0.015/GB/month is ~$0.14/month even if no cleanup
runs. Cleanup (delete pins older than N days) is a v0.2 add — the
naming convention makes it trivial: `wrangler r2 object delete`
anything matching `spec-*-main-*.json` with `last-modified <
T-30d`.

Pinned editions (`es2025`, `es2025-candidate`) get no historical
copies — their live key already represents a single SHA forever.

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

### Atomic-ish deploys (v0.1)

R2 uploads happen in a deliberate order — historical pins + side
indices first, **live mains last** (`worker/scripts/upload-r2.ts`
+ `classify.ts`). A reader hitting the Worker mid-deploy either sees
the old live state or the new one, with a short window (2-5 s)
where they could see a new historical pin while the live mains are
still old. The previous "all uploads in parallel" model had a much
longer (60-90 s) inconsistency window. True manifest-swap atomicity
is a v0.2 add.

### Known limitations of the R2 update model (v0.1)

| Limitation | Impact | v0.2 fix |
|---|---|---|
| Full re-upload every deploy (~50 MB) | ~60-90 s deploy time; R2 egress cost | Compare local SHA vs R2 ETag; skip unchanged objects |
| Inconsistency window during upload (2-5 s) | Worker might briefly serve mixed-version data | Upload to versioned keys, swap a manifest atomically last |
| No Cache-Control headers on tool responses | Cloudflare CDN doesn't cache JSON-RPC POSTs | Switch to GET-cacheable HTTP variants of the read tools in v0.2 |
| No active purge of stale isolates | Stale isolates serve old R2 reads from in-memory cache for their lifetime | Cloudflare's isolate recycling handles it (minutes); acceptable for v0.1 |

These are optimizations, not correctness gaps. The current design is
correct end-to-end; v0.2 can make it faster and more atomic.

### Why only 6 tools in the hosted Worker (v0.1.0)?

The stdio server exposes 19 tools; the Worker ships 6. The other 13
fall into three buckets:

| Excluded tool | Reason |
|---|---|
| `spec.history` | Shells out to `git log` against a vendored checkout; no FS or subprocess on Workers. |
| `test262.get` | Reads files from `vendor/test262/`; Workers have no FS. |
| `spec.crossrefs`, `spec.sdo_index`, `spec.global_search`, `spec.symbol_resolve`, `spec.well_known_intrinsics`, `spec.tables`, `spec.grammar`, `clause.outline`, `spec.diff`, `spec.snapshots`, `test262.search` | Code-complete in the stdio server; v0.2 of the Worker will port them across (they're all pure functions over R2-backed data). |

The v0.1.0 Worker is **deliberately minimal** — it proves the
architecture, ships the highest-traffic tools, and leaves rich
expansion for v0.2 without blocking the initial release.

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

An `Authorization: Bearer tcms_…` header is supported but
**optional** — see "Sponsor lifecycle" below. It never gates
access to the tools (anonymous traffic gets all 19); it only
chooses which rate-limit bucket the request lands in.

## Sponsor lifecycle (maintainer guide)

The hosted Worker recognizes optional sponsor API keys (see
[`docs/sponsor.md`](sponsor.md) for the sponsor-side view). This
section is for the maintainer running the deployment — how to
provision the KV namespace and how to issue / revoke keys.

### One-time setup

```sh
# 1. Create the KV namespace. Cloudflare returns an id; paste it
#    into wrangler.toml's `[[kv_namespaces]]` block.
wrangler kv namespace create sponsors

# 2. Repeat for the preview namespace, then paste that into
#    `preview_id`.
wrangler kv namespace create sponsors --preview

# 3. Redeploy the Worker with the populated binding.
npm run deploy
```

That's all. The Worker now reads the SPONSORS namespace on every
request; anonymous traffic is unaffected because the binding is
optional in `worker/src/auth.ts`.

### Issuing a key for a new sponsor

```sh
npm run issue-sponsor-key -- --github=alice --amount=5
```

The script generates a random `tcms_…` key, hashes it with SHA-256,
and stores `(hash → { github_login, tier, since, amount_per_month_usd })`
in the SPONSORS KV namespace via `wrangler kv key put`. It prints
the raw key once to stdout. Copy that into the GitHub Sponsors
thank-you DM (or whatever channel the sponsor prefers). The key
cannot be recovered later — only the hash lives in KV.

Add `--dry-run` to see the wrangler invocation without writing to
KV.

### Revoking a key

By GitHub login (the common case):

```sh
npm run revoke-sponsor-key -- --github=alice --reason="canceled subscription"
```

By hash directly (if you have it from logs):

```sh
npm run revoke-sponsor-key -- --hash=14dde4001d75…
```

The next request carrying the revoked key falls through to the
anonymous path — `auth.ts` treats unknown hashes as anonymous,
returning the IP-bucketed rate limit. No 401 is ever surfaced
because nothing on the access path requires the key.

### Auditing who's sponsored

```sh
# List every active sponsor key (hash only — raw keys aren't stored).
wrangler kv key list --binding=SPONSORS --remote

# Show the metadata for one entry.
wrangler kv key get --binding=SPONSORS --remote <hash>
```

Combine with `wrangler tail` for live correlation:

```sh
wrangler tail --format pretty | jq 'select(.plan == "sponsor")'
```

Per-request log lines emit `plan` (`"free"` vs `"sponsor"`) and
`api_key_hash` (only for `sponsor`), so noisy traffic can be
pinpointed to a key without ever seeing the raw value.

### Notes on operational scale

- The KV's `get(key, "json")` call adds ~1 ms to a cold request.
  Warm isolates already cache nothing here — every request
  re-checks the KV — but cache could be added in front of the
  lookup if sponsor volume ever justifies it.
- The Cloudflare KV free tier covers 1 GB storage, 100 K reads/day,
  1 K writes/day. With each sponsor record at ~150 bytes, you can
  fit millions of sponsors in storage; the reads/day cap (100 K)
  is the actual ceiling on traffic from sponsor-using machines.
  Above that you'd want either Workers Paid or to memoize the
  lookup at the isolate level (a few lines of code).

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
