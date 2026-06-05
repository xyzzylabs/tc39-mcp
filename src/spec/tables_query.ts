// Pure `spec.tables` query logic, shared by the stdio server and the
// Cloudflare Worker so both transports list / fetch tables identically.
// Dependency-free (no node:fs / parser imports) so the Worker bundles
// it directly, the same way it bundles ./search.ts and ./catalog.ts.

/** The minimal `<emu-table>` shape this query reads + returns.
 *  Structurally satisfied by the parser's `SpecTable`, so callers pass
 *  their parsed tables unchanged. */
export interface TableRow {
  id: string;
  caption: string;
  columns: string[];
  rows: string[][];
  clause_id?: string;
}

/** Lightweight table summary returned in list mode. */
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

/** Core result of a tables query, without the echoed `spec` field
 *  (each transport adds that). Two discriminated variants:
 *
 *  - `get`  — full structured table (or `null` when the id misses).
 *  - `list` — summary rows, optionally filtered. */
export type TablesQueryResult =
  | {
      /** Returned when the `id` filter was set. */
      mode: "get";
      /** Full table object, or `null` when the id doesn't match. */
      table: TableRow | null;
    }
  | {
      /** Returned when the `id` filter was omitted. */
      mode: "list";
      /** Total tables matching `filter` before the `limit` cap. */
      total: number;
      /** Table summaries, capped at `limit`. */
      tables: TableSummary[];
    };

/** Query a spec's captured tables. Two modes:
 *
 *  - `id` set → return exactly that table (full columns + rows), or
 *    `null` when no table has that id.
 *  - `id` omitted → list table summaries, optionally narrowed by a
 *    case-insensitive substring `filter` over the caption or id. */
export function queryTables(
  tables: Record<string, TableRow>,
  opts: { id?: string; filter?: string; limit?: number },
): TablesQueryResult {
  if (opts.id) {
    return { mode: "get", table: tables[opts.id] ?? null };
  }

  const filter = opts.filter?.toLowerCase();
  const limit = opts.limit ?? 50;
  const list: TableSummary[] = [];
  for (const t of Object.values(tables)) {
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
  return { mode: "list", total: list.length, tables: list.slice(0, limit) };
}
