// Generate `docs/tools.md` from source: walk `src/mcp/server.ts` for
// tool registrations, then resolve each tool's input Zod schema +
// output TypeScript interface + co-located `<name>Examples` array
// from `src/mcp/tools/*.ts`. The rendered page lists every tool with
// structured Input + Output tables and a "What it answers" section
// of realistic example calls, all sourced from the same .describe()
// calls, JSDoc comments, and Examples arrays the LLM-facing surfaces
// consume.
//
// This file is intentionally regex-free for the schema/interface
// shapes — those use the TypeScript Compiler API to stay correct
// across formatting variations. Only the JSDoc reduction is text-y.
//
// Run via `npm run docs:data` (build_data.ts wires us in).

import * as ts from "typescript";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface ToolReg {
  name: string;
  description: string;
  schemaIdent: string;
}

interface SchemaField {
  name: string;
  /** Human-friendly type string, e.g. `string`, `"262" | "402"`, `number (int, 1–500)`. */
  type: string;
  optional: boolean;
  defaultValue?: string;
  description: string;
}

interface OutputField {
  name: string;
  type: string;
  optional: boolean;
  description: string;
}

interface OutputType {
  name: string;
  description: string;
  fields: OutputField[];
}

interface ToolExample {
  /** Natural-language question this call answers. */
  q: string;
  /** Input arguments as a JSON-able literal. */
  input: Record<string, unknown>;
  /** Optional extra context — e.g. what's noteworthy about the
   *  response, a caveat, or a follow-up suggestion. Renders as a
   *  sub-bullet under the example on the docs page. */
  note?: string;
}

interface ToolDoc {
  name: string;
  description: string;
  inputFields: SchemaField[];
  /** Declared return type as written, e.g. `Clause | null`. */
  outputTypeText: string;
  /** When the type names a local interface, its field list. */
  outputBody: OutputType | null;
  /** Co-located `<name>Examples` entries. */
  examples: ToolExample[];
}

// ─── const resolution: SPEC_VALUES, EDITION_VALUES, etc. ──────────────

/** Read `src/editions.ts` and pull out the string-literal arrays so the
 *  generator can render `"262" | "402"` instead of `SPEC_VALUES` etc. */
