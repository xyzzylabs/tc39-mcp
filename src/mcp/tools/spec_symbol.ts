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
import { loadSpec } from "./clause.js";
import { flatClauseText } from "../../parser/walk.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
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
  spec: z.enum(SPEC_VALUES).default("262"),
  edition: z.enum(EDITION_VALUES).default("latest"),
  limit: z.number().int().min(1).max(50).default(10),
};

export type SymbolKind =
  | "internal-slot"
  | "intrinsic"
  | "sigil-enum"
  | "unrecognized";

export interface SymbolHit {
  id: string;
  aoid: string | null;
  title: string;
  number: string;
  score: number;
  match_count: number;
}

export interface SymbolResolveResult {
  notation: string;
  kind: SymbolKind;
  /** Bare name with sigils stripped. */
  name: string;
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

export function specSymbolResolve(args: {
  notation: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): SymbolResolveResult {
  const { kind, name } = classify(args.notation);
  const parsed = loadSpec(args.spec ?? "262", args.edition ?? "latest");
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
