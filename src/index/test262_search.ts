// Pure `test262.search` ranking + control flow, shared by the stdio
// server and the Cloudflare Worker so both rank a query against the
// `test262-index.json` snapshot identically. Dependency-free (no
// node:fs) so the Worker bundles it directly, like ./proposals_filter.ts.
//
// Each transport only differs in how it loads the index: the stdio
// server reads it through its on-disk cache / hosted-fetch chain, the
// Worker reads the same JSON from R2. Both hand a loader callback to
// `runTest262Search`, which owns the validate → load → rank flow.

/** One entry in `test262-index.json`: a single test's indexed
 *  front-matter, keyed by its path in the tc39/test262 checkout. */
export interface Test262IndexEntry {
  /** Path within the test262 checkout, relative to the repo root. */
  path: string;
  /** `esid:` front-matter value, when present. */
  esid?: string;
  /** `description:` front-matter value, when present. */
  description?: string;
  /** `features:` front-matter array, when present. */
  features?: string[];
  /** `flags:` front-matter array, when present. */
  flags?: string[];
}

/** The `test262-index.json` shape: the indexed front-matter of every
 *  test plus the SHA of the checkout that produced it. */
export interface Test262IndexFile {
  version: number;
  test262_sha: string;
  generated_at: string;
  tests: Test262IndexEntry[];
}

/** One ranked test262 hit. Pass `path` to `test262.get` to read the
 *  full file source + structured front-matter. */
export interface Test262Hit {
  /** Path within the test262 checkout, relative to the repo root. */
  path: string;
  /** Permanent URL to the file on GitHub at the indexed SHA. */
  url?: string;
  /** `esid:` value from the test's front matter. */
  esid?: string;
  /** `description:` value from the test's front matter. */
  description?: string;
  /** `features:` array from the test's front matter. */
  features?: string[];
  /** `flags:` array from the test's front matter. */
  flags?: string[];
}

/** Output of `test262.search`: ranked hits from the test262 index,
 *  plus the index SHA for reproducibility. */
export interface Test262SearchResult {
  query?: string;
  esid?: string;
  source: "index" | "none";
  index_sha?: string;
  hits: Test262Hit[];
  hint?: string;
}

function ghUrl(path: string, sha: string): string {
  return `https://github.com/tc39/test262/blob/${sha}/${path}`;
}

/** Rank the index against `query` (multi-token AND over description +
 *  path) and / or `esid` (case-insensitive prefix), capped at `limit`
 *  (default 20). Pure — no I/O. */
export function searchTest262(
  idx: Test262IndexFile,
  args: { query?: string; esid?: string; limit?: number },
): Test262SearchResult {
  const limit = args.limit ?? 20;
  const esidPrefix = args.esid?.toLowerCase();
  // Multi-token AND match: every whitespace-separated token must appear
  // somewhere in description + path. Single-word queries reduce to one
  // substring check; multi-word queries don't require the exact phrase.
  const queryTokens =
    args.query
      ?.toLowerCase()
      .split(/\s+/)
      .filter((s) => s.length > 0) ?? [];
  const hits: Test262Hit[] = [];

  for (const t of idx.tests) {
    if (esidPrefix) {
      if (!t.esid) continue;
      if (!t.esid.toLowerCase().startsWith(esidPrefix)) continue;
    }
    if (queryTokens.length > 0) {
      const haystack = (t.description ?? "").toLowerCase() + " " + t.path.toLowerCase();
      let ok = true;
      for (const tok of queryTokens) {
        if (!haystack.includes(tok)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    hits.push({
      path: t.path,
      url: ghUrl(t.path, idx.test262_sha),
      ...(t.esid ? { esid: t.esid } : {}),
      ...(t.description ? { description: t.description } : {}),
      ...(t.features ? { features: t.features } : {}),
      ...(t.flags ? { flags: t.flags } : {}),
    });
    if (hits.length >= limit) break;
  }

  return {
    query: args.query,
    esid: args.esid,
    source: "index",
    index_sha: idx.test262_sha,
    hits,
  };
}

/** The full `test262.search` flow shared by both transports: require at
 *  least one of `query` / `esid`, load the index via the caller's
 *  `loadIndex`, and rank — or return `source: "none"` with the caller's
 *  `noIndexHint` when the index isn't available. */
export async function runTest262Search(
  args: { query?: string; esid?: string; limit?: number },
  loadIndex: () => Promise<Test262IndexFile | null>,
  noIndexHint: string,
): Promise<Test262SearchResult> {
  if (!args.query && !args.esid) {
    return {
      source: "none",
      hits: [],
      hint: "Provide either `query` or `esid` (or both).",
    };
  }
  const idx = await loadIndex();
  if (idx) return searchTest262(idx, args);
  return {
    query: args.query,
    esid: args.esid,
    source: "none",
    hits: [],
    hint: noIndexHint,
  };
}
