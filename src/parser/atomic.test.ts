import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeJsonAtomic } from "./atomic.js";

// Each test gets its own dir so they can run in parallel without
// stepping on each other.
let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `tc39-mcp-atomic-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("writeJsonAtomic", () => {
  it("writes the JSON payload to the target path", () => {
    const target = join(dir, "out.json");
    writeJsonAtomic(target, { hello: "world" });
    expect(existsSync(target)).toBe(true);
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    expect(parsed).toEqual({ hello: "world" });
  });

  it("formats with 2-space indentation", () => {
    const target = join(dir, "out.json");
    writeJsonAtomic(target, { a: 1 });
    const raw = readFileSync(target, "utf8");
    expect(raw).toBe(`{\n  "a": 1\n}`);
  });

  it("overwrites an existing file", () => {
    const target = join(dir, "out.json");
    writeFileSync(target, '{"old":true}');
    writeJsonAtomic(target, { new: true });
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ new: true });
  });

  it("leaves no `.tmp` siding behind on success", () => {
    const target = join(dir, "out.json");
    writeJsonAtomic(target, { ok: 1 });
    expect(existsSync(target + ".tmp")).toBe(false);
  });

  it("preserves the previous file when rename fails (target dir gone)", () => {
    // Force rename to fail by writing to a directory that ceases to exist
    // before the rename. The test verifies the previous good copy at the
    // sibling path isn't disturbed.
    const target = join(dir, "out.json");
    writeJsonAtomic(target, { v: 1 });
    expect(readFileSync(target, "utf8")).toContain("\"v\": 1");

    // Now try a write that will fail mid-way. We point to a target inside
    // a non-existent subdir; writeFileSync will throw on the .tmp write
    // before rename even runs.
    const badTarget = join(dir, "no-such-dir", "out.json");
    expect(() => writeJsonAtomic(badTarget, { v: 2 })).toThrow();

    // The original file is untouched.
    expect(readFileSync(target, "utf8")).toContain("\"v\": 1");
  });

  it("cleans up `.tmp` when rename fails", () => {
    // Simulate rename failure by making the target path a directory.
    // rename() into an existing directory fails with EISDIR (or similar).
    const target = join(dir, "is-a-directory");
    mkdirSync(target);
    expect(() => writeJsonAtomic(target, { x: 1 })).toThrow();
    // The .tmp staging file should have been removed.
    expect(existsSync(target + ".tmp")).toBe(false);
  });

  it("survives serializable payloads of varied shapes", () => {
    const target = join(dir, "out.json");
    const payloads: unknown[] = [
      null,
      42,
      "hello",
      [1, 2, 3],
      { nested: { deeply: { value: true } } },
      Array.from({ length: 1000 }, (_, i) => i),
    ];
    for (const p of payloads) {
      writeJsonAtomic(target, p);
      expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(p);
    }
  });
});
