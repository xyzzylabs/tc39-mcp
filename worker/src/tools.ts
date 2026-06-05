// Tool implementations for the Cloudflare Worker. Each tool is an
// async function that takes the R2 env + the parsed args and returns
// a JSON-serializable result.
//
// Beyond the core lookup surface (clause.get, clause.list, spec.search,
// spec.about, proposal.list, proposal.get) the Worker also serves the
// pure-data query tools that read only the parsed spec it already loads
// from R2: spec.grammar, spec.tables, spec.sdo_index. Each shares its
// logic with the stdio server via a dependency-free `src/spec/*` module
// so the two transports answer identically.
//
// `spec.history` (git subprocess) and `test262.get` (full test sources,
// not in R2) stay filesystem / subprocess-bound and run stdio-only.

import {
  loadParsedSpec,
  loadParsedSpecUncached,
  loadProposalsIndex,
  loadTest262Index,
  listSnapshots,
  type R2Env,
  type ParsedSpec,
  type Clause,
} from "./r2.js";
// Shared, dependency-free spec/edition catalog — the same module the
// stdio server uses, bundled directly so the two never drift on edition
// coverage. It pulls in no node:fs/path, so the Worker can bundle it.
import {
  RELEASED_262_EDITIONS,
  resolveEdition,
  isSupported,
  type Spec,
  type Edition,
} from "../../src/spec/catalog.js";
import {
  searchClauses,
  type SpecSearchHit,
} from "../../src/spec/search.js";
import {
  filterProposals,
  type FilterableProposal,
} from "../../src/index/proposals_filter.js";
import {
  queryGrammar,
  type GrammarQueryResult,
  type GrammarRow,
} from "../../src/spec/grammar_query.js";
import {
  queryTables,
  type TablesQueryResult,
  type TableRow,
} from "../../src/spec/tables_query.js";
import {
  buildSdoIndex,
  type SdoIndexResult,
} from "../../src/spec/sdo_index.js";
import {
  buildOutline,
  type OutlineTree,
} from "../../src/spec/outline.js";
import {
  resolveSymbol,
  type SymbolResolveResult,
} from "../../src/spec/symbol_resolve.js";
import {
  wellKnownIntrinsics,
  type IntrinsicsResult,
} from "../../src/spec/intrinsics.js";
import {
  searchAcrossSpecs,
  type GlobalSearchHit,
} from "../../src/spec/global_search.js";
import {
  diffClause,
  type DiffCore,
} from "../../src/spec/diff.js";

// ─── tool result shapes ────────────────────────────────────────────

interface SnapshotInfo {
  spec: string;
  edition: string;
  present: boolean;
  sha?: string;
  fetched_at?: string;
  biblio_commit?: string;
  clause_count?: number;
  has_tables?: boolean;
  has_grammar?: boolean;
}

interface SpecAboutResult {
  server: { name: string; version: string };
  transport: string;
  backed_by: string;
  generated_at: string;
  snapshots: SnapshotInfo[];
  test262_index?: { test262_sha: string; generated_at: string; test_count: number };
  proposals_index?: { proposals_sha: string; generated_at: string; proposal_count: number };
}

interface ClauseListHit {
  id: string;
  aoid: string | null;
  title: string;
  number: string;
  kind: string;
  algorithms: number;
}

interface ProposalListResult {
  source: "index" | "none";
  proposals_sha?: string;
  total: number;
  proposals: FilterableProposal[];
  hint?: string;
}

interface ProposalGetResult {
  source: "index" | "none";
  proposals_sha?: string;
  proposal: FilterableProposal | null;
  hint?: string;
}

async function getSpec(
  env: R2Env,
  spec: string,
  ed: string,
  at?: string,
): Promise<ParsedSpec> {
  const resolved = resolveEdition(spec as Spec, ed as Edition);
  if (!isSupported(spec as Spec, resolved)) {
    throw new Error(`Unsupported (spec, edition): ${spec}/${ed} → ${resolved}`);
  }
  if (at) {
    // SHA addressing only applies to `main`, the one moving edition we
    // keep per-SHA history for. Released editions are served from a
    // single key with no SHA-suffixed history, so rejecting `at` there
    // avoids generating R2 keys nobody uploads.
    if (resolved !== "main") {
      throw new Error(
        `\`at\` is only valid for the 'main' edition. ${spec}/${resolved} is served from a single snapshot key with no per-SHA history; omit \`at\` to query it.`,
      );
    }
    if (!/^[a-f0-9]{4,40}$/.test(at)) {
      throw new Error(
        `\`at\` must be a hex SHA (4-40 chars). Got: ${JSON.stringify(at)}`,
      );
    }
  }
  const p = await loadParsedSpec(env, spec, resolved, at);
  return p;
}

// ─── spec.about ────────────────────────────────────────────────────

