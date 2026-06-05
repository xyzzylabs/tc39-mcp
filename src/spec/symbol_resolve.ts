// Pure `spec.symbol_resolve` logic, shared by the stdio server and the
// Cloudflare Worker so both transports resolve a notation identically.
// Dependency-free (builds on ./clause_text.ts) so the Worker bundles it
// directly.
//
// For spec notation like `[[Prototype]]`, `%Object.prototype%`, or
// `~number~`, classify the sigil, strip it to the bare name, and search
// the parsed spec for literal occurrences across signature + step text +
// notes. Hits rank by occurrence count, with a bump for "definition-y"
// sections.

import { flatClauseText, type ClauseTextStep } from "./clause_text.js";

/** Classification of a resolved notation. */
export type SymbolKind =
  | "internal-slot"
  | "intrinsic"
  | "sigil-enum"
  | "unrecognized";

/** The minimal clause shape the resolver reads. */
export interface SymbolResolveClause {
  meta: { aoid: string | null; title?: string | null; number?: string | null };
  signatureRaw: string | null;
  notes: { text: string }[];
  algorithms: { steps: ClauseTextStep[] }[];
}

/** One ranked candidate clause for a resolved notation. */
export interface SymbolHit {
  id: string;
  aoid: string | null;
  title: string;
  number: string;
  score: number;
  match_count: number;
}

/** Core result of a symbol resolution. */
export interface SymbolResolveResult {
  notation: string;
  kind: SymbolKind;
  name: string;
  hits: SymbolHit[];
}

/** Classify a notation by its sigil and return the bare name. */
export function classifySymbol(notation: string): { kind: SymbolKind; name: string } {
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
    if (sectionNumber.startsWith("6.") || sectionNumber.startsWith("10.")) {
      return 25;
    }
  } else if (kind === "intrinsic") {
    // §6.1.7.4 — well-known intrinsics table.
    if (sectionNumber.startsWith("6.1.7")) return 40;
  }
  // sigil-enum: spec sigil enums are mostly defined inline at first use;
  // no single home section.
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

/** Resolve a spec notation against a spec's clauses: rank the clauses
 *  that mention it, capped at `limit`. */
export function resolveSymbol(
  clauses: Record<string, SymbolResolveClause>,
  opts: { notation: string; limit?: number },
): SymbolResolveResult {
  const { kind, name } = classifySymbol(opts.notation);
  const limit = opts.limit ?? 10;
  const hits: SymbolHit[] = [];

  for (const [id, c] of Object.entries(clauses)) {
    const text = flatClauseText(c);
    const count = countOccurrences(text, opts.notation);
    if (count === 0) continue;
    let score = count * 10 + definitionBump(kind, c.meta.number ?? "");
    // Title containing the bare name (e.g. "Object.prototype.toString")
    // for intrinsics gets a nudge.
    if (kind === "intrinsic" && (c.meta.title ?? "").includes(name)) score += 15;
    if (kind === "internal-slot" && (c.meta.title ?? "").includes(`[[${name}]]`)) {
      score += 25;
    }
    hits.push({
      id,
      aoid: c.meta.aoid ?? null,
      title: c.meta.title ?? "",
      number: c.meta.number ?? "",
      score,
      match_count: count,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
  return { notation: opts.notation, kind, name, hits: hits.slice(0, limit) };
}
