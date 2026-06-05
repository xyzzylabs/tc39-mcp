// MCP tool: spec.well_known_intrinsics — enumerate the well-known
// intrinsics referenced in a spec, with their probable defining
// clauses.
//
// Resolution strategy (in order of authority):
//
//   1. If the parsed spec includes `table-well-known-intrinsic-objects`
//      (262's canonical §6.1.7.4 table), drive from that. The table
//      maps each `%Name%` to a description column that names the
//      defining clause. We match each row to the clause whose title
//      most closely corresponds.
//   2. Otherwise (e.g. ECMA-402, which has no equivalent global
//      table), fall back to scanning every clause's title + signature
//      + step text for `%X%` notation and ranking by occurrence + a
//      title-substring heuristic.
//
// Either way, each hit carries `defining_clause.matched_on` so callers
// can tell which path produced it. The resolution logic lives in
// `src/spec/intrinsics.ts` so the stdio server and the Cloudflare Worker
// enumerate intrinsics identically.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import { wellKnownIntrinsics } from "../../spec/intrinsics.js";
import {
  type Edition,
  type Spec,
} from "../../editions.js";

const WKI_TABLE_ID = "table-well-known-intrinsic-objects";

export const specIntrinsicsSchema = {
  spec: specArg,
  edition: editionArg,
  filter: z
    .string()
    .optional()
    .describe("Case-insensitive substring filter on the intrinsic name (bare, e.g. 'object.prototype')."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Max well-known intrinsics returned."),
};

export const specIntrinsicsExamples = [
  {
    q: "Every well-known intrinsic in ECMA-262",
    input: {},
  },
  {
    q: "Well-known intrinsics named like Array",
    input: { filter: "array" },
  },
] as const;

export interface IntrinsicHit {
  /** Bare name, e.g. `Object.prototype` (the surrounding `%…%` is implied). */
  name: string;
  /** Total mentions of `%name%` across the spec. Only populated on the
   *  heuristic path; the table path doesn't count occurrences. */
  mention_count?: number;
  /** Verbatim "ECMAScript Language Association" cell from the WKI
   *  table — a prose description of what the intrinsic is. Only set
   *  on the table path. */
  association?: string;
  /** Verbatim "Global Name" cell from the WKI table (e.g. `Array`).
   *  Empty for intrinsics that aren't exposed as global names. Only
   *  set on the table path. */
  global_name?: string;
  /** The clause we believe defines this intrinsic + how we picked it. */
  defining_clause: {
    id: string;
    title: string;
    number: string;
    matched_on:
      | "table-row"           // chosen by matching the WKI table's text
      | "title-literal"       // clause title contains the literal `%X%`
      | "title-bare"          // clause title contains the bare name only
      | "most-mentions";      // fallback; the clause that mentions it most
  } | null;
}

/** Output of `spec.well_known_intrinsics`: every well-known
 *  intrinsic detected in the spec, with the clause that probably
 *  defines it. */
export interface IntrinsicsResult {
  /** Which TC39 spec was scanned. */
  spec: Spec;
  /** Which resolution path produced these hits. `table` uses the
   *  authoritative §6.1.7.4 WKI table; `heuristic` falls back to a
   *  scan of clause titles + step text. */
  source: "table" | "heuristic";
  /** Human-readable note describing how the hits were produced (e.g.
   *  table missing, fallback scan ran, etc.). */
  hint: string;
  /** Matched intrinsics, capped at `limit`. */
  hits: IntrinsicHit[];
}

export async function specIntrinsics(args: {
  spec?: Spec;
  edition?: Edition;
  filter?: string;
  limit?: number;
}): Promise<IntrinsicsResult> {
  const spec = args.spec ?? "262";
  const parsed = await loadSpec(spec, args.edition ?? "latest");
  const core = wellKnownIntrinsics(parsed.clauses, parsed.tables?.[WKI_TABLE_ID], {
    filter: args.filter,
    limit: args.limit,
  });
  return { spec, ...core };
}
