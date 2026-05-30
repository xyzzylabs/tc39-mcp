import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker from "./index.js";
import { __resetCachesForTests } from "./r2.js";
import { createFakeR2 } from "./__fixtures__/fakeR2.js";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetCachesForTests();
  // The Worker emits structured logs via console.log. Capture them
  // for assertion; pass-through to stdout is suppressed.
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

function postMcp(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": "198.51.100.7",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function lastLogEntry(): Record<string, unknown> {
  const calls = logSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const raw = calls[calls.length - 1]![0] as string;
  return JSON.parse(raw);
}

describe("Worker structured logging", () => {
  it("emits one log line per /mcp request", async () => {
    const env = { SPECS: createFakeR2() };
    await worker.fetch(
      postMcp({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      env,
    );
    const log = lastLogEntry();
    expect(log.request_id).toMatch(/^[a-z0-9]+$/);
    expect(log.method).toBe("initialize");
    expect(log.status).toBe("ok");
    expect(typeof log.duration_ms).toBe("number");
    expect(log.client_ip).toBe("198.51.100.7");
    expect(typeof log.ts).toBe("string");
  });

  it("captures the tool name on tools/call", async () => {
    const env = { SPECS: createFakeR2() };
    await worker.fetch(
      postMcp({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "spec.about", arguments: {} },
      }),
      env,
    );
    const log = lastLogEntry();
    expect(log.method).toBe("tools/call");
    expect(log.tool).toBe("spec.about");
  });

  it("logs status='error' + the error object on dispatcher errors", async () => {
    const env = { SPECS: createFakeR2() };
    await worker.fetch(
      postMcp({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "no.such.tool", arguments: {} },
      }),
      env,
    );
    const log = lastLogEntry();
    expect(log.status).toBe("error");
    expect((log.error as { code?: number }).code).toBe(-32601);
  });

  it("logs status='parse-error' when JSON parsing fails", async () => {
    const env = { SPECS: createFakeR2() };
    const req = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not valid json",
    });
    await worker.fetch(req, env);
    const log = lastLogEntry();
    expect(log.status).toBe("parse-error");
  });

  it("attaches an x-request-id response header", async () => {
    const env = { SPECS: createFakeR2() };
    const r = await worker.fetch(
      postMcp({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      env,
    );
    const rid = r.headers.get("x-request-id");
    expect(rid).not.toBeNull();
    expect(rid).toMatch(/^[a-z0-9]+$/);
    const log = lastLogEntry();
    expect(rid).toBe(log.request_id);
  });
});
