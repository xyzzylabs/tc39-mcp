import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotCache } from "./cache.js";
import { isImmutableKey, loadSnapshot } from "./loader.js";

/** Build a fake fetch implementation that returns a scripted Response. */
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

/** A fake fetch that records every call and returns 404. */
function trackingFetch(record: { calls: number }): typeof fetch {
  return async () => {
    record.calls++;
    return new Response("missing", { status: 404 });
  };
}

describe("isImmutableKey", () => {
  it("treats per-SHA pins as immutable", () => {
    expect(isImmutableKey("spec-262-main-abc1234567.json")).toBe(true);
    expect(isImmutableKey("spec-402-main-deadbeef12.json")).toBe(true);
  });

  it("treats live + index keys as mutable", () => {
    expect(isImmutableKey("spec-262-main.json")).toBe(false);
    expect(isImmutableKey("spec-402-main.json")).toBe(false);
    expect(isImmutableKey("test262-index.json")).toBe(false);
    expect(isImmutableKey("proposals-index.json")).toBe(false);
  });
});

describe("loadSnapshot — immutable keys", () => {
  let cacheRoot: string;
  let bundleDir: string;
  let cache: SnapshotCache;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), "tc39-mcp-loader-test-"));
    bundleDir = mkdtempSync(join(tmpdir(), "tc39-mcp-bundle-test-"));
    cache = new SnapshotCache(cacheRoot);
  });
  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
    rmSync(bundleDir, { recursive: true, force: true });
  });

  const KEY = "spec-262-main-abc1234567.json";

  it("returns the cached body without touching the network on a hit", async () => {
    cache.writeSnapshot(KEY, '{"v":"cached"}');
    const calls = { calls: 0 };
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: trackingFetch(calls),
    });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.body).toBe('{"v":"cached"}');
    expect(r.source).toBe("cache");
    expect(calls.calls).toBe(0);
  });

  it("fetches from network on cache miss + caches the result", async () => {
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: scriptedFetch(200, '{"v":"fresh"}', { etag: '"e1"' }),
    });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.body).toBe('{"v":"fresh"}');
    expect(r.source).toBe("network");
    // Cached for next time.
    expect(cache.readSnapshot(KEY)).toBe('{"v":"fresh"}');
  });

  it("falls back to bundled when cache miss + network 404", async () => {
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, KEY), '{"v":"bundled"}');
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: scriptedFetch(404, "nope"),
    });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.body).toBe('{"v":"bundled"}');
    expect(r.source).toBe("bundle");
  });

  it("returns missing when neither cache, network, nor bundle has the key", async () => {
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: scriptedFetch(404, "nope"),
    });
    expect(r.kind).toBe("missing");
    if (r.kind !== "missing") return;
    expect(r.reason).toContain(KEY);
  });

  it("falls back to bundled when network is unavailable (e.g. offline)", async () => {
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, KEY), '{"v":"bundled"}');
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.source).toBe("bundle");
  });
});

describe("loadSnapshot — live keys", () => {
  let cacheRoot: string;
  let bundleDir: string;
  let cache: SnapshotCache;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), "tc39-mcp-loader-test-"));
    bundleDir = mkdtempSync(join(tmpdir(), "tc39-mcp-bundle-test-"));
    cache = new SnapshotCache(cacheRoot);
  });
  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
    rmSync(bundleDir, { recursive: true, force: true });
  });

  const KEY = "spec-262-main.json";

  it("serves from cache when the pointer is fresh", async () => {
    cache.writeSnapshot(KEY, '{"v":"cached"}');
    const now = 1_700_000_000_000;
    cache.writePointer(KEY, {
      key: KEY,
      etag: "e1",
      resolved_at: new Date(now - 1_000).toISOString(), // 1s old
    });
    const calls = { calls: 0 };
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: trackingFetch(calls),
      nowMs: () => now,
    });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.source).toBe("cache");
    expect(calls.calls).toBe(0);
  });

  it("re-fetches when pointer is stale and writes new bytes + pointer", async () => {
    cache.writeSnapshot(KEY, '{"v":"old"}');
    const now = 1_700_000_000_000;
    cache.writePointer(KEY, {
      key: KEY,
      etag: "e-old",
      resolved_at: new Date(now - 10 * 60 * 60 * 1000).toISOString(), // 10h
    });
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: scriptedFetch(200, '{"v":"new"}', { etag: '"e-new"' }),
      nowMs: () => now,
    });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.body).toBe('{"v":"new"}');
    expect(r.source).toBe("network");
    // Cache updated.
    expect(cache.readSnapshot(KEY)).toBe('{"v":"new"}');
    const updatedPointer = cache.readPointer(KEY);
    expect(updatedPointer?.etag).toBe("e-new");
  });

  it("on 304 keeps cached body and refreshes pointer timestamp", async () => {
    cache.writeSnapshot(KEY, '{"v":"cached"}');
    const t0 = 1_700_000_000_000;
    cache.writePointer(KEY, {
      key: KEY,
      etag: "e1",
      resolved_at: new Date(t0 - 10 * 60 * 60 * 1000).toISOString(),
    });
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: scriptedFetch(304, "", { etag: '"e1"' }),
      nowMs: () => t0,
    });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.body).toBe('{"v":"cached"}');
    expect(r.source).toBe("cache");
    const updated = cache.readPointer(KEY);
    expect(updated?.resolved_at).toBe(new Date(t0).toISOString());
  });

  it("falls back to cache when network fails (offline) and cache exists", async () => {
    cache.writeSnapshot(KEY, '{"v":"cached"}');
    // No pointer at all — forces a network attempt.
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.source).toBe("cache");
  });

  it("falls back to bundled when cache miss + network fails", async () => {
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, KEY), '{"v":"bundled"}');
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.source).toBe("bundle");
  });

  it("returns missing when nothing reachable", async () => {
    const r = await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: scriptedFetch(503, "down"),
    });
    expect(r.kind).toBe("missing");
  });

  it("sends If-None-Match when a previous etag is cached", async () => {
    cache.writeSnapshot(KEY, "{}");
    cache.writePointer(KEY, {
      key: KEY,
      etag: "etag-prev",
      resolved_at: new Date(0).toISOString(), // ancient → forces re-probe
    });
    let observed: Record<string, string> = {};
    const recordingFetch: typeof fetch = async (_url, init) => {
      observed = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response("{}", { status: 200, headers: { etag: '"etag-new"' } });
    };
    await loadSnapshot(KEY, {
      cache,
      bundleDir,
      fetchImpl: recordingFetch,
    });
    expect(observed["if-none-match"]).toBe("etag-prev");
  });
});