export async function specAbout(
  env: R2Env,
  serverVersion: string,
): Promise<SpecAboutResult> {
  const present = new Set(await listSnapshots(env));
  const snapshots: SnapshotInfo[] = [];
  for (const spec of ["262", "402"] as const) {
    const eds = [...RELEASED_262_EDITIONS, "main"];
    for (const ed of eds) {
      const key = `spec-${spec}-${ed}.json`;
      if (!present.has(key)) {
        snapshots.push({ spec, edition: ed, present: false });
        continue;
      }
      try {
        // Parse-and-discard rather than `getSpec`: this scan touches
        // every present (spec, edition) pair just to report counts, so
        // populating the capacity-4 `specCache` would evict concurrent
        // callers' hot clause.get / spec.search entries. The edition is
        // already concrete here, so the resolve/support checks `getSpec`
        // adds would be no-ops anyway.
        const p = await loadParsedSpecUncached(env, spec, ed);
        const tables = p.tables;
        const grammar = p.grammar;
        snapshots.push({
          spec,
          edition: ed,
          present: true,
          sha: p.pin.sha,
          fetched_at: p.pin.fetched_at,
          biblio_commit: p.pin.biblio_commit,
          clause_count: Object.keys(p.clauses).length,
          has_tables: Boolean(tables && Object.keys(tables).length > 0),
          has_grammar: Boolean(grammar && grammar.length > 0),
        });
      } catch {
        snapshots.push({ spec, edition: ed, present: false });
      }
    }
  }
  const t262 = await loadTest262Index(env);
  const props = await loadProposalsIndex(env);
  return {
    server: { name: "tc39-mcp", version: serverVersion },
    transport: "http-streamable",
    backed_by: "cloudflare-r2",
    generated_at: new Date().toISOString(),
    snapshots,
    ...(t262
      ? {
          test262_index: {
            test262_sha: t262.test262_sha,
            generated_at: t262.generated_at,
            test_count: t262.tests.length,
          },
        }
      : {}),
    ...(props
      ? {
          proposals_index: {
            proposals_sha: props.proposals_sha,
            generated_at: props.generated_at,
            proposal_count: props.proposals.length,
          },
        }
      : {}),
  };
}

// ─── clause.get ────────────────────────────────────────────────────

export async function clauseGet(
  env: R2Env,
  args: { id: string; spec?: string; edition?: string; at?: string },
): Promise<Clause | null> {
  const p = await getSpec(
    env,
    args.spec ?? "262",
    args.edition ?? "latest",
    args.at,
  );
  return p.clauses[args.id] ?? null;
}

// ─── clause.list ───────────────────────────────────────────────────

export async function clauseList(
  env: R2Env,
  args: {
    spec?: string;
    edition?: string;
    at?: string;
    kind?: string;
    section?: string;
    has_algorithm?: boolean;
    limit?: number;
  },
): Promise<{ hits: ClauseListHit[] }> {
  const limit = args.limit ?? 200;
  const p = await getSpec(
    env,
    args.spec ?? "262",
    args.edition ?? "latest",
    args.at,
  );
  const hits: ClauseListHit[] = [];
  for (const [id, c] of Object.entries(p.clauses)) {
    if (args.kind && c.meta.kind !== args.kind) continue;
    if (args.section && !(c.meta.number ?? "").startsWith(args.section)) continue;
    if (args.has_algorithm && c.algorithms.length === 0) continue;
    hits.push({
      id,
      aoid: c.meta.aoid ?? null,
      title: c.meta.title ?? "",
      number: c.meta.number ?? "",
      kind: c.meta.kind ?? "unknown",
      algorithms: c.algorithms.length,
    });
    if (hits.length >= limit) break;
  }
  return { hits };
}

// ─── spec.search ──────────────────────────────────────────────────

export async function specSearch(
  env: R2Env,
  args: {
    query: string;
    spec?: string;
    edition?: string;
    at?: string;
    limit?: number;
    search_steps?: boolean;
  },
): Promise<{ hits: SpecSearchHit[] }> {
  const p = await getSpec(
    env,
    args.spec ?? "262",
    args.edition ?? "latest",
    args.at,
  );
  // Same shared ranker the stdio server uses — including `search_steps`,
  // which the Worker previously couldn't do.
  return {
    hits: searchClauses(p.clauses, {
      query: args.query,
      searchSteps: args.search_steps,
      limit: args.limit,
    }),
  };
}

// ─── proposal.list / proposal.get ─────────────────────────────────

