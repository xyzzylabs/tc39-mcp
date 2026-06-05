// MCP tools: proposal.list / proposal.get — TC39 proposal index.
//
// The index is a flat list of every proposal across every stage file
// in tc39/proposals, for both specs (each row carries a `spec` tag):
//
//   ECMA-262 (root):   README.md (Stages 2 / 2.7 / 3), stage-1-,
//                      stage-0-, finished-, inactive-proposals.md
//   ECMA-402 (ecma402/): README.md (active), finished-, stage-0-,
//                      inactive-proposals.md
//
// Sourced via `loadSnapshot` (cache → hosted Worker → bundled fallback);
// also producible locally via `npm run build-proposals-index` from a
// vendored checkout. No auth, no subprocess. If no layer in the chain
// can produce the index, the tools return source: "none" + a hint.

import { z } from "zod";
import { loadSnapshot } from "../../data/loader.js";
import { SPEC_VALUES } from "../../editions.js";
import { filterProposals } from "../../index/proposals_filter.js";
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
async function loadIndex(): Promise<IndexFile | null> {
  if (cache) return cache;
  // No negative caching: a transient network failure on the first
  // call must not poison the result for the rest of the process.
  // The loader has its own cache + pointer logic, so retrying here
  // is cheap when the on-disk cache exists.
  const outcome = await loadSnapshot("proposals-index.json");
  if (outcome.kind === "missing") return null;
  try {
    const parsed = JSON.parse(outcome.body) as IndexFile;
    // A legacy v1 index (still served from R2 until v0.2.0 redeploys)
    // has no per-row `spec`. v1 only ever held ECMA-262 proposals, so
    // default missing tags to "262" — every row stays spec-tagged as
    // ProposalEntry documents, and the `spec` filter stays sound.
    for (const p of parsed.proposals) p.spec ??= "262";
    cache = parsed;
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
  spec: z
    .enum(SPEC_VALUES)
    .optional()
    .describe(
      "Filter to one spec's proposals: '262' (core language) or '402' (Intl). tc39/proposals tracks the two in parallel — omit to list both.",
    ),
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
  {
    q: "Finished ECMA-402 (Intl) proposals",
    input: { spec: "402", stage: "finished" },
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
  spec?: "262" | "402";
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
  // Filtering is shared with the Worker so both transports apply the
  // same spec / stage / champion / contains filters.
  const matches = filterProposals(idx.proposals, {
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
