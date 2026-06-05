// Cloudflare Worker entry point for the hosted MCP server.
//
// Speaks MCP's JSON-RPC over HTTP (POST /mcp). Each request is a
// single JSON-RPC envelope; we route `initialize`, `tools/list`, and
// `tools/call` to native handlers and dispatch tool calls into
// ./tools.ts.
//
// We don't use the official @modelcontextprotocol/sdk transport here
// because the SDK's `StreamableHTTPServerTransport` is designed for
// stateful Node-style sessions; on a stateless Worker, each request
// is its own session. A minimal handler is simpler and ~10 KB
// instead of ~400 KB of bundled SDK code.

import {
  clauseGet,
  clauseList,
  clauseOutline,
  proposalGet,
  proposalList,
  specAbout,
  specCrossrefs,
  specDiff,
  specGlobalSearch,
  specGrammar,
  specSdoIndex,
  specSearch,
  specSnapshots,
  specSymbolResolve,
  specTables,
  specWellKnownIntrinsics,
} from "./tools.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import type { R2Env } from "./r2.js";
import rootPkg from "../../package.json";

// Package version — bumped by the refresh workflow + baked into the
// bundle every `wrangler deploy` via the JSON import below (esbuild
// inlines it at build time). Reported via `spec.about` so callers
// know what version of tc39-mcp they're hitting.
const SERVER_VERSION = (rootPkg as { version?: string }).version ?? "unknown";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── tool registry ─────────────────────────────────────────────────

