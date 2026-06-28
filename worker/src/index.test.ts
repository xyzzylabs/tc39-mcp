import { describe, it, expect, beforeEach } from "vitest";
import { dispatch, type JsonRpcRequest } from "./index.js";
import { __resetCachesForTests } from "./r2.js";
import {
  createFakeR2,
  fakeProposalsIndexJson,
  fakeSpecJson,
} from "./__fixtures__/fakeR2.js";
import { HOSTED_TOOLS } from "../../src/spec/tool_inventory.js";

beforeEach(() => {
  __resetCachesForTests();
});

function rpc(method: string, params?: unknown, id: number | string | null = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

/** Minimal App HTML stubs — enough for resources/read assertions without
 *  pulling Node fs into the Worker test tsconfig. Production serves the
 *  real files from `worker/public/apps/` via the ASSETS binding. */
const STUB_APP_HTML: Record<string, string> = {
  "clause-viewer.html":
    "<!DOCTYPE html><html><head><title>TC39 Clause Viewer</title></head>" +
    "<body><script>/* ui/initialize */</script></body></html>",
  "diff-viewer.html":
    "<!DOCTYPE html><html><head><title>TC39 Edition Diff Viewer</title></head>" +
    "<body><script>/* ui/initialize */</script></body></html>",
};

/** ASSETS stub that serves `/apps/<file>` like the deployed Worker. */
function createAppAssets() {
  return {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      const m = /^\/apps\/([^/]+\.html)$/.exec(path);
      if (!m) return new Response("not found", { status: 404 });
      const html = STUB_APP_HTML[m[1]!];
      if (!html) return new Response("not found", { status: 404 });
      return new Response(html, { headers: { "content-type": "text/html" } });
    },
  };
}

// ─── initialize / handshake ────────────────────────────────────────

describe("dispatch — initialize", () => {
  it("returns protocolVersion 2024-11-05", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("initialize"));
    expect(r.error).toBeUndefined();
    const result = r.result as { protocolVersion: string };
    expect(result.protocolVersion).toBe("2024-11-05");
  });

  it("advertises tools + resources capabilities", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("initialize"));
    const result = r.result as {
      capabilities: { tools: unknown; resources: unknown };
    };
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.resources).toBeDefined();
  });

  it("returns serverInfo with the name 'tc39-mcp'", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("initialize"));
    const result = r.result as { serverInfo: { name: string; version: string } };
    expect(result.serverInfo.name).toBe("tc39-mcp");
    expect(typeof result.serverInfo.version).toBe("string");
  });

  it("returns instructions string in initialize result", async () => {
    // Agents see this via clients that forward `instructions` into
    // their system prompt. It tells them the workflow and edition
    // semantics without needing to read tool descriptions one at a time.
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("initialize"));
    const result = r.result as { instructions?: string };
    expect(typeof result.instructions).toBe("string");
    expect(result.instructions!.length).toBeGreaterThan(100);
    // Spot-check that the instructions actually describe the server.
    expect(result.instructions!).toMatch(/tc39-mcp/);
    expect(result.instructions!.toLowerCase()).toMatch(/spec.about|workflow|edition/);
  });

  it("handles notifications/initialized as a no-op", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("notifications/initialized"));
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual({});
  });
});

// ─── resources (MCP Apps) ──────────────────────────────────────────

describe("dispatch — resources", () => {
  it("lists clause + diff viewer ui:// resources", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("resources/list"));
    const result = r.result as { resources: { uri: string; mimeType: string }[] };
    expect(result.resources.length).toBe(2);
    const uris = result.resources.map((x) => x.uri).sort();
    expect(uris).toEqual([
      "ui://tc39-mcp/clause-viewer.html",
      "ui://tc39-mcp/diff-viewer.html",
    ]);
    for (const res of result.resources) {
      expect(res.mimeType).toBe("text/html;profile=mcp-app");
    }
  });

  it("reads clause-viewer HTML via ASSETS /apps/", async () => {
    const env = { SPECS: createFakeR2(), ASSETS: createAppAssets() };
    const r = await dispatch(
      env,
      rpc("resources/read", { uri: "ui://tc39-mcp/clause-viewer.html" }),
    );
    expect(r.error).toBeUndefined();
    const result = r.result as { contents: { text: string; mimeType: string }[] };
    expect(result.contents[0]!.mimeType).toBe("text/html;profile=mcp-app");
    expect(result.contents[0]!.text).toContain("TC39 Clause Viewer");
    expect(result.contents[0]!.text).toContain("ui/initialize");
  });

  it("reads diff-viewer HTML via ASSETS /apps/", async () => {
    const env = { SPECS: createFakeR2(), ASSETS: createAppAssets() };
    const r = await dispatch(
      env,
      rpc("resources/read", { uri: "ui://tc39-mcp/diff-viewer.html" }),
    );
    expect(r.error).toBeUndefined();
    const result = r.result as { contents: { text: string }[] };
    expect(result.contents[0]!.text).toContain("TC39 Edition Diff Viewer");
  });

  it("errors when ASSETS is missing for a known app uri", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(
      env,
      rpc("resources/read", { uri: "ui://tc39-mcp/clause-viewer.html" }),
    );
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toMatch(/ASSETS|unavailable/i);
  });

  it("errors on unknown resource uri", async () => {
    const env = { SPECS: createFakeR2(), ASSETS: createAppAssets() };
    const r = await dispatch(env, rpc("resources/read", { uri: "ui://nope" }));
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toMatch(/Unknown resource/);
  });
});

