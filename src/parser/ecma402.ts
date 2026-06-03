/**
 * ECMA-402 parser entrypoint.
 *
 * tc39/ecma402 doesn't ship a single rendered `spec.html` (the way
 * tc39/ecma262 does). Its spec is split into `spec/*.html` ecmarkup
 * fragments that the upstream build concatenates via `<emu-import>`
 * elements in `spec/index.html`.
 *
 * We don't shell out to ecmarkup. Instead we:
 *   1. Read `spec/index.html` and recursively inline every
 *      `<emu-import>` target — yielding one big HTML blob.
 *   2. Load it with cheerio.
 *   3. Walk every `<emu-clause>` in document order, synthesizing biblio
 *      metadata (id, aoid, title, number, kind) ourselves. Section
 *      numbers come from the depth-first traversal index — ECMA-402
 *      doesn't carry section numbers as attributes any more than 262
 *      does, but the order of clauses + their nesting gives them
 *      deterministically.
 *   4. Hand each clause off to the existing `extractClause()` so the
 *      output shape matches the ECMA-262 path bit-for-bit.
 *
 * Why synthesis and not `@tc39/ecma402-biblio` (which does exist):
 * unlike 262 — where the biblio IS the clause index that drives the
 * whole parse — 402's multi-file walk already recovers ids, section
 * numbers, and aoids on its own. Measured head-to-head on 402/main the
 * biblio adds a single aoid (125 → 126) and zero corrections, so it
 * isn't worth a dependency. It would also be *wrong* for the released
 * editions: the biblio only ever tracks `main`, whereas synthesis
 * reads each edition's own HTML and stays edition-correct. And it would
 * introduce a hard failure mode (a missing/broken biblio would throw),
 * where synthesis simply always works. If a future change makes 402
 * carry `aoid`/number attributes natively, revisit — but don't re-add
 * the biblio for parity; the parser is already there.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { load } from "cheerio";
import { extractClause } from "./clause.js";
import { extractTables } from "./tables.js";
import { extractGrammar } from "./grammar.js";
import { computeSectionNumbers, metaFromElement } from "./synthesize.js";
import type { Clause, ParsedSpec, SpecPin } from "./schema.js";

/** Recursively inline `<emu-import href="…">` in HTML rooted at
 *  `rootHtmlPath`, returning one combined HTML blob. */
function inlineImports(rootHtmlPath: string): string {
  const seen = new Set<string>();
  const walk = (path: string): string => {
    if (seen.has(path)) return "";
    seen.add(path);
    if (!existsSync(path)) return "";
    const html = readFileSync(path, "utf8");
    const dir = dirname(path);
    return html.replace(
      /<emu-import\s+href="([^"]+)"\s*><\/emu-import>/g,
      (_full, href: string) => walk(join(dir, href)),
    );
  };
  return walk(rootHtmlPath);
}

export function parseSpec402(rootSpecPath: string, pin: SpecPin): ParsedSpec {
  const html = inlineImports(rootSpecPath);
  const $ = load(html, { xmlMode: false });
  const numbers = computeSectionNumbers($);

  const clauses: Record<string, Clause> = {};
  $("emu-clause, emu-annex").each((_, el) => {
    const id = $(el).attr("id");
    if (!id) return;
    const meta = metaFromElement($, el, numbers.get(id) ?? "");
    if (!meta) return;
    const clause = extractClause($, meta);
    if (clause) clauses[id] = clause;
  });

  const tables = extractTables($);
  const grammar = extractGrammar($);
  return { pin, clauses, tables, grammar };
}
