// Pure `spec.sdo_index` logic, shared by the stdio server and the
// Cloudflare Worker so both transports index Syntax-Directed Operations
// identically. Dependency-free (no node:fs / parser imports) so the
// Worker bundles it directly, the same way it bundles ./search.ts and
// ./catalog.ts.
//
// SDOs in ECMA-262 are abstract operations whose implementation varies
// per grammar production: a single SDO like `Evaluation` has many
// `<emu-alg>` blocks, each preceded by an `<emu-grammar>` saying which
// production this case handles. The parser captures that production
// string per algorithm; this reindexes it so callers can ask "what SDOs
// implement BindingIdentifier?" or "what productions does Evaluation
// handle?".

/** The minimal clause shape this index reads: a title plus each
 *  algorithm's optional grammar production. Structurally satisfied by
 *  both transports' `Clause`. */
export interface SdoIndexClause {
  meta: { title?: string | null };
  algorithms: { production?: string }[];
}

/** One (production, sdo) entry in the index. */
export interface SdoEntry {
  /** The clause id the algorithm lives under. */
  id: string;
  /** The clause's `<h1>` text. For an SDO, the SDO name + signature. */
  title: string;
  /** The grammar production this algorithm handles (verbatim). */
  production: string;
}

/** Core result of the SDO index, without the echoed `spec` field
 *  (each transport adds that). */
export interface SdoIndexResult {
  /** Which direction the index runs. `production` keys productions to
   *  the SDOs implementing them; `sdo` keys SDO titles to the
   *  productions they cover. */
  by: "production" | "sdo";
  /** Total number of (production, sdo) pairs in the source, before
   *  filtering / truncation. Context for when `groups` was capped. */
  pair_count: number;
  /** Number of unique groups (productions when by=production, SDO
   *  titles when by=sdo) matching the filter, before the `limit` cap. */
  group_count: number;
  /** The index. Keys are productions or SDO titles depending on `by`;
   *  values are the entries grouped under that key. */
  groups: Record<string, SdoEntry[]>;
}

/** Build the SDO ↔ production index from a spec's clauses. `by` picks
 *  the grouping direction; `filter` narrows to keys containing the
 *  substring (case-insensitive); `limit` caps the number of groups. */
export function buildSdoIndex(
  clauses: Record<string, SdoIndexClause>,
  opts: { by?: "production" | "sdo"; filter?: string; limit?: number },
): SdoIndexResult {
  const by = opts.by ?? "production";
  const filter = opts.filter?.toLowerCase();
  const limit = opts.limit ?? 50;

  // Collect every (production, sdo) pair across the parse.
  const pairs: SdoEntry[] = [];
  for (const [id, c] of Object.entries(clauses)) {
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

  // Sort keys alphabetically so output is deterministic; cap to `limit`.
  const keptKeys = Object.keys(groups).sort().slice(0, limit);
  const kept: Record<string, SdoEntry[]> = {};
  for (const k of keptKeys) kept[k] = groups[k]!;

  return {
    by,
    pair_count: pairs.length,
    group_count: Object.keys(groups).length,
    groups: kept,
  };
}
