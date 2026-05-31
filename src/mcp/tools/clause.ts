// MCP tool: clause.get / clause.list — read a parsed (spec, edition).

import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import type { ParsedSpec, Clause } from "../../parser/schema.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  isSupported,
  resolveEdition,
  specJsonPath,
  type ConcreteEdition,
  type Edition,
  type Spec,
} from "../../editions.js";
import { LruMap } from "../../util/lru.js";

/** Bounded cache keyed on (spec, concrete edition). One in-memory
 *  parse per pair; aliases reuse the same entry as their concrete
 *  resolution. Capacity defaults to 4 (each parsed snapshot is
 *  ~25-50 MB on the heap, so working-set RSS stays under ~200 MB
 *  on a long-running server). Override via `TC39_MCP_LRU=N`. */
const LRU_CAP = Math.max(
  1,
  parseInt(process.env.TC39_MCP_LRU ?? "4", 10) || 4,
);
const cached = new LruMap<string, ParsedSpec>(LRU_CAP);

function cacheKey(spec: Spec, ed: ConcreteEdition): string {
  return `${spec}:${ed}`;
}

/** Load (and cache) a parsed (spec, edition). Aliases resolve to a
 *  concrete edition first; `latest` is spec-aware. Throws if the
 *  combination isn't supported or the parsed JSON hasn't been built. */
export function loadSpec(spec: Spec, edition: Edition): ParsedSpec {
  const concrete = resolveEdition(spec, edition);
  if (!isSupported(spec, concrete)) {
    throw new Error(
      `ECMA-${spec} doesn't support edition '${concrete}'. ` +
        (spec === "402"
          ? `ECMA-402 doesn't tag annual releases — use 'main' / 'latest' / 'draft' / 'next', or 'es2025-candidate'.`
          : `Supported: es2016 … es2025, main.`),
    );
  }
  const key = cacheKey(spec, concrete);
  const hit = cached.get(key);
  if (hit) return hit;
  const path = specJsonPath(spec, concrete);
  if (!existsSync(path)) {
    throw new Error(
      `Parsed spec missing: ${path}. Run 'npm run parse' first.`,
    );
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ParsedSpec;
  cached.set(key, parsed);
  return parsed;
}

// — get ——————————————————————————————————————————————

export const clauseGetSchema = {
  id: z.string().describe("Spec clause id, e.g. 'sec-tonumber' (262) or 'sec-intl.numberformat' (402)."),
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
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: main, es2025-candidate. Aliases: latest, draft, next.",
    ),
};

export type ClauseGetArgs = {
  id: string;
  spec?: Spec;
  edition?: Edition;
};

export function clauseGet(args: ClauseGetArgs): Clause | null {
  const parsed = loadSpec(args.spec ?? "262", args.edition ?? "latest");
  return parsed.clauses[args.id] ?? null;
}

// — list ——————————————————————————————————————————————

export const clauseListSchema = {
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
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: main, es2025-candidate. Aliases: latest, draft, next.",
    ),
  kind: z
    .string()
    .optional()
    .describe(
      "Filter by clause kind (e.g. 'op', 'sdo', 'built-in function', 'concrete method').",
    ),
  section: z
    .string()
    .optional()
    .describe(
      "Filter to clauses whose section number starts with this prefix, e.g. '22.2' for RegExp or '15' for the Locale-aware operations in ECMA-402.",
    ),
  has_algorithm: z
    .boolean()
    .optional()
    .describe("If true, return only clauses with at least one `<emu-alg>`."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(2500)
    .default(200)
    .describe("Max clauses returned. The full spec has ~3000 clauses; the default is a safe slice."),
};

/** Lightweight metadata row for one clause, returned by `clause.list`.
 *  Use the `id` to follow up with `clause.get` for the full structured
 *  clause (signature, steps, notes, cross-refs). */
export interface ClauseListHit {
  /** Spec clause id, e.g. `sec-tonumber`. */
  id: string;
  /** Abstract Operation ID — the spec's identifier for invocable
   *  operations (e.g. `ToNumber`). `null` for clauses that aren't
   *  abstract operations (built-ins, methods, prose-only clauses). */
  aoid: string | null;
  /** `<h1>` text of the clause, including any signature line. */
  title: string;
  /** Section number, e.g. `7.1.4` or `B.3.1` (Annex B). */
  number: string;
  /** Clause kind: `op`, `sdo`, `built-in function`, `concrete method`,
   *  `internal method`, `term`, `clause` (generic), or `unknown`. */
  kind: string;
  /** Number of `<emu-alg>` blocks under this clause. 0 for prose-only
   *  clauses; >1 for SDOs which define one algorithm per production. */
  algorithms: number;
}

export function clauseList(args: {
  spec?: Spec;
  edition?: Edition;
  kind?: string;
  section?: string;
  has_algorithm?: boolean;
  limit?: number;
}): ClauseListHit[] {
  const parsed = loadSpec(args.spec ?? "262", args.edition ?? "latest");
  const limit = args.limit ?? 200;
  const out: ClauseListHit[] = [];
  for (const [id, c] of Object.entries(parsed.clauses)) {
    if (args.kind && c.meta.kind !== args.kind) continue;
    if (args.section && !(c.meta.number ?? "").startsWith(args.section)) continue;
    if (args.has_algorithm && c.algorithms.length === 0) continue;
    out.push({
      id,
      aoid: c.meta.aoid ?? null,
      title: c.meta.title ?? "",
      number: c.meta.number ?? "",
      kind: c.meta.kind ?? "unknown",
      algorithms: c.algorithms.length,
    });
    if (out.length >= limit) break;
  }
  out.sort((a, b) => a.number.localeCompare(b.number));
  return out;
}
