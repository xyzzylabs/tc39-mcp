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
  /** Cloudflare's built-in per-Worker rate limiter. See
   *  wrangler.toml's `[[unsafe.bindings]]` block. Optional so unit
   *  tests can construct an env without it. */
  RATE_LIMITER?: {
    limit(args: { key: string }): Promise<{ success: boolean }>;
  };
  /** Static assets binding (Workers Assets). Serves the VitePress
   *  docs site for any GET that isn't `/mcp` / `/health`. Optional so
   *  tests can omit it; the runtime fetch() handler returns a plain
   *  404 when the binding is absent. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

// We re-declare the spec types locally to keep the Worker bundle
// independent of the main `src/parser/schema.ts` (which imports
// node:fs transitively via its sibling modules). The shapes are
// pinned by the JSON contract on disk.

export interface ParsedSpec {
  pin: {
    spec: string;
    edition: string;
    sha: string;
    fetched_at?: string;
    biblio_commit?: string;
  };
  clauses: Record<string, unknown>;
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
  const obj = await env.SPECS.get(key);
  if (!obj) {
    throw new Error(
      at
        ? `Missing historical snapshot in R2: ${key}. Use \`spec.about\` to see what's available, or omit \`at\` to query the live snapshot.`
        : `Missing parsed spec object in R2: ${key}. Upload via the deploy-worker workflow or scripts/upload-r2.ts.`,
    );
  }
  const text = await obj.text();
  const parsed = JSON.parse(text) as ParsedSpec;
  specCache.set(key, parsed);
  return parsed;
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
  const obj = await env.SPECS.get("proposals-index.json");
  if (!obj) return null;
  try {
    proposalsCache = JSON.parse(await obj.text()) as ProposalsIndexFile;
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
