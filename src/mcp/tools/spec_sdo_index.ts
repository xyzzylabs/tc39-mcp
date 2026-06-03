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
//   `by_production: true`  (default) → { [production]: [{ sdo, id, title }] }
//   `by_sdo: true`                    → { [sdo title]: [productions[]] }

import { z } from "zod";
import { loadSpec } from "./clause.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  type Edition,
  type Spec,
} from "../../editions.js";

export const specSdoIndexSchema = {
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
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: es2016 … es2025, main. Aliases: latest, draft, next.",
    ),
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

export interface SdoEntry {
  /** The clause id the algorithm lives under. */
  id: string;
  /** The clause's `<h1>` text. For an SDO, this is the SDO name + signature. */
  title: string;
  /** The grammar production this algorithm handles (verbatim). */
  production: string;
}

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
  const by = args.by ?? "production";
  const filter = args.filter?.toLowerCase();
  const limit = args.limit ?? 50;

  // Collect every (production, sdo) pair across the parse.
  const pairs: SdoEntry[] = [];
  for (const [id, c] of Object.entries(parsed.clauses)) {
    const title = c.meta.title ?? "";
    for (const algo of c.algorithms) {
      if (!algo.production) continue;
      pairs.push({ id, title, production: algo.production });
    }
  }

  const groups: Record<string, SdoEntry[]> = {};
  const keyOf = (e: SdoEntry) => (by === "production" ? e.production : e.title);

  for (const p of pairs) {
    const key = keyOf(p);
    if (filter && !key.toLowerCase().includes(filter)) continue;
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(p);
  }

  // Stable sort + truncate. Sort keys alphabetically so output is
  // deterministic; cap to `limit` groups.
  const keptKeys = Object.keys(groups).sort().slice(0, limit);
  const kept: Record<string, SdoEntry[]> = {};
  for (const k of keptKeys) kept[k] = groups[k]!;

  return {
    spec,
    by,
    pair_count: pairs.length,
    group_count: Object.keys(groups).length,
    groups: kept,
  };
}
