// R2-backed loaders for parsed spec snapshots + offline indexes.
//
// The stdio server reads `build/*.json` from disk; the Worker reads
// the same JSON shapes from a bound R2 bucket. The two share the
// same `ParsedSpec` / `IndexFile` types so the tool implementations
// can run unchanged.
//
// Per-isolate cache: an R2 GET costs ~10-20 ms cold; in steady
// state we want one cold load per (spec, edition) per isolate, then
// hits from memory. Cloudflare recycles isolates eventually, so the
// cache is best-effort, not a leak.

export interface R2Env {
  SPECS: R2Bucket;
  /** Cloudflare's built-in per-Worker rate limiter — IP-bucketed at
   *  30 req/60 s. See wrangler.toml's `[[unsafe.bindings]]` block.
   *  Optional so unit tests can construct an env without it. */
  RATE_LIMITER?: {
    limit(args: { key: string }): Promise<{ success: boolean }>;
  };
  /** Static assets binding (Workers Assets). Serves the VitePress
   *  docs site for any GET that isn't `/mcp` / `/health`. Optional so
   *  tests can omit it; the runtime fetch() handler returns a plain
   *  404 when the binding is absent. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Per-request ExecutionContext. Set by the fetch handler in
   *  `index.ts`; used here for `ctx.waitUntil(cache.put(...))` so
   *  edge-cache writes survive past the response send. Optional so
   *  unit tests and direct callers can run without it (in which case
   *  the edge-cache write is skipped and the read still works). */
  executionContext?: ExecutionContext;
}

// ─── edge-cache helper ────────────────────────────────────────────
//
// Layer two of the R2 read path. After the in-memory isolate cache
// (specCache, test262Cache, proposalsCache) misses, we check
// Cloudflare's per-colo Workers Cache. On hit, we skip R2 entirely —
// reads against the Cache API don't count toward the R2 Class B
// free allowance. On miss, we read R2, then write the bytes back
// into the cache for the next isolate that wakes up cold.
//
// Why a synthetic URL: the Cache API keys by URL. We don't expose R2
// objects on a public path, so the cache key needs to be a stable
// internal one we own. The host is intentionally a non-resolving
// `.internal` so it can never collide with real Worker routing.

const EDGE_CACHE_BASE = "https://tc39-mcp.internal/r2/";

/** TTL + immutability hint per R2 key. Per-SHA snapshots
 *  (`spec-<spec>-<edition>-<sha10>.json`, written by upload-r2.ts on
 *  every refresh) are immutable by construction — once a SHA is
 *  pinned, the bytes will never change, so cache them aggressively
 *  with `immutable`. Live `*-main.json` and `*-<edition>.json` files
 *  can be overwritten by the next refresh, so cap their TTL at
 *  300 s — short enough that a refresh-triggered redeploy propagates
 *  within five minutes, long enough to absorb burst traffic. */
function cacheControlFor(key: string): string {
  const isImmutable = /-[a-f0-9]{10}\.json$/.test(key);
  return isImmutable
    ? "public, max-age=86400, immutable"
    : "public, max-age=300";
}

/** Resolve `caches.default` defensively. Vitest runs Worker code in
 *  Node where the global isn't defined; production runs have it. */
function edgeCache(): Cache | null {
  return typeof caches !== "undefined" ? caches.default : null;
}

/** Read an R2 key as text, layered through the edge cache. Returns
 *  `null` if the object doesn't exist in R2. */
async function readTextWithEdgeCache(
  env: R2Env,
  key: string,
): Promise<string | null> {
  const store = edgeCache();
  const cacheReq = store
    ? new Request(`${EDGE_CACHE_BASE}${key}`)
    : null;

  if (store && cacheReq) {
    const hit = await store.match(cacheReq);
    if (hit) return hit.text();
  }

  const obj = await env.SPECS.get(key);
  if (!obj) return null;
  const text = await obj.text();

  if (store && cacheReq && env.executionContext) {
    env.executionContext.waitUntil(
      store.put(
        cacheReq,
        new Response(text, {
          headers: {
            "cache-control": cacheControlFor(key),
            "content-type": "application/json",
          },
        }),
      ),
    );
  }

  return text;
}

