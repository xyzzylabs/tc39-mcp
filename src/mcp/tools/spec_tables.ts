// MCP tool: spec.tables — list or fetch parsed `<emu-table>` content.
//
// The parser captures every `<emu-table id="...">` with structured
// columns + rows. This tool serves it in two query modes:
//
//   - `{ id: "..." }` → return exactly that one table.
//   - otherwise → list tables (id, caption, columns, row_count, clause_id),
//     optionally filtered by substring against the caption or id.
//
// Useful examples:
//   - id="table-well-known-intrinsic-objects" → the authoritative WKI table.
//   - id="table-well-known-symbols" → Symbol.x values.
//   - filter="completion record" → tables describing completion fields.
//   - filter="locale" (on spec=402) → locale data tables.
//
// The query logic lives in `src/spec/tables_query.ts` so the stdio
// server and the Cloudflare Worker answer it identically.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import {
  type Edition,
  type Spec,
} from "../../editions.js";
import {
  queryTables,
  type TablesQueryResult,
  type TableSummary,
} from "../../spec/tables_query.js";

export type { TableSummary };

export const specTablesSchema = {
  id: z
    .string()
    .optional()
    .describe(
      "If set, return exactly this table (full columns + rows). If omitted, list tables (lightweight rows).",
    ),
  filter: z
    .string()
    .optional()
    .describe(
      "Case-insensitive substring filter on the caption or id (list mode only).",
    ),
  spec: specArg,
  edition: editionArg,
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Max table summaries returned in list mode (ignored when 'id' is set)."),
};

export const specTablesExamples = [
  {
    q: "The authoritative well-known intrinsics table",
    input: { id: "table-well-known-intrinsic-objects" },
  },
  {
    q: "List every captured `<emu-table>` in ECMA-262",
    input: {},
  },
] as const;

/** Output of `spec.tables`: the shared tables-query result plus which
 *  TC39 spec it was drawn from. */
export type SpecTablesResult = { spec: Spec } & TablesQueryResult;

export async function specTables(args: {
  id?: string;
  filter?: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): Promise<SpecTablesResult> {
  const spec = args.spec ?? "262";
  const parsed = await loadSpec(spec, args.edition ?? "latest");
  const core = queryTables(parsed.tables ?? {}, {
    id: args.id,
    filter: args.filter,
    limit: args.limit,
  });
  return { spec, ...core };
}
