/**
 * Parse the ecmarkdown body of an `<emu-alg>` block into a step tree.
 *
 * Ecmarkdown algorithm syntax:
 *   1. Top-level step.
 *     1. Indented sub-step.
 *       1. Sub-sub-step.
 *   1. Another top-level step.
 *
 * Every numbered marker is literally `1.` — ecmarkup renumbers at build
 * time. Indentation (2 spaces per level) marks nesting. We preserve the
 * step text verbatim (with `_x_`, `*"foo"*`, `~hint~` markup intact)
 * so callers can reason about the prose word-for-word.
 */

import type { AlgorithmStep } from "./schema.js";

const STEP_RE = /^(\s*)1\.\s+(.+?)\s*$/;

export function parseAlgorithm(emuAlgBody: string): AlgorithmStep[] {
  const lines = emuAlgBody.split(/\r?\n/);
  const root: AlgorithmStep[] = [];
  /** Stack of (indent at which this frame's children sit, target array). */
  const stack: { indent: number; steps: AlgorithmStep[] }[] = [
    { indent: -1, steps: root },
  ];

  for (const line of lines) {
    const m = STEP_RE.exec(line);
    if (!m) continue;
    const indent = m[1]!.length;
    const text = m[2]!;
    const step: AlgorithmStep = { text, substeps: [] };

    // Pop frames whose indent is >= current; they are siblings or ancestors.
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    stack[stack.length - 1]!.steps.push(step);
    stack.push({ indent, steps: step.substeps });
  }

  return root;
}
