// MCP tool: test262.search — search the tc39/test262 conformance suite
// for tests matching a free-text query and/or a specific esid.
//
// The rank/filter logic lives in `src/index/test262_search.ts` so the
// stdio server and the Cloudflare Worker answer identically; this file
// wires the Zod schema to that shared core plus the stdio index loader.
//
// One backend: the `test262-index.json` snapshot, resolved through
// `loadSnapshot` (cache → hosted Worker → bundled fallback). Locally
// it's also producible via `npm run build-test262-index` from a
// vendored checkout. If no layer in the chain can produce the index the
// tool returns `source: "none"` plus an actionable hint, never throwing.
// No auth, no subprocess.

import { z } from "zod";
import { loadSnapshot } from "../../data/loader.js";
import { runTest262Search, type Test262IndexFile } from "../../index/test262_search.js";

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

let indexCache: Test262IndexFile | null = null;

async function loadIndex(): Promise<Test262IndexFile | null> {
  if (indexCache) return indexCache;
  // No negative caching: a transient network failure on the first
  // call must not poison the result for the rest of the process.
  // The loader has its own cache + pointer logic, so retrying here
  // is cheap when the on-disk cache exists.
  const outcome = await loadSnapshot("test262-index.json");
  if (outcome.kind === "missing") return null;
  try {
    indexCache = JSON.parse(outcome.body) as Test262IndexFile;
    return indexCache;
  } catch {
    return null;
  }
}

export async function test262Search(args: {
  query?: string;
  esid?: string;
  limit?: number;
}): Promise<Test262SearchResult> {
  return runTest262Search(
    args,
    loadIndex,
    "test262 index not built. Run: `npm run fetch-test262 && npm run build-test262-index`. " +
      "The index ships a ~13 MB JSON of every test's front-matter, served instantly with no network and no auth.",
  );
}
