/**
 * Structured representation of a parsed TC39 spec snapshot — either
 * ECMA-262 (core language) or ECMA-402 (Intl). Both specs are
 * ecmarkup-rendered HTML with the same `<emu-clause>` shape, so the
 * parser and this schema are spec-agnostic.
 *
 * Two sources combine into one shape:
 *  - `@tc39/ecma262-biblio` gives us per-clause metadata (id, aoid, title,
 *    section number). It indexes both 262 and 402 clauses.
 *  - `cheerio` extracting `<emu-alg>` / `<emu-note>` / `<emu-xref>` from
 *    spec.html gives us step bodies, notes, and cross-refs.
 *
 * Captures enough to drive `clause.get` and the search/diff tools.
 * Richer fields (SDOs, intrinsics, grammar productions) accrete as
 * tooling demands them.
 */

export type ClauseKind =
  | "clause"
  | "op"
  | "built-in function"
  | "concrete method"
  | "internal method"
  | "sdo"
  | "term"
  | "unknown";

/** Per-clause metadata pulled from `@tc39/ecma262-biblio` plus the
 *  ecmarkup parse: identifier, abstract-operation id, title, section
 *  number, and kind. Common to every clause in a parsed spec. */
export interface ClauseMeta {
  /** Spec clause id (e.g. `sec-tonumber`). Stable across editions. */
  id: string;
  /** Abstract Operation ID — the spec's identifier for invocable
   *  operations (e.g. `ToNumber`). `null` for clauses that aren't
   *  abstract operations. */
  aoid: string | null;
  /** `<h1>` text. Includes the signature line for abstract ops. */
  title: string;
  /** Section number, e.g. `7.1.4` or `B.3.1` (Annex B). */
  number: string;
  /** How the clause behaves: `op`, `sdo`, `built-in function`,
   *  `concrete method`, `internal method`, `term`, `clause` (generic),
   *  or `unknown`. */
  kind: ClauseKind;
}

/** One numbered step in an `<emu-alg>`, possibly with nested substeps. */
export interface AlgorithmStep {
  /** Verbatim ecmarkdown text of the step, with markup preserved. */
  text: string;
  /** Nested numbered substeps (`a.`, `b.`, …) under this step. Empty
   *  array when the step has no substeps. */
  substeps: AlgorithmStep[];
}

/** One `<emu-alg>` block. Regular abstract operations have one
 *  algorithm; SDOs have one per grammar production. */
export interface Algorithm {
  /** The numbered steps of the algorithm. */
  steps: AlgorithmStep[];
  /** For SDOs (Syntax-Directed Operations), each algorithm is keyed by a
   *  grammar production. Captured verbatim from the preceding
   *  `<emu-grammar>` element. Undefined for non-SDO algorithms (regular
   *  abstract operations, methods, etc.). */
  production?: string;
}

/** A `<emu-note>` element's content + optional attributes.
 *  In practice the TC39 specs almost never set `type` (ecmarkup supports
 *  `editor` / `normative` / `informative` but the specs rarely
 *  distinguish); `id` is more common (used for cross-references like
 *  `<emu-xref href="#note-star-default-star">`). Both are surfaced
 *  when present. */
export interface Note {
  text: string;
  /** Verbatim `id=` attribute, if any. Lets `<emu-xref>` resolve to
   *  a specific note rather than the containing clause. */
  id?: string;
  /** Verbatim `type=` attribute, if any (e.g. `"editor"`). Reserved
   *  for future use — TC39 specs rarely set this today. */
  type?: string;
}

/** One parsed clause — the structured representation of a single
 *  `<emu-clause>` element. The headline output of `clause.get`. */
export interface Clause {
  /** Identifier, AOID, title, section number, and kind. */
  meta: ClauseMeta;
  /** Trimmed `<h1>` contents — the signature line for abstract ops.
   *  `null` when the clause has no `<h1>` (or for prose-only clauses
   *  without a signature). */
  signatureRaw: string | null;
  /** Captured `<emu-alg>` blocks. Empty array when the clause has
   *  no algorithm. Multiple entries for SDOs. */
  algorithms: Algorithm[];
  /** Captured `<emu-note>` blocks, in document order. */
  notes: Note[];
  /** Hrefs from `<emu-xref href="...">` anywhere inside the clause.
   *  Used by `spec.crossrefs` to build the forward index. */
  crossrefs: string[];
}

export interface SpecPin {
  /** Which TC39 spec this snapshot is from: "262" or "402". */
  spec: string;
  edition: string;
  sha: string;
  /** ISO-8601 timestamp recording when the parser ran. Helps callers
   *  detect drift between published parses. */
  fetched_at?: string;
  /** The biblio package commit the parse was driven from. */
  biblio_commit?: string;
}

/** A captured `<emu-table>` element. ecmarkup numbers tables but we
 *  don't surface the number — the `id` is the canonical handle. */
export interface SpecTable {
  id: string;
  /** `<emu-caption>` content (or fallback to `caption` attribute). */
  caption: string;
  /** `<th>` text per column, in document order. Empty array if the
   *  table has no `<thead>` or `<th>` row. */
  columns: string[];
  /** `<tr>` rows in document order; each row is a string per cell
   *  matching the `columns` order. Empty cells stay as empty strings. */
  rows: string[][];
  /** The clause id that contains this table, if any. */
  clause_id?: string;
}

/** One grammar production block. */
export interface GrammarProduction {
  nonterminal: string;
  parameters: string[];
  rhs: string[];
  clause_id?: string;
  /** False when this block was sitting immediately before an
   *  `<emu-alg>` (i.e. captured as an SDO production already). */
  standalone: boolean;
}

export interface ParsedSpec {
  pin: SpecPin;
  clauses: Record<string, Clause>;
  /** Every `<emu-table id="...">` in the spec, keyed by table id.
   *  Populated by the table-extraction pass; may be missing in older
   *  build outputs. */
  tables?: Record<string, SpecTable>;
  /** Every `<emu-grammar>` block in the spec, captured as structured
   *  productions. Includes both SDO-attached and standalone blocks;
   *  consumers use `standalone:true` to filter to the lexical /
   *  syntactic grammar definitions. May be missing in older build
   *  outputs. */
  grammar?: GrammarProduction[];
}
