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
import { load, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { extractClause } from "./clause.js";
import { extractTables } from "./tables.js";
import { extractGrammar } from "./grammar.js";
import type {
  Clause,
  ClauseKind,
  ClauseMeta,
  ParsedSpec,
  SpecPin,
} from "./schema.js";

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

/** Compute section numbers by walking `<emu-clause>` / `<emu-annex>` in
 *  document order. Top-level clauses are 1, 2, 3, …; their children
 *  are 1.1, 1.2, 2.1, …; annexes are A, B, C, …
 *
 *  Returns a map keyed on clause id → section number string. */
function computeSectionNumbers($: CheerioAPI): Map<string, string> {
  const numbers = new Map<string, string>();
  // Find the outermost containers — anything that's an emu-clause /
  // emu-annex with no ancestor of the same tag.
  const rootSel = "emu-clause, emu-annex";
  const tops = $(rootSel).filter((_, el) => {
    return $(el).parents("emu-clause, emu-annex, emu-intro").length === 0;
  });
  // Separate intro / regular clauses / annexes; numbering rules differ.
  let clauseCounter = 0;
  let annexCounter = 0; // A, B, C …
  const assignChildren = (parentSel: ReturnType<CheerioAPI>, prefix: string): void => {
    let sub = 0;
    parentSel.children("emu-clause, emu-annex").each((_, child) => {
      sub++;
      const id = $(child).attr("id");
      const num = `${prefix}.${sub}`;
      if (id) numbers.set(id, num);
      assignChildren($(child), num);
    });
  };
  tops.each((_, el) => {
    const $el = $(el);
    const id = $el.attr("id");
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    let num: string;
    if (tag === "emu-annex") {
      num = String.fromCharCode("A".charCodeAt(0) + annexCounter++);
    } else {
      clauseCounter++;
      num = String(clauseCounter);
    }
    if (id) numbers.set(id, num);
    assignChildren($el, num);
  });
  return numbers;
}

/** Synthesize biblio-style metadata from an `<emu-clause>` element.
 *
 *  ECMA-402 (unlike ECMA-262) almost never sets the `aoid` attribute on
 *  `<emu-clause>` — instead the operation name is the leading token of
 *  the `<h1>` title (e.g. `<h1>SetNumberFormatUnitOptions ( nf, options
 *  )</h1>`). For clauses whose id starts with `sec-` and whose title
 *  matches `<Name>( ... )`, we synthesize an AOID from the title. This
 *  is what makes cross-spec AOID matching work between 262 ↔ 402. */
function metaFromElement(
  $: CheerioAPI,
  el: AnyNode,
  sectionNumber: string,
): ClauseMeta | null {
  const $el = $(el);
  const id = $el.attr("id");
  if (!id) return null;
  const title = $el.children("h1").first().text().replace(/\s+/g, " ").trim();
  let aoid = $el.attr("aoid") ?? null;
  if (!aoid) {
    // Pattern: "Name ( args )" or "Name ( )". Anchor with a leading
    // identifier and require the open paren to avoid pulling out the
    // first word of prose-style titles ("NumberFormat Objects").
    const m = /^([A-Z][A-Za-z0-9_$]*)\s*\(/.exec(title);
    if (m) aoid = m[1]!;
  }
  // Heuristic kind: aoid presence → "op"; "[[…]]" in title → internal
  // method; otherwise generic "clause". Same shape as biblio's taxonomy.
  let kind: ClauseKind = "clause";
  if (aoid) kind = "op";
  else if (/^\[\[[^\]]+\]\]/.test(title)) kind = "internal method";
  return { id, aoid, title, number: sectionNumber, kind };
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
