import { describe, it, expect, afterEach } from "vitest";
import { fetchSnapshot, resolveBaseUrl } from "./fetcher.js";

/** Build a fake fetch implementation that returns a scripted Response.
 *  Null-body statuses (304 etc.) get a null body because the Response
 *  constructor refuses anything else for those. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
function scriptedFetch(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): typeof fetch {
  return async () =>
    new Response(NULL_BODY_STATUSES.has(status) ? null : body, {
      status,
      headers,
    });
}

/** Build a fake fetch implementation that throws (network error). */
function throwingFetch(message = "network down"): typeof fetch {
  return async () => {
    throw new Error(message);
  };
}

describe("resolveBaseUrl", () => {
  const original = process.env.TC39_MCP_BASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.TC39_MCP_BASE_URL;
    else process.env.TC39_MCP_BASE_URL = original;
  });

  it("returns the canonical hosted URL when nothing is set", () => {
    delete process.env.TC39_MCP_BASE_URL;
    expect(resolveBaseUrl()).toBe("https://mcp.xyzzylabs.ai/tc39");
  });

  it("honors TC39_MCP_BASE_URL env var", () => {
    process.env.TC39_MCP_BASE_URL = "https://staging.example.com";
    expect(resolveBaseUrl()).toBe("https://staging.example.com");
  });

  it("strips trailing slashes from the override", () => {
    expect(resolveBaseUrl("https://staging.example.com/")).toBe(
      "https://staging.example.com",
    );
    expect(resolveBaseUrl("https://staging.example.com///")).toBe(
      "https://staging.example.com",
    );
  });

  it("explicit arg wins over env var", () => {
    process.env.TC39_MCP_BASE_URL = "https://env.example.com";
    expect(resolveBaseUrl("https://arg.example.com")).toBe(
      "https://arg.example.com",
    );
  });
});

describe("fetchSnapshot — successful 200", () => {
  it("returns ok with the body + a pointer including the etag", async () => {
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: scriptedFetch(200, '{"pin":{"sha":"abc"}}', { etag: '"e123"' }),
      nowMs: () => 1_700_000_000_000,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.snapshot.body).toBe('{"pin":{"sha":"abc"}}');
    expect(result.snapshot.pointer).toEqual({
      key: "spec-262-main.json",
      etag: "e123",
      resolved_at: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("strips the W/ weak-validator prefix from the ETag", async () => {
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: scriptedFetch(200, "{}", { etag: 'W/"abc"' }),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.snapshot.pointer.etag).toBe("abc");
  });

  it("returns empty etag when the server omits the header", async () => {
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: scriptedFetch(200, "{}", {}),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.snapshot.pointer.etag).toBe("");
  });
});

describe("fetchSnapshot — 304 Not Modified", () => {
  it("returns not-modified with the server's etag preferred", async () => {
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: scriptedFetch(304, "", { etag: '"server-etag"' }),
      ifNoneMatch: "client-etag",
      nowMs: () => 1_700_000_000_000,
    });
    expect(result.kind).toBe("not-modified");
    if (result.kind !== "not-modified") return;
    expect(result.etag).toBe("server-etag");
    expect(result.nowIso).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("falls back to the request's ifNoneMatch when server omits etag", async () => {
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: scriptedFetch(304, ""),
      ifNoneMatch: "client-etag",
    });
    if (result.kind !== "not-modified") throw new Error("expected not-modified");
    expect(result.etag).toBe("client-etag");
  });
});

describe("fetchSnapshot — failure modes", () => {
  it("returns not-found on 404", async () => {
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: scriptedFetch(404, "Not found"),
    });
    expect(result.kind).toBe("not-found");
  });

  it("returns unavailable for 5xx", async () => {
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: scriptedFetch(503, "down"),
    });
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") return;
    expect(result.reason).toContain("503");
  });

  it("returns unavailable when fetch throws (DNS / TCP error)", async () => {
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: throwingFetch("ENOTFOUND"),
    });
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") return;
    expect(result.reason).toBe("ENOTFOUND");
  });

  it("aborts on timeout and returns unavailable", async () => {
    const slowFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const result = await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: slowFetch,
      timeoutMs: 1,
    });
    expect(result.kind).toBe("unavailable");
  });
});

describe("fetchSnapshot — URL construction", () => {
  it("URL-encodes the key (defense in depth even though allowlist forbids slashes)", async () => {
    let observedUrl = "";
    const fakeFetch: typeof fetch = async (url) => {
      observedUrl = url.toString();
      return new Response("{}", { status: 200 });
    };
    await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: fakeFetch,
    });
    expect(observedUrl).toBe("https://example.com/r2/spec-262-main.json");
  });

  it("sends If-None-Match when ifNoneMatch is provided", async () => {
    let observed: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (_url, init) => {
      observed = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response("{}", { status: 200 });
    };
    await fetchSnapshot("spec-262-main.json", {
      baseUrl: "https://example.com",
      fetchImpl: fakeFetch,
      ifNoneMatch: "abc123",
    });
    expect(observed["if-none-match"]).toBe("abc123");
  });
});
