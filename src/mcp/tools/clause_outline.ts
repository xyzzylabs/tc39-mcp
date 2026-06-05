// MCP tool: clause.outline — return the section tree (table of
// contents) for a parsed (spec, edition).
//
// Builds a tree from clause section numbers: "7" is a top-level node,
// "7.1" is its child, "7.1.4" is a grandchild, etc. A `depth` limit
// caps how deep we descend (depth=1 → top-level only, depth=2 → first
// two levels, …). With no depth, the full tree is returned.
//
// Annexes (numbered A, B, C …) are sorted after numeric sections.
//
// The tree-building logic lives in `src/spec/outline.ts` so the stdio
// server and the Cloudflare Worker produce identical outlines.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import {
  type Edition,
  type Spec,
} from "../../editions.js";
import { buildOutline } from "../../spec/outline.js";

export const clauseOutlineSchema = {
  spec: specArg,
  edition: editionArg,
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

export async function clauseOutline(args: {
  spec?: Spec;
  edition?: Edition;
  depth?: number;
  under?: string;
}): Promise<OutlineResult> {
  const spec = args.spec ?? "262";
  const parsed = await loadSpec(spec, args.edition ?? "latest");
  const core = buildOutline(parsed.clauses, { depth: args.depth, under: args.under });
  return { spec, ...core };
}
