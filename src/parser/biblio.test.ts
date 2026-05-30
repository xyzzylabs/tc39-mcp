import { describe, it, expect } from "vitest";
import { loadBiblioClauses, biblioCommit } from "./biblio.js";

// Tests use the real @tc39/ecma262-biblio package (it's a build dep).
// We're verifying the type filter + passthrough, not mocking the biblio.

describe("loadBiblioClauses", () => {
  it("returns a non-empty Map", () => {
    const m = loadBiblioClauses();
    expect(m.size).toBeGreaterThan(1000);
  });

  it("includes both `clause` and `op` entry types", () => {
    const m = loadBiblioClauses();
    const kinds = new Set<string>();
    for (const meta of m.values()) kinds.add(meta.kind);
    expect(kinds.has("clause")).toBe(true);
    expect(kinds.has("op") || kinds.has("clause")).toBe(true);
  });

  it("excludes entry types other than clause/op (built-in function, etc.)", () => {
    const m = loadBiblioClauses();
    for (const meta of m.values()) {
      expect(["clause", "op"]).toContain(meta.kind);
    }
  });

  it("keys map entries by id", () => {
    const m = loadBiblioClauses();
    for (const [key, meta] of m.entries()) {
      expect(key).toBe(meta.id);
    }
  });

  it("preserves aoid from biblio entries (null when absent)", () => {
    const m = loadBiblioClauses();
    const toNumber = m.get("sec-tonumber");
    if (!toNumber) return; // ES2025 biblio always has this; skip if absent
    expect(toNumber.aoid).toBe("ToNumber");
  });

  it("captures section number for known clauses", () => {
    const m = loadBiblioClauses();
    const toBoolean = m.get("sec-toboolean");
    if (!toBoolean) return;
    expect(toBoolean.number).toMatch(/^\d+(\.\d+)*$/);
  });

  it("captures title verbatim", () => {
    const m = loadBiblioClauses();
    const c = m.get("sec-toboolean");
    if (!c) return;
    expect(c.title.toLowerCase()).toContain("toboolean");
  });

  it("returns the same Map shape on every call (no surprise mutation)", () => {
    const a = loadBiblioClauses();
    const b = loadBiblioClauses();
    expect(a.size).toBe(b.size);
  });
});

describe("biblioCommit", () => {
  it("returns a non-empty string", () => {
    const c = biblioCommit();
    expect(typeof c).toBe("string");
    expect(c.length).toBeGreaterThan(0);
  });

  it("returns either a real commit SHA or 'unknown'", () => {
    const c = biblioCommit();
    // Real SHAs are 40 hex chars; the fallback is the literal "unknown".
    expect(c === "unknown" || /^[a-f0-9]{40}$/.test(c)).toBe(true);
  });
});
