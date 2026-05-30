import { describe, it, expect, beforeEach } from "vitest";
import worker from "./index.js";
import { __resetCachesForTests } from "./r2.js";
import {
  createFakeR2,
  createFakeRateLimiter,
} from "./__fixtures__/fakeR2.js";

beforeEach(() => {
  __resetCachesForTests();
});

function postMcp(body: unknown): Request {
  return new Request("https://example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": "203.0.113.42",
    },
    body: JSON.stringify(body),
  });
}

describe("rate limiting", () => {
  it("falls open when the limiter binding isn't configured", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await worker.fetch(
      postMcp({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      env,
    );
    expect(r.status).toBe(200);
  });

  it("calls the limiter with the client IP", async () => {
    const limiter = createFakeRateLimiter();
    const env = {
      SPECS: createFakeR2(),
      RATE_LIMITER: limiter,
    };
    await worker.fetch(
      postMcp({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      env,
    );
    expect(limiter.__calls).toEqual(["203.0.113.42"]);
  });

  it("returns 429 with Retry-After when the limiter denies", async () => {
    const limiter = createFakeRateLimiter({ denyAll: true });
    const env = {
      SPECS: createFakeR2(),
      RATE_LIMITER: limiter,
    };
    const r = await worker.fetch(
      postMcp({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      env,
    );
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    const body = await r.json();
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32000 },
    });
  });

  it("uses 'unknown' as the key when CF-Connecting-IP is missing", async () => {
    const limiter = createFakeRateLimiter();
    const env = {
      SPECS: createFakeR2(),
      RATE_LIMITER: limiter,
    };
    const req = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    await worker.fetch(req, env);
    expect(limiter.__calls).toEqual(["unknown"]);
  });

  it("doesn't rate-limit /health (GET passthrough)", async () => {
    const limiter = createFakeRateLimiter({ denyAll: true });
    const env = {
      SPECS: createFakeR2(),
      RATE_LIMITER: limiter,
    };
    const req = new Request("https://example.com/health", { method: "GET" });
    const r = await worker.fetch(req, env);
    // Health stays accessible even under deny; the limiter only
    // applies to /mcp POSTs.
    expect(r.status).toBe(200);
    expect(limiter.__calls).toEqual([]);
  });
});
