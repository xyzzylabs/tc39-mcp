// Shared clause-metadata synthesis from rendered ecmarkup HTML.
//
// Two callers build clause metadata straight from the HTML rather than a
// biblio:
//   - the ECMA-402 parser, which has no biblio at all (see ecma402.ts);
//   - the ECMA-262 parser's HTML-discovery fallback, for clauses a
//     stale or mismatched biblio doesn't list (see index.ts).
//
// Both need the same two operations: a section number from document
// position, and a ClauseMeta from the element itself.

import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { ClauseKind, ClauseMeta } from "./schema.js";

/** Compute section numbers by walking `<emu-clause>` / `<emu-annex>` in
 *  document order. Top-level clauses are 1, 2, 3, …; their children
 *  are 1.1, 1.2, 2.1, …; annexes are A, B, C, …
 *
 *  Returns a map keyed on clause id → section number string. */
export function computeSectionNumbers($: CheerioAPI): Map<string, string> {
  const numbers = new Map<string, string>();
  // Find the outermost containers — anything that's an emu-clause /
  // emu-annex with no ancestor of the same tag.
  const rootSel = "emu-clause, emu-annex";
  const tops = $(rootSel).filter((_, el) => {
    return $(el).parents("emu-clause, emu-annex, emu-intro").length === 0;
  });
  // Regular clauses are numbered (1, 2, 3 …); annexes are lettered (A, B,
  // C …). Intro sections (<emu-intro>) were excluded above — unnumbered.
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

/** Synthesize biblio-style metadata from an `<emu-clause>` / `<emu-annex>`
 *  element.
 *
 *  Rendered ecmarkup HTML rarely carries the `aoid` attribute on a clause
 *  — the operation name is the leading token of the `<h1>` title (e.g.
 *  `<h1>SetNumberFormatUnitOptions ( nf, options )</h1>`), so we derive
 *  the AOID from there when the attribute is absent. This is also what
 *  makes cross-spec AOID matching work between 262 ↔ 402. */
export function metaFromElement(
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
