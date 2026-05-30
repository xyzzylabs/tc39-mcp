// Extract standalone `<emu-grammar>` productions from a loaded
// cheerio document.
//
// In TC39 specs, `<emu-grammar>` shows up in two roles:
//
//   1. SDO algorithms: an `<emu-grammar>` immediately preceding an
//      `<emu-alg>` says "this algorithm handles this production." The
//      clause parser already captures these as `Algorithm.production`.
//      We don't re-capture them here.
//
//   2. Standalone definitions: the §11 lexical grammar, §12 expression
//      grammar, §13 statement grammar, §14 functions, §15 modules, etc.
//      Each `<emu-grammar>` block in those chapters defines one or more
//      productions for a single non-terminal. This module captures
//      those.
//
// The grammar inside `<emu-grammar>` uses ecmarkup's grammar DSL:
//
//      NonTerminal[Yield, Await] :
//        RHS1
//        RHS2
//
// We don't fully parse the DSL — that's a significant project on its
// own. We capture each block as a structured record { nonterminal,
// parameters, rhs[] } with the RHS as verbatim lines, leaving deeper
// analysis to callers.

import type { CheerioAPI } from "cheerio";
import type { GrammarProduction } from "./schema.js";

// Re-export for convenience — historical callers imported this type
// from `./grammar.js`.
export type { GrammarProduction };

/** Parse a single `<emu-grammar>` block's text into one or more
 *  productions. Real ECMA-262 grammar uses two shapes:
 *
 *  Multi-line:
 *      NonTerm[Yield, Await] :
 *        RHS1
 *        RHS2
 *
 *  Single-line (mostly lexical, using `::`):
 *      NonTerm :: RHS
 *
 *  The colon count (`:`, `::`, `:::`) signals the grammar level
 *  (syntactic / lexical / regexp); we treat them uniformly. */
function parseBlock(text: string): {
  nonterminal: string;
  parameters: string[];
  rhs: string[];
}[] {
  // Normalize CR + tabs.
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n");
  const productions: {
    nonterminal: string;
    parameters: string[];
    rhs: string[];
  }[] = [];
  let current: {
    nonterminal: string;
    parameters: string[];
    rhs: string[];
  } | null = null;
  // Header pattern: non-terminal, optional `[Yield, Await]`, then `:` /
  // `::` / `:::` separator, then optionally a same-line RHS.
  const headRe = /^\s*([A-Za-z][A-Za-z0-9_]*)(?:\[([^\]]*)\])?\s*:{1,3}\s*(.*)$/;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const headMatch = headRe.exec(line);
    if (headMatch) {
      if (current) productions.push(current);
      const rhsRest = headMatch[3]!.trim();
      current = {
        nonterminal: headMatch[1]!,
        parameters: headMatch[2]
          ? headMatch[2].split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        rhs: rhsRest ? [rhsRest] : [],
      };
      continue;
    }
    // Otherwise this is an RHS line (indented).
    if (current) {
      current.rhs.push(line.replace(/^\s+/, ""));
    }
  }
  if (current) productions.push(current);
  return productions;
}

export function extractGrammar($: CheerioAPI): GrammarProduction[] {
  const out: GrammarProduction[] = [];

  $("emu-grammar").each((_, el) => {
    const $el = $(el);
    // SDO-preceding emu-grammar blocks live inside an emu-clause
    // immediately before an emu-alg sibling. The clause parser
    // captures those as Algorithm.production; we skip them here.
    const $next = $el.nextAll().filter((_, n) => {
      const tag = (n as { tagName?: string }).tagName?.toLowerCase();
      return tag !== undefined && !/^(p|emu-note|emu-xref|h\d+)$/.test(tag);
    }).first();
    const nextTag = ($next.get(0) as { tagName?: string } | undefined)?.tagName?.toLowerCase();
    const isSdoPreceder = nextTag === "emu-alg";

    const $clause = $el.parents("emu-clause, emu-annex").first();
    const clauseId = $clause.attr("id");

    const text = $el.text();
    const blocks = parseBlock(text);
    for (const b of blocks) {
      // Skip blocks where we couldn't find a non-terminal header — those
      // are usually one-line in-prose grammar fragments captured by
      // emu-grammar inline.
      if (!b.nonterminal) continue;
      out.push({
        nonterminal: b.nonterminal,
        parameters: b.parameters,
        rhs: b.rhs,
        ...(clauseId ? { clause_id: clauseId } : {}),
        standalone: !isSdoPreceder,
      });
    }
  });

  return out;
}
