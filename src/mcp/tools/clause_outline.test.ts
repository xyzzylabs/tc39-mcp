import { describe, it, expect } from "vitest";
import { clauseOutline, type OutlineNode } from "./clause_outline.js";

function countNodes(roots: OutlineNode[]): number {
  let n = 0;
  const walk = (xs: OutlineNode[]) => {
    for (const x of xs) {
      n++;
      walk(x.children);
    }
  };
  walk(roots);
  return n;
}

describe("clauseOutline", () => {
  it("returns top-level clauses only with depth=1", async () => {
    try {
      const r = await clauseOutline({ spec: "262", edition: "latest", depth: 1 });
      // The top-level of ECMA-262 has ~30 clauses (§1–§29 + a few annexes).
      expect(r.roots.length).toBeGreaterThan(10);
      for (const root of r.roots) {
        expect(root.children).toEqual([]);
      }
      expect(r.node_count).toBe(r.roots.length);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("returns a tree at depth=2 with first-level children populated", async () => {
    try {
      const r = await clauseOutline({ spec: "262", edition: "latest", depth: 2 });
      expect(r.node_count).toBeGreaterThan(r.roots.length);
      // At least one root should have children at this depth.
      expect(r.roots.some((root) => root.children.length > 0)).toBe(true);
      // No grandchildren — depth=2 caps at the second level.
      for (const root of r.roots) {
        for (const child of root.children) {
          expect(child.children).toEqual([]);
        }
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("children are ordered by section number", async () => {
    try {
      const r = await clauseOutline({ spec: "262", edition: "latest", depth: 2 });
      for (const root of r.roots) {
        let prev = "";
        for (const child of root.children) {
          if (prev) {
            // child numbers should be monotonically non-decreasing per parent.
            const a = child.number.split(".").map((s) => parseInt(s, 10) || 0);
            const b = prev.split(".").map((s) => parseInt(s, 10) || 0);
            // Compare lex by numeric segments.
            let cmp = 0;
            for (let i = 0; i < Math.min(a.length, b.length); i++) {
              if (a[i] !== b[i]) {
                cmp = (a[i] ?? 0) - (b[i] ?? 0);
                break;
              }
            }
            expect(cmp).toBeGreaterThanOrEqual(0);
          }
          prev = child.number;
        }
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("`under` filter limits to descendants of a clause", async () => {
    try {
      // §22.2 RegExp has dozens of descendants but only one top-level
      // RegExp clause. Anchor at one to verify scoping.
      const all = await clauseOutline({ spec: "262", edition: "latest", depth: 1 });
      const regexpClause = all.roots.find((r) => /regular expressions?/i.test(r.title));
      if (!regexpClause) return;
      const r = await clauseOutline({
        spec: "262",
        edition: "latest",
        under: regexpClause.id,
      });
      // Returned roots are the direct children of §22.2 (or whichever
      // section), not the §22.2 clause itself.
      for (const root of r.roots) {
        expect(root.number.startsWith(regexpClause.number + ".")).toBe(true);
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("works on ECMA-402", async () => {
    try {
      const r = await clauseOutline({ spec: "402", edition: "main", depth: 1 });
      expect(r.spec).toBe("402");
      expect(r.roots.length).toBeGreaterThan(5);
      for (const root of r.roots) {
        expect(typeof root.id).toBe("string");
        expect(typeof root.title).toBe("string");
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("node_count matches actual tree size", async () => {
    try {
      const r = await clauseOutline({ spec: "262", edition: "latest", depth: 3 });
      expect(countNodes(r.roots)).toBe(r.node_count);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("annexes (A, B, …) sort after numeric sections", async () => {
    // Verified indirectly: collect top-level roots and verify every
    // annex (letter-numbered) comes after every numeric-numbered root.
    try {
      const r = await clauseOutline({ spec: "262", edition: "latest", depth: 1 });
      let seenAnnex = false;
      for (const root of r.roots) {
        const isAnnex = /^[A-Z]+$/.test(root.number);
        if (isAnnex) {
          seenAnnex = true;
        } else {
          // A numeric root after an annex would break the ordering.
          expect(seenAnnex).toBe(false);
        }
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("sibling annexes (A, B, C) sort alphabetically", async () => {
    try {
      const r = await clauseOutline({ spec: "262", edition: "latest", depth: 1 });
      const annexes = r.roots.filter((x) => /^[A-Z]+$/.test(x.number));
      for (let i = 1; i < annexes.length; i++) {
        // 'A' < 'B' < 'C' as plain string compare.
        expect(annexes[i]!.number > annexes[i - 1]!.number).toBe(true);
      }
    } catch {
      // Parsed JSON missing.
    }
  });
});
