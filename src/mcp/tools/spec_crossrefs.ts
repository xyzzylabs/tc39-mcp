// MCP tool: spec.crossrefs — for a clause id, return its outgoing
// references (clauses it cites) and / or its incoming references
// (clauses that cite IT — a back-reference index that the parse
// alone doesn't surface).
//
// The reverse index gets AOID-densified: the parser only captures
// explicit <emu-xref> hrefs, but most references in spec prose are
// bare AOID mentions in step text. We scan every clause's signature,
// step text, and notes for AOID tokens to densify the index.
//
// Cross-spec opt-in: when `direction` is `out` or `both`, you can pass
// `include_cross_spec: true` to also resolve references that point
// from ECMA-262 → ECMA-402 (or vice versa). The reverse index from a
// given spec stays single-spec; cross-spec discovery is a separate
// best-effort pass over AOIDs known to live in the other spec.

import { z } from "zod";
import { loadSpec } from "./clause.js";
import { walkSteps } from "../../parser/walk.js";
import type { ParsedSpec } from "../../parser/schema.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  resolveEdition,
  type ConcreteEdition,
  type Edition,
  type Spec,
} from "../../editions.js";

export const specCrossrefsSchema = {
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

export interface CrossrefHit {
  id: string;
  aoid: string | null;
  title: string;
  number: string;
  spec: Spec;
}

interface CrossrefsResult {
  incoming?: CrossrefHit[];
  outgoing?: CrossrefHit[];
}

interface CrossrefIndices {
  forward: Map<string, Set<string>>; // clause_id → ids it references
  reverse: Map<string, Set<string>>; // clause_id → ids that reference it
}

const indexCache = new Map<string, CrossrefIndices>();
function indexKey(spec: Spec, edition: ConcreteEdition): string {
  return `${spec}:${edition}`;
}

function buildIndices(spec: Spec, edition: ConcreteEdition): CrossrefIndices {
  const cached = indexCache.get(indexKey(spec, edition));
  if (cached) return cached;
  const parsed = loadSpec(spec, edition);

  const aoidToId = new Map<string, string>();
  for (const [id, c] of Object.entries(parsed.clauses)) {
    if (c.meta.aoid) aoidToId.set(c.meta.aoid, id);
  }

  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    if (from === to) return;
    if (!forward.has(from)) forward.set(from, new Set());
    forward.get(from)!.add(to);
    if (!reverse.has(to)) reverse.set(to, new Set());
    reverse.get(to)!.add(from);
  };

  for (const [id, c] of Object.entries(parsed.clauses)) {
    // 1. Explicit <emu-xref> hrefs from the parse.
    for (const href of c.crossrefs ?? []) {
      const target = href.startsWith("#") ? href.slice(1) : href;
      if (target) link(id, target);
    }
    // 2. AOID *call-site* mentions across all readable text in the
    //    clause. We require the AOID to be followed by `(` so words
    //    like "Set" or "Get" don't false-positive on prose ("Set the
    //    value of X"). Trade-off: prose references like "performs
    //    the Set abstract operation" are missed, but those are
    //    typically duplicated by an explicit `<emu-xref>` anyway,
    //    captured in step 1 above.
    //
    //    Pattern: identifier-ish token (the AOID character class)
    //    followed by optional whitespace and an opening paren. We
    //    take only the identifier portion as the candidate AOID.
    const blob: string[] = [];
    if (c.signatureRaw) blob.push(c.signatureRaw);
    for (const n of c.notes ?? []) blob.push(n.text);
    for (const algo of c.algorithms) walkSteps(algo.steps, (s) => blob.push(s.text));
    const text = blob.join("\n");
    const CALL_SITE_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = CALL_SITE_RE.exec(text)) !== null) {
      const w = m[1]!;
      if (seen.has(w)) continue;
      seen.add(w);
      const target = aoidToId.get(w);
      if (target) link(id, target);
    }
  }

  const indices = { forward, reverse };
  indexCache.set(indexKey(spec, edition), indices);
  return indices;
}

