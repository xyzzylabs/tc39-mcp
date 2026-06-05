// MCP tool: spec.symbol_resolve — for spec notation like `[[Prototype]]`,
// `%Object.prototype%`, or `~number~`, return clauses that mention or
// define the notation. The "what does this notation mean" entry point
// agents reach for when reading the spec cold.
//
// We classify the sigil (internal slot / intrinsic / hint enum), strip
// it to get the bare name, and search the parsed spec for literal
// occurrences across signature + step text + notes. Hits are ranked by
// where they appear: definition-y locations (§6 type domain, §10
// ordinary objects, §6.1.7.4 well-known intrinsics) get a bump.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import { flatClauseText } from "../../parser/walk.js";
import {
  type Edition,
  type Spec,
} from "../../editions.js";

export const specSymbolResolveSchema = {
  notation: z
    .string()
    .min(2)
    .describe(
      "Spec notation like `[[Prototype]]` (internal slot), `%Object.prototype%` (well-known intrinsic), or `~number~` (sigil enum).",
    ),
  spec: specArg,
  edition: editionArg,
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Max candidate clauses returned, ranked by relevance score."),
};

export const specSymbolResolveExamples = [
  {
    q: "What does `[[Prototype]]` mean?",
    input: { notation: "[[Prototype]]" },
    note: "Classified as `internal-slot`. Ranking bumps clauses in §6 (type domain) and §10 (ordinary + exotic objects).",
  },
  {
    q: "Where is `%Object.prototype%` defined?",
    input: { notation: "%Object.prototype%" },
    note: "Classified as `intrinsic`. Cross-check with `spec.tables({ id: \"table-well-known-intrinsic-objects\" })` for the authoritative WKI table.",
  },
  {
    q: "What is the `~enumerate~` hint?",
    input: { notation: "~enumerate~" },
    note: "Classified as `sigil-enum`. Useful for the Hint enums passed to ToPrimitive and friends.",
  },
] as const;

/** Classification of the notation passed to `spec.symbol_resolve`.
 *  - `internal-slot`  — `[[Name]]` form (object internal slots).
 *  - `intrinsic`      — `%Name%` form (well-known intrinsics).
 *  - `sigil-enum`     — `~name~` form (hint / state enums).
 *  - `unrecognized`   — none of the above; treated as a literal search. */
export type SymbolKind =
  | "internal-slot"
  | "intrinsic"
  | "sigil-enum"
  | "unrecognized";

/** One ranked candidate clause for a resolved notation. */
export interface SymbolHit {
  /** Spec clause id of the candidate. */
  id: string;
  /** Abstract Operation ID of the candidate, or `null` if it isn't
   *  an abstract operation. */
  aoid: string | null;
  /** `<h1>` text of the candidate clause. */
  title: string;
  /** Section number, e.g. `6.1.7.4`. */
  number: string;
  /** Relevance score, with bumps for "definition-y" sections. */
  score: number;
  /** Number of literal occurrences of the notation inside this clause. */
  match_count: number;
}

/** Output of `spec.symbol_resolve`: candidate clauses likely to
 *  define or describe a spec notation like `[[Prototype]]`. */
export interface SymbolResolveResult {
  /** The original notation as passed in. */
  notation: string;
  /** How the notation was classified. `unrecognized` triggers a
   *  literal search rather than a sigil-aware one. */
  kind: SymbolKind;
  /** Bare name with sigils stripped (e.g. `Prototype` for `[[Prototype]]`). */
  name: string;
  /** Candidate clauses, ranked, capped at `limit`. */
  hits: SymbolHit[];
}

function classify(notation: string): { kind: SymbolKind; name: string } {
  const slot = /^\[\[(.+)\]\]$/.exec(notation);
  if (slot) return { kind: "internal-slot", name: slot[1]! };
  const intrinsic = /^%(.+)%$/.exec(notation);
  if (intrinsic) return { kind: "intrinsic", name: intrinsic[1]! };
  const sigil = /^~(.+)~$/.exec(notation);
  if (sigil) return { kind: "sigil-enum", name: sigil[1]! };
  return { kind: "unrecognized", name: notation };
}

/** Per-section bumps for "definition-y" locations. The notation
 *  *defining* table tends to live under one of these section prefixes. */
function definitionBump(kind: SymbolKind, sectionNumber: string): number {
  if (kind === "internal-slot") {
    // §6 type domain / §10 ordinary + exotic objects host the slot tables.
    if (sectionNumber.startsWith("6.") || sectionNumber.startsWith("10."))
      return 25;
  } else if (kind === "intrinsic") {
    // §6.1.7.4 — well-known intrinsics table.
    if (sectionNumber.startsWith("6.1.7")) return 40;
  } else if (kind === "sigil-enum") {
    // Spec sigil enums (~number~, ~string~, ~normal~, ~throw~) are
    // mostly defined inline at first use; no single home section.
  }
  return 0;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export async function specSymbolResolve(args: {
  notation: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): Promise<SymbolResolveResult> {
  const { kind, name } = classify(args.notation);
  const parsed = await loadSpec(args.spec ?? "262", args.edition ?? "latest");
  const limit = args.limit ?? 10;
  const hits: SymbolHit[] = [];

  for (const [id, c] of Object.entries(parsed.clauses)) {
    const text = flatClauseText(c);
    const count = countOccurrences(text, args.notation);
    if (count === 0) continue;
    let score = count * 10 + definitionBump(kind, c.meta.number ?? "");
    // Title containing the bare name (e.g. "Object.prototype.toString")
    // for intrinsics gets a nudge.
    if (kind === "intrinsic" && (c.meta.title ?? "").includes(name)) score += 15;
    if (kind === "internal-slot" && (c.meta.title ?? "").includes(`[[${name}]]`))
      score += 25;
    hits.push({
      id,
      aoid: c.meta.aoid ?? null,
      title: c.meta.title ?? "",
      number: c.meta.number ?? "",
      score,
      match_count: count,
    });
  }
  hits.sort(
    (a, b) => b.score - a.score || a.number.localeCompare(b.number),
  );
  return {
    notation: args.notation,
    kind,
    name,
    hits: hits.slice(0, limit),
  };
}