const TOOL_REGISTRY: {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (env: R2Env, args: Record<string, unknown>) => Promise<unknown>;
}[] = [
  {
    name: "spec.about",
    description:
      "Self-description of this MCP server: package name + version, per-snapshot pin metadata (sha, fetched_at, biblio_commit, clause_count) for every supported (spec, edition), plus test262 + proposals index headers when present.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (env) => specAbout(env, SERVER_VERSION),
  },
  {
    name: "clause.get",
    description:
      "Fetch a parsed TC39 clause as structured JSON. `spec` selects '262' (default) or '402'. `edition` defaults to 'latest'. `at: '<sha>'` pins to a historical main snapshot (only valid for edition='main'); omit to query the live snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        at: {
          type: "string",
          description:
            "Optional historical SHA pin (hex, 4-40 chars). Only valid when edition='main'; released editions have no per-SHA history to address.",
        },
      },
      required: ["id"],
    },
    handler: async (env, args) =>
      clauseGet(env, args as { id: string; spec?: string; edition?: string; at?: string }),
  },
  {
    name: "clause.list",
    description:
      "List parsed spec clauses with optional filters (kind, section prefix, has_algorithm). `spec` selects '262' or '402'. `at: '<sha>'` queries a historical main snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        at: { type: "string" },
        kind: { type: "string" },
        section: { type: "string" },
        has_algorithm: { type: "boolean" },
        limit: { type: "number" },
      },
    },
    handler: async (env, args) => clauseList(env, args),
  },
  {
    name: "spec.search",
    description:
      "Search the parsed spec by clause id / aoid / title (+ step text with `search_steps`). Aoid-exact ranks first. `at: '<sha>'` searches a historical main snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        at: { type: "string" },
        limit: { type: "number" },
        search_steps: { type: "boolean" },
      },
      required: ["query"],
    },
    handler: async (env, args) =>
      specSearch(env, args as { query: string; spec?: string; edition?: string; at?: string; limit?: number; search_steps?: boolean }),
  },
  {
    name: "proposal.list",
    description:
      "List TC39 proposals from the static index (tc39/proposals). Filter by spec ('262'|'402'), stage ('0'|'1'|'2'|'2.7'|'3'|'finished'|'inactive'|'active'), champion (substring), or contains (name/slug substring).",
    inputSchema: {
      type: "object",
      properties: {
        spec: { type: "string", enum: ["262", "402"] },
        stage: { type: "string" },
        champion: { type: "string" },
        contains: { type: "string" },
        limit: { type: "number" },
      },
    },
    handler: async (env, args) => proposalList(env, args),
  },
  {
    name: "proposal.get",
    description: "Fetch one TC39 proposal by slug (exact) or name (case-insensitive).",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    handler: async (env, args) => proposalGet(env, args as { name: string }),
  },
  {
    name: "spec.grammar",
    description:
      "Query grammar productions captured from the spec's `<emu-grammar>` blocks. `{ nonterminal }` returns every production for that non-terminal (exact match); `{ contains }` filters by RHS / name substring; neither lists all non-terminals + their production counts. `include_sdo` folds in SDO-attached productions (off by default).",
    inputSchema: {
      type: "object",
      properties: {
        nonterminal: { type: "string" },
        contains: { type: "string" },
        include_sdo: { type: "boolean" },
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        limit: { type: "number" },
      },
    },
    handler: async (env, args) =>
      specGrammar(
        env,
        args as {
          nonterminal?: string;
          contains?: string;
          include_sdo?: boolean;
          spec?: string;
          edition?: string;
          limit?: number;
        },
      ),
  },
  {
    name: "spec.tables",
    description:
      "List or fetch parsed `<emu-table>` content. `{ id }` returns exactly that table (full columns + rows); otherwise list table summaries, optionally narrowed by a `filter` substring over the caption or id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        filter: { type: "string" },
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        limit: { type: "number" },
      },
    },
    handler: async (env, args) =>
      specTables(
        env,
        args as {
          id?: string;
          filter?: string;
          spec?: string;
          edition?: string;
          limit?: number;
        },
      ),
  },
  {
    name: "spec.sdo_index",
    description:
      "Index Syntax-Directed Operations by the grammar production they're defined on. `by: 'production'` (default) groups SDOs under each production; `by: 'sdo'` groups productions under each SDO title. `filter` narrows to keys containing a substring (case-insensitive).",
    inputSchema: {
      type: "object",
      properties: {
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        by: { type: "string", enum: ["production", "sdo"] },
        filter: { type: "string" },
        limit: { type: "number" },
      },
    },
    handler: async (env, args) =>
      specSdoIndex(
        env,
        args as {
          by?: "production" | "sdo";
          filter?: string;
          spec?: string;
          edition?: string;
          limit?: number;
        },
      ),
  },
  {
    name: "clause.outline",
    description:
      "Return the section tree (table of contents) for a parsed (spec, edition). `depth` caps how deep the tree descends (1 = top-level only); `under` limits the tree to descendants of one clause id.",
    inputSchema: {
      type: "object",
      properties: {
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        depth: { type: "number" },
        under: { type: "string" },
      },
    },
    handler: async (env, args) =>
      clauseOutline(
        env,
        args as { spec?: string; edition?: string; depth?: number; under?: string },
      ),
  },
  {
    name: "spec.global_search",
    description:
      "Run spec.search across both ECMA-262 and ECMA-402 in one call and interleave hits by score. Each hit is tagged with the spec it came from. Use it when you don't know which spec defines a symbol. `search_steps` also matches algorithm step text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        search_steps: { type: "boolean" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    handler: async (env, args) =>
      specGlobalSearch(
        env,
        args as { query: string; search_steps?: boolean; limit?: number },
      ),
  },
  {
    name: "spec.snapshots",
    description:
      "List the live (spec, edition, sha, fetched_at) snapshots the hosted Worker is serving from R2. Filter by `spec` ('262'|'402') or `edition` (e.g. 'main', 'es2026'). Historical SHA-pinned copies are reachable via `at:` on clause.get / spec.search but aren't enumerated here.",
    inputSchema: {
      type: "object",
      properties: {
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
      },
    },
    handler: async (env, args) =>
      specSnapshots(env, args as { spec?: string; edition?: string }),
  },
  {
    name: "spec.symbol_resolve",
    description:
      "Resolve spec notation like `[[Prototype]]` (internal slot), `%Object.prototype%` (well-known intrinsic), or `~number~` (sigil enum): return clauses that mention or define it, ranked by occurrence with a bump for definition-y sections.",
    inputSchema: {
      type: "object",
      properties: {
        notation: { type: "string" },
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        limit: { type: "number" },
      },
      required: ["notation"],
    },
    handler: async (env, args) =>
      specSymbolResolve(
        env,
        args as { notation: string; spec?: string; edition?: string; limit?: number },
      ),
  },
  {
    name: "spec.well_known_intrinsics",
    description:
      "Enumerate the well-known intrinsics in a spec with their probable defining clauses. Driven from the canonical §6.1.7.4 WKI table when present (ECMA-262), else a `%X%` prose scan (e.g. ECMA-402). `filter` narrows by bare-name substring.",
    inputSchema: {
      type: "object",
      properties: {
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        filter: { type: "string" },
        limit: { type: "number" },
      },
    },
    handler: async (env, args) =>
      specWellKnownIntrinsics(
        env,
        args as { spec?: string; edition?: string; filter?: string; limit?: number },
      ),
  },
  {
    name: "spec.diff",
    description:
      "Clause-level diff of one clause across two editions of a spec. Reports identical / modified / added / removed plus a field-level breakdown (title, signature, step count, reworded step indices, notes, crossrefs). `from` defaults to the latest stable release, `to` to main.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        spec: { type: "string", enum: ["262", "402"] },
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (env, args) =>
      specDiff(env, args as { id: string; spec?: string; from?: string; to?: string }),
  },
  {
    name: "spec.crossrefs",
    description:
      "For a clause id, return its outgoing references (clauses it cites) and/or incoming references (clauses that cite it — the back-reference index the parse alone doesn't expose). The reverse index is AOID-densified from step text. `direction`: 'in' | 'out' | 'both' (default). Set `include_cross_spec: true` to also resolve outgoing references from ECMA-262 → ECMA-402 (or vice versa).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        spec: { type: "string", enum: ["262", "402"] },
        edition: { type: "string" },
        direction: { type: "string", enum: ["in", "out", "both"] },
        include_cross_spec: { type: "boolean" },
        limit: { type: "number" },
      },
      required: ["id"],
    },
    handler: async (env, args) =>
      specCrossrefs(
        env,
        args as {
          id: string;
          spec?: string;
          edition?: string;
          direction?: "in" | "out" | "both";
          include_cross_spec?: boolean;
          limit?: number;
        },
      ),
  },
];

