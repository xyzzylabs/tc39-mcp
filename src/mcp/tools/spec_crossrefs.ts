// MCP tool: spec.crossrefs — for a clause id, return its outgoing
// references (clauses it cites) and / or its incoming references
// (clauses that cite IT — a back-reference index the parse alone
// doesn't surface).
//
// The cross-reference logic lives in `src/spec/crossrefs.ts` so the
// stdio server and the Cloudflare Worker answer identically; this file
// just wires the Zod schema + edition resolution to that shared core.
// The reverse index is AOID-densified and the optional cross-spec pass
// resolves 262 ↔ 402 references — see that module for the details.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import { computeCrossrefs, type CrossrefsResult } from "../../spec/crossrefs.js";
import { resolveEdition, type Edition, type Spec } from "../../editions.js";

export const specCrossrefsSchema = {
  id: z.string().describe("Spec clause id, e.g. 'sec-tonumber' (262) or 'sec-intl.numberformat' (402)."),
  spec: specArg,
  edition: editionArg,
  direction: z
    .enum(["in", "out", "both"])
    .default("both")
    .describe(
      "'in' = clauses that reference this one (back-refs); 'out' = clauses this one references; 'both' = both.",
    ),
  include_cross_spec: z
    .boolean()
    .default(false)
    .describe(
      "If true, outgoing references also include AOIDs that resolve to the *other* TC39 spec (262 ↔ 402). Useful for queries like 'every 262 op that calls into Intl'. Off by default because it requires loading both specs.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Max hits returned in each direction (incoming and outgoing are limited independently)."),
};

export const specCrossrefsExamples = [
  {
    q: "Which clauses cite ToNumber?",
    input: { id: "sec-tonumber", direction: "in" },
    note: "The reverse index is AOID-densified — bare AOID mentions in step text count, not just explicit `<emu-xref>` hrefs.",
  },
  {
    q: "Every 262 op that Intl.Collator's compare reaches",
    input: {
      id: "sec-intl.collator.prototype.compare",
      spec: "402",
      direction: "out",
      include_cross_spec: true,
    },
    note: "`include_cross_spec` is off by default because it loads both specs into memory. Turn it on when you want the full call graph across 262/402.",
  },
  {
    q: "What external specs does String.prototype.normalize cite?",
    input: { id: "sec-string.prototype.normalize", direction: "out" },
    note: "Outgoing includes an `external` category — the clause's Unicode/IETF/WHATWG citations as resolvable URLs, alongside the internal hits.",
  },
] as const;

export async function specCrossrefs(args: {
  id: string;
  spec?: Spec;
  edition?: Edition;
  direction?: "in" | "out" | "both";
  include_cross_spec?: boolean;
  limit?: number;
}): Promise<CrossrefsResult> {
  const spec = args.spec ?? "262";
  const edition = resolveEdition(spec, args.edition ?? "latest");
  const parsed = await loadSpec(spec, edition);
  return computeCrossrefs({
    spec,
    edition,
    parsed,
    id: args.id,
    direction: args.direction ?? "both",
    limit: args.limit ?? 100,
    includeCrossSpec: args.include_cross_spec ?? false,
    // The other spec is read at its `latest` (spec-aware). A missing
    // local parse means cross-spec hits are simply skipped.
    loadOther: async (otherSpec) => {
      try {
        return await loadSpec(otherSpec, "latest");
      } catch {
        return null;
      }
    },
  });
}