// ─── tools/list ────────────────────────────────────────────────────

describe("dispatch — tools/list", () => {
  it("attaches MCP App _meta on clause.get and spec.diff", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("tools/list"));
    const result = r.result as {
      tools: { name: string; _meta?: { ui?: { resourceUri?: string } } }[];
    };
    const clause = result.tools.find((t) => t.name === "clause.get");
    const diff = result.tools.find((t) => t.name === "spec.diff");
    expect(clause?._meta?.ui?.resourceUri).toBe("ui://tc39-mcp/clause-viewer.html");
    expect(diff?._meta?.ui?.resourceUri).toBe("ui://tc39-mcp/diff-viewer.html");
  });

  it("registers exactly the hosted-tool inventory count", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("tools/list"));
    const result = r.result as { tools: { name: string }[] };
    expect(result.tools.length).toBe(HOSTED_TOOLS.length);
  });

  it("registers exactly the hosted-tool inventory names", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("tools/list"));
    const result = r.result as { tools: { name: string }[] };
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([...HOSTED_TOOLS].sort());
  });

  it("every tool has a description + inputSchema", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("tools/list"));
    const result = r.result as { tools: { description: string; inputSchema: unknown }[] };
    for (const t of result.tools) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeDefined();
    }
  });
});

// ─── tools/call routing ────────────────────────────────────────────

describe("dispatch — tools/call routing", () => {
  it("routes spec.about to its handler", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("tools/call", { name: "spec.about", arguments: {} }));
    expect(r.error).toBeUndefined();
    const result = r.result as { content: { type: string; text: string }[] };
    expect(result.content[0]!.type).toBe("text");
    const inner = JSON.parse(result.content[0]!.text) as { server: { name: string } };
    expect(inner.server.name).toBe("tc39-mcp");
  });

  it("routes clause.get to its handler", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({
            spec: "262",
            edition: "es2026",
            clauses: { "sec-tonumber": { id: "sec-tonumber", aoid: "ToNumber" } },
          }),
        },
      }),
    };
    const r = await dispatch(env, rpc("tools/call", {
      name: "clause.get",
      arguments: { id: "sec-tonumber" },
    }));
    expect(r.error).toBeUndefined();
    const result = r.result as { content: { text: string }[] };
    const inner = JSON.parse(result.content[0]!.text) as { meta: { aoid: string } };
    expect(inner.meta.aoid).toBe("ToNumber");
  });

  it("routes proposal.list to its handler", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "x",
            proposals: [{ slug: "a", name: "A", stage: "3" }],
          }),
        },
      }),
    };
    const r = await dispatch(env, rpc("tools/call", {
      name: "proposal.list",
      arguments: { stage: "3" },
    }));
    expect(r.error).toBeUndefined();
    const result = r.result as { content: { text: string }[] };
    const inner = JSON.parse(result.content[0]!.text) as { total: number };
    expect(inner.total).toBe(1);
  });

  it("returns -32601 for unknown tool name", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("tools/call", { name: "no.such.tool", arguments: {} }));
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe(-32601);
    expect(r.error!.message).toContain("No such tool");
  });

  it("returns -32603 when the handler throws", async () => {
    const env = { SPECS: createFakeR2() };
    // clause.get throws for unsupported (spec, edition); es2015 is below
    // the catalog floor (es2016).
    const r = await dispatch(env, rpc("tools/call", {
      name: "clause.get",
      arguments: { id: "sec-x", spec: "402", edition: "es2015" },
    }));
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe(-32603);
    expect(r.error!.message).toMatch(/Unsupported/);
  });
});

// ─── method-not-found + id propagation ─────────────────────────────

describe("dispatch — method handling", () => {
  it("returns -32601 for unknown methods", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("no.such.method"));
    expect(r.error).toBeDefined();
    expect(r.error!.code).toBe(-32601);
    expect(r.error!.message).toContain("Method not found");
  });

  it("propagates the request id back on success", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("initialize", undefined, 42));
    expect(r.id).toBe(42);
  });

  it("propagates the request id back on error", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("no.such.method", undefined, "abc"));
    expect(r.id).toBe("abc");
  });

  it("returns id:null when request has no id (notification)", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, { jsonrpc: "2.0", method: "initialize" });
    expect(r.id).toBeNull();
  });

  it("returns jsonrpc:'2.0' on every response", async () => {
    const env = { SPECS: createFakeR2() };
    const ok = await dispatch(env, rpc("initialize"));
    const err = await dispatch(env, rpc("no.such.method"));
    expect(ok.jsonrpc).toBe("2.0");
    expect(err.jsonrpc).toBe("2.0");
  });
});
