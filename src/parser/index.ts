/**
 * Top-level parser entry point. Reads a `spec.html`, combines its content
 * with biblio metadata, and emits a `ParsedSpec`.
 */

import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { loadBiblioClauses } from "./biblio.js";
import { extractClause } from "./clause.js";
import { extractTables } from "./tables.js";
import { extractGrammar } from "./grammar.js";
import type { Clause, ParsedSpec, SpecPin } from "./schema.js";

export function parseSpec(specHtmlPath: string, pin: SpecPin): ParsedSpec {
  const html = readFileSync(specHtmlPath, "utf8");
  const $ = load(html, { xmlMode: false });
  const biblioMetas = loadBiblioClauses();

  const clauses: Record<string, Clause> = {};
  for (const meta of biblioMetas.values()) {
    const clause = extractClause($, meta);
    if (clause) clauses[meta.id] = clause;
  }

  const tables = extractTables($);
  const grammar = extractGrammar($);
  return { pin, clauses, tables, grammar };
}
