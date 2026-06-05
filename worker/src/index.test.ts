import { describe, it, expect, beforeEach } from "vitest";
import { dispatch, type JsonRpcRequest } from "./index.js";
import { __resetCachesForTests } from "./r2.js";
import {
  createFakeR2,
  fakeProposalsIndexJson,
  fakeSpecJson,
} from "./__fixtures__/fakeR2.js";

beforeEach(() => {
  __resetCachesForTests();
});

function rpc(method: string, params?: unknown, id: number | string | null = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
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

  it("advertises tools capability", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("initialize"));
    const result = r.result as { capabilities: { tools: unknown } };
    expect(result.capabilities.tools).toBeDefined();
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

// ─── tools/list ────────────────────────────────────────────────────

describe("dispatch — tools/list", () => {
  it("returns 14 tools", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("tools/list"));
    const result = r.result as { tools: { name: string }[] };
    expect(result.tools.length).toBe(14);
  });

  it("includes the expected tool names", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await dispatch(env, rpc("tools/list"));
    const result = r.result as { tools: { name: string }[] };
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "clause.get",
      "clause.list",
      "clause.outline",
      "proposal.get",
      "proposal.list",
      "spec.about",
      "spec.global_search",
      "spec.grammar",
      "spec.sdo_index",
      "spec.search",
      "spec.snapshots",
      "spec.symbol_resolve",
      "spec.tables",
      "spec.well_known_intrinsics",
    ]);
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