export function readStringConstArrays(
  editionsPath: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(editionsPath)) return out;
  const src = readFileSync(editionsPath, "utf8");
  const sf = ts.createSourceFile(editionsPath, src, ts.ScriptTarget.Latest, true);

  // First, capture every top-level `export const X = [...]` whose
  // array elements are plain string literals or spreads of already-
  // captured names.
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        // `[...] as const` is a TypeAssertion (`as`) — unwrap.
        let init: ts.Expression = decl.initializer;
        if (
          ts.isAsExpression(init) ||
          ts.isTypeAssertionExpression(init)
        ) {
          init = init.expression;
        }
        if (!ts.isArrayLiteralExpression(init)) continue;
        const items: string[] = [];
        let ok = true;
        for (const el of init.elements) {
          if (ts.isStringLiteral(el)) {
            items.push(el.text);
          } else if (
            ts.isSpreadElement(el) &&
            ts.isIdentifier(el.expression) &&
            out.has(el.expression.text)
          ) {
            items.push(...out.get(el.expression.text)!);
          } else if (
            ts.isSpreadElement(el) &&
            ts.isCallExpression(el.expression) &&
            ts.isPropertyAccessExpression(el.expression.expression) &&
            ts.isIdentifier(el.expression.expression.expression) &&
            el.expression.expression.expression.text === "Object" &&
            el.expression.expression.name.text === "keys"
          ) {
            // `...Object.keys(X)` — try to resolve X if it's a known object literal.
            // For now, skip — keeps the array but tags it as partial.
            ok = false;
          } else {
            ok = false;
          }
        }
        if (ok && items.length > 0) {
          out.set(decl.name.text, items);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ─── server.ts: find all tool registrations ────────────────────────────
//
// Two shapes are recognized:
//
//   server.tool(name, description, schemaIdent, handler)
//
//   server.registerTool(name, {
//     title?, description, inputSchema: schemaIdent,
//     annotations?: { readOnlyHint, ... },
//   }, handler)
//
// Both surface the same { name, description, schemaIdent } triple to
// downstream rendering. The richer `registerTool` form's title +
// annotations are MCP runtime metadata only — they don't change the
// generated tools.md page shape.

export function parseServerTools(serverPath: string): ToolReg[] {
  const src = readFileSync(serverPath, "utf8");
  const sf = ts.createSourceFile(serverPath, src, ts.ScriptTarget.Latest, true);
  const out: ToolReg[] = [];

  function extractStringProperty(
    obj: ts.ObjectLiteralExpression,
    key: string,
  ): string | undefined {
    for (const prop of obj.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === key &&
        ts.isStringLiteral(prop.initializer)
      ) {
        return prop.initializer.text;
      }
    }
    return undefined;
  }

  function extractIdentifierProperty(
    obj: ts.ObjectLiteralExpression,
    key: string,
  ): string | undefined {
    for (const prop of obj.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === key &&
        ts.isIdentifier(prop.initializer)
      ) {
        return prop.initializer.text;
      }
    }
    return undefined;
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "server" &&
      ts.isIdentifier(node.expression.name)
    ) {
      const method = node.expression.name.text;
      if (method === "tool") {
        // Legacy 4-arg form.
        const [nameArg, descArg, schemaArg] = node.arguments;
        if (
          nameArg &&
          descArg &&
          schemaArg &&
          ts.isStringLiteral(nameArg) &&
          ts.isStringLiteral(descArg) &&
          ts.isIdentifier(schemaArg)
        ) {
          out.push({
            name: nameArg.text,
            description: descArg.text,
            schemaIdent: schemaArg.text,
          });
        }
      } else if (method === "registerTool") {
        // Object-config form.
        const [nameArg, configArg] = node.arguments;
        if (
          nameArg &&
          configArg &&
          ts.isStringLiteral(nameArg) &&
          ts.isObjectLiteralExpression(configArg)
        ) {
          const description = extractStringProperty(configArg, "description");
          const schemaIdent = extractIdentifierProperty(
            configArg,
            "inputSchema",
          );
          if (description !== undefined && schemaIdent !== undefined) {
            out.push({ name: nameArg.text, description, schemaIdent });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ─── tool file: extract schema fields + output interfaces ──────────────

/** Best-effort JSDoc extraction for a single AST node. Reads the
 *  preceding `/** ... *​/` block (if any) and reduces it to one line. */
function jsdocFor(node: ts.Node, sf: ts.SourceFile): string {
  const full = sf.getFullText();
  const leading = full.substring(node.getFullStart(), node.getStart(sf));
  const m = /\/\*\*\s*([\s\S]*?)\s*\*\//.exec(leading);
  if (!m) return "";
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

interface ChainAnalysis {
  baseType: string;
  optional: boolean;
  defaultValue?: string;
  description: string;
  range?: { min?: number; max?: number; int?: boolean };
  enumValues?: string[];
}

/** Walk a zod method chain inside-out and pull out what affects docs.
 *  The chain looks like `z.<baseType>(...).<modifier>(...).<modifier>(...)`.
 *  We unwrap modifiers until we hit the `z.<baseType>(...)` call and
 *  extract the base type there. */
function analyzeZodChain(expr: ts.Expression, sf: ts.SourceFile): ChainAnalysis {
  let optional = false;
  let defaultValue: string | undefined;
  let description = "";
  const range: { min?: number; max?: number; int?: boolean } = {};
  let enumValues: string[] | undefined;
  let baseType = "unknown";

  let cur: ts.Node = expr;
  while (
    ts.isCallExpression(cur) &&
    ts.isPropertyAccessExpression(cur.expression)
  ) {
    const method = cur.expression.name.text;
    const args = cur.arguments;

    // If the receiver is the identifier `z`, this call IS the base
    // type. Capture it and stop unwrapping.
    if (
      ts.isIdentifier(cur.expression.expression) &&
      cur.expression.expression.text === "z"
    ) {
      if (method === "enum" && args[0]) {
        const a = args[0];
        if (ts.isArrayLiteralExpression(a)) {
          enumValues = a.elements
            .filter(ts.isStringLiteral)
            .map((s) => s.text);
          baseType = "enum";
        } else if (ts.isIdentifier(a)) {
          baseType = a.text; // e.g. SPEC_VALUES
        } else {
          baseType = "enum";
        }
      } else {
        baseType = method;
      }
      break;
    }

    // Otherwise it's a modifier in the chain.
    if (method === "optional") {
      optional = true;
    } else if (method === "default" && args[0]) {
      defaultValue = args[0].getText(sf);
    } else if (method === "describe" && args[0] && ts.isStringLiteral(args[0])) {
      description = args[0].text;
    } else if (method === "min" && args[0] && ts.isNumericLiteral(args[0])) {
      range.min = Number(args[0].text);
    } else if (method === "max" && args[0] && ts.isNumericLiteral(args[0])) {
      range.max = Number(args[0].text);
    } else if (method === "int") {
      range.int = true;
    }
    cur = cur.expression.expression;
  }

  return { baseType, optional, defaultValue, description, range, enumValues };
}

/** Pretty-print the analysis as a type cell. `constArrays` lets us
 *  substitute identifier-named enums (e.g. `SPEC_VALUES`) with their
 *  string-literal contents. */
function renderTypeCell(
  a: ChainAnalysis,
  constArrays?: Map<string, string[]>,
): string {
  if (a.enumValues) {
    return a.enumValues.map((v) => `\`"${v}"\``).join(" \\| ");
  }
  // Identifier-named enum (e.g. `SPEC_VALUES`): try to resolve.
  if (
    constArrays &&
    a.baseType !== "string" &&
    a.baseType !== "number" &&
    a.baseType !== "boolean" &&
    a.baseType !== "enum" &&
    a.baseType !== "unknown" &&
    constArrays.has(a.baseType)
  ) {
    const vals = constArrays.get(a.baseType)!;
    return vals.map((v) => `\`"${v}"\``).join(" \\| ");
  }
  const labelBase: Record<string, string> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    enum: "enum",
  };
  let t = labelBase[a.baseType] ?? a.baseType;
  if (a.baseType === "number") {
    const bits: string[] = [];
    if (a.range?.int) bits.push("int");
    if (a.range?.min !== undefined && a.range?.max !== undefined) {
      bits.push(`${a.range.min}–${a.range.max}`);
    } else if (a.range?.min !== undefined) {
      bits.push(`≥ ${a.range.min}`);
    } else if (a.range?.max !== undefined) {
      bits.push(`≤ ${a.range.max}`);
    }
    if (bits.length) t += ` (${bits.join(", ")})`;
  }
  return t;
}

interface ParsedToolFile {
  inputFields: SchemaField[];
  interfaces: OutputType[];
  /** Map of exported function name → its return type as written (e.g.
   *  `Clause | null`, `ClauseListHit[]`, `Promise<SpecHistoryResult>`). */
  functionReturnTypes: Map<string, string>;
  /** Co-located `<name>Examples` arrays in this file, keyed by const
   *  name (e.g. `clauseGetExamples`). */
  examplesByName: Map<string, ToolExample[]>;
}

/** Convert a TS object/array literal node to a plain JS value when
 *  every leaf is a string / number / boolean / array / object literal.
 *  Returns `undefined` if anything dynamic (a reference, a call, etc.)
 *  is in the tree. */
function literalToJs(node: ts.Expression, sf: ts.SourceFile): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    const out: unknown[] = [];
    for (const el of node.elements) {
      if (ts.isOmittedExpression(el)) return undefined;
      const v = literalToJs(el, sf);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) return undefined;
      let key: string;
      if (ts.isIdentifier(prop.name)) key = prop.name.text;
      else if (ts.isStringLiteral(prop.name)) key = prop.name.text;
      else return undefined;
      const v = literalToJs(prop.initializer, sf);
      if (v === undefined) return undefined;
      out[key] = v;
    }
    return out;
  }
  return undefined;
}

/** A z.object field can reference a shared schema fragment imported
 *  from another module (e.g. `spec: specArg`) instead of an inline
 *  chain. Resolve the import to the fragment's `export const` so its
 *  chain can be analyzed in place — returns the initializer expression
 *  plus the source file it lives in (needed for `.getText()` on
 *  `.default(...)`). Returns null for inline chains or unresolvable
 *  references (the caller then analyzes the initializer as-is). */
function resolveImportedConst(
  name: string,
  toolSf: ts.SourceFile,
  toolPath: string,
): { expr: ts.Expression; sf: ts.SourceFile } | null {
  let moduleSpec: string | undefined;
  for (const stmt of toolSf.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !stmt.importClause?.namedBindings ||
      !ts.isNamedImports(stmt.importClause.namedBindings) ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      continue;
    }
    if (
      stmt.importClause.namedBindings.elements.some((el) => el.name.text === name)
    ) {
      moduleSpec = stmt.moduleSpecifier.text;
      break;
    }
  }
  if (!moduleSpec || !moduleSpec.startsWith(".")) return null;
  const modPath = resolve(dirname(toolPath), moduleSpec.replace(/\.js$/, ".ts"));
  if (!existsSync(modPath)) return null;
  const modSf = ts.createSourceFile(
    modPath,
    readFileSync(modPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let found: ts.Expression | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          found = decl.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(modSf);
  return found ? { expr: found, sf: modSf } : null;
}

export function parseToolFile(
  path: string,
  schemaIdent: string,
  constArrays?: Map<string, string[]>,
): ParsedToolFile {
  const src = readFileSync(path, "utf8");
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true);
  const interfaces: OutputType[] = [];
  const functionReturnTypes = new Map<string, string>();
  const examplesByName = new Map<string, ToolExample[]>();
  let inputFields: SchemaField[] = [];

  const visit = (node: ts.Node) => {
    // export function <name>(...): <returnType> { ... }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (node.type) {
        functionReturnTypes.set(node.name.text, node.type.getText(sf));
      }
    }

    // export const <name>Examples = [ ... ] as const
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          !ts.isIdentifier(decl.name) ||
          !decl.name.text.endsWith("Examples") ||
          !decl.initializer
        ) {
          continue;
        }
        let init: ts.Expression = decl.initializer;
        if (
          ts.isAsExpression(init) ||
          ts.isTypeAssertionExpression(init)
        ) {
          init = init.expression;
        }
        if (!ts.isArrayLiteralExpression(init)) continue;
        const out: ToolExample[] = [];
        for (const el of init.elements) {
          const v = literalToJs(el, sf);
          if (
            v &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            typeof (v as Record<string, unknown>).q === "string" &&
            (v as Record<string, unknown>).input &&
            typeof (v as Record<string, unknown>).input === "object"
          ) {
            const rec = v as {
              q: string;
              input: Record<string, unknown>;
              note?: unknown;
            };
            out.push({
              q: rec.q,
              input: rec.input,
              note: typeof rec.note === "string" ? rec.note : undefined,
            });
          }
        }
        if (out.length > 0) {
          examplesByName.set(decl.name.text, out);
        }
      }
    }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === schemaIdent &&
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer)
        ) {
          inputFields = [];
          for (const prop of decl.initializer.properties) {
            if (
              !ts.isPropertyAssignment(prop) ||
              !ts.isIdentifier(prop.name)
            ) {
              continue;
            }
            // A field is usually an inline zod chain, but it can also
            // reference a shared fragment imported from another module
            // (e.g. `spec: specArg`). Resolve the import so the chain is
            // analyzed from its own module's source.
            let chainExpr: ts.Expression = prop.initializer;
            let chainSf = sf;
            if (ts.isIdentifier(prop.initializer)) {
              const shared = resolveImportedConst(prop.initializer.text, sf, path);
              if (shared) {
                chainExpr = shared.expr;
                chainSf = shared.sf;
              }
            }
            const analysis = analyzeZodChain(chainExpr, chainSf);
            const desc = analysis.description || jsdocFor(prop, sf);
            inputFields.push({
              name: prop.name.text,
              type: renderTypeCell(analysis, constArrays),
              optional: analysis.optional || analysis.defaultValue !== undefined,
              defaultValue: analysis.defaultValue,
              description: desc,
            });
          }
        }
      }
    }

    if (
      ts.isInterfaceDeclaration(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const fields: OutputField[] = [];
      for (const member of node.members) {
        if (
          !ts.isPropertySignature(member) ||
          !(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
        ) {
          continue;
        }
        const memName = (member.name as ts.Identifier | ts.StringLiteral).text;
        fields.push({
          name: memName,
          type: member.type ? member.type.getText(sf) : "unknown",
          optional: !!member.questionToken,
          description: jsdocFor(member, sf),
        });
      }
      interfaces.push({
        name: node.name.text,
        description: jsdocFor(node, sf),
        fields,
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { inputFields, interfaces, functionReturnTypes, examplesByName };
}

// ─── glue ──────────────────────────────────────────────────────────────

export function findToolFileExporting(
  toolsDir: string,
  exportName: string,
): string | null {
  for (const f of readdirSync(toolsDir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const content = readFileSync(join(toolsDir, f), "utf8");
    if (new RegExp(`export\\s+const\\s+${exportName}\\b`).test(content)) {
      return join(toolsDir, f);
    }
  }
  return null;
}

/** Resolve the declared output for a tool. Two pieces:
 *  - `typeText`: the return-type annotation of the matching handler
 *    function (e.g. `Clause | null`, `ClauseListHit[]`,
 *    `Promise<Test262GetResult>`). Stripped of `Promise<…>` wrapper.
 *  - `bodyInterface`: the local interface whose fields we expand
 *    inline as the result-shape table, when the return type names
 *    a local interface. `null` when the return type is imported or
 *    a primitive. */
function resolveOutput(
  schemaIdent: string,
  parsed: ParsedToolFile,
): { typeText: string; bodyInterface: OutputType | null } {
  // schemaIdent → handler function name. `<verbBase>Schema` → `<verbBase>`.
  const base = schemaIdent.replace(/Schema$/, "");
  const candidates = [base];
  // Try common verb aliases when the schema doesn't match by name
  // (e.g. some tools have a single handler named like the schema base
  // but with capitalization differences).
  candidates.push(base.charAt(0).toLowerCase() + base.slice(1));

  let typeText = "";
  for (const c of candidates) {
    const rt = parsed.functionReturnTypes.get(c);
    if (rt) {
      typeText = rt;
      break;
    }
  }
  if (!typeText) {
    // Fall back to the first exported function in the file.
    const first = parsed.functionReturnTypes.values().next();
    if (!first.done) typeText = first.value;
  }
  // Strip `Promise<…>` for display — async wrapping isn't documentation-relevant.
  typeText = typeText.replace(/^Promise<([\s\S]*)>$/, "$1");

  // Try to map the type back to a local interface for field expansion.
  // Pick the interface whose name appears as the first identifier-y
  // token of the type. Handles `Foo`, `Foo | null`, `Foo[]`, etc.
  const firstIdent = /^[A-Za-z_][A-Za-z0-9_]*/.exec(typeText.trim());
  let bodyInterface: OutputType | null = null;
  if (firstIdent) {
    const target = firstIdent[0];
    bodyInterface =
      parsed.interfaces.find((i) => i.name === target) ?? null;
  }
  return { typeText, bodyInterface };
}

// ─── markdown rendering ───────────────────────────────────────────────

/** Escape the three HTML metacharacters (`&`, `<`, `>`) outside
 *  backtick code spans so VitePress's Vue template compiler doesn't
 *  read text like `<emu-alg>` as an element tag. We walk the string
 *  splitting on backticks, HTML-entity-encoding the metacharacters
 *  only in the non-code segments; text inside code spans renders
 *  through markdown-it's code-span handler, which already escapes
 *  for HTML.
 *
 *  Order matters: `&` is escaped *first* so a downstream `<` / `>`
 *  substitution can't double-encode an existing `&amp;` into
 *  `&amp;amp;`. Idempotency check: if the function runs twice on
 *  its own output, the second pass re-escapes the literal `&` in
 *  `&lt;` / `&gt;` to `&amp;` — so callers should not double-apply.
 *
 *  Why backslash isn't escaped (CodeQL's `js/incomplete-sanitization`
 *  may flag this): the output is rendered Markdown for VitePress,
 *  not a JavaScript string literal. Backslash is not a metacharacter
 *  in Vue's template parser, in markdown-it's prose rendering, or in
 *  HTML attribute-free element text. Escaping it would corrupt
 *  intentional backslashes (e.g. `\|` for literal pipe in table
 *  cells) added downstream by `mdEscape`. */
function escapeAnglesOutsideCode(s: string): string {
  const parts = s.split("`");
  for (let i = 0; i < parts.length; i++) {
    // Even-indexed pieces are outside backticks; odd-indexed are inside.
    if (i % 2 === 0) {
      parts[i] = parts[i]!
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }
  return parts.join("`");
}

function mdEscape(s: string): string {
  return escapeAnglesOutsideCode(s)
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

/** Collapse runs of internal whitespace inside a type string so
 *  multi-line object types render on one row. */
function tidyType(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

function renderTool(doc: ToolDoc): string {
  // Defensive: the tool-level description comes straight from
  // server.tool()'s 2nd argument. If a future change introduces an
  // unwrapped `<tag>` literal it would break VitePress's Vue
  // template compiler downstream. Escape outside-code angle brackets
  // here so the page builds even when a source has slipped through.
  const desc = escapeAnglesOutsideCode(doc.description.trim());
  let md = `## \`${doc.name}\`\n\n${desc}\n\n`;

  if (doc.examples.length > 0) {
    md += `### What it answers\n\n`;
    for (const ex of doc.examples) {
      const inp = JSON.stringify(ex.input);
      md += `- **${escapeAnglesOutsideCode(ex.q)}** — \`${mdEscape(inp)}\`\n`;
      if (ex.note) {
        md += `    - _${escapeAnglesOutsideCode(ex.note)}_\n`;
      }
    }
    md += "\n";
  }

  md += `### Input\n\n`;
  if (doc.inputFields.length === 0) {
    md += `_No parameters._\n\n`;
  } else {
    md += `| Field | Type | Default | Description |\n|---|---|---|---|\n`;
    for (const f of doc.inputFields) {
      const def = f.defaultValue ?? "—";
      const opt = f.optional && !f.defaultValue ? " (optional)" : "";
      md += `| \`${f.name}\` | ${f.type}${opt} | ${mdEscape(def)} | ${mdEscape(f.description) || "—"} |\n`;
    }
    md += "\n";
  }

  md += `### Output\n\n`;
  if (!doc.outputTypeText) {
    md += `_See \`src/mcp/tools/\` for the return type._\n\n`;
    return md;
  }
  md += `Returns \`${tidyType(doc.outputTypeText)}\`.\n\n`;
  if (doc.outputBody && doc.outputBody.fields.length > 0) {
    const ot = doc.outputBody;
    md += `**\`${ot.name}\`**`;
    if (ot.description) md += ` — ${ot.description}`;
    md += `\n\n`;
    md += `| Field | Type | Description |\n|---|---|---|\n`;
    for (const f of ot.fields) {
      const opt = f.optional ? " (optional)" : "";
      md += `| \`${f.name}\` | \`${mdEscape(tidyType(f.type))}\`${opt} | ${mdEscape(f.description) || "—"} |\n`;
    }
    md += "\n";
  }
  return md;
}

/** Front matter prepended to every generated tools page. Hand-edit if
 *  the "safe defaults" story changes. The HTML comment is hidden by
 *  both VitePress's markdown pipeline and GitHub's renderer, so it
 *  serves only as a hint for someone reading the .md file in an
 *  editor that nudges them toward the schema sources rather than
 *  this generated copy. */
const TOOLS_PAGE_INTRO = `# Tool reference

<!--
  This file is generated by \`npm run docs:data\` from
  \`src/mcp/server.ts\` + \`src/mcp/tools/*.ts\`. Edit the sources
  (Zod schemas, \`<name>Examples\` arrays, and JSDoc on the result
  interfaces) — the page regenerates on the next docs build.
-->

Every tool's input is validated by a Zod schema. Defaults match the
"safe boring choice" — \`spec\` defaults to \`"262"\`, \`edition\` defaults
to \`"latest"\`, limits are generous but bounded, and toggleable
expensive options (like \`search_steps\` and \`include_cross_spec\`) are
off by default.

All spec-reading tools accept \`spec\` (\`"262"\` | \`"402"\`) and \`edition\`
arguments. See [\`editions.md\`](editions.md) for the value set and how
aliases resolve per spec.

Each tool section below carries:

- **What it answers** — co-located example calls, each tagged with the
  natural-language question it resolves.
- **Input** — every field from the Zod schema with its type, default,
  and inline help text.
- **Output** — the handler's declared return type, expanded into a
  field table when it names a locally-defined interface.

`;

/** Universal footer covering error semantics. */
const TOOLS_PAGE_FOOTER = `## Error envelope

Tools that can fail return either \`{ hits: [] }\` (search-style) or a
top-level error message under \`isError: true\` (clause-style). No tool
throws an unhandled exception under normal use — malformed inputs are
rejected by Zod with a clear validation message; runtime issues (e.g.
"parsed spec missing for (spec, edition) X") return a structured error
rather than a stack trace.
`;

export function renderToolsPage(rootDir: string): string {
  const serverPath = resolve(rootDir, "src", "mcp", "server.ts");
  const toolsDir = resolve(rootDir, "src", "mcp", "tools");
  const editionsPath = resolve(rootDir, "src", "editions.ts");

  if (!existsSync(serverPath) || !existsSync(toolsDir)) {
    return `# Tool reference\n\n_Source files not found. Run from the repo root._\n`;
  }

  const constArrays = readStringConstArrays(editionsPath);
  const tools = parseServerTools(serverPath);

  let md = TOOLS_PAGE_INTRO;

  for (const t of tools) {
    const file = findToolFileExporting(toolsDir, t.schemaIdent);
    if (!file) {
      md += `## \`${t.name}\`\n\n${t.description.trim()}\n\n_Schema export \`${t.schemaIdent}\` not found in \`src/mcp/tools/\`._\n\n`;
      continue;
    }
    const parsed = parseToolFile(file, t.schemaIdent, constArrays);
    const { typeText, bodyInterface } = resolveOutput(t.schemaIdent, parsed);
    const examplesName = t.schemaIdent.replace(/Schema$/, "Examples");
    const examples = parsed.examplesByName.get(examplesName) ?? [];
    md += renderTool({
      name: t.name,
      description: t.description,
      inputFields: parsed.inputFields,
      outputTypeText: typeText,
      outputBody: bodyInterface,
      examples,
    });
  }

  md += TOOLS_PAGE_FOOTER;
  return md;
}

export function buildToolsPage(rootDir: string): void {
  const md = renderToolsPage(rootDir);
  const dst = join(rootDir, "docs", "tools.md");
  writeFileSync(dst, md, "utf8");
}
