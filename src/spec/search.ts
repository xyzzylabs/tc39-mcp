// Pure `spec.search` ranking, shared by the stdio server and the
// Cloudflare Worker so the two transports rank a query identically.
// Dependency-free (no node:fs / parser imports) so the Worker bundles
// it directly, the same way it bundles ./catalog.ts.

/** The minimal clause shape the ranker reads. Structurally satisfied by
 *  both the stdio parser's `Clause` and the Worker's `Clause`, so each
 *  caller passes its own parsed clauses unchanged. */
export interface SearchableClause {
  meta: {
    aoid: string | null;
    title?: string | null;
    number?: string | null;
    kind?: string | null;
  };
  algorithms: { steps: SearchableStep[] }[];
}
interface SearchableStep {
  text: string;
  substeps: SearchableStep[];
}

/** One ranked search hit. Lightweight metadata — follow up with
 *  `clause.get` for the full structured clause. */
export interface SpecSearchHit {
  /** Spec clause id of the matching clause. */
  id: string;
  /** Abstract Operation ID of the matching clause, or `null`. */
  aoid: string | null;
  /** `<h1>` text of the matching clause. */
  title: string;
  /** Section number, e.g. `7.1.4`. */
  number: string;
  /** Clause kind: `op`, `sdo`, `built-in function`, etc. */
  kind: string;
  /** Which field produced the highest-ranked match.
   *  Ordering (high → low): `aoid-exact`, `aoid`, `title`, `id`, `steps`. */
  matched_on: "aoid-exact" | "aoid" | "title" | "id" | "steps";
  /** Relevance score (0–100). Higher = stronger match. */
  score: number;
}

/** Newline-join every step's text (depth-first), for step-text matching. */
function joinSteps(steps: SearchableStep[]): string {
  const out: string[] = [];
  const walk = (ss: SearchableStep[]) => {
    for (const s of ss) {
      out.push(s.text);
      if (s.substeps.length > 0) walk(s.substeps);
    }
  };
  walk(steps);
  return out.join("\n");
}

/** Rank every clause against `query` and return hits sorted by score
 *  (then section number). Matching, highest first:
 *  exact aoid > aoid substring > title substring > id substring >
 *  step-text substring (only when `searchSteps` is true). */
export function searchClauses(
  clauses: Record<string, SearchableClause>,
  opts: { query: string; searchSteps?: boolean; limit?: number },
): SpecSearchHit[] {
  const q = opts.query.toLowerCase();
  const searchSteps = opts.searchSteps ?? false;
  const limit = opts.limit ?? 20;

  const hits: SpecSearchHit[] = [];
  for (const [id, c] of Object.entries(clauses)) {
    const aoid = c.meta.aoid;
    const title = c.meta.title ?? "";
    let score = 0;
    let matchedOn: SpecSearchHit["matched_on"] | null = null;

    if (aoid && aoid.toLowerCase() === q) {
      score = 100;
      matchedOn = "aoid-exact";
    } else if (aoid && aoid.toLowerCase().includes(q)) {
      score = 80;
      matchedOn = "aoid";
    } else if (title.toLowerCase().includes(q)) {
      score = 60;
      matchedOn = "title";
    } else if (id.toLowerCase().includes(q)) {
      score = 40;
      matchedOn = "id";
    } else if (searchSteps) {
      const stepText = c.algorithms.map((a) => joinSteps(a.steps)).join("\n");
      if (stepText.toLowerCase().includes(q)) {
        score = 20;
        matchedOn = "steps";
      }
    }

    if (matchedOn) {
      hits.push({
        id,
        aoid: aoid ?? null,
        title,
        number: c.meta.number ?? "",
        kind: c.meta.kind ?? "unknown",
        matched_on: matchedOn,
        score,
      });
    }
  }

  // Sort by score desc, then by spec section number (lexical is a fine,
  // stable tiebreak; numeric-aware ordering isn't worth it here).
  hits.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
  return hits.slice(0, limit);
}
