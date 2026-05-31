// MCP tools: proposal.list / proposal.get — TC39 proposal index.
//
// The index is built once by `npm run build-proposals-index` from a
// vendored tc39/proposals checkout. It's a flat list of every proposal
// across every stage file in that repo:
//
//   README.md                — Stages 2 / 2.7 / 3 (active)
//   stage-1-proposals.md     — Stage 1
//   stage-0-proposals.md     — Stage 0
//   finished-proposals.md    — Stage 4 (advanced)
//   inactive-proposals.md    — withdrawn / rejected
//
// Same offline-only contract as test262.search: served from a static
// JSON file on disk; no auth, no network, no subprocess. If the index
// hasn't been built, the tools return source: "none" + a hint.

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_DIR } from "../../paths.js";
import type { ProposalEntry } from "../../index/proposals_parser.js";

// Re-export so historical callers can keep importing `ProposalEntry`
// from this module.
export type { ProposalEntry };

// ─── shared index loader ───────────────────────────────────────────

interface IndexFile {
  version: number;
  proposals_sha: string;
  generated_at: string;
  proposals: ProposalEntry[];
}

let cache: IndexFile | null = null;
let checkedDisk = false;
function loadIndex(): IndexFile | null {
  if (checkedDisk) return cache;
  checkedDisk = true;
  const p = join(BUILD_DIR, "proposals-index.json");
  if (!existsSync(p)) return null;
  try {
    cache = JSON.parse(readFileSync(p, "utf8")) as IndexFile;
    return cache;
  } catch {
    return null;
  }
}

const NO_INDEX_HINT =
  "Proposals index not built. Run: `npm run fetch-proposals && npm run build-proposals-index`. " +
  "Produces a ~100 KB JSON of every TC39 proposal across all stages.";

// ─── proposal.list ─────────────────────────────────────────────────

export const proposalListSchema = {
  stage: z
    .string()
    .optional()
    .describe(
      "Filter to one stage: '0', '1', '2', '2.7', '3', 'finished', 'inactive', or 'active' (anything in the active README — stages 2/2.7/3).",
    ),
  champion: z
    .string()
    .optional()
    .describe("Case-insensitive substring filter on the champion list."),
  contains: z
    .string()
    .optional()
    .describe(
      "Case-insensitive substring filter applied to the proposal name + slug.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Max proposals returned from the filtered set."),
};

export interface ProposalListResult {
  source: "index" | "none";
  proposals_sha?: string;
  total: number;
  proposals: ProposalEntry[];
  hint?: string;
}

export function proposalList(args: {
  stage?: string;
  champion?: string;
  contains?: string;
  limit?: number;
}): ProposalListResult {
  const idx = loadIndex();
  if (!idx) {
    return { source: "none", total: 0, proposals: [], hint: NO_INDEX_HINT };
  }
  const limit = args.limit ?? 100;
  const stage = args.stage;
  const champion = args.champion?.toLowerCase();
  const contains = args.contains?.toLowerCase();

  let matches = idx.proposals;
  if (stage) matches = matches.filter((p) => p.stage === stage);
  if (champion) {
    matches = matches.filter((p) =>
      p.champions.some((c) => c.toLowerCase().includes(champion)),
    );
  }
  if (contains) {
    matches = matches.filter((p) => {
      const blob = (p.name + " " + p.slug).toLowerCase();
      return blob.includes(contains);
    });
  }
  return {
    source: "index",
    proposals_sha: idx.proposals_sha,
    total: matches.length,
    proposals: matches.slice(0, limit),
  };
}

// ─── proposal.get ──────────────────────────────────────────────────

export const proposalGetSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      "Match against either the proposal's slug (preferred, exact-match) or its name (case-insensitive). Slug is the canonical id — use what proposal.list returns directly.",
    ),
};

export interface ProposalGetResult {
  source: "index" | "none";
  proposals_sha?: string;
  proposal: ProposalEntry | null;
  hint?: string;
}

export function proposalGet(args: { name: string }): ProposalGetResult {
  const idx = loadIndex();
  if (!idx) {
    return { source: "none", proposal: null, hint: NO_INDEX_HINT };
  }
  // Slug-exact wins; fall back to case-insensitive name match.
  const bySlug = idx.proposals.find((p) => p.slug === args.name);
  if (bySlug) {
    return {
      source: "index",
      proposals_sha: idx.proposals_sha,
      proposal: bySlug,
    };
  }
  const lc = args.name.toLowerCase();
  const byName = idx.proposals.find((p) => p.name.toLowerCase() === lc);
  return {
    source: "index",
    proposals_sha: idx.proposals_sha,
    proposal: byName ?? null,
  };
}
