// Tool implementations for the Cloudflare Worker. Each tool is an
// async function that takes the R2 env + the parsed args and returns
// a JSON-serializable result.
//
// v0.1.0 covers the core lookup surface: clause.get, clause.list,
// spec.search, spec.about, proposal.list, proposal.get. The richer
// tools (crossrefs index, sdo index, tables / grammar parsing,
// global_search, etc.) ride on the same R2 loader and ship in v0.2.
//
// `spec.history` and `test262.get` are filesystem / subprocess-bound
// and don't ship in the hosted Worker — the stdio server remains
// the right consumer for those.

import {
  loadParsedSpec,
  loadProposalsIndex,
  loadTest262Index,
  listSnapshots,
  type R2Env,
  type ParsedSpec,
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
): Promise<unknown> {
  const present = new Set(await listSnapshots(env));
  const snapshots: Record<string, unknown>[] = [];
  for (const spec of ["262", "402"] as const) {
    const eds = [...RELEASED_262_EDITIONS, "main"];
    for (const ed of eds) {
      const key = `spec-${spec}-${ed}.json`;
      if (!present.has(key)) {
        snapshots.push({ spec, edition: ed, present: false });
        continue;
      }
      try {
        const p = await getSpec(env, spec, ed);
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
): Promise<unknown> {
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
): Promise<unknown> {
  const limit = args.limit ?? 200;
  const p = await getSpec(
    env,
    args.spec ?? "262",
    args.edition ?? "latest",
    args.at,
  );
  const hits: unknown[] = [];
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
): Promise<unknown> {
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
): Promise<unknown> {
  const idx = await loadProposalsIndex(env);
  if (!idx) {
    return { source: "none", proposal: null, hint: "Proposals index not present in R2." };
  }
  const ps = idx.proposals as { slug: string; name: string }[];
  const bySlug = ps.find((p) => p.slug === args.name);
  if (bySlug) return { source: "index", proposals_sha: idx.proposals_sha, proposal: bySlug };
  const lc = args.name.toLowerCase();
  const byName = ps.find((p) => p.name.toLowerCase() === lc);
  return { source: "index", proposals_sha: idx.proposals_sha, proposal: byName ?? null };
}
