// Pure clause-text flattening, shared by the stdio server and the
// Cloudflare Worker. `spec.symbol_resolve` and `spec.well_known_intrinsics`
// scan a clause's full text for literal occurrences; this concatenates
// the searchable parts into one blob. Dependency-free (no node:fs /
// parser imports) so the Worker bundles it directly, like ./search.ts.

/** One algorithm step, possibly with nested substeps. */
export interface ClauseTextStep {
  text: string;
  substeps: ClauseTextStep[];
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
 *  (depth-first) into one newline-joined blob for a clause. */
export function flatClauseText(c: ClauseTextInput): string {
  const out: string[] = [];
  if (c.signatureRaw) out.push(c.signatureRaw);
  if (c.meta.title) out.push(c.meta.title);
  for (const n of c.notes) out.push(n.text);
  for (const algo of c.algorithms) {
    const walk = (steps: ClauseTextStep[]) => {
      for (const s of steps) {
        out.push(s.text);
        if (s.substeps.length > 0) walk(s.substeps);
      }
    };
    walk(algo.steps);
  }
  return out.join("\n");
}