// We re-declare the spec types locally to keep the Worker bundle
// independent of the main `src/parser/schema.ts` (which imports
// node:fs transitively via its sibling modules). The shapes are
// pinned by the JSON contract on disk.

export interface ClauseMeta {
  id: string;
  aoid: string | null;
  title: string;
  number: string;
  kind: string;
}

export interface AlgorithmStep {
  text: string;
  substeps: AlgorithmStep[];
}

export interface Algorithm {
  steps: AlgorithmStep[];
  production?: string;
}

export interface Clause {
  meta: ClauseMeta;
  signatureRaw: string | null;
  algorithms: Algorithm[];
  notes: { text: string; id?: string; type?: string }[];
  crossrefs: string[];
}

export interface ParsedSpec {
  pin: {
    spec: string;
    edition: string;
    sha: string;
    fetched_at?: string;
    biblio_commit?: string;
  };
  clauses: Record<string, Clause>;
  tables?: Record<string, unknown>;
  grammar?: unknown[];
}

export interface Test262IndexFile {
  version: number;
  test262_sha: string;
  generated_at: string;
  tests: unknown[];
}

export interface ProposalsIndexFile {
  version: number;
  proposals_sha: string;
  generated_at: string;
  proposals: unknown[];
}

// ─── per-isolate caches ────────────────────────────────────────────

/** Small LRU instead of an unbounded Map. Workers recycle isolates on
 *  their own schedule (typically minutes), so even without bounding
 *  this would't be a leak — but historical-SHA queries can produce
 *  arbitrary cache keys, so we bound it explicitly. Capacity 4 covers
 *  the common workflow (latest 262 + latest 402 + 1 historical pin)
 *  with headroom. */
class IsolateLru<K, V> {
  private readonly capacity: number;
  private readonly store = new Map<K, V>();
  constructor(capacity: number) {
    this.capacity = capacity;
  }
  get(key: K): V | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }
  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      const oldest = this.store.keys().next().value as K | undefined;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

const specCache = new IsolateLru<string, ParsedSpec>(4);
let test262Cache: Test262IndexFile | null = null;
let proposalsCache: ProposalsIndexFile | null = null;

function specKey(spec: string, edition: string, at?: string): string {
  // Historical pins use the short (10-char) SHA suffix written by
  // upload-r2.ts. Callers may pass a full or truncated SHA; we
  // normalize to the first 10 characters.
  if (at) {
    const short = at.slice(0, 10);
    return `spec-${spec}-${edition}-${short}.json`;
  }
  return `spec-${spec}-${edition}.json`;
}

// ─── loaders ───────────────────────────────────────────────────────

export async function loadParsedSpec(
  env: R2Env,
  spec: string,
  edition: string,
  at?: string,
): Promise<ParsedSpec> {
  const key = specKey(spec, edition, at);
  const cached = specCache.get(key);
  if (cached) return cached;
  const text = await readTextWithEdgeCache(env, key);
  if (text === null) {
    throw new Error(
      at
        ? `Missing historical snapshot in R2: ${key}. Use \`spec.about\` to see what's available, or omit \`at\` to query the live snapshot.`
        : `Missing parsed spec object in R2: ${key}. Upload via the deploy-worker workflow or scripts/upload-r2.ts.`,
    );
  }
  const parsed = JSON.parse(text) as ParsedSpec;
  specCache.set(key, parsed);
  return parsed;
}

