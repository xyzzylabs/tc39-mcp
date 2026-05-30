// Tests for the fetch() handler's routing: which paths/methods go to
// /mcp JSON-RPC, which to /health, which fall through to the bundled
// Workers Assets binding for the docs site.
//
// The MCP semantics themselves are covered by index.test.ts (testing
// dispatch() directly) and ratelimit.test.ts. This file isolates the
// routing layer so a future change to `[assets]` config or path
// dispatch can't silently break the docs site.

import { describe, it, expect, beforeEach } from "vitest";
import worker from "./index.js";
import { __resetCachesForTests } from "./r2.js";
import { createFakeR2 } from "./__fixtures__/fakeR2.js";

beforeEach(() => {
  __resetCachesForTests();
});

/** Construct a fake ASSETS binding that records every URL it sees and
 *  returns a stub HTML body. Lets us assert "the asset handler was
 *  called for path X" without spinning up a real Worker. */
function createFakeAssets(): {
  fetch: (request: Request) => Promise<Response>;
  __calls: string[];
} {
  const calls: string[] = [];
  return {
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}`);
      return new Response(`<html><title>docs</title>${url.pathname}</html>`, {
        headers: { "content-type": "text/html" },
      });
    },
    get __calls() {
      return calls;
    },
  };
}

describe("routing", () => {
  describe("/health", () => {
    it("GET /health returns 200 + body 'ok'", async () => {
      const env = { SPECS: createFakeR2() };
      const r = await worker.fetch(
        new Request("https://example.com/health"),
        env,
      );
      expect(r.status).toBe(200);
      expect(await r.text()).toBe("ok");
    });

    it("HEAD /health returns 200 with no body (for uptime monitors)", async () => {
      const env = { SPECS: createFakeR2() };
      const r = await worker.fetch(
        new Request("https://example.com/health", { method: "HEAD" }),
        env,
      );
      expect(r.status).toBe(200);
      expect(await r.text()).toBe("");
    });

    it("does not delegate /health to ASSETS even when bound", async () => {
      const assets = createFakeAssets();
      const env = { SPECS: createFakeR2(), ASSETS: assets };
      await worker.fetch(new Request("https://example.com/health"), env);
      await worker.fetch(
        new Request("https://example.com/health", { method: "HEAD" }),
        env,
      );
      expect(assets.__calls).toEqual([]);
    });
  });

  describe("/mcp", () => {
    it("OPTIONS /mcp returns 204 with CORS preflight headers", async () => {
      const env = { SPECS: createFakeR2() };
      const r = await worker.fetch(
        new Request("https://example.com/mcp", { method: "OPTIONS" }),
        env,
      );
      expect(r.status).toBe(204);
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
      expect(r.headers.get("access-control-expose-headers")).toContain(
        "x-request-id",
      );
    });

    it("GET /mcp is rejected with 405", async () => {
      const env = { SPECS: createFakeR2() };
      const r = await worker.fetch(
        new Request("https://example.com/mcp"),
        env,
      );
      expect(r.status).toBe(405);
    });

    it("POST /mcp dispatches to JSON-RPC (does not fall through to ASSETS)", async () => {
      const assets = createFakeAssets();
      const env = { SPECS: createFakeR2(), ASSETS: assets };
      const r = await worker.fetch(
        new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        }),
        env,
      );
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("application/json");
      expect(assets.__calls).toEqual([]);
    });

    it("DELETE/PUT/PATCH /mcp are rejected with 405 (no rate-limiter burn)", async () => {
      const env = { SPECS: createFakeR2() };
      for (const method of ["DELETE", "PUT", "PATCH"]) {
        const r = await worker.fetch(
          new Request("https://example.com/mcp", { method }),
          env,
        );
        expect(r.status, `${method} /mcp`).toBe(405);
      }
    });

    it("GET /mcp/anything (sub-path) is treated as not-/mcp and falls through to ASSETS", async () => {
      // /mcp itself is the JSON-RPC endpoint; sub-paths like /mcp/foo
      // shouldn't be routed to the dispatcher.
      const assets = createFakeAssets();
      const env = { SPECS: createFakeR2(), ASSETS: assets };
      const r = await worker.fetch(
        new Request("https://example.com/mcp/something"),
        env,
      );
      expect(r.status).toBe(200); // ASSETS stub returns 200
      expect(assets.__calls).toEqual(["GET /mcp/something"]);
    });
  });

  describe("assets fallthrough", () => {
    it("GET / delegates to ASSETS when the binding is present", async () => {
      const assets = createFakeAssets();
      const env = { SPECS: createFakeR2(), ASSETS: assets };
      const r = await worker.fetch(new Request("https://example.com/"), env);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/html");
      expect(assets.__calls).toEqual(["GET /"]);
    });

    it("GET /snapshots delegates to ASSETS", async () => {
      const assets = createFakeAssets();
      const env = { SPECS: createFakeR2(), ASSETS: assets };
      const r = await worker.fetch(
        new Request("https://example.com/snapshots"),
        env,
      );
      expect(r.status).toBe(200);
      expect(assets.__calls).toEqual(["GET /snapshots"]);
    });

    it("OPTIONS / (non-/mcp) delegates to ASSETS rather than returning CORS preflight", async () => {
      const assets = createFakeAssets();
      const env = { SPECS: createFakeR2(), ASSETS: assets };
      await worker.fetch(
        new Request("https://example.com/", { method: "OPTIONS" }),
        env,
      );
      expect(assets.__calls).toEqual(["OPTIONS /"]);
    });

    it("falls back to JSON identity when ASSETS is unbound (local dev / tests)", async () => {
      const env = { SPECS: createFakeR2() };
      const r = await worker.fetch(new Request("https://example.com/"), env);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("application/json");
      const body = await r.json();
      expect(body).toMatchObject({
        name: "tc39-mcp",
        mcp_endpoint: expect.stringContaining("/mcp"),
      });
    });

    it("returns 404 JSON identity for unknown paths when ASSETS is unbound", async () => {
      const env = { SPECS: createFakeR2() };
      const r = await worker.fetch(
        new Request("https://example.com/no-such-page"),
        env,
      );
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("application/json");
    });

    it("POST to a non-/mcp path falls through to ASSETS (caller's mistake, not ours)", async () => {
      const assets = createFakeAssets();
      const env = { SPECS: createFakeR2(), ASSETS: assets };
      await worker.fetch(
        new Request("https://example.com/some-page", {
          method: "POST",
          body: "irrelevant",
        }),
        env,
      );
      expect(assets.__calls).toEqual(["POST /some-page"]);
    });

    it("propagates ASSETS response status (e.g. 404 from VitePress 404.html)", async () => {
      const env = {
        SPECS: createFakeR2(),
        ASSETS: {
          fetch: async () =>
            new Response("<html>not found</html>", {
              status: 404,
              headers: { "content-type": "text/html" },
            }),
        },
      };
      const r = await worker.fetch(
        new Request("https://example.com/no-such-page"),
        env,
      );
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("text/html");
    });
  });
});
