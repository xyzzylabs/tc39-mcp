// Pure `spec.crossrefs` index + assembly, shared by the stdio server and
// the Cloudflare Worker so both answer cross-reference queries
// identically. Dependency-free (builds on ./clause_text.ts + the
// ./catalog.ts spec type) so the Worker bundles it directly.
//
// For a clause id the tool returns its outgoing references (clauses it
// cites) and / or its incoming references (clauses that cite IT — a
// back-reference index the parse alone doesn't surface).
//
// The reverse index gets AOID-densified: the parser only captures
// explicit <emu-xref> hrefs, but most references in spec prose are bare
// AOID mentions in step text. We scan every clause's signature, step
// text, and notes for AOID *call sites* (`Foo(`) to densify the index.

import { flatClauseText, type ClauseTextStep } from "./clause_text.js";
import type { Spec } from "./catalog.js";

/** The minimal clause shape the crossref index reads. Structurally
 *  satisfied by both transports' `Clause`. */
export interface CrossrefClause {
  meta: { aoid?: string | null; title?: string | null; number?: string | null };
  signatureRaw: string | null;
  notes: { text: string }[];
  algorithms: { steps: ClauseTextStep[] }[];
  crossrefs?: string[];
}

/** The minimal parsed-spec shape: a clause map keyed by id, plus the
 *  snapshot pin so the index memo can key on the content SHA. */
export interface CrossrefSpec {
  clauses: Record<string, CrossrefClause>;
  pin?: { sha?: string };
}

/** One cross-reference row, either incoming or outgoing. */
export interface CrossrefHit {
  /** Spec clause id of the linked clause. */
  id: string;
  /** Abstract Operation ID of the linked clause, or `null` if it
   *  isn't an abstract operation. */
  aoid: string | null;
  /** `<h1>` text of the linked clause. */
  title: string;
  /** Section number of the linked clause. */
  number: string;
  /** Which TC39 spec the linked clause lives in. With
   *  `include_cross_spec`, outgoing hits can be from a different
   *  spec than the source. */
  spec: Spec;
}

/** Output of `spec.crossrefs`. `incoming` / `outgoing` are present
 *  according to the `direction` argument. */
export interface CrossrefsResult {
  /** Clauses that reference the requested id (back-refs). Present
   *  when `direction` is `in` or `both`. */
  incoming?: CrossrefHit[];
  /** Clauses the requested id references. Present when `direction`
   *  is `out` or `both`. */
  outgoing?: CrossrefHit[];
}

/** Forward (clause → ids it references) + reverse (clause → ids that
 *  reference it) adjacency for one parsed spec. */
export interface CrossrefIndices {
  forward: Map<string, Set<string>>;
  reverse: Map<string, Set<string>>;
}

// ─── AOID call-site scanning ───────────────────────────────────────

/** Distinct AOID tokens that appear as *call sites* (`Foo(`) in `text`,
 *  mapped through `aoidToId` to clause ids, in first-appearance order.
 *
 *  We require the AOID to be followed by `(` so words like "Set" or
 *  "Get" don't false-positive on prose ("Set the value of X"). The
 *  trade-off: a prose reference like "performs the Set abstract
 *  operation" is missed, but those are typically duplicated by an
 *  explicit `<emu-xref>` anyway (captured separately from `crossrefs`). */
function callSiteTargets(text: string, aoidToId: Map<string, string>): string[] {
  // Fresh regex per call: `/g` carries `lastIndex` state across `exec`
  // loops, so a module-level instance would need manual resetting.
  const callSite = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = callSite.exec(text)) !== null) {
    const w = m[1]!;
    if (seen.has(w)) continue;
    seen.add(w);
    const target = aoidToId.get(w);
    if (target) out.push(target);
  }
  return out;
}

/** Map every clause's AOID to its id, for call-site resolution. */
function aoidIndex(parsed: CrossrefSpec): Map<string, string> {
  const m = new Map<string, string>();
  for (const [id, c] of Object.entries(parsed.clauses)) {
    if (c.meta.aoid) m.set(c.meta.aoid, id);
  }
  return m;
}

// ─── index building (+ per-(spec, edition) memo) ───────────────────

/** Build the forward + reverse cross-reference indices for one parsed
 *  spec: explicit `<emu-xref>` hrefs from the parse, densified with AOID
 *  call-site mentions found in each clause's signature + notes + step
 *  text. Pure — no I/O, no caching. */
export function buildCrossrefIndices(parsed: CrossrefSpec): CrossrefIndices {
  const aoidToId = aoidIndex(parsed);
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
    // 2. AOID call-site mentions across the clause's readable text.
    //    Title excluded — call sites live in prose, not the heading,
    //    and including the title risks matching the op's own name.
    const text = flatClauseText(c, { includeTitle: false });
    for (const target of callSiteTargets(text, aoidToId)) link(id, target);
  }

  return { forward, reverse };
}

// Per-(spec, edition, sha) memo. The key space is the finite edition
// catalog (≤ ~24 spec/edition pairs; `spec.crossrefs` never addresses by
// SHA), so this stays naturally bounded without an LRU. The content SHA
// is folded into the key so a refreshed `main` snapshot rebuilds rather
// than serving a stale adjacency: on a long-lived Worker isolate the
// parsed bytes for `main` can be re-fetched newer (the isolate's
// parsed-spec LRU evicts independently), and a sha-less key would keep
// returning the old index. Each transport bundles its own copy, so the
// map is per-process (stdio) / per-isolate (Worker).
const indexCache = new Map<string, CrossrefIndices>();

