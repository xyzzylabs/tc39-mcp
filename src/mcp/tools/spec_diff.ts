// MCP tool: spec.diff — clause-level diff across two editions of one
// TC39 spec. Reports identical / modified / added / removed plus a
// field-level breakdown (title, signature, step count, per-step
// reworded indices, notes, crossrefs).

import { z } from "zod";
import { loadSpec } from "./clause.js";
import { flattenStepText, walkSteps } from "../../parser/walk.js";
import type { Clause } from "../../parser/schema.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  type ConcreteEdition,
  type Edition,
  type Spec,
  resolveEdition,
} from "../../editions.js";

// — generic `spec.diff` — works across any two editions of one spec —

export const specDiffSchema = {
  id: z.string().describe("Spec clause id."),
  spec: z
    .enum(SPEC_VALUES)
    .default("262")
    .describe(
      "Which TC39 spec to read: '262' (core language, default) or '402' (Internationalization API).",
    ),
  from: z
    .enum(EDITION_VALUES)
    .default("latest")
    .describe("The 'before' edition. Defaults to the latest stable release."),
  to: z
    .enum(EDITION_VALUES)
    .default("main")
    .describe("The 'after' edition. Defaults to the working draft (main)."),
};

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

function countSteps(c: Clause): number {
  let n = 0;
  for (const a of c.algorithms) walkSteps(a.steps, () => n++);
  return n;
}

function summary(c: Clause): ClauseSummary {
  return {
    title: c.meta.title ?? "",
    signatureRaw: c.signatureRaw ?? null,
    step_count: countSteps(c),
    note_count: c.notes.length,
  };
}

function flatSteps(c: Clause): string[] {
  const out: string[] = [];
  for (const a of c.algorithms) out.push(...flattenStepText(a.steps));
  return out;
}

/** Generic clause diff across any two editions. */
export function specDiff(args: {
  id: string;
  spec?: Spec;
  from?: Edition;
  to?: Edition;
}): SpecDiffResult {
  const spec = args.spec ?? "262";
  const fromEd = resolveEdition(spec, args.from ?? "latest");
  const toEd = resolveEdition(spec, args.to ?? "main");
  const before = loadSpec(spec, fromEd);
  const after = loadSpec(spec, toEd);
  const a = before.clauses[args.id];
  const b = after.clauses[args.id];

  if (!a && !b) {
    return {
      id: args.id,
      from: fromEd,
      to: toEd,
      same: true,
      status: "missing-from-both",
    };
  }
  if (a && !b) {
    return {
      id: args.id,
      from: fromEd,
      to: toEd,
      same: false,
      status: "removed",
      from_summary: summary(a),
    };
  }
  if (!a && b) {
    return {
      id: args.id,
      from: fromEd,
      to: toEd,
      same: false,
      status: "added",
      to_summary: summary(b),
    };
  }

  const aSum = summary(a!);
  const bSum = summary(b!);
  const diffs: NonNullable<SpecDiffResult["diffs"]> = [];

  if (aSum.title !== bSum.title) {
    diffs.push({ field: "title", before: aSum.title, after: bSum.title });
  }
  if (aSum.signatureRaw !== bSum.signatureRaw) {
    diffs.push({
      field: "signatureRaw",
      before: aSum.signatureRaw ?? "(none)",
      after: bSum.signatureRaw ?? "(none)",
    });
  }
  if (aSum.step_count !== bSum.step_count) {
    diffs.push({
      field: "steps",
      before: aSum.step_count,
      after: bSum.step_count,
      detail: `${bSum.step_count - aSum.step_count > 0 ? "+" : ""}${bSum.step_count - aSum.step_count} step(s)`,
    });
  } else {
    const aSteps = flatSteps(a!);
    const bSteps = flatSteps(b!);
    const changed: number[] = [];
    for (let i = 0; i < aSteps.length; i++) {
      if (aSteps[i] !== bSteps[i]) changed.push(i + 1);
    }
    if (changed.length > 0) {
      diffs.push({
        field: "steps",
        before: aSteps.length,
        after: bSteps.length,
        detail: `${changed.length} step(s) reworded: #${changed.join(", #")}`,
      });
    }
  }
  if (aSum.note_count !== bSum.note_count) {
    diffs.push({
      field: "notes",
      before: aSum.note_count,
      after: bSum.note_count,
    });
  }
  // Clone before sort — sort() mutates in place, and the source arrays
  // live in the parsed-spec cache. Mutating them would silently reorder
  // crossrefs on every subsequent loadSpec call.
  const aRefs = [...(a!.crossrefs ?? [])].sort().join("\n");
  const bRefs = [...(b!.crossrefs ?? [])].sort().join("\n");
  if (aRefs !== bRefs) {
    diffs.push({
      field: "crossrefs",
      before: a!.crossrefs.length,
      after: b!.crossrefs.length,
    });
  }

  return {
    id: args.id,
    from: fromEd,
    to: toEd,
    same: diffs.length === 0,
    status: diffs.length === 0 ? "identical" : "modified",
    from_summary: aSum,
    to_summary: bSum,
    ...(diffs.length > 0 ? { diffs } : {}),
  };
}
