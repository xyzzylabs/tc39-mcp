// Pure step + clause-text walkers, shared by the stdio server and the
// Cloudflare Worker. Several read tools (spec.symbol_resolve,
// spec.well_known_intrinsics, spec.crossrefs, spec.diff) walk a clause's
// nested algorithm steps and flatten its text. Dependency-free (no
// node:fs / parser imports) so the Worker bundles it directly, like
// ./search.ts.

/** One algorithm step, possibly with nested substeps. */
export interface ClauseTextStep {
  text: string;
  substeps: ClauseTextStep[];
}

/** Visit every step depth-first (pre-order). */
export function walkSteps(
  steps: ClauseTextStep[],
  visit: (step: ClauseTextStep) => void,
): void {
  for (const s of steps) {
    visit(s);
    if (s.substeps.length > 0) walkSteps(s.substeps, visit);
  }
}

/** Collect every step's verbatim text into a flat string[], DFS order. */
export function flattenStepText(steps: ClauseTextStep[]): string[] {
  const out: string[] = [];
  walkSteps(steps, (s) => out.push(s.text));
  return out;
}

/** The minimal clause shape `flatClauseText` reads. Structurally
 *  satisfied by both transports' `Clause`. */
export interface ClauseTextInput {
  meta: { title?: string | null };
  signatureRaw: string | null;
  notes: { text: string }[];
  algorithms: { steps: ClauseTextStep[] }[];
}

/** Concatenate signature + title + notes + every algorithm step's text
 *  (depth-first) into one newline-joined blob for a clause. Pass
 *  `{ includeTitle: false }` to drop the heading — `spec.crossrefs`
 *  scans only prose for AOID call sites, where the clause's own title
 *  would be noise (and risks matching the operation's own name). */
export function flatClauseText(
  c: ClauseTextInput,
  opts?: { includeTitle?: boolean },
): string {
  const out: string[] = [];
  if (c.signatureRaw) out.push(c.signatureRaw);
  if (opts?.includeTitle !== false && c.meta.title) out.push(c.meta.title);
  for (const n of c.notes) out.push(n.text);
  for (const algo of c.algorithms) walkSteps(algo.steps, (s) => out.push(s.text));
  return out.join("\n");
}