// ─── JSON-RPC dispatcher ───────────────────────────────────────────

export async function dispatch(
  env: R2Env,
  req: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "tc39-mcp", version: SERVER_VERSION },
            instructions: SERVER_INSTRUCTIONS,
          },
        };
      case "notifications/initialized":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: TOOL_REGISTRY.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };
      case "tools/call": {
        const p = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const tool = TOOL_REGISTRY.find((t) => t.name === p.name);
        if (!tool) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `No such tool: ${p.name}` },
          };
        }
        const result = await tool.handler(env, p.arguments ?? {});
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        };
      }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

// ─── observability ────────────────────────────────────────────────

interface LogEntry {
  ts: string;
  request_id: string;
  method?: string;
  tool?: string;
  status: "ok" | "error" | "rate-limited" | "parse-error";
  duration_ms: number;
  client_ip?: string;
  error?: { code?: number; message?: string };
}

/** Emit a single-line JSON log entry. Cloudflare captures
 *  console.log output and surfaces it in the Workers Logs dashboard
 *  + `wrangler tail`. One line per request keeps the log shape
 *  grep-friendly. */
function emitLog(entry: LogEntry): void {
  // The console.log call IS the side effect we want — Cloudflare's
  // log capture hooks into it.
  console.log(JSON.stringify(entry));
}

/** Generate a short opaque request id. Cloudflare's `cf-ray` would
 *  do but is only set in production; this gives us a consistent
 *  field locally + in prod. 12 base36 chars = ~62 bits of entropy. */
function newRequestId(): string {
  let out = "";
  for (let i = 0; i < 2; i++) {
    out += Math.random().toString(36).slice(2, 8);
  }
  return out;
}

// ─── fetch handler ─────────────────────────────────────────────────

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id",
  // Exposes the trace id so callers can correlate with Worker logs.
  "access-control-expose-headers": "x-request-id",
};

