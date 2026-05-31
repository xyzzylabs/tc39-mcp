// MCP tool: spec.search — full-text-ish search over the parsed spec so
// agents can find a clause from a symptom ("Canonicalize", "unbound
// this") rather than needing the exact id. clause.get needs the id;
// this is the entry point that produces ids.
//
// Ranking (highest first):
//   exact aoid match > aoid substring > title substring > id substring
//   > step-text substring (only when search_steps is true)
//
// Returns lightweight rows ({id, aoid, title, number, kind, matched_on})
// so a follow-up clause.get fetches the full structured clause.

import { z } from "zod";
import { loadSpec } from "./clause.js";
import { joinStepText } from "../../parser/walk.js";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  type Edition,
  type Spec,
} from "../../editions.js";

export const specSearchSchema = {
  query: z
    .string()
    .min(1)
    .describe("Search text. Matched against clause id, aoid, and title (and step text when search_steps is true)."),
  spec: z
    .enum(SPEC_VALUES)
    .default("262")
    .describe(
      "Which TC39 spec to read: '262' (core language, default) or '402' (Internationalization API).",
    ),
  edition: z
    .enum(EDITION_VALUES)
    .default("latest")
    .describe(
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: main, es2025-candidate. Aliases: latest, draft, next.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Max ranked hits returned."),
  search_steps: z
    .boolean()
    .default(false)
    .describe("Also match against algorithm step text. Slower + noisier; off by default."),
};

export type SpecSearchArgs = {
  query: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
  search_steps?: boolean;
};

export interface SpecSearchHit {
  id: string;
  aoid: string | null;
  title: string;
  number: string;
  kind: string;
  /** Which field produced the match (highest-ranked one). */
  matched_on: "aoid-exact" | "aoid" | "title" | "id" | "steps";
  score: number;
}

export function specSearch(args: SpecSearchArgs): SpecSearchHit[] {
  const spec = loadSpec(args.spec ?? "262", args.edition ?? "latest");
  const q = args.query.toLowerCase();
  const searchSteps = args.search_steps ?? false;
  const limit = args.limit ?? 20;

  const hits: SpecSearchHit[] = [];
  for (const [id, c] of Object.entries(spec.clauses)) {
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
      const stepText = c.algorithms
        .map((a) => joinStepText(a.steps))
        .join("\n");
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

  // Sort by score desc, then by spec section number (lexical is fine for
  // a stable tiebreak; numeric-aware ordering isn't worth it here).
  hits.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
  return hits.slice(0, limit);
}
