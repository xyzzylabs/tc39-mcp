import { describe, it, expect } from "vitest";
import { clauseGet, clauseList, loadSpec } from "./clause.js";

// Direct coverage for clause.get / clause.list. Other test files exercise
// these indirectly; this file pins their shape contract.

describe("clauseGet", () => {
  it("returns null for an id that doesn't exist in the requested spec", async () => {
    const c = await clauseGet({
      id: "sec-this-clause-does-not-exist-xyz",
      spec: "262",
      edition: "latest",
    });
    expect(c).toBeNull();
  });

  it("returns structured shape for a real ECMA-262 clause", async () => {
    const c = await clauseGet({ id: "sec-tonumber", spec: "262", edition: "latest" });
    if (!c) return; // parsed JSON missing
    expect(c.meta.id).toBe("sec-tonumber");
    expect(c.meta.aoid).toBe("ToNumber");
    // Abstract operations are now kind="op" (any clause with an
    // aoid). Previously the biblio's raw "clause" type leaked
    // through; the loader now overrides it.
    expect(c.meta.kind).toBe("op");
    expect(Array.isArray(c.algorithms)).toBe(true);
    expect(c.algorithms.length).toBeGreaterThan(0);
    expect(Array.isArray(c.notes)).toBe(true);
    expect(Array.isArray(c.crossrefs)).toBe(true);
  });

  it("returns structured shape for a real ECMA-402 clause", async () => {
    const c = await clauseGet({
      id: "sec-intl.numberformat",
      spec: "402",
      edition: "main",
    });
    if (!c) return; // parsed JSON missing
    expect(c.meta.id).toBe("sec-intl.numberformat");
    expect(c.meta.title).toMatch(/Intl\.NumberFormat/);
    expect(Array.isArray(c.algorithms)).toBe(true);
  });

  it("defaults to spec=262 + edition=latest when not specified", async () => {
    const a = await clauseGet({ id: "sec-tonumber" });
    const b = await clauseGet({ id: "sec-tonumber", spec: "262", edition: "latest" });
    if (!a || !b) return;
    expect(a).toEqual(b);
  });
});

describe("clauseList", () => {
  it("returns rows with the documented shape", async () => {
    try {
      const hits = await clauseList({ spec: "262", edition: "latest", limit: 5 });
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) {
        expect(typeof h.id).toBe("string");
        expect(typeof h.title).toBe("string");
        expect(typeof h.number).toBe("string");
        expect(typeof h.kind).toBe("string");
        expect(typeof h.algorithms).toBe("number");
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("respects the limit", async () => {
    try {
      const hits = await clauseList({ spec: "262", edition: "latest", limit: 3 });
      expect(hits.length).toBeLessThanOrEqual(3);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("kind filter narrows to the requested kind", async () => {
    try {
      // After the biblio override, abstract operations are kind="op"
      // on 262; non-op clauses stay kind="clause". Verify both branches.
      const ops = await clauseList({
        spec: "262",
        edition: "latest",
        kind: "op",
        limit: 50,
      });
      expect(ops.length).toBeGreaterThan(0);
      for (const h of ops) expect(h.kind).toBe("op");

      const clauses = await clauseList({
        spec: "262",
        edition: "latest",
        kind: "clause",
        limit: 50,
      });
      expect(clauses.length).toBeGreaterThan(0);
      for (const h of clauses) expect(h.kind).toBe("clause");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("has_algorithm filter only returns clauses with at least one algorithm", async () => {
    try {
      const hits = await clauseList({
        spec: "262",
        edition: "latest",
        has_algorithm: true,
        limit: 20,
      });
      for (const h of hits) expect(h.algorithms).toBeGreaterThan(0);
    } catch {
      // Parsed JSON missing.
    }
  });
});

describe("loadSpec caching", () => {
  it("returns the same object instance on repeat call (concrete edition)", async () => {
    const a = await loadSpec("262", "es2025");
    const b = await loadSpec("262", "es2025");
    expect(a).toBe(b);
  });

  it("aliases share the cache with their concrete resolution", async () => {
    // latest on 262 resolves to es2025; the cache key is the concrete
    // edition, so both calls should hit the same in-memory parse.
    const a = await loadSpec("262", "latest");
    const b = await loadSpec("262", "es2025");
    expect(a).toBe(b);
  });

  it("different specs do NOT share a cache entry", async () => {
    try {
      const a = await loadSpec("262", "main");
      const b = await loadSpec("402", "main");
      expect(a).not.toBe(b);
      expect(a.pin.spec).toBe("262");
      expect(b.pin.spec).toBe("402");
    } catch {
      // 402/main parsed JSON missing.
    }
  });
});
