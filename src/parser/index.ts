/**
 * Top-level parser entry point. Reads a `spec.html`, combines its content
 * with biblio metadata, and emits a `ParsedSpec`.
 *
 * Two passes:
 *   1. Biblio-driven — iterate the biblio's clause list (authoritative
 *      metadata: aoid, title, number, kind) and pull each one's body out
 *      of the HTML.
 *   2. HTML-discovery fallback — the biblio is a pinned snapshot of `main`
 *      that can lag the HTML being parsed (a newer `main`, or an older
 *      edition carrying clauses since dropped from `main`). Walk every
 *      `<emu-clause>` / `<emu-annex>` and capture any id the biblio didn't
 *      supply, synthesizing its metadata from the HTML. So a stale or
 *      mismatched biblio can never silently drop a clause.
 */

import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { loadBiblioClauses } from "./biblio.js";
import { extractClause } from "./clause.js";
import { extractTables } from "./tables.js";
import { extractGrammar } from "./grammar.js";
import { computeSectionNumbers, metaFromElement } from "./synthesize.js";
import type { Clause, ParsedSpec, SpecPin } from "./schema.js";

export function parseSpec(specHtmlPath: string, pin: SpecPin): ParsedSpec {
  const html = readFileSync(specHtmlPath, "utf8");
  const $ = load(html, { xmlMode: false });
  const biblioMetas = loadBiblioClauses();

  const clauses: Record<string, Clause> = {};

  // Pass 1: biblio-driven (authoritative metadata).
  for (const meta of biblioMetas.values()) {
    const clause = extractClause($, meta);
    if (clause) clauses[meta.id] = clause;
  }

  // Pass 2: HTML-discovery fallback for anything the biblio missed.
  // Biblio-captured clauses are left untouched (keyed by id); only gaps
  // are filled, with metadata synthesized from the element itself.
  const numbers = computeSectionNumbers($);
  $("emu-clause, emu-annex").each((_, el) => {
    const id = $(el).attr("id");
    if (!id || clauses[id]) return;
    const meta = metaFromElement($, el, numbers.get(id) ?? "");
    if (!meta) return;
    const clause = extractClause($, meta);
    if (clause) clauses[id] = clause;
  });

  const tables = extractTables($);
  const grammar = extractGrammar($);
  return { pin, clauses, tables, grammar };
}
