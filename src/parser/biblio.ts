import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ClauseKind, ClauseMeta } from "./schema.js";

interface BiblioFile {
  location: string;
  entries: BiblioEntry[];
}

interface BiblioEntry {
  type: string;
  id?: string;
  aoid?: string | null;
  title?: string;
  titleHTML?: string;
  number?: string;
  refId?: string;
  term?: string;
}

const req = createRequire(import.meta.url);

/** Lazily-loaded biblio; throws a clear error if the package is
 *  missing or its JSON is malformed. We don't load at module top
 *  level because any throw there would kill the import chain of every
 *  caller (including the MCP server) before useful error reporting. */
let cached: BiblioFile | null = null;
function loadBiblio(): BiblioFile {
  if (cached) return cached;
  let biblioPath: string;
  try {
    // The package main IS biblio.json; only `.` and `./package.json`
    // are exported.
    biblioPath = req.resolve("@tc39/ecma262-biblio");
  } catch (e) {
    throw new Error(
      "Failed to resolve `@tc39/ecma262-biblio`. Run `npm install` in tc39-mcp/ to install it. Underlying error: " +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  let text: string;
  try {
    text = readFileSync(biblioPath, "utf8");
  } catch (e) {
    throw new Error(
      `Failed to read biblio at ${biblioPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    cached = JSON.parse(text) as BiblioFile;
  } catch (e) {
    throw new Error(
      `Biblio at ${biblioPath} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return cached;
}

// Biblio entry-type taxonomy (counts per ES2025):
//   clause              ~2266  regular sections AND method definitions
//                              (Array.prototype.includes is type=clause)
//   op                   ~723  abstract operations (ToNumber, ToBoolean, ...)
//   built-in function    ~528  SUPPLEMENTARY signature metadata for clauses
//                              under §19+. Keyed by `name`+`clause`, no `id`.
//                              Contains structured params (required/optional/rest).
//                              The actual clauses they reference are already
//                              captured via the `clause` entry type above.
//   concrete method       ~48  Cross-ref records linking abstract method
//                              definitions to their concrete impls. Keyed by
//                              `refId`, supplementary; the impl clauses
//                              themselves are captured under `clause`.
//   production           ~378  grammar productions — captured separately by
//                              the standalone <emu-grammar> pass in grammar.ts.
//   term, table, figure, step, note — out of scope.
export function loadBiblioClauses(): Map<string, ClauseMeta> {
  const biblio = loadBiblio();
  const map = new Map<string, ClauseMeta>();
  for (const entry of biblio.entries) {
    if (!entry.id) continue;
    if (entry.type !== "clause" && entry.type !== "op") continue;
    // The biblio's `type` field is "clause" for *every* <emu-clause>,
    // including the ones that define abstract operations — so filtering
    // by kind="op" downstream returns nothing useful. Override: if
    // biblio attaches an aoid to this entry, treat it as an op even
    // when type=="clause". This matches the ECMA-402 parser's
    // convention and lets `clause.list { kind: "op" }` work on 262.
    const kind: ClauseKind = entry.aoid ? "op" : (entry.type as ClauseKind);
    map.set(entry.id, {
      id: entry.id,
      aoid: entry.aoid ?? null,
      title: entry.title ?? "",
      number: entry.number ?? "",
      kind,
    });
  }
  return map;
}

export function biblioCommit(): string {
  try {
    const pkgPath = req.resolve("@tc39/ecma262-biblio/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { commit?: string };
    return pkg.commit ?? "unknown";
  } catch {
    return "unknown";
  }
}
