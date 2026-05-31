// Generate `docs/api-reference.md` from source: walk `src/mcp/server.ts`
// for tool registrations, then resolve each tool's input Zod schema +
// output TypeScript interface from `src/mcp/tools/*.ts`. The rendered
// page lists every tool with structured Input + Output tables, where
// the prose comes from the same .describe() calls and JSDoc comments
// the LLM-facing surfaces consume.
//
// This file is intentionally regex-free for the schema/interface
// shapes — those use the TypeScript Compiler API to stay correct
// across formatting variations. Only the JSDoc reduction is text-y.
//
// Run via `npm run docs:data` (build_data.ts wires us in).

import * as ts from "typescript";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

interface ToolDoc {
  name: string;
  description: string;
  inputFields: SchemaField[];
  /** Declared return type as written, e.g. `Clause | null`. */
  outputTypeText: string;
  /** When the type names a local interface, its field list. */
  outputBody: OutputType | null;
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

// ─── server.ts: find all server.tool(name, desc, schemaIdent, handler) ──

export function parseServerTools(serverPath: string): ToolReg[] {
  const src = readFileSync(serverPath, "utf8");
  const sf = ts.createSourceFile(serverPath, src, ts.ScriptTarget.Latest, true);
  const out: ToolReg[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "server" &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === "tool"
    ) {
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
            const analysis = analyzeZodChain(prop.initializer, sf);
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

  return { inputFields, interfaces, functionReturnTypes };
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

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Collapse runs of internal whitespace inside a type string so
 *  multi-line object types render on one row. */
function tidyType(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

function renderTool(doc: ToolDoc): string {
  let md = `## \`${doc.name}\`\n\n${doc.description.trim()}\n\n`;

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

export function renderApiReference(rootDir: string): string {
  const serverPath = resolve(rootDir, "src", "mcp", "server.ts");
  const toolsDir = resolve(rootDir, "src", "mcp", "tools");
  const editionsPath = resolve(rootDir, "src", "editions.ts");

  if (!existsSync(serverPath) || !existsSync(toolsDir)) {
    return `# API reference\n\n_Source files not found. Run from the repo root._\n`;
  }

  const constArrays = readStringConstArrays(editionsPath);
  const tools = parseServerTools(serverPath);

  let md = `# API reference\n\n`;
  md += `> Auto-generated by \`npm run docs:data\` from \`src/mcp/server.ts\` + \`src/mcp/tools/*.ts\`. Do not edit by hand — change the sources instead.\n\n`;
  md += `Every tool is registered with a name, a description, an input Zod schema, and a handler that returns a typed output. This page surfaces all three: the description verbatim, every input field with its type / default / inline help, and every output field with the type and JSDoc from the result interface.\n\n`;
  md += `For prose-style usage notes, hand-written examples, and the error envelope, see [\`tools.md\`](tools.md).\n\n`;

  for (const t of tools) {
    const file = findToolFileExporting(toolsDir, t.schemaIdent);
    if (!file) {
      md += `## \`${t.name}\`\n\n${t.description.trim()}\n\n_Schema export \`${t.schemaIdent}\` not found in \`src/mcp/tools/\`._\n\n`;
      continue;
    }
    const parsed = parseToolFile(file, t.schemaIdent, constArrays);
    const { typeText, bodyInterface } = resolveOutput(t.schemaIdent, parsed);
    md += renderTool({
      name: t.name,
      description: t.description,
      inputFields: parsed.inputFields,
      outputTypeText: typeText,
      outputBody: bodyInterface,
    });
  }
  return md;
}

export function buildApiReference(rootDir: string): void {
  const md = renderApiReference(rootDir);
  const dst = join(rootDir, "docs", "api-reference.md");
  writeFileSync(dst, md, "utf8");
}