// Allowlist for R2 artifacts the public /r2/ proxy will serve. Keeps
// the bucket itself non-browsable: arbitrary keys are 404'd, only the
// published snapshot + index shapes are reachable.
//
//   spec-<spec>-<edition>.json           live snapshot
//   spec-<spec>-<edition>-<sha10>.json   historical pin
//   test262-index.json
//   proposals-index.json
function isAllowedR2Key(key: string): boolean {
  if (key.includes("/") || key.includes("\\") || key.includes("..")) {
    return false;
  }
  if (key === "test262-index.json" || key === "proposals-index.json") {
    return true;
  }
  return /^spec-(262|402)-[a-z0-9-]+(-[a-f0-9]{10})?\.json$/.test(key);
}

/** Cache-Control header to attach to a /r2/<key> response. Historical
 *  per-SHA pins are immutable by construction; live `*-main.json` and
 *  `*-<edition>.json` can be overwritten by the next refresh, so cap
 *  their freshness window short. Mirrors the policy worker/src/r2.ts
 *  uses for the worker-internal edge cache. */
function r2CacheControl(key: string): string {
  return /-[a-f0-9]{10}\.json$/.test(key)
    ? "public, max-age=86400, immutable"
    : "public, max-age=300";
}

/** Whether an `If-None-Match` header value satisfies a 304 for `etag`.
 *  Handles the spec's `*`, comma-separated validator lists, and the `W/`
 *  weak prefix + surrounding quotes — the stdio loader canonicalizes
 *  etags and re-sends them unquoted, while standard HTTP clients send
 *  them quoted. */
function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const canon = (e: string) =>
    e.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
  return header.split(",").some((tag) => canon(tag) === canon(etag));
}

/** Handler for GET/HEAD /r2/<key>. Fetches the key from the bound R2
 *  bucket, applies the allowlist, returns the bytes with cache-control
 *  + CORS so stdio clients can read directly. */
async function serveR2Object(
  request: Request,
  url: URL,
  env: R2Env,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Use GET or HEAD for /r2/", {
      status: 405,
      headers: corsHeaders,
    });
  }
  const key = decodeURIComponent(url.pathname.slice("/r2/".length));
  if (!isAllowedR2Key(key)) {
    return new Response("Not allowed", { status: 404, headers: corsHeaders });
  }
  if (!env.SPECS) {
    return new Response("R2 binding not available", {
      status: 503,
      headers: corsHeaders,
    });
  }
  const obj = await env.SPECS.get(key);
  if (!obj) {
    return new Response("Not found", { status: 404, headers: corsHeaders });
  }
  // Honor conditional revalidation: the stdio loader re-checks live keys
  // with `If-None-Match` once past its freshness window. On a match,
  // return a bodyless 304 so a revalidation doesn't re-download the full
  // (tens-of-MB) snapshot.
  if (obj.etag && ifNoneMatchMatches(request.headers.get("if-none-match"), obj.etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        etag: `"${obj.etag}"`,
        "cache-control": r2CacheControl(key),
        ...corsHeaders,
      },
    });
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": r2CacheControl(key),
    ...corsHeaders,
  };
  if (obj.etag) headers.etag = `"${obj.etag}"`;
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}

