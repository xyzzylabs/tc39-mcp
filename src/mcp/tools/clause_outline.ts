// MCP tool: clause.outline — return the section tree (table of
// contents) for a parsed (spec, edition).
//
// Builds a tree from clause section numbers: "7" is a top-level node,
// "7.1" is its child, "7.1.4" is a grandchild, etc. A `depth` limit
// caps how deep we descend (depth=1 → top-level only, depth=2 → first
// two levels, …). With no depth, the full tree is returned.
//
// Annexes (numbered A, B, C …) are sorted after numeric sections.

import { z } from "zod";
import { loadSpec } from "./clause.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  type Edition,
  type Spec,
} from "../../editions.js";

export const clauseOutlineSchema = {
  spec: z
    .enum(SPEC_VALUES)
    .default("262")
    .describe(
      "Which TC39 spec to read: '262' (core language, default) or '402' (Internationalization API).",
    ),
  edition: z
    .enum(EDITION_VALUES)
    .default("latest")
    .describe(
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: main, es2025-candidate. Aliases: latest, draft, next.",
    ),
  depth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      "Max tree depth to return. 1 = top-level only; 2 = first two levels; omitted = full tree.",
    ),
  /** Optional anchor: limit the outline to descendants of a specific
   *  clause id (use it for "show me the shape of §22.2" without
   *  pulling the whole 262 outline). */
  under: z
    .string()
    .optional()
    .describe("Optional clause id. If set, return only descendants of this clause."),
};

export const clauseOutlineExamples = [
  {
    q: "Top-level section tree of ECMA-262",
    input: { depth: 1 },
  },
  {
    q: "Everything under §22.2 (RegExp)",
    input: { under: "sec-regexp-regular-expression-objects" },
  },
] as const;

/** One node in the section-tree produced by `clause.outline`. Children
 *  are sub-sections nested under this clause's section number. */
export interface OutlineNode {
  /** Spec clause id of this node. */
  id: string;
  /** Section number (e.g. `7.1`, `7.1.4`, `B.3`). */
  number: string;
  /** Clause `<h1>` text. */
  title: string;
  /** Clause kind: `op`, `sdo`, `built-in function`, etc. */
  kind: string;
  /** Direct sub-sections of this node, sorted by section number. */
  children: OutlineNode[];
}

/** Output of `clause.outline`: the section tree for one (spec, edition). */
export interface OutlineResult {
  /** Which TC39 spec the outline is from: `262` or `402`. */
  spec: Spec;
  /** Number of nodes in the returned tree (after `depth` / `under`
   *  filters are applied). */
  node_count: number;
  /** Top-level nodes of the returned tree. If `under` was set, these
   *  are that anchor's direct children rather than the spec roots. */
  roots: OutlineNode[];
}

/** Section-number comparator. Numeric segments compare numerically;
 *  annex letters (A, B, …) sort after any numeric prefix. */
function compareSectionNumbers(a: string, b: string): number {
  const aP = a.split(".");
  const bP = b.split(".");
  const n = Math.min(aP.length, bP.length);
  for (let i = 0; i < n; i++) {
    const aS = aP[i]!;
    const bS = bP[i]!;
    const aIsAnnex = /^[A-Z]+$/.test(aS);
    const bIsAnnex = /^[A-Z]+$/.test(bS);
    if (aIsAnnex !== bIsAnnex) return aIsAnnex ? 1 : -1;
    if (aIsAnnex && bIsAnnex) {
      if (aS !== bS) return aS < bS ? -1 : 1;
      continue;
    }
    const aN = parseInt(aS, 10);
    const bN = parseInt(bS, 10);
    if (aN !== bN) return aN - bN;
  }
  return aP.length - bP.length;
}

export function clauseOutline(args: {
  spec?: Spec;
  edition?: Edition;
  depth?: number;
  under?: string;
}): OutlineResult {
  const spec = args.spec ?? "262";
  const parsed = loadSpec(spec, args.edition ?? "latest");
  const maxDepth = args.depth;

  // Collect rows + sort by section number.
  interface Row {
    id: string;
    number: string;
    title: string;
    kind: string;
    parts: string[];
  }
  const rows: Row[] = [];
  for (const [id, c] of Object.entries(parsed.clauses)) {
    const number = c.meta.number ?? "";
    if (!number) continue;
    rows.push({
      id,
      number,
      title: c.meta.title ?? "",
      kind: c.meta.kind ?? "unknown",
      parts: number.split("."),
    });
  }
  rows.sort((a, b) => compareSectionNumbers(a.number, b.number));

  // If `under` is set, find the anchor's number prefix; only keep rows
  // whose parts begin with the same prefix (and skip the anchor itself
  // from its own descendant list).
  let anchorParts: string[] | null = null;
  if (args.under) {
    const anchor = parsed.clauses[args.under];
    if (anchor && anchor.meta.number) {
      anchorParts = anchor.meta.number.split(".");
    } else {
      return { spec, node_count: 0, roots: [] };
    }
  }

  // Build the tree. We walk rows in section order and attach each row
  // to its parent based on parts[0..len-1]. Track a stack indexed by
  // depth so we can find the parent in O(1).
  const stack: { parts: string[]; node: OutlineNode }[] = [];
  const roots: OutlineNode[] = [];
  let nodeCount = 0;

  for (const row of rows) {
    // Apply `under` filter.
    if (anchorParts) {
      if (row.parts.length <= anchorParts.length) continue;
      let ok = true;
      for (let i = 0; i < anchorParts.length; i++) {
        if (row.parts[i] !== anchorParts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    // Effective depth: relative to anchor (or absolute).
    const effDepth = anchorParts
      ? row.parts.length - anchorParts.length
      : row.parts.length;
    if (maxDepth && effDepth > maxDepth) continue;

    const node: OutlineNode = {
      id: row.id,
      number: row.number,
      title: row.title,
      kind: row.kind,
      children: [],
    };

    // Pop stack frames that aren't on the current path. A parent's
    // parts must be a strict prefix of the current row's parts.
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const tp = top.parts;
      if (
        tp.length < row.parts.length &&
        tp.every((s, i) => row.parts[i] === s)
      ) {
        break;
      }
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1]!.node.children.push(node);
    }
    stack.push({ parts: row.parts, node });
    nodeCount++;
  }

  return { spec, node_count: nodeCount, roots };
}
