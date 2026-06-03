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

import { z } from "zod";
import { loadSpec } from "./clause.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  type Edition,
  type Spec,
} from "../../editions.js";
import type { SpecTable } from "../../parser/schema.js";

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
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: es2016 … es2025, main, es2025-candidate. Aliases: latest, draft, next.",
    ),
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

/** Lightweight `<emu-table>` summary row returned in list mode. */
export interface TableSummary {
  /** Verbatim `id="..."` attribute of the `<emu-table>` element. */
  id: string;
  /** Caption text (from `<emu-caption>` or the `caption` attribute). */
  caption: string;
  /** `<th>` column headers in document order. Empty if the table has
   *  no header row. */
  columns: string[];
  /** Number of body rows in the table. */
  row_count: number;
  /** The clause id that contains this table, if any. */
  clause_id?: string;
}

/** Output of `spec.tables`. Two discriminated variants:
 *
 *  - `get`  — full structured table (or `null` when not found).
 *  - `list` — summary rows, optionally filtered. */
export type SpecTablesResult =
  | {
      /** Returned when the `id` arg was set. */
      mode: "get";
      /** Which TC39 spec the table came from. */
      spec: Spec;
      /** Full table object, or `null` when the id doesn't match. */
      table: SpecTable | null;
    }
  | {
      /** Returned when the `id` arg was omitted. */
      mode: "list";
      /** Which TC39 spec the listing came from. */
      spec: Spec;
      /** Total tables matching the `filter` before the `limit` cap. */
      total: number;
      /** Table summaries, capped at `limit`. */
      tables: TableSummary[];
    };

export async function specTables(args: {
  id?: string;
  filter?: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): Promise<SpecTablesResult> {
  const spec = args.spec ?? "262";
  const parsed = await loadSpec(spec, args.edition ?? "latest");
  const all = parsed.tables ?? {};

  if (args.id) {
    return { mode: "get", spec, table: all[args.id] ?? null };
  }

  const filter = args.filter?.toLowerCase();
  const limit = args.limit ?? 50;
  const list: TableSummary[] = [];
  for (const t of Object.values(all)) {
    if (filter) {
      const blob = (t.caption + " " + t.id).toLowerCase();
      if (!blob.includes(filter)) continue;
    }
    list.push({
      id: t.id,
      caption: t.caption,
      columns: t.columns,
      row_count: t.rows.length,
      ...(t.clause_id ? { clause_id: t.clause_id } : {}),
    });
  }
  list.sort((a, b) => a.id.localeCompare(b.id));
  return {
    mode: "list",
    spec,
    total: list.length,
    tables: list.slice(0, limit),
  };
}