/** Full-parse a live snapshot WITHOUT touching the per-isolate LRU.
 *  `spec.about`'s introspection scan reads every present snapshot just
 *  to report `clause_count` / `has_tables` / `has_grammar`. Routing
 *  those parses through `loadParsedSpec` would thrash `specCache`
 *  (capacity 4) against the ~24 (spec, edition) pairs: every load
 *  evicts a hot entry, so a single scan can drop a concurrent caller's
 *  parsed `262/main` + `402/main` and force them to re-load. This still
 *  layers through the edge cache — so repeated scans skip R2 and stay
 *  cheap — but the parsed object goes straight out of scope and never
 *  enters the LRU. Mirrors the stdio server's parse-and-discard
 *  `spec.about`. Live keys only; the scan never addresses by SHA. */
export async function loadParsedSpecUncached(
  env: R2Env,
  spec: string,
  edition: string,
): Promise<ParsedSpec> {
  const key = specKey(spec, edition);
  const text = await readTextWithEdgeCache(env, key);
  if (text === null) {
    throw new Error(
      `Missing parsed spec object in R2: ${key}. Upload via the deploy-worker workflow or scripts/upload-r2.ts.`,
    );
  }
  return JSON.parse(text) as ParsedSpec;
}

/** Read just the `pin` block of a snapshot WITHOUT populating the
 *  parsed-spec LRU. Parses the full JSON (no streaming parser is
 *  available) but lets it go straight out of scope — the same
 *  parse-and-discard the stdio server uses for `spec.snapshots`, so a
 *  snapshot scan can't evict the hot `clause.get` / `spec.search`
 *  entries in `specCache`. Returns `null` when the object is missing or
 *  unparseable. */
export async function readSnapshotPin(
  env: R2Env,
  spec: string,
  edition: string,
  at?: string,
): Promise<ParsedSpec["pin"] | null> {
  const key = specKey(spec, edition, at);
  const text = await readTextWithEdgeCache(env, key);
  if (text === null) return null;
  try {
    return (JSON.parse(text) as ParsedSpec).pin ?? null;
  } catch {
    return null;
  }
}

export async function loadTest262Index(
  env: R2Env,
): Promise<Test262IndexFile | null> {
  if (test262Cache) return test262Cache;
  const obj = await env.SPECS.get("test262-index.json");
  if (!obj) return null;
  try {
    test262Cache = JSON.parse(await obj.text()) as Test262IndexFile;
    return test262Cache;
  } catch {
    return null;
  }
}

export async function loadProposalsIndex(
  env: R2Env,
): Promise<ProposalsIndexFile | null> {
  if (proposalsCache) return proposalsCache;
  const text = await readTextWithEdgeCache(env, "proposals-index.json");
  if (text === null) return null;
  try {
    proposalsCache = JSON.parse(text) as ProposalsIndexFile;
    return proposalsCache;
  } catch {
    return null;
  }
}

// ─── available snapshots (R2 LIST) ─────────────────────────────────

let snapshotIndexCache: { keys: string[]; at: number } | null = null;
const SNAPSHOT_INDEX_TTL_MS = 60_000;

/** List which `spec-*-*.json` keys exist in R2. Used by `spec.about`. */
export async function listSnapshots(env: R2Env): Promise<string[]> {
  const now = Date.now();
  if (snapshotIndexCache && now - snapshotIndexCache.at < SNAPSHOT_INDEX_TTL_MS) {
    return snapshotIndexCache.keys;
  }
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SPECS.list({ prefix: "spec-", cursor });
    for (const obj of page.objects) out.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  snapshotIndexCache = { keys: out, at: now };
  return out;
}

// ─── test-only ─────────────────────────────────────────────────────

/** Reset every module-level cache. Test code only. The Worker runtime
 *  recycles isolates on its own schedule, so production never calls
 *  this — but tests need clean state per-case to verify cache
 *  behavior in isolation. */
export function __resetCachesForTests(): void {
  specCache.clear();
  test262Cache = null;
  proposalsCache = null;
  snapshotIndexCache = null;
}
