// MCP tool: spec.sdo_index — index Syntax-Directed Operations by the
// grammar production they're defined on.
//
// SDOs (Syntax-Directed Operations) in ECMA-262 are abstract operations
// whose implementation varies per grammar production: a single SDO like
// `Evaluation` has many `<emu-alg>` blocks, each preceded by an
// `<emu-grammar>` saying which production this case handles. The parser
// captures the `<emu-grammar>` text per algorithm; this tool reindexes
// it so callers can ask "what SDOs implement BindingIdentifier?" or
// "what productions does Evaluation handle?".
//
// Two query directions:
//   `by: "production"` (default) → { [production]: [{ sdo, id, title }] }
//   `by: "sdo"`                   → { [sdo title]: [productions[]] }
//
// The index logic lives in `src/spec/sdo_index.ts` so the stdio server
// and the Cloudflare Worker build it identically.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import {
  type Edition,
  type Spec,
} from "../../editions.js";
import {
  buildSdoIndex,
  type SdoEntry,
} from "../../spec/sdo_index.js";

export type { SdoEntry };

export const specSdoIndexSchema = {
  spec: specArg,
  edition: editionArg,
  by: z
    .enum(["production", "sdo"])
    .default("production")
    .describe(
      "Index direction. 'production' (default) groups SDO definitions by the production they handle. 'sdo' groups productions by which SDO defines them.",
    ),
  /** Optional filter: substring match on the production text or SDO
   *  title. Returns only entries whose key contains this string
   *  (case-insensitive). */
  filter: z.string().optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Cap the number of groups returned. Each group can still hold many entries."),
};

export const specSdoIndexExamples = [
  {
    q: "Which SDOs implement BindingIdentifier?",
    input: { by: "production", filter: "BindingIdentifier" },
  },
  {
    q: "What productions does Evaluation handle?",
    input: { by: "sdo", filter: "Evaluation" },
  },
] as const;

/** Output of `spec.sdo_index`: the SDO ↔ production index either
 *  grouped by production (the default) or by SDO title. */
export interface SdoIndexResult {
  /** Which TC39 spec the index was built from. */
  spec: Spec;
  /** Which direction the index runs. `production` keys productions
   *  to the SDOs implementing them; `sdo` keys SDO titles to the
   *  productions they cover. */
  by: "production" | "sdo";
  /** Total number of (production, sdo) pairs in the source. Useful for
   *  context when `groups` was truncated by `limit`. */
  pair_count: number;
  /** Number of unique groups (productions when by=production, SDO
   *  titles when by=sdo). */
  group_count: number;
  /** The actual index. Keys are productions or SDO titles depending on
   *  `by`. Values are the entries grouped under that key. */
  groups: Record<string, SdoEntry[]>;
}

export async function specSdoIndex(args: {
  spec?: Spec;
  edition?: Edition;
  by?: "production" | "sdo";
  filter?: string;
  limit?: number;
}): Promise<SdoIndexResult> {
  const spec = args.spec ?? "262";
  const parsed = await loadSpec(spec, args.edition ?? "latest");
  const core = buildSdoIndex(parsed.clauses, {
    by: args.by,
    filter: args.filter,
    limit: args.limit,
  });
  return { spec, ...core };
}
