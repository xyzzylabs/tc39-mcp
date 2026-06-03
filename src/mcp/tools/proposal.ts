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
import { loadSnapshot } from "../../data/loader.js";
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
let attempted = false;
async function loadIndex(): Promise<IndexFile | null> {
  if (cache) return cache;
  if (attempted) return null;
  attempted = true;
  const outcome = await loadSnapshot("proposals-index.json");
  if (outcome.kind === "missing") return null;
  try {
    cache = JSON.parse(outcome.body) as IndexFile;
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

export const proposalListExamples = [
  {
    q: "Proposals currently at Stage 3",
    input: { stage: "3" },
  },
  {
    q: "Active proposals (stages 2 / 2.7 / 3)",
    input: { stage: "active" },
  },
] as const;

/** Output of `proposal.list`: filtered slice of the TC39 proposals
 *  index, plus the index SHA so callers can pin reproducibility. */
export interface ProposalListResult {
  /** `index` when the proposals index was loaded; `none` when it
   *  hasn't been built — see `hint` for the build command. */
  source: "index" | "none";
  /** SHA of the vendored `tc39/proposals` checkout that produced
   *  this index. Absent when `source: "none"`. */
  proposals_sha?: string;
  /** Total proposals matching the filters before `limit` truncation. */
  total: number;
  /** Proposals matching the filters, capped at `limit`. */
  proposals: ProposalEntry[];
  /** Human-readable setup hint, set only when `source: "none"`. */
  hint?: string;
}

export async function proposalList(args: {
  stage?: string;
  champion?: string;
  contains?: string;
  limit?: number;
}): Promise<ProposalListResult> {
  const idx = await loadIndex();
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

export const proposalGetExamples = [
  {
    q: "Look up the Temporal proposal",
    input: { name: "temporal" },
  },
] as const;

/** Output of `proposal.get`: one proposal looked up by slug or name. */
export interface ProposalGetResult {
  /** `index` when the proposals index was loaded; `none` when it
   *  hasn't been built — see `hint`. */
  source: "index" | "none";
  /** SHA of the vendored `tc39/proposals` checkout that produced
   *  this index. Absent when `source: "none"`. */
  proposals_sha?: string;
  /** The matched proposal, or `null` when nothing matched. */
  proposal: ProposalEntry | null;
  /** Human-readable setup hint, set only when `source: "none"`. */
  hint?: string;
}

export async function proposalGet(args: { name: string }): Promise<ProposalGetResult> {
  const idx = await loadIndex();
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
