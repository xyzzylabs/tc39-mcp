/**
 * Extract one clause's content from a loaded cheerio document.
 *
 * "Direct content" of a clause = whatever lives directly under
 * `<emu-clause id="X">` and is NOT itself a nested `<emu-clause>`. Nested
 * clauses are addressable by their own ids, so we don't duplicate their
 * content into the parent.
 */

import type { CheerioAPI } from "cheerio";
import type { Algorithm, Clause, ClauseMeta, Note } from "./schema.js";
import { parseAlgorithm } from "./steps.js";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function escapeAttr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function extractClause(
  $: CheerioAPI,
  meta: ClauseMeta,
): Clause | null {
  // Attribute selector (not "#id") because spec clause ids contain dots —
  // e.g. "sec-array.prototype.includes" — which collide with CSS class syntax.
  const attr = escapeAttr(meta.id);
  const el = $(
    `emu-clause[id="${attr}"], emu-annex[id="${attr}"]`,
  ).first();
  if (el.length === 0) return null;

  const signatureRaw =
    normalizeWhitespace(el.children("h1").first().text()) || null;

  // Walk direct children in document order so we can pair each
  // <emu-alg> with the <emu-grammar> that precedes it (SDOs only;
  // regular abstract ops have just <emu-alg> with no grammar).
  const algorithms: Algorithm[] = [];
  let pendingProduction: string | null = null;
  el.children().each((_, child) => {
    const tag = (child as { tagName?: string }).tagName?.toLowerCase();
    if (tag === "emu-grammar") {
      pendingProduction = normalizeWhitespace($(child).text());
    } else if (tag === "emu-alg") {
      const text = $(child).text();
      algorithms.push({
        steps: parseAlgorithm(text),
        ...(pendingProduction ? { production: pendingProduction } : {}),
      });
      pendingProduction = null;
    } else {
      // Any non-grammar tag (h1, p, emu-note, nested emu-clause) breaks
      // the pairing chain — a pending grammar without an immediate alg
      // is just a definitional grammar block (e.g. in §11 lexical
      // grammar). Drop it.
      if (tag !== "emu-grammar") pendingProduction = null;
    }
  });

  const notes: Note[] = [];
  el.children("emu-note").each((_, n) => {
    const t = normalizeWhitespace($(n).text());
    if (!t) return;
    const note: Note = { text: t };
    const id = $(n).attr("id");
    const type = $(n).attr("type");
    if (id) note.id = id;
    if (type) note.type = type;
    notes.push(note);
  });

  // Cross-refs anywhere inside the clause (including in nested children)
  // — they're indicators of relatedness; we don't try to resolve them yet.
  const crossrefs: string[] = [];
  el.find("emu-xref[href]").each((_, x) => {
    const href = $(x).attr("href");
    if (href) crossrefs.push(href);
  });

  return { meta, signatureRaw, algorithms, notes, crossrefs };
}
