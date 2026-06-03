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
// Either way, each hit carries `source: "table" | "heuristic"` so
// callers can tell which path produced it.

import { z } from "zod";
import { loadSpec } from "./clause.js";
import { flatClauseText } from "../../parser/walk.js";
import type { ParsedSpec, SpecTable } from "../../parser/schema.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  type Edition,
  type Spec,
} from "../../editions.js";

export const specIntrinsicsSchema = {
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

const INTRINSIC_RE = /%([A-Za-z0-9_$.%]+?)%/g;
const WKI_TABLE_ID = "table-well-known-intrinsic-objects";

// ─── table-driven path ─────────────────────────────────────────────

/** Drive the result from the structured WKI table. For each row, find
 *  the clause that defines that intrinsic by matching either:
 *    a) a clause titled with `%Name%` literally, or
 *    b) a clause titled with the bare name + an "intrinsic verb"
 *       (Constructor / Object / Function), or
 *    c) the global name from the row (e.g. `Array` → "Array").
 *
 *  Falls back to `defining_clause: null` when nothing matches — the
 *  table tells the caller what the intrinsic is even without the
 *  clause pointer. */
function fromTable(
  parsed: ParsedSpec,
  table: SpecTable,
  filter: string | undefined,
  limit: number,
): IntrinsicHit[] {
  const hits: IntrinsicHit[] = [];
  // Pre-index clauses by title for cheap lookup.
  const byTitle = new Map<string, { id: string; title: string; number: string }>();
  for (const [id, c] of Object.entries(parsed.clauses)) {
    const title = c.meta.title ?? "";
    if (!title) continue;
    // Multiple clauses can share a title (e.g. forwarders); keep the
    // first, which is usually the canonical definition by section order.
    if (!byTitle.has(title)) {
      byTitle.set(title, { id, title, number: c.meta.number ?? "" });
    }
  }

  for (const row of table.rows) {
    const intrinsic = row[0] ?? "";
    const globalName = row[1] ?? "";
    const association = row[2] ?? "";
    // The "Intrinsic Name" column carries the `%Name%` form. Strip
    // the percent signs to get the bare name.
    const m = /^%([^%]+)%/.exec(intrinsic);
    if (!m) continue;
    const name = m[1]!;
    if (filter && !name.toLowerCase().includes(filter)) continue;

    let defining: IntrinsicHit["defining_clause"] = null;

    // (a) title literally contains `%Name%` — strongest match
    for (const [title, info] of byTitle) {
      if (title.includes(intrinsic)) {
        defining = { ...info, matched_on: "title-literal" };
        break;
      }
    }

    // (b) "The X Constructor" / "The X Object" — canonical defining
    //     pattern. Tried before generic bare-name substring so
    //     "%Array%" lands on "The Array Constructor" rather than
    //     "IsArray ( argument )".
    if (!defining) {
      const canonicalShapes = [
        `The ${name} Constructor`,
        `The ${name} Object`,
        `The ${name} Function`,
      ];
      outer: for (const [title, info] of byTitle) {
        for (const shape of canonicalShapes) {
          if (title.includes(shape)) {
            defining = { ...info, matched_on: "table-row" };
            break outer;
          }
        }
      }
    }

    // (c) global-name match (e.g. globalName=`Array` → title === "Array")
    if (!defining && globalName) {
      const bare = globalName.replace(/`/g, "").trim();
      if (bare) {
        for (const [title, info] of byTitle) {
          if (title === bare) {
            defining = { ...info, matched_on: "table-row" };
            break;
          }
        }
      }
    }

    // (d) bare-name substring as last resort — kept honest by the
    //     `matched_on` label so callers can downweight it
    if (!defining) {
      // Require word-boundary so "Array" doesn't hit "IsArray".
      const wbRe = new RegExp(`\\b${name.replace(/[.$+()[\]{}|^?*\\]/g, "\\$&")}\\b`);
      for (const [title, info] of byTitle) {
        if (wbRe.test(title)) {
          defining = { ...info, matched_on: "title-bare" };
          break;
        }
      }
    }
    hits.push({
      name,
      ...(globalName ? { global_name: globalName } : {}),
      ...(association ? { association } : {}),
      defining_clause: defining,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

// ─── heuristic fallback path ───────────────────────────────────────

function fromHeuristic(
  parsed: ParsedSpec,
  filter: string | undefined,
  limit: number,
): IntrinsicHit[] {
  type Acc = { name: string; mentions: number; perClause: Map<string, number> };
  const accs = new Map<string, Acc>();

  for (const [id, c] of Object.entries(parsed.clauses)) {
    const text = flatClauseText(c);
    INTRINSIC_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const seenInThisClause = new Map<string, number>();
    while ((m = INTRINSIC_RE.exec(text)) !== null) {
      const name = m[1]!;
      if (!name || /^[%.]+$/.test(name)) continue;
      seenInThisClause.set(name, (seenInThisClause.get(name) ?? 0) + 1);
    }
    for (const [name, count] of seenInThisClause) {
      if (!accs.has(name)) {
        accs.set(name, { name, mentions: 0, perClause: new Map() });
      }
      const acc = accs.get(name)!;
      acc.mentions += count;
      acc.perClause.set(id, count);
    }
  }

  const hits: IntrinsicHit[] = [];
  for (const acc of accs.values()) {
    if (filter && !acc.name.toLowerCase().includes(filter)) continue;
    const literal = `%${acc.name}%`;
    let defining: IntrinsicHit["defining_clause"] = null;
    let titleLiteral: { id: string; title: string; number: string } | null = null;
    let titleBare: { id: string; title: string; number: string } | null = null;
    let mostMentions: { id: string; title: string; number: string; n: number } = {
      id: "",
      title: "",
      number: "",
      n: 0,
    };
    for (const [id, count] of acc.perClause) {
      const c = parsed.clauses[id];
      if (!c) continue;
      const t = c.meta.title ?? "";
      if (!titleLiteral && t.includes(literal)) {
        titleLiteral = { id, title: t, number: c.meta.number ?? "" };
      }
      if (!titleBare && t.includes(acc.name)) {
        titleBare = { id, title: t, number: c.meta.number ?? "" };
      }
      if (count > mostMentions.n) {
        mostMentions = { id, title: t, number: c.meta.number ?? "", n: count };
      }
    }
    if (titleLiteral) {
      defining = { ...titleLiteral, matched_on: "title-literal" };
    } else if (titleBare) {
      defining = { ...titleBare, matched_on: "title-bare" };
    } else if (mostMentions.id) {
      const { id, title, number } = mostMentions;
      defining = { id, title, number, matched_on: "most-mentions" };
    }
    hits.push({
      name: acc.name,
      mention_count: acc.mentions,
      defining_clause: defining,
    });
  }
  hits.sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0) || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}

// ─── public entry ──────────────────────────────────────────────────

export async function specIntrinsics(args: {
  spec?: Spec;
  edition?: Edition;
  filter?: string;
  limit?: number;
}): Promise<IntrinsicsResult> {
  const spec = args.spec ?? "262";
  const parsed: ParsedSpec = await loadSpec(spec, args.edition ?? "latest");
  const filter = args.filter?.toLowerCase();
  const limit = args.limit ?? 100;

  const table = parsed.tables?.[WKI_TABLE_ID];
  if (table && table.rows.length > 0) {
    return {
      spec,
      source: "table",
      hint:
        "Hits driven from the canonical Well-Known Intrinsic Objects table (§6.1.7.4 in ECMA-262). Each row carries the global name + ECMAScript-language association; defining_clause is the parsed clause matched against the row, when one exists.",
      hits: fromTable(parsed, table, filter, limit),
    };
  }

  return {
    spec,
    source: "heuristic",
    hint:
      "No structured WKI table available for this (spec, edition). Hits come from scanning prose for `%X%` notation; defining_clause uses a title-substring heuristic. See `matched_on` per hit for confidence.",
    hits: fromHeuristic(parsed, filter, limit),
  };
}

