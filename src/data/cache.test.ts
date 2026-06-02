import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  POINTER_TTL_MS,
  SnapshotCache,
  defaultCacheRoot,
  pointerIsFresh,
} from "./cache.js";

describe("defaultCacheRoot", () => {
  const originalXdg = process.env.XDG_CACHE_HOME;

  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdg;
  });

  it("uses XDG_CACHE_HOME when set", () => {
    process.env.XDG_CACHE_HOME = "/tmp/xdg-cache";
    expect(defaultCacheRoot()).toBe("/tmp/xdg-cache/tc39-mcp");
  });

  it("falls back to ~/.cache/tc39-mcp when XDG_CACHE_HOME is unset", () => {
    delete process.env.XDG_CACHE_HOME;
    expect(defaultCacheRoot()).toBe(join(homedir(), ".cache", "tc39-mcp"));
  });

  it("falls back to ~/.cache/tc39-mcp when XDG_CACHE_HOME is empty string", () => {
    process.env.XDG_CACHE_HOME = "";
    expect(defaultCacheRoot()).toBe(join(homedir(), ".cache", "tc39-mcp"));
  });
});

describe("SnapshotCache", () => {
  let root: string;
  let cache: SnapshotCache;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tc39-mcp-cache-test-"));
    cache = new SnapshotCache(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("snapshots", () => {
    it("reads null when nothing is cached", () => {
      expect(cache.readSnapshot("spec-262-main.json")).toBeNull();
    });

    it("writes and reads back a snapshot atomically", () => {
      cache.writeSnapshot("spec-262-main.json", '{"pin":{"sha":"abc"}}');
      expect(cache.readSnapshot("spec-262-main.json")).toBe(
        '{"pin":{"sha":"abc"}}',
      );
      // The on-disk file path is reproducible.
      expect(existsSync(cache.snapshotPath("spec-262-main.json"))).toBe(true);
    });

    it("creates nested directories on first write", () => {
      // The snapshots/ subdir doesn't exist in a fresh cache root.
      expect(existsSync(join(root, "snapshots"))).toBe(false);
      cache.writeSnapshot("spec-262-main.json", "{}");
      expect(existsSync(join(root, "snapshots"))).toBe(true);
    });

    it("overwrites an existing snapshot", () => {
      cache.writeSnapshot("spec-262-main.json", '{"v":1}');
      cache.writeSnapshot("spec-262-main.json", '{"v":2}');
      expect(cache.readSnapshot("spec-262-main.json")).toBe('{"v":2}');
    });

    it("does not leave the .tmp file behind after a successful write", () => {
      cache.writeSnapshot("spec-262-main.json", "{}");
      const target = cache.snapshotPath("spec-262-main.json");
      // The atomic-rename should have removed the temp file.
      expect(existsSync(`${target}.${process.pid}.tmp`)).toBe(false);
    });

    it("deleteSnapshot removes the file; calling again is a no-op", () => {
      cache.writeSnapshot("spec-262-main.json", "{}");
      cache.deleteSnapshot("spec-262-main.json");
      expect(existsSync(cache.snapshotPath("spec-262-main.json"))).toBe(false);
      // Second delete: no throw.
      expect(() => cache.deleteSnapshot("spec-262-main.json")).not.toThrow();
    });

    it("isolates per-SHA pins and live snapshots in separate files", () => {
      cache.writeSnapshot("spec-262-main.json", '{"v":"live"}');
      cache.writeSnapshot("spec-262-main-abc1234567.json", '{"v":"pinned"}');
      expect(cache.readSnapshot("spec-262-main.json")).toBe('{"v":"live"}');
      expect(cache.readSnapshot("spec-262-main-abc1234567.json")).toBe(
        '{"v":"pinned"}',
      );
    });
  });

  describe("pointers", () => {
    it("reads null when no pointer exists", () => {
      expect(cache.readPointer("spec-262-main.json")).toBeNull();
    });

    it("writes and reads back a pointer", () => {
      const p = {
        key: "spec-262-main.json",
        etag: "abc123",
        resolved_at: "2026-06-02T00:00:00.000Z",
      };
      cache.writePointer("spec-262-main.json", p);
      expect(cache.readPointer("spec-262-main.json")).toEqual(p);
    });

    it("returns null for a malformed (truncated) pointer file", () => {
      cache.writePointer("spec-262-main.json", {
        key: "spec-262-main.json",
        etag: "abc",
        resolved_at: "2026-06-02T00:00:00.000Z",
      });
      const p = cache.pointerPath("spec-262-main.json");
      const truncated = readFileSync(p, "utf8").slice(0, 5);
      writeFileSync(p, truncated);
      expect(cache.readPointer("spec-262-main.json")).toBeNull();
    });

    it("returns null for a pointer JSON missing required fields", () => {
      const p = cache.pointerPath("spec-262-main.json");
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify({ key: "x" }));
      expect(cache.readPointer("spec-262-main.json")).toBeNull();
    });
  });
});

describe("pointerIsFresh", () => {
  const t0 = 1_700_000_000_000; // arbitrary fixed reference time
  const baseAt = new Date(t0).toISOString();

  it("returns true for a just-written pointer", () => {
    expect(
      pointerIsFresh(
        { key: "k", etag: "e", resolved_at: baseAt },
        t0,
      ),
    ).toBe(true);
  });

  it("returns true at the edge of the TTL window", () => {
    expect(
      pointerIsFresh(
        { key: "k", etag: "e", resolved_at: baseAt },
        t0 + POINTER_TTL_MS - 1,
      ),
    ).toBe(true);
  });

  it("returns false past the TTL window", () => {
    expect(
      pointerIsFresh(
        { key: "k", etag: "e", resolved_at: baseAt },
        t0 + POINTER_TTL_MS,
      ),
    ).toBe(false);
  });

  it("returns false for a malformed resolved_at", () => {
    expect(
      pointerIsFresh({ key: "k", etag: "e", resolved_at: "not-a-date" }, t0),
    ).toBe(false);
  });
});
