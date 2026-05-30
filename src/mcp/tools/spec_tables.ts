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
  spec: z.enum(SPEC_VALUES).default("262"),
  edition: z.enum(EDITION_VALUES).default("latest"),
  limit: z.number().int().min(1).max(500).default(50),
};

export interface TableSummary {
  id: string;
  caption: string;
  columns: string[];
  row_count: number;
  clause_id?: string;
}

export type SpecTablesResult =
  | { mode: "get"; spec: Spec; table: SpecTable | null }
  | { mode: "list"; spec: Spec; total: number; tables: TableSummary[] };

export function specTables(args: {
  id?: string;
  filter?: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): SpecTablesResult {
  const spec = args.spec ?? "262";
  const parsed = loadSpec(spec, args.edition ?? "latest");
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
