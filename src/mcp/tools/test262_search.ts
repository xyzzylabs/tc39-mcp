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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_DIR } from "../../paths.js";

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

export interface Test262Hit {
  path: string;
  url?: string;
  esid?: string;
  description?: string;
  features?: string[];
  flags?: string[];
}

export interface Test262SearchResult {
  query?: string;
  esid?: string;
  /** Which backend served the query.
   *  - "index" → results from build/test262-index.json (always).
   *  - "none"  → no index built; `hits` empty; `hint` explains setup. */
  source: "index" | "none";
  index_sha?: string;
  hits: Test262Hit[];
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
let indexCheckedDisk = false;

function loadIndex(): IndexFile | null {
  if (indexCheckedDisk) return indexCache;
  indexCheckedDisk = true;
  const p = join(BUILD_DIR, "test262-index.json");
  if (!existsSync(p)) return null;
  try {
    indexCache = JSON.parse(readFileSync(p, "utf8")) as IndexFile;
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

export function test262Search(args: {
  query?: string;
  esid?: string;
  limit?: number;
}): Test262SearchResult {
  if (!args.query && !args.esid) {
    return {
      source: "none",
      hits: [],
      hint: "Provide either `query` or `esid` (or both).",
    };
  }

  const idx = loadIndex();
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
