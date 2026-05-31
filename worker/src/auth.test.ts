import { describe, it, expect, beforeEach } from "vitest";
import { authenticate, sha256hex, type SponsorMetadata } from "./auth.js";
import { asFakeKV, createFakeKV } from "./__fixtures__/fakeKV.js";

// One real sponsor key + its sha256, computed once per test and
// reused so the per-test setup stays focused on the assertion under
// test.
const SAMPLE_KEY = "tcms_5kKpL3qZ4j_-Wa1xPwQrTs6Yc8nVbHmEdFGh1JkLmNoPqRs";
let SAMPLE_HASH: string;

beforeEach(async () => {
  SAMPLE_HASH = await sha256hex(SAMPLE_KEY);
});

function bearerRequest(token?: string): Request {
  return new Request("https://tc39-mcp.workers.dev/mcp", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: "{}",
  });
}

describe("authenticate", () => {
  it("returns free + IP bucketing when no Authorization header is present", async () => {
    const env = { SPONSORS: createFakeKV() };
    const result = await authenticate(bearerRequest(undefined), env, "1.2.3.4");
    expect(result.plan).toBe("free");
    expect(result.rateLimitKey).toBe("1.2.3.4");
    expect(result.apiKeyHash).toBeUndefined();
  });

  it("returns free when the Authorization scheme isn't Bearer", async () => {
    const env = { SPONSORS: createFakeKV() };
    const req = new Request("https://tc39-mcp.workers.dev/mcp", {
      method: "POST",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
      body: "{}",
    });
    const result = await authenticate(req, env, "1.2.3.4");
    expect(result.plan).toBe("free");
    expect(result.rateLimitKey).toBe("1.2.3.4");
  });

  it("returns free when the Bearer token doesn't match the tcms_ prefix", async () => {
    const env = { SPONSORS: createFakeKV() };
    const result = await authenticate(
      bearerRequest("sk_live_XYZ123abcdefghij"),
      env,
      "1.2.3.4",
    );
    expect(result.plan).toBe("free");
  });

  it("returns free when the SPONSORS binding is missing", async () => {
    // Local `wrangler dev` and unit-test envs without KV provisioned
    // must not block traffic — this verifies the binding-absent
    // graceful-degradation path.
    const env = {};
    const result = await authenticate(bearerRequest(SAMPLE_KEY), env, "1.2.3.4");
    expect(result.plan).toBe("free");
    expect(result.rateLimitKey).toBe("1.2.3.4");
  });

  it("returns free when the key has the right shape but isn't in KV", async () => {
    // Right shape + no matching record = traffic still flows at the
    // anonymous rate. The sponsor is none-the-wiser that their key
    // expired / was revoked; their client just runs into the IP cap.
    const env = { SPONSORS: createFakeKV() };
    const result = await authenticate(bearerRequest(SAMPLE_KEY), env, "1.2.3.4");
    expect(result.plan).toBe("free");
  });

  it("returns sponsor + per-key bucketing on a recognized key", async () => {
    const meta: SponsorMetadata = {
      github_login: "alice",
      tier: "sponsor",
      since: "2026-05-31",
      amount_per_month_usd: 5,
    };
    const env = { SPONSORS: createFakeKV({ entries: { [SAMPLE_HASH]: meta } }) };
    const result = await authenticate(bearerRequest(SAMPLE_KEY), env, "1.2.3.4");
    expect(result.plan).toBe("sponsor");
    expect(result.rateLimitKey).toBe(`sponsor:${SAMPLE_HASH}`);
    expect(result.apiKeyHash).toBe(SAMPLE_HASH);
    expect(result.sponsor).toEqual(meta);
  });

  it("falls back to free on a transient KV outage (kv.get throws)", async () => {
    const env = {
      SPONSORS: createFakeKV({
        entries: {
          [SAMPLE_HASH]: { github_login: "alice", tier: "sponsor", since: "2026-05-31" },
        },
        throwOnGet: new Error("KV unreachable"),
      }),
    };
    const result = await authenticate(bearerRequest(SAMPLE_KEY), env, "1.2.3.4");
    expect(result.plan).toBe("free");
    expect(result.rateLimitKey).toBe("1.2.3.4");
  });

  it("never echoes the raw key — only the hash is returned", async () => {
    const env = {
      SPONSORS: createFakeKV({
        entries: {
          [SAMPLE_HASH]: { github_login: "alice", tier: "sponsor", since: "2026-05-31" },
        },
      }),
    };
    const result = await authenticate(bearerRequest(SAMPLE_KEY), env, "1.2.3.4");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SAMPLE_KEY);
    expect(result.apiKeyHash).toBeTruthy();
  });

  it("hashes the key only once per request (KV lookup uses the hash)", async () => {
    const env = {
      SPONSORS: createFakeKV({
        entries: {
          [SAMPLE_HASH]: { github_login: "alice", tier: "sponsor", since: "2026-05-31" },
        },
      }),
    };
    await authenticate(bearerRequest(SAMPLE_KEY), env, "1.2.3.4");
    expect(asFakeKV(env.SPONSORS).__get_count(SAMPLE_HASH)).toBe(1);
  });
});

describe("sha256hex", () => {
  it("returns the canonical SHA-256 of the empty string", async () => {
    expect(await sha256hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic — same input always yields the same hash", async () => {
    const a = await sha256hex(SAMPLE_KEY);
    const b = await sha256hex(SAMPLE_KEY);
    expect(a).toBe(b);
  });

  it("produces lowercase hex of length 64", async () => {
    const h = await sha256hex(SAMPLE_KEY);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
