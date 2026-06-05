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
//
// The resolver lives in `src/spec/symbol_resolve.ts` so the stdio server
// and the Cloudflare Worker resolve a notation identically.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import { resolveSymbol } from "../../spec/symbol_resolve.js";
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

export async function specSymbolResolve(args: {
  notation: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): Promise<SymbolResolveResult> {
  const parsed = await loadSpec(args.spec ?? "262", args.edition ?? "latest");
  return resolveSymbol(parsed.clauses, { notation: args.notation, limit: args.limit });
}
