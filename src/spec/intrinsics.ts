// Pure `spec.well_known_intrinsics` logic, shared by the stdio server
// and the Cloudflare Worker so both transports enumerate intrinsics
// identically. Dependency-free (builds on ./clause_text.ts) so the
// Worker bundles it directly.
//
// Resolution strategy (in order of authority):
//   1. If the parsed spec includes the canonical WKI table
//      (262's §6.1.7.4 `table-well-known-intrinsic-objects`), drive
//      from that — each row maps `%Name%` to a description and we match
//      it to the clause whose title most closely corresponds.
//   2. Otherwise (e.g. ECMA-402, which has no such table), fall back to
//      scanning every clause's title + signature + step text for `%X%`
//      notation and ranking by occurrence + a title-substring heuristic.
//
// Each hit carries `defining_clause.matched_on` so callers can tell how
// it was picked, and the result `source` says which path produced it.

import { flatClauseText, type ClauseTextStep } from "./clause_text.js";

const INTRINSIC_RE = /%([A-Za-z0-9_$.%]+?)%/g;

/** The minimal clause shape the intrinsics scan reads. */
export interface IntrinsicsClause {
  meta: { title?: string | null; number?: string | null };
  signatureRaw: string | null;
  notes: { text: string }[];
  algorithms: { steps: ClauseTextStep[] }[];
}

/** The minimal table shape the table-driven path reads. */
export interface IntrinsicsTable {
  rows: string[][];
}

export interface IntrinsicHit {
  name: string;
  mention_count?: number;
  association?: string;
  global_name?: string;
  defining_clause: {
    id: string;
    title: string;
    number: string;
    matched_on: "table-row" | "title-literal" | "title-bare" | "most-mentions";
  } | null;
}

/** Core result of an intrinsics scan, without the echoed `spec` field. */
export interface IntrinsicsResult {
  source: "table" | "heuristic";
  hint: string;
  hits: IntrinsicHit[];
}

const TABLE_HINT =
  "Hits driven from the canonical Well-Known Intrinsic Objects table (§6.1.7.4 in ECMA-262). Each row carries the global name + ECMAScript-language association; defining_clause is the parsed clause matched against the row, when one exists.";
const HEURISTIC_HINT =
  "No structured WKI table available for this (spec, edition). Hits come from scanning prose for `%X%` notation; defining_clause uses a title-substring heuristic. See `matched_on` per hit for confidence.";

// ─── table-driven path ─────────────────────────────────────────────

function fromTable(
  clauses: Record<string, IntrinsicsClause>,
  table: IntrinsicsTable,
  filter: string | undefined,
  limit: number,
): IntrinsicHit[] {
  const hits: IntrinsicHit[] = [];
  // Pre-index clauses by title for cheap lookup. Multiple clauses can
  // share a title; keep the first (usually the canonical definition by
  // section order).
  const byTitle = new Map<string, { id: string; title: string; number: string }>();
  for (const [id, c] of Object.entries(clauses)) {
    const title = c.meta.title ?? "";
    if (!title) continue;
    if (!byTitle.has(title)) {
      byTitle.set(title, { id, title, number: c.meta.number ?? "" });
    }
  }

  for (const row of table.rows) {
    const intrinsic = row[0] ?? "";
    const globalName = row[1] ?? "";
    const association = row[2] ?? "";
    const m = /^%([^%]+)%/.exec(intrinsic);
    if (!m) continue;
    const name = m[1]!;
    if (filter && !name.toLowerCase().includes(filter)) continue;

    let defining: IntrinsicHit["defining_clause"] = null;

    // (a) title literally contains `%Name%` — strongest match.
    for (const [title, info] of byTitle) {
      if (title.includes(intrinsic)) {
        defining = { ...info, matched_on: "title-literal" };
        break;
      }
    }

    // (b) "The X Constructor / Object / Function" — canonical defining
    //     pattern, tried before a generic bare-name substring.
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

    // (c) global-name match (e.g. globalName=`Array` → title === "Array").
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

    // (d) bare-name substring as last resort, word-boundaried so "Array"
    //     doesn't hit "IsArray".
    if (!defining) {
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
  clauses: Record<string, IntrinsicsClause>,
  filter: string | undefined,
  limit: number,
): IntrinsicHit[] {
  type Acc = { name: string; mentions: number; perClause: Map<string, number> };
  const accs = new Map<string, Acc>();

  for (const [id, c] of Object.entries(clauses)) {
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
      const c = clauses[id];
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
  hits.sort(
    (a, b) =>
      (b.mention_count ?? 0) - (a.mention_count ?? 0) || a.name.localeCompare(b.name),
  );
  return hits.slice(0, limit);
}

/** Enumerate the well-known intrinsics in a spec. Drives from the
 *  canonical WKI table when present, else falls back to a prose scan. */
export function wellKnownIntrinsics(
  clauses: Record<string, IntrinsicsClause>,
  table: IntrinsicsTable | undefined,
  opts: { filter?: string; limit?: number },
): IntrinsicsResult {
  const filter = opts.filter?.toLowerCase();
  const limit = opts.limit ?? 100;

  if (table && table.rows.length > 0) {
    return { source: "table", hint: TABLE_HINT, hits: fromTable(clauses, table, filter, limit) };
  }
  return {
    source: "heuristic",
    hint: HEURISTIC_HINT,
    hits: fromHeuristic(clauses, filter, limit),
  };
}