/** `buildCrossrefIndices`, memoized by `(spec, edition, content sha)`.
 *  The caller passes the already-loaded parsed spec for that pair. */
export function getCrossrefIndices(
  spec: Spec,
  edition: string,
  parsed: CrossrefSpec,
): CrossrefIndices {
  const key = `${spec}:${edition}:${parsed.pin?.sha ?? ""}`;
  const cached = indexCache.get(key);
  if (cached) return cached;
  const built = buildCrossrefIndices(parsed);
  indexCache.set(key, built);
  return built;
}

/** Reset the index memo. Test code only — the Worker recycles isolates
 *  and the stdio process is short-lived, so production never calls it. */
export function __resetCrossrefCacheForTests(): void {
  indexCache.clear();
}

// ─── hit assembly ──────────────────────────────────────────────────

/** Build a `CrossrefHit` for `id` in `parsed`, tagged with `spec`.
 *  Returns null if the id isn't present (a dangling reference). */
function crossrefHit(spec: Spec, parsed: CrossrefSpec, id: string): CrossrefHit | null {
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

/** Cross-spec outgoing refs: AOID call sites in `sourceClause` that
 *  resolve into `otherParsed` (the OTHER TC39 spec). Pure — each
 *  transport loads the other spec its own way and passes it in. Capped
 *  at `limit`. */
function crossSpecHits(
  otherSpec: Spec,
  otherParsed: CrossrefSpec,
  sourceClause: CrossrefClause | undefined,
  limit: number,
): CrossrefHit[] {
  if (!sourceClause) return [];
  const otherAoidToId = aoidIndex(otherParsed);
  const text = flatClauseText(sourceClause, { includeTitle: false });
  const hits: CrossrefHit[] = [];
  for (const targetId of callSiteTargets(text, otherAoidToId)) {
    const h = crossrefHit(otherSpec, otherParsed, targetId);
    if (h) hits.push(h);
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Assemble the in/out result from prebuilt indices + the source spec.
 *  `crossSpec` is the already-resolved cross-spec outgoing hits (only
 *  the `out`/`both` opt-in path passes it). Pure — no I/O. */
function assembleCrossrefs(args: {
  spec: Spec;
  parsed: CrossrefSpec;
  indices: CrossrefIndices;
  id: string;
  direction: "in" | "out" | "both";
  limit: number;
  crossSpec?: CrossrefHit[];
}): CrossrefsResult {
  const { spec, parsed, indices, id, direction, limit } = args;
  const out: CrossrefsResult = {};

  if (direction === "out" || direction === "both") {
    const hits: CrossrefHit[] = [];
    for (const target of indices.forward.get(id) ?? new Set<string>()) {
      const h = crossrefHit(spec, parsed, target);
      if (h) hits.push(h);
      if (hits.length >= limit) break;
    }
    hits.sort((a, b) => a.number.localeCompare(b.number));
    if (args.crossSpec) {
      const cross = [...args.crossSpec].sort((a, b) => a.number.localeCompare(b.number));
      hits.push(...cross);
    }
    out.outgoing = hits.slice(0, limit);
  }

  if (direction === "in" || direction === "both") {
    const hits: CrossrefHit[] = [];
    for (const refId of indices.reverse.get(id) ?? new Set<string>()) {
      const h = crossrefHit(spec, parsed, refId);
      if (h) hits.push(h);
      if (hits.length >= limit) break;
    }
    hits.sort((a, b) => a.number.localeCompare(b.number));
    out.incoming = hits;
  }

  return out;
}

// ─── entry point ───────────────────────────────────────────────────

/** Compute `spec.crossrefs` for one clause. The caller supplies the
 *  already-loaded source `parsed` spec plus a `loadOther` callback that
 *  loads the OTHER spec at its `latest` (used only when `includeCrossSpec`
 *  is set and direction includes `out`); the callback returns null when
 *  that spec isn't available, in which case cross-spec hits are skipped.
 *
 *  This is the single shared implementation: both transports differ only
 *  in how they load a spec (filesystem vs R2). */
export async function computeCrossrefs(args: {
  spec: Spec;
  /** Concrete edition the source spec was loaded at (used for the index
   *  memo key + nothing else). */
  edition: string;
  parsed: CrossrefSpec;
  id: string;
  direction: "in" | "out" | "both";
  limit: number;
  includeCrossSpec: boolean;
  loadOther: (otherSpec: Spec) => Promise<CrossrefSpec | null>;
}): Promise<CrossrefsResult> {
  const indices = getCrossrefIndices(args.spec, args.edition, args.parsed);

  let crossSpec: CrossrefHit[] | undefined;
  if (args.includeCrossSpec && (args.direction === "out" || args.direction === "both")) {
    const otherSpec: Spec = args.spec === "262" ? "402" : "262";
    const otherParsed = await args.loadOther(otherSpec);
    crossSpec = otherParsed
      ? crossSpecHits(otherSpec, otherParsed, args.parsed.clauses[args.id], args.limit)
      : [];
  }

  return assembleCrossrefs({
    spec: args.spec,
    parsed: args.parsed,
    indices,
    id: args.id,
    direction: args.direction,
    limit: args.limit,
    crossSpec,
  });
}