export default {
  async fetch(
    request: Request,
    env: R2Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    // Expose the per-request ExecutionContext to the R2 loaders in
    // r2.ts so they can `ctx.waitUntil(cache.put(...))` after a cold
    // R2 read. Mutation is safe — Workers hands fetch() a fresh env
    // per request; nothing else aliases it. Optional because vitest
    // call sites construct fetch invocations without an ExecutionContext.
    if (ctx) env.executionContext = ctx;

    const url = new URL(request.url);

    // CORS preflight is only relevant to the JSON-RPC endpoint; static
    // asset OPTIONS requests pass through to the assets handler.
    if (request.method === "OPTIONS" && url.pathname === "/mcp") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Liveness probe used by deploy-worker.yml + uptime monitors.
    // Accepts both GET and HEAD — CDNs and several uptime monitors
    // (UptimeRobot, Better Stack) prefer HEAD for cheaper probes.
    if (
      url.pathname === "/health" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return new Response(request.method === "HEAD" ? null : "ok", {
        headers: corsHeaders,
      });
    }

    // GET /r2/<key> — serves a parsed snapshot artifact from R2 to
    // remote readers. The stdio package's fetch-on-first-use path
    // (v0.2.0+) reads from this endpoint instead of bundling every
    // snapshot in its tarball. Allowlisted to the artifact-naming
    // scheme so the bucket itself is not browsable.
    if (url.pathname.startsWith("/r2/")) {
      return serveR2Object(request, url, env);
    }

    // Anything that's not the MCP endpoint falls through to the
    // bundled docs site (Workers Assets). The Worker bundle ships
    // `docs/.vitepress/dist/` as static assets, so visiting the
    // bare origin renders the landing page and `/snapshots`,
    // `/tools`, etc. are routable.
    if (url.pathname !== "/mcp") {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      // No ASSETS binding in this environment (unit tests, local dev
      // without `wrangler dev`): respond with a small JSON identity so
      // a bare GET still tells the caller what they're talking to.
      return new Response(
        JSON.stringify(
          {
            name: "tc39-mcp",
            version: SERVER_VERSION,
            mcp_endpoint: `${url.origin}/mcp`,
            docs: "https://github.com/xyzzylabs/tc39-mcp",
          },
          null,
          2,
        ),
        {
          status: url.pathname === "/" ? 200 : 404,
          headers: { "content-type": "application/json", ...corsHeaders },
        },
      );
    }

    // /mcp — must be POST. Everything else is rejected up front so we
    // don't burn rate-limiter quota on bad-method requests.
    if (request.method !== "POST") {
      return new Response("Use POST /mcp for MCP protocol traffic.", {
        status: 405,
        headers: corsHeaders,
      });
    }

    const requestId = newRequestId();
    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const t0 = Date.now();

    // IP-bucketed rate limit: 30 req / 60 s per client IP. See
    // wrangler.toml's `[[unsafe.bindings]]` block for the cap.
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
      if (!success) {
        emitLog({
          ts: new Date().toISOString(),
          request_id: requestId,
          status: "rate-limited",
          duration_ms: Date.now() - t0,
          client_ip: clientIp,
        });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32000,
              message: "Rate limit exceeded. Try again in a minute.",
            },
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "60",
              "x-request-id": requestId,
              ...corsHeaders,
            },
          },
        );
      }
    }

    let body: JsonRpcRequest | JsonRpcRequest[];
    try {
      body = (await request.json()) as JsonRpcRequest | JsonRpcRequest[];
    } catch (e) {
      emitLog({
        ts: new Date().toISOString(),
        request_id: requestId,
        status: "parse-error",
        duration_ms: Date.now() - t0,
        client_ip: clientIp,
        error: { code: -32700, message: e instanceof Error ? e.message : String(e) },
      });
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error: " + (e instanceof Error ? e.message : String(e)),
          },
        },
        requestId,
      );
    }

    let response: unknown;
    let firstError: { code?: number; message?: string } | undefined;
    let firstMethod: string | undefined;
    let firstTool: string | undefined;
    if (Array.isArray(body)) {
      const responses = await Promise.all(body.map((r) => dispatch(env, r)));
      response = responses;
      const firstReq = body[0];
      firstMethod = firstReq?.method;
      if (firstReq?.method === "tools/call") {
        const p = firstReq.params as { name?: string } | undefined;
        firstTool = p?.name;
      }
      const firstErr = responses.find((r) => r.error)?.error;
      if (firstErr) firstError = firstErr;
    } else {
      const single = await dispatch(env, body);
      response = single;
      firstMethod = body.method;
      if (body.method === "tools/call") {
        const p = body.params as { name?: string } | undefined;
        firstTool = p?.name;
      }
      if (single.error) firstError = single.error;
    }

    emitLog({
      ts: new Date().toISOString(),
      request_id: requestId,
      ...(firstMethod ? { method: firstMethod } : {}),
      ...(firstTool ? { tool: firstTool } : {}),
      status: firstError ? "error" : "ok",
      duration_ms: Date.now() - t0,
      client_ip: clientIp,
      ...(firstError ? { error: firstError } : {}),
    });

    return jsonResponse(response, requestId);
  },
};

function jsonResponse(payload: unknown, requestId?: string): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
      ...(requestId ? { "x-request-id": requestId } : {}),
      ...corsHeaders,
    },
  });
}
