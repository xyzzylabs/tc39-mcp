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
} from "./r2.js";

// ─── editions catalog ─────────────────────────────────────────────
// Local copy of the spec/edition catalog to avoid bundling
// editions.ts (which transitively imports path/fs in source-shape).

const RELEASED_262 = [
  "es2016", "es2017", "es2018", "es2019", "es2020",
  "es2021", "es2022", "es2023", "es2024", "es2025", "es2026",
] as const;
const LATEST_262 = "es2026";
// ECMA-402 publishes the same annual range as ECMA-262 (es2016 … es2026)
// and resolves `latest` to the newest stable the same way.
const LATEST_402 = "es2026";

function resolveEdition(spec: string, e: string): string {
  if (e === "latest") return spec === "262" ? LATEST_262 : LATEST_402;
  if (e === "draft" || e === "next") return "main";
  return e;
}

function isSupported(spec: string, ed: string): boolean {
  if (ed === "main") return true;
  // Both specs cover es2016 … es2026 (RELEASED_262 doubles as the 402 list).
  return (RELEASED_262 as readonly string[]).includes(ed);
}

// ─── narrow types pulled from the JSON contract ───────────────────

interface ClauseMeta {
  id: string;
  aoid: string | null;
  title: string;
  number: string;
  kind: string;
}

interface AlgorithmStep {
  text: string;
  substeps: AlgorithmStep[];
}

interface Algorithm {
  steps: AlgorithmStep[];
  production?: string;
}

interface Clause {
  meta: ClauseMeta;
  signatureRaw: string | null;
  algorithms: Algorithm[];
  notes: { text: string; id?: string; type?: string }[];
  crossrefs: string[];
}

interface ParsedSpecBody {
  pin: { spec: string; edition: string; sha: string; fetched_at?: string; biblio_commit?: string };
  clauses: Record<string, Clause>;
}

async function getSpec(
  env: R2Env,
  spec: string,
  ed: string,
  at?: string,
): Promise<ParsedSpecBody> {
  const resolved = resolveEdition(spec, ed);
  if (!isSupported(spec, resolved)) {
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
  return p as unknown as ParsedSpecBody;
}

// ─── spec.about ────────────────────────────────────────────────────

export async function specAbout(
  env: R2Env,
  serverVersion: string,
): Promise<unknown> {
  const present = new Set(await listSnapshots(env));
  const snapshots: Record<string, unknown>[] = [];
  for (const spec of ["262", "402"] as const) {
    const eds = [...RELEASED_262, "main"];
    for (const ed of eds) {
      const key = `spec-${spec}-${ed}.json`;
      if (!present.has(key)) {
        snapshots.push({ spec, edition: ed, present: false });
        continue;
      }
      try {
        const p = await getSpec(env, spec, ed);
        const tables = (p as unknown as { tables?: Record<string, unknown> }).tables;
        const grammar = (p as unknown as { grammar?: unknown[] }).grammar;
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
  },
): Promise<unknown> {
  const limit = args.limit ?? 20;
  const p = await getSpec(
    env,
    args.spec ?? "262",
    args.edition ?? "latest",
    args.at,
  );
  const q = args.query.toLowerCase();
  const hits: { id: string; aoid: string | null; title: string; number: string; kind: string; matched_on: string; score: number }[] = [];
  for (const [id, c] of Object.entries(p.clauses)) {
    const aoid = c.meta.aoid;
    const title = c.meta.title ?? "";
    let score = 0;
    let matched_on: string | null = null;
    if (aoid && aoid.toLowerCase() === q) { score = 100; matched_on = "aoid-exact"; }
    else if (aoid && aoid.toLowerCase().includes(q)) { score = 80; matched_on = "aoid"; }
    else if (title.toLowerCase().includes(q)) { score = 60; matched_on = "title"; }
    else if (id.toLowerCase().includes(q)) { score = 40; matched_on = "id"; }
    if (matched_on) {
      hits.push({
        id,
        aoid: aoid ?? null,
        title,
        number: c.meta.number ?? "",
        kind: c.meta.kind ?? "unknown",
        matched_on,
        score,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
  return { hits: hits.slice(0, limit) };
}

// ─── proposal.list / proposal.get ─────────────────────────────────

export async function proposalList(
  env: R2Env,
  args: { stage?: string; champion?: string; contains?: string; limit?: number },
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
  const stage = args.stage;
  const champion = args.champion?.toLowerCase();
  const contains = args.contains?.toLowerCase();
  let matches = idx.proposals as { slug: string; name: string; stage: string; champions: string[] }[];
  if (stage) matches = matches.filter((p) => p.stage === stage);
  if (champion) {
    matches = matches.filter((p) =>
      p.champions.some((c) => c.toLowerCase().includes(champion)),
    );
  }
  if (contains) {
    matches = matches.filter((p) =>
      (p.name + " " + p.slug).toLowerCase().includes(contains),
    );
  }
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
