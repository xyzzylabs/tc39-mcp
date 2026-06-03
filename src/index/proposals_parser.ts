// Pure parsing helpers for the tc39/proposals markdown files. Lives
// separate from `build_proposals.ts` (the CLI script) so tests can
// import without triggering the index build's filesystem side effects.

import type { Spec } from "../editions.js";

export interface ProposalEntry {
  /** Markdown link slug — the canonical id. */
  slug: string;
  /** Human-readable name from the link text. */
  name: string;
  /** Resolved URL from the slug reference. */
  url?: string;
  /** Stage as labeled in the source heading (e.g. "0", "1", "2", "2.7",
   *  "3", "finished", "inactive"). */
  stage: string;
  /** Which TC39 spec the proposal targets: "262" (core language) or
   *  "402" (Intl). tc39/proposals tracks the two in parallel file sets
   *  — the root markdown files for ECMA-262, an `ecma402/` subdirectory
   *  for ECMA-402. */
  spec: Spec;
  authors: string[];
  champions: string[];
  test262_flag?: string;
  /** Which file the row was harvested from. */
  source_file: string;
}

/** Build slug → url map from the link references at the bottom of a
 *  markdown file. Each line looks like `[slug]: <URL>` (URL may be
 *  bare or wrapped in `<>`). */
export function buildSlugMap(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*\[([^\]]+)\]:\s*<?([^\s>]+)>?/.exec(line);
    if (!m) continue;
    out.set(m[1]!, m[2]!);
  }
  return out;
}

/** Trim a markdown cell: strip leading/trailing whitespace, replace
 *  HTML `<br />` tags with newlines, decode the few HTML entities
 *  tc39/proposals actually uses. */
export function cellText(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8209;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a multi-author / multi-champion cell on newlines and commas. */
export function splitPeople(cell: string): string[] {
  return cell
    .split(/\n|<br\s*\/?>/gi)
    .flatMap((s) => s.split(/,(?![^<>]*>)/))
    .map((s) => s.replace(/<sub>|<\/sub>/g, "").trim())
    .filter((s) => s.length > 0);
}

/** Parse one source markdown file's text into ProposalEntry rows.
 *  `spec` tags every row, since the file's location (root vs the
 *  `ecma402/` subdirectory) is what distinguishes the two proposal
 *  tracks — the table shape is identical. */
export function parseProposalsMarkdown(
  text: string,
  sourceFile: string,
  defaultStage: string,
  spec: Spec,
): ProposalEntry[] {
  const slugs = buildSlugMap(text);
  const rows: ProposalEntry[] = [];

  const lines = text.split("\n");
  let currentStage = defaultStage;
  let inTable = false;
  let columns: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Track Stage headings.
    const h = /^###\s+Stage\s+(\S+)/.exec(line);
    if (h) {
      currentStage = h[1]!;
      inTable = false;
      columns = [];
      continue;
    }
    if (/^##\s/.test(line)) {
      inTable = false;
      columns = [];
      continue;
    }
    // Detect a markdown-table header row.
    if (line.startsWith("|") && line.includes("|") && !inTable) {
      const cells = line.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
      // The next line should be a separator (---).
      const next = lines[i + 1] ?? "";
      if (/^\s*\|[\s:|\-]+\|/.test(next)) {
        columns = cells.map((c) => c.toLowerCase());
        inTable = true;
        i++; // skip the separator
        continue;
      }
    }
    if (inTable) {
      if (!line.startsWith("|")) {
        inTable = false;
        columns = [];
        continue;
      }
      const cells = line.split("|").slice(1, -1).map((s) => s);
      if (cells.length < 3) continue;
      const proposalCell = cells[0]!.trim();
      // Match the first `[Name][slug]` reference link in the proposal cell.
      const linkMatch = /\[([^\]]+)\]\[([^\]]+)\]/.exec(proposalCell);
      if (!linkMatch) continue;
      const name = linkMatch[1]!.trim();
      const slug = linkMatch[2]!;
      const entry: ProposalEntry = {
        slug,
        name,
        stage: currentStage,
        spec,
        authors: [],
        champions: [],
        source_file: sourceFile,
      };
      const url = slugs.get(slug);
      if (url) entry.url = url;
      // Map remaining columns.
      for (let c = 1; c < cells.length && c < columns.length; c++) {
        const col = columns[c]!;
        const value = cells[c]!;
        if (col.includes("author")) entry.authors = splitPeople(value);
        else if (col.includes("champion")) entry.champions = splitPeople(value);
        else if (col.includes("test262")) {
          const t = cellText(value);
          if (t) entry.test262_flag = t;
        }
      }
      rows.push(entry);
    }
  }
  return rows;
}
