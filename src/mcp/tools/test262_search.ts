// MCP tool: test262.search — search the tc39/test262 conformance suite
// for tests matching a free-text query and/or a specific esid.
//
// One backend: a local index (`build/test262-index.json`) built once
// by `npm run build-test262-index` from a vendored checkout. No auth,
// no network, no subprocess — the tool runs identically locally and
// behind a hosted Cloudflare Worker. If the index hasn't been built,
// the tool returns `source: "none"` plus an actionable hint, never
// throwing.
//
// Earlier revisions had a `gh search code` fallback; it was the only
// subprocess surface in the whole server, hosted deployments couldn't
// use it anyway, and the index path is faster + more deterministic.
// Dropped.

import { z } from "zod";
import { loadSnapshot } from "../../data/loader.js";

export const test262SearchSchema = {
  query: z
    .string()
    .optional()
    .describe(
      "Free-text query. Matched case-insensitively as whitespace-separated tokens (AND) across each test's description + path. Either `query` or `esid` (or both) must be supplied.",
    ),
  esid: z
    .string()
    .optional()
    .describe(
      "Filter to tests whose front-matter esid: starts with this prefix (case-insensitive). Prefix match catches the common case where test262 uses a more specific esid than the spec section id — e.g. `esid: 'sec-tonumber'` matches both `sec-tonumber` and `sec-tonumber-applied-to-the-string-type`.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Max ranked hits returned from the test262 index."),
};

export const test262SearchExamples = [
  {
    q: "Tests anchored to sec-tonumber",
    input: { esid: "sec-tonumber" },
    note: "`esid` is prefix-matched: this also catches `sec-tonumber-applied-to-the-string-type` and other nested ids without listing them.",
  },
  {
    q: "Tests mentioning `for-await-of`",
    input: { query: "for-await-of" },
    note: "`query` matches case-insensitively across description + path. Pair it with `esid` to AND-narrow.",
  },
] as const;

/** One ranked test262 hit. Pass `path` back to `test262.get` to read
 *  the full file source + structured front-matter. */
export interface Test262Hit {
  /** Path within the test262 checkout, relative to the repo root
   *  (e.g. `test/built-ins/Number/prototype/toString/...`). */
  path: string;
  /** Permanent URL to the file on GitHub at the indexed SHA. */
  url?: string;
  /** `esid:` value from the test's front matter (e.g. `sec-tonumber`). */
  esid?: string;
  /** `description:` value from the test's front matter. */
  description?: string;
  /** `features:` array from the test's front matter. */
  features?: string[];
  /** `flags:` array from the test's front matter (e.g. `onlyStrict`). */
  flags?: string[];
}

/** Output of `test262.search`: ranked hits from the local test262
 *  index, plus the index SHA for reproducibility. */
export interface Test262SearchResult {
  /** Echo of the `query` argument (when present). */
  query?: string;
  /** Echo of the `esid` argument (when present). */
  esid?: string;
  /** Which backend served the query.
   *  - "index" → results from `build/test262-index.json` (always).
   *  - "none"  → no index built; `hits` empty; `hint` explains setup. */
  source: "index" | "none";
  /** SHA of the vendored test262 checkout that produced this index.
   *  Absent when `source: "none"`. */
  index_sha?: string;
  /** Ranked hits, capped at `limit`. */
  hits: Test262Hit[];
  /** Human-readable setup hint, set only when `source: "none"`. */
  hint?: string;
}

// ─── local-index path ──────────────────────────────────────────────

interface IndexEntry {
  path: string;
  esid?: string;
  description?: string;
  features?: string[];
  flags?: string[];
}

interface IndexFile {
  version: number;
  test262_sha: string;
  generated_at: string;
  tests: IndexEntry[];
}

let indexCache: IndexFile | null = null;
let indexAttempted = false;

async function loadIndex(): Promise<IndexFile | null> {
  if (indexCache) return indexCache;
  if (indexAttempted) return null;
  indexAttempted = true;
  const outcome = await loadSnapshot("test262-index.json");
  if (outcome.kind === "missing") return null;
  try {
    indexCache = JSON.parse(outcome.body) as IndexFile;
    return indexCache;
  } catch {
    return null;
  }
}

function ghUrl(path: string, sha: string): string {
  return `https://github.com/tc39/test262/blob/${sha}/${path}`;
}

function searchIndex(
  idx: IndexFile,
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

// ─── public entry ──────────────────────────────────────────────────

export async function test262Search(args: {
  query?: string;
  esid?: string;
  limit?: number;
}): Promise<Test262SearchResult> {
  if (!args.query && !args.esid) {
    return {
      source: "none",
      hits: [],
      hint: "Provide either `query` or `esid` (or both).",
    };
  }

  const idx = await loadIndex();
  if (idx) return searchIndex(idx, args);

  return {
    query: args.query,
    esid: args.esid,
    source: "none",
    hits: [],
    hint:
      "test262 index not built. Run: `npm run fetch-test262 && npm run build-test262-index`. " +
      "The index ships a ~13 MB JSON of every test's front-matter, served instantly with no network and no auth.",
  };
}