function hit(spec: Spec, parsed: ParsedSpec, id: string): CrossrefHit | null {
  const c = parsed.clauses[id];
  if (!c) return null;
  return {
    id,
    aoid: c.meta.aoid ?? null,
    title: c.meta.title ?? "",
    number: c.meta.number ?? "",
    spec,
  };
}

/** Cross-spec outgoing refs: scan the source clause's text for AOID
 *  mentions that resolve into the OTHER spec. The other spec is read
 *  at its `latest` (which is spec-aware: es2025 for 262, main for 402). */
function crossSpecOutgoing(
  sourceSpec: Spec,
  sourceParsed: ParsedSpec,
  sourceId: string,
  limit: number,
): CrossrefHit[] {
  const otherSpec: Spec = sourceSpec === "262" ? "402" : "262";
  let otherParsed: ParsedSpec;
  try {
    otherParsed = loadSpec(otherSpec, "latest");
  } catch {
    // Other spec hasn't been parsed locally; nothing to do.
    return [];
  }
  const otherAoidToId = new Map<string, string>();
  for (const [id, c] of Object.entries(otherParsed.clauses)) {
    if (c.meta.aoid) otherAoidToId.set(c.meta.aoid, id);
  }
  const c = sourceParsed.clauses[sourceId];
  if (!c) return [];
  const blob: string[] = [];
  if (c.signatureRaw) blob.push(c.signatureRaw);
  for (const n of c.notes ?? []) blob.push(n.text);
  const walk = (steps: { text: string; substeps: unknown[] }[]) => {
    for (const s of steps) {
      blob.push(s.text);
      if (Array.isArray(s.substeps) && s.substeps.length > 0) {
        walk(s.substeps as { text: string; substeps: unknown[] }[]);
      }
    }
  };
  for (const algo of c.algorithms) walk(algo.steps);
  // Call-site AOID matching — same precision/recall trade-off as the
  // primary index in buildIndices(). See that function's comments.
  const text = blob.join("\n");
  const CALL_SITE_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const hits: CrossrefHit[] = [];
  const seenIds = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = CALL_SITE_RE.exec(text)) !== null) {
    const w = m[1]!;
    const targetId = otherAoidToId.get(w);
    if (!targetId || seenIds.has(targetId)) continue;
    seenIds.add(targetId);
    const h = hit(otherSpec, otherParsed, targetId);
    if (h) hits.push(h);
    if (hits.length >= limit) break;
  }
  return hits;
}

export function specCrossrefs(args: {
  id: string;
  spec?: Spec;
  edition?: Edition;
  direction?: "in" | "out" | "both";
  include_cross_spec?: boolean;
  limit?: number;
}): CrossrefsResult {
  const spec = args.spec ?? "262";
  const edition = resolveEdition(spec, args.edition ?? "latest");
  const parsed = loadSpec(spec, edition);
  const direction = args.direction ?? "both";
  const limit = args.limit ?? 100;
  const indices = buildIndices(spec, edition);
  const out: CrossrefsResult = {};

  if (direction === "out" || direction === "both") {
    const hits: CrossrefHit[] = [];
    for (const target of indices.forward.get(args.id) ?? new Set()) {
      const h = hit(spec, parsed, target);
      if (h) hits.push(h);
      if (hits.length >= limit) break;
    }
    hits.sort((a, b) => a.number.localeCompare(b.number));
    if (args.include_cross_spec) {
      const cross = crossSpecOutgoing(spec, parsed, args.id, limit);
      cross.sort((a, b) => a.number.localeCompare(b.number));
      hits.push(...cross);
    }
    out.outgoing = hits.slice(0, limit);
  }

  if (direction === "in" || direction === "both") {
    const hits: CrossrefHit[] = [];
    for (const refId of indices.reverse.get(args.id) ?? new Set()) {
      const h = hit(spec, parsed, refId);
      if (h) hits.push(h);
      if (hits.length >= limit) break;
    }
    hits.sort((a, b) => a.number.localeCompare(b.number));
    out.incoming = hits;
  }

  return out;
}