export async function proposalList(
  env: R2Env,
  args: { spec?: string; stage?: string; champion?: string; contains?: string; limit?: number },
): Promise<ProposalListResult> {
  const idx = await loadProposalsIndex(env);
  if (!idx) {
    return {
      source: "none",
      total: 0,
      proposals: [],
      hint: "Proposals index not present in R2. Upload via scripts/upload-r2.ts.",
    };
  }
  const limit = args.limit ?? 100;
  // Same shared filter the stdio server uses — including `spec`, which
  // the Worker previously couldn't filter on.
  const matches = filterProposals(idx.proposals as FilterableProposal[], {
    spec: args.spec,
    stage: args.stage,
    champion: args.champion,
    contains: args.contains,
  });
  return {
    source: "index",
    proposals_sha: idx.proposals_sha,
    total: matches.length,
    proposals: matches.slice(0, limit),
  };
}

export async function proposalGet(
  env: R2Env,
  args: { name: string },
): Promise<ProposalGetResult> {
  const idx = await loadProposalsIndex(env);
  if (!idx) {
    return { source: "none", proposal: null, hint: "Proposals index not present in R2." };
  }
  const ps = idx.proposals as FilterableProposal[];
  const bySlug = ps.find((p) => p.slug === args.name);
  if (bySlug) return { source: "index", proposals_sha: idx.proposals_sha, proposal: bySlug };
  const lc = args.name.toLowerCase();
  const byName = ps.find((p) => p.name.toLowerCase() === lc);
  return { source: "index", proposals_sha: idx.proposals_sha, proposal: byName ?? null };
}

// ─── spec.grammar ─────────────────────────────────────────────────

export async function specGrammar(
  env: R2Env,
  args: {
    nonterminal?: string;
    contains?: string;
    include_sdo?: boolean;
    spec?: string;
    edition?: string;
    limit?: number;
  },
): Promise<{ spec: string } & GrammarQueryResult> {
  const spec = args.spec ?? "262";
  const p = await getSpec(env, spec, args.edition ?? "latest");
  // `p.grammar` is typed `unknown[]` in the Worker's local ParsedSpec;
  // the bytes are the parser's structured GrammarProduction[] (see r2.ts).
  const core = queryGrammar((p.grammar ?? []) as GrammarRow[], {
    nonterminal: args.nonterminal,
    contains: args.contains,
    includeSdo: args.include_sdo,
    limit: args.limit,
  });
  return { spec, ...core };
}

// ─── spec.tables ──────────────────────────────────────────────────

export async function specTables(
  env: R2Env,
  args: {
    id?: string;
    filter?: string;
    spec?: string;
    edition?: string;
    limit?: number;
  },
): Promise<{ spec: string } & TablesQueryResult> {
  const spec = args.spec ?? "262";
  const p = await getSpec(env, spec, args.edition ?? "latest");
  // `p.tables` is typed `Record<string, unknown>` in the Worker's local
  // ParsedSpec; the bytes are the parser's structured SpecTable map.
  const core = queryTables((p.tables ?? {}) as Record<string, TableRow>, {
    id: args.id,
    filter: args.filter,
    limit: args.limit,
  });
  return { spec, ...core };
}

// ─── spec.sdo_index ───────────────────────────────────────────────

export async function specSdoIndex(
  env: R2Env,
  args: {
    by?: "production" | "sdo";
    filter?: string;
    spec?: string;
    edition?: string;
    limit?: number;
  },
): Promise<{ spec: string } & SdoIndexResult> {
  const spec = args.spec ?? "262";
  const p = await getSpec(env, spec, args.edition ?? "latest");
  const core = buildSdoIndex(p.clauses, {
    by: args.by,
    filter: args.filter,
    limit: args.limit,
  });
  return { spec, ...core };
}

// ─── clause.outline ───────────────────────────────────────────────

export async function clauseOutline(
  env: R2Env,
  args: { spec?: string; edition?: string; depth?: number; under?: string },
): Promise<{ spec: string } & OutlineTree> {
  const spec = args.spec ?? "262";
  const p = await getSpec(env, spec, args.edition ?? "latest");
  const core = buildOutline(p.clauses, { depth: args.depth, under: args.under });
  return { spec, ...core };
}

// ─── spec.global_search ───────────────────────────────────────────

export async function specGlobalSearch(
  env: R2Env,
  args: { query: string; search_steps?: boolean; limit?: number },
): Promise<GlobalSearchHit[]> {
  // Load both specs at their own `latest` in parallel; skip a spec whose
  // R2 snapshot is missing rather than failing the whole call.
  const loaded = await Promise.all(
    (["262", "402"] as const).map(async (spec) => {
      try {
        const p = await getSpec(env, spec, "latest");
        return { spec, clauses: p.clauses };
      } catch {
        return null;
      }
    }),
  );
  const inputs = loaded.filter((x): x is NonNullable<typeof x> => x !== null);
  return searchAcrossSpecs(inputs, {
    query: args.query,
    searchSteps: args.search_steps,
    limit: args.limit,
  });
}

