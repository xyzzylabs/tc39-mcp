// Shared step-tree walkers over AlgorithmStep[]. Several tool modules
// used to roll their own recursive `walk()` with the same
// `s.substeps as { text: string; substeps: unknown[] }[]` cast;
// extracting here removes the duplication AND the cast.
//
// Clause-level text flattening (`spec.symbol_resolve` /
// `spec.well_known_intrinsics`) lives in `src/spec/clause_text.ts`, a
// dependency-free module the Cloudflare Worker also bundles.

import type { AlgorithmStep } from "./schema.js";

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
