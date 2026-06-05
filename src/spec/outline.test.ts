import { describe, it, expect } from "vitest";
import { buildOutline, compareSectionNumbers, type OutlineClause } from "./outline.js";

const CLAUSES: Record<string, OutlineClause> = {
  "sec-1": { meta: { number: "1", title: "Scope", kind: "clause" } },
  "sec-7": { meta: { number: "7", title: "Abstract Operations", kind: "clause" } },
  "sec-7-1": { meta: { number: "7.1", title: "Type Conversion", kind: "clause" } },
  "sec-7-1-4": { meta: { number: "7.1.4", title: "ToNumber", kind: "op" } },
  "sec-7-2": { meta: { number: "7.2", title: "Testing & Comparison", kind: "clause" } },
  "sec-b": { meta: { number: "B", title: "Annex B", kind: "clause" } },
  "sec-b-1": { meta: { number: "B.1", title: "Additional Syntax", kind: "clause" } },
  "sec-nonumber": { meta: { number: "", title: "Introduction", kind: "clause" } },
};

describe("buildOutline — full tree", () => {
  it("nests by section number and skips numberless clauses", () => {
    const t = buildOutline(CLAUSES, {});
    // 7 numbered clauses; sec-nonumber is dropped.
    expect(t.node_count).toBe(7);
    // Roots sorted numerically, annex last.
    expect(t.roots.map((n) => n.number)).toEqual(["1", "7", "B"]);
    const seven = t.roots.find((n) => n.number === "7")!;
    expect(seven.children.map((c) => c.number)).toEqual(["7.1", "7.2"]);
    const sevenOne = seven.children.find((c) => c.number === "7.1")!;
    expect(sevenOne.children.map((c) => c.number)).toEqual(["7.1.4"]);
  });
});

describe("buildOutline — depth", () => {
  it("depth=1 returns top-level only", () => {
    const t = buildOutline(CLAUSES, { depth: 1 });
    expect(t.node_count).toBe(3);
    expect(t.roots.every((n) => n.children.length === 0)).toBe(true);
  });

  it("depth=2 includes second level but not third", () => {
    const t = buildOutline(CLAUSES, { depth: 2 });
    // 1, 7, 7.1, 7.2, B, B.1 — but not 7.1.4
    expect(t.node_count).toBe(6);
    const seven = t.roots.find((n) => n.number === "7")!;
    expect(seven.children.find((c) => c.number === "7.1")!.children).toEqual([]);
  });
});

describe("buildOutline — under", () => {
  it("returns only descendants of the anchor", () => {
    const t = buildOutline(CLAUSES, { under: "sec-7" });
    expect(t.node_count).toBe(3); // 7.1, 7.1.4, 7.2
    expect(t.roots.map((n) => n.number)).toEqual(["7.1", "7.2"]);
    expect(t.roots[0]!.children.map((c) => c.number)).toEqual(["7.1.4"]);
  });

  it("returns an empty tree for an unknown anchor", () => {
    const t = buildOutline(CLAUSES, { under: "sec-nope" });
    expect(t).toEqual({ node_count: 0, roots: [] });
  });
});

describe("compareSectionNumbers", () => {
  it("orders numerically, not lexically", () => {
    expect(compareSectionNumbers("2", "10")).toBeLessThan(0);
    expect(compareSectionNumbers("7.2", "7.10")).toBeLessThan(0);
  });

  it("sorts annex letters after numeric sections", () => {
    expect(compareSectionNumbers("9", "B")).toBeLessThan(0);
    expect(compareSectionNumbers("B", "9")).toBeGreaterThan(0);
    expect(compareSectionNumbers("A", "B")).toBeLessThan(0);
  });
});