// ─── spec.snapshots ───────────────────────────────────────────────
//
// Lists the live (spec, edition, sha, fetched_at) snapshots the Worker
// is serving from R2. Like spec.about it reads each present snapshot's
// `pin`, but returns the leaner snapshot-row shape (no clause counts).
// Historical SHA-pinned copies (spec-...-{sha10}.json) stay addressable
// via `at:` but aren't enumerated here.

/** One snapshot the server has available. Mirrors the stdio
 *  `spec.snapshots` row shape. */
interface SnapshotRow {
  spec: string;
  edition: string;
  sha: string;
  fetched_at?: string;
  biblio_commit?: string;
  /** Always true here — only the live snapshot for each (spec, edition)
   *  is enumerated; historical pins are reachable via `at:` but not
   *  listed. */
  live: boolean;
}

interface SnapshotsResult {
  spec_filter?: string;
  edition_filter?: string;
  snapshots: SnapshotRow[];
}

export async function specSnapshots(
  env: R2Env,
  args: { spec?: string; edition?: string },
): Promise<SnapshotsResult> {
  const keys = await listSnapshots(env);
  const rows: SnapshotRow[] = [];
  for (const key of keys) {
    // Live snapshot keys only: `spec-{spec}-{edition}.json`. The
    // historical SHA-pinned copies (`spec-...-{sha10}.json`) carry a
    // dash before a 10-hex suffix, so the `[a-z0-9]+` edition match
    // skips them.
    const m = /^spec-(262|402)-([a-z0-9]+)\.json$/.exec(key);
    if (!m) continue;
    const spec = m[1]!;
    const edition = m[2]!;
    if (args.spec && args.spec !== spec) continue;
    if (args.edition && args.edition !== edition) continue;
    // Read the snapshot for its pin via the uncached loader, so this
    // scan never populates the hot specCache LRU (which would evict live
    // clause.get / spec.search entries — same reasoning as spec.about).
    // A missing object (list-then-delete race) or corrupt snapshot
    // throws; skip it rather than fail the whole call or emit a row with
    // no sha.
    let pin: ParsedSpec["pin"];
    try {
      pin = (await loadParsedSpecUncached(env, spec, edition)).pin;
    } catch {
      continue;
    }
    if (!pin?.sha) continue;
    rows.push({
      spec,
      edition,
      sha: pin.sha,
      live: true,
      ...(pin.fetched_at ? { fetched_at: pin.fetched_at } : {}),
      ...(pin.biblio_commit ? { biblio_commit: pin.biblio_commit } : {}),
    });
  }
  // Deterministic order: spec → edition → sha (matches the stdio tool).
  rows.sort(
    (a, b) =>
      a.spec.localeCompare(b.spec) ||
      a.edition.localeCompare(b.edition) ||
      a.sha.localeCompare(b.sha),
  );
  return {
    ...(args.spec ? { spec_filter: args.spec } : {}),
    ...(args.edition ? { edition_filter: args.edition } : {}),
    snapshots: rows,
  };
}

// ─── spec.symbol_resolve ──────────────────────────────────────────

export async function specSymbolResolve(
  env: R2Env,
  args: { notation: string; spec?: string; edition?: string; limit?: number },
): Promise<SymbolResolveResult> {
  const p = await getSpec(env, args.spec ?? "262", args.edition ?? "latest");
  return resolveSymbol(p.clauses, { notation: args.notation, limit: args.limit });
}

// ─── spec.well_known_intrinsics ───────────────────────────────────

export async function specWellKnownIntrinsics(
  env: R2Env,
  args: { spec?: string; edition?: string; filter?: string; limit?: number },
): Promise<{ spec: string } & IntrinsicsResult> {
  const spec = args.spec ?? "262";
  const p = await getSpec(env, spec, args.edition ?? "latest");
  // `p.tables` is typed `Record<string, unknown>` in the Worker's local
  // ParsedSpec; the bytes are the parser's structured SpecTable map.
  const table = p.tables?.["table-well-known-intrinsic-objects"] as
    | { rows: string[][] }
    | undefined;
  const core = wellKnownIntrinsics(p.clauses, table, {
    filter: args.filter,
    limit: args.limit,
  });
  return { spec, ...core };
}

// ─── spec.diff ────────────────────────────────────────────────────

export async function specDiff(
  env: R2Env,
  args: { id: string; spec?: string; from?: string; to?: string },
): Promise<{ id: string; from: string; to: string } & DiffCore> {
  const spec = args.spec ?? "262";
  const fromEd = resolveEdition(spec as Spec, (args.from ?? "latest") as Edition);
  const toEd = resolveEdition(spec as Spec, (args.to ?? "main") as Edition);
  const [before, after] = await Promise.all([
    getSpec(env, spec, fromEd),
    getSpec(env, spec, toEd),
  ]);
  const core = diffClause(before.clauses[args.id], after.clauses[args.id]);
  return { id: args.id, from: fromEd, to: toEd, ...core };
}
