// MCP tool: spec.diff — clause-level diff across two editions of one
// TC39 spec. Reports identical / modified / added / removed plus a
// field-level breakdown (title, signature, step count, per-step
// reworded indices, notes, crossrefs).
//
// The comparison logic lives in `src/spec/diff.ts` so the stdio server
// and the Cloudflare Worker diff two editions identically.

import { z } from "zod";
import { specArg, editionArg } from "../_args.js";
import { loadSpec } from "./clause.js";
import { diffClause } from "../../spec/diff.js";
import {
  EDITION_VALUES,
  type ConcreteEdition,
  type Edition,
  type Spec,
  resolveEdition,
} from "../../editions.js";

export const specDiffSchema = {
  id: z.string().describe("Spec clause id."),
  spec: specArg,
  from: z
    .enum(EDITION_VALUES)
    .default("latest")
    .describe("The 'before' edition. Defaults to the latest stable release."),
  to: z
    .enum(EDITION_VALUES)
    .default("main")
    .describe("The 'after' edition. Defaults to the working draft (main)."),
};

export const specDiffExamples = [
  {
    q: "How did ToNumber change from es2024 to the working draft?",
    input: { id: "sec-tonumber", from: "es2024", to: "main" },
    note: "Returns `status` ('identical' / 'modified' / etc.) plus a per-field diff. Pair with `spec.history` (Cookbook recipe 2) for a temporal walk.",
  },
] as const;

interface ClauseSummary {
  title: string;
  signatureRaw: string | null;
  step_count: number;
  note_count: number;
}

/** Output of `spec.diff`: clause-level comparison between two
 *  editions of the same TC39 spec. */
export interface SpecDiffResult {
  /** Spec clause id that was diffed. */
  id: string;
  /** Concrete edition the `from` argument resolved to (e.g. `es2024`). */
  from: ConcreteEdition;
  /** Concrete edition the `to` argument resolved to (e.g. `main`). */
  to: ConcreteEdition;
  /** `true` iff the clause is byte-identical (after the structural
   *  pass) across the two editions. */
  same: boolean;
  /** High-level verdict for this clause across the two editions.
   *  `identical` — no structural changes detected.
   *  `modified`  — present in both, but differs in one or more fields.
   *  `added`     — exists in `to`, missing from `from`.
   *  `removed`   — exists in `from`, missing from `to`.
   *  `missing-from-both` — not found in either edition. */
  status:
    | "identical"
    | "modified"
    | "added"
    | "removed"
    | "missing-from-both";
  /** Brief snapshot of the clause in the `from` edition (title,
   *  signature, step/note counts). Absent when status is `added`. */
  from_summary?: ClauseSummary;
  /** Brief snapshot of the clause in the `to` edition. Absent when
   *  status is `removed`. */
  to_summary?: ClauseSummary;
  /** Field-by-field difference list. Each entry names the field that
   *  changed, its before/after values (or counts for collection
   *  fields), and an optional human-readable detail string. */
  diffs?: {
    /** Which clause field changed. */
    field: "title" | "signatureRaw" | "steps" | "notes" | "crossrefs";
    /** Value (or count) in the `from` edition. */
    before: string | number;
    /** Value (or count) in the `to` edition. */
    after: string | number;
    /** Optional human-readable note about the change (e.g. step
     *  rewording summary). */
    detail?: string;
  }[];
}

/** Generic clause diff across any two editions. */
export async function specDiff(args: {
  id: string;
  spec?: Spec;
  from?: Edition;
  to?: Edition;
}): Promise<SpecDiffResult> {
  const spec = args.spec ?? "262";
  const fromEd = resolveEdition(spec, args.from ?? "latest");
  const toEd = resolveEdition(spec, args.to ?? "main");
  const [before, after] = await Promise.all([
    loadSpec(spec, fromEd),
    loadSpec(spec, toEd),
  ]);
  const core = diffClause(before.clauses[args.id], after.clauses[args.id]);
  return { id: args.id, from: fromEd, to: toEd, ...core };
}
