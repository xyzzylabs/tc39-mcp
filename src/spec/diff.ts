// Pure `spec.diff` clause comparison, shared by the stdio server and the
// Cloudflare Worker so both diff two editions of a spec identically.
// Dependency-free (builds on ./clause_text.ts) so the Worker bundles it.

import { walkSteps, flattenStepText, type ClauseTextStep } from "./clause_text.js";

/** The minimal clause shape the diff reads. */
export interface DiffClause {
  meta: { title?: string | null };
  signatureRaw: string | null;
  notes: { text: string }[];
  algorithms: { steps: ClauseTextStep[] }[];
  crossrefs?: string[];
}

/** Brief snapshot of a clause in one edition. */
export interface ClauseSummary {
  title: string;
  signatureRaw: string | null;
  step_count: number;
  note_count: number;
}

export type DiffStatus =
  | "identical"
  | "modified"
  | "added"
  | "removed"
  | "missing-from-both";

export interface DiffEntry {
  field: "title" | "signatureRaw" | "steps" | "notes" | "crossrefs";
  before: string | number;
  after: string | number;
  detail?: string;
}

/** Core clause-diff result, without the echoed id / from / to (each
 *  transport adds those after resolving the two editions). */
export interface DiffCore {
  same: boolean;
  status: DiffStatus;
  from_summary?: ClauseSummary;
  to_summary?: ClauseSummary;
  diffs?: DiffEntry[];
}

function countSteps(c: DiffClause): number {
  let n = 0;
  for (const a of c.algorithms) walkSteps(a.steps, () => n++);
  return n;
}

function summary(c: DiffClause): ClauseSummary {
  return {
    title: c.meta.title ?? "",
    signatureRaw: c.signatureRaw ?? null,
    step_count: countSteps(c),
    note_count: c.notes.length,
  };
}

function flatSteps(c: DiffClause): string[] {
  const out: string[] = [];
  for (const a of c.algorithms) out.push(...flattenStepText(a.steps));
  return out;
}

/** Compare a clause across two editions. `a` is the `from` clause, `b`
 *  the `to` clause; either may be undefined (added / removed / missing). */
export function diffClause(a: DiffClause | undefined, b: DiffClause | undefined): DiffCore {
  if (!a && !b) return { same: true, status: "missing-from-both" };
  if (a && !b) return { same: false, status: "removed", from_summary: summary(a) };
  if (!a && b) return { same: false, status: "added", to_summary: summary(b) };

  const aSum = summary(a!);
  const bSum = summary(b!);
  const diffs: DiffEntry[] = [];

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
    const delta = bSum.step_count - aSum.step_count;
    diffs.push({
      field: "steps",
      before: aSum.step_count,
      after: bSum.step_count,
      detail: `${delta > 0 ? "+" : ""}${delta} step(s)`,
    });
  } else {
    // Same step count — flag individual reworded steps by index.
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
    diffs.push({ field: "notes", before: aSum.note_count, after: bSum.note_count });
  }
  // Clone before sort — `.sort()` mutates in place, and the source
  // arrays live in the parsed-spec cache; mutating them would silently
  // reorder crossrefs on every subsequent load.
  const aRefs = [...(a!.crossrefs ?? [])].sort().join("\n");
  const bRefs = [...(b!.crossrefs ?? [])].sort().join("\n");
  if (aRefs !== bRefs) {
    diffs.push({
      field: "crossrefs",
      before: (a!.crossrefs ?? []).length,
      after: (b!.crossrefs ?? []).length,
    });
  }

  return {
    same: diffs.length === 0,
    status: diffs.length === 0 ? "identical" : "modified",
    from_summary: aSum,
    to_summary: bSum,
    ...(diffs.length > 0 ? { diffs } : {}),
  };
}
