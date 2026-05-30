// Shared step-tree walkers. Five tool modules used to roll their own
// recursive `walk()` over AlgorithmStep[] with the same `s.substeps as
// { text: string; substeps: unknown[] }[]` cast; extracting here
// removes the duplication AND the cast.

import type { AlgorithmStep, Clause } from "./schema.js";

/** Visit every step (depth-first, pre-order). */
export function walkSteps(
  steps: AlgorithmStep[],
  visitor: (step: AlgorithmStep) => void,
): void {
  for (const s of steps) {
    visitor(s);
    if (s.substeps.length > 0) walkSteps(s.substeps, visitor);
  }
}

/** Collect every step's verbatim text into a flat string[]. */
export function flattenStepText(steps: AlgorithmStep[]): string[] {
  const out: string[] = [];
  walkSteps(steps, (s) => out.push(s.text));
  return out;
}

/** Concatenate every step's text into a single newline-joined blob. */
export function joinStepText(steps: AlgorithmStep[]): string {
  return flattenStepText(steps).join("\n");
}

/** Concatenate signature + title + notes + every algorithm step's text
 *  into one searchable text blob for a clause. Used by `spec.symbol_resolve`
 *  and `spec.well_known_intrinsics` for occurrence-counting. */
export function flatClauseText(c: Clause): string {
  const out: string[] = [];
  if (c.signatureRaw) out.push(c.signatureRaw);
  if (c.meta.title) out.push(c.meta.title);
  for (const n of c.notes) out.push(n.text);
  for (const algo of c.algorithms) walkSteps(algo.steps, (s) => out.push(s.text));
  return out.join("\n");
}
