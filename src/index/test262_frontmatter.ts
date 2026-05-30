// Shared test262 front-matter reader. Used both by the index builder
// (build_test262.ts) and the test262.get tool (test262_get.ts).
//
// test262 front-matter convention: a `/*---\n ... \n---*\/` block near
// the top of every test file. Body is a small subset of YAML —
// flat scalars, bulleted-list arrays, inline arrays, and literal
// block scalars. We hand-parse it because the subset is tiny enough
// that adding a YAML dependency for this would be overkill.

export interface Test262Frontmatter {
  esid?: string;
  description?: string;
  info?: string;
  features?: string[];
  flags?: string[];
  includes?: string[];
  negative?: { phase?: string; type?: string };
  /** Any keys we recognize but didn't have a typed slot for, stored verbatim. */
  raw?: Record<string, string | string[]>;
}

/** Pull the YAML front-matter block out of a test file. */
export function readFrontmatter(text: string): string | null {
  const open = text.indexOf("/*---");
  if (open < 0) return null;
  const close = text.indexOf("---*/", open + 5);
  if (close < 0) return null;
  return text.slice(open + 5, close).trim();
}

/** Parse the front-matter YAML subset that test262 actually uses. */
export function parseTest262Yaml(text: string): Test262Frontmatter {
  const out: Test262Frontmatter = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const line = raw.replace(/\s+$/, "");
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    let value: string | string[] = m[2]!.trim();

    if (value === "|" || value === ">") {
      // Literal block scalar. Collect indented continuation lines.
      // When the inner loop breaks, `i` already points at the next
      // top-level line — DO NOT i++ after, or that line is lost.
      const buf: string[] = [];
      i++;
      while (i < lines.length) {
        const nx = lines[i]!;
        if (/^\S/.test(nx) && nx.trim() !== "") break;
        buf.push(nx.replace(/^\s\s/, ""));
        i++;
      }
      assign(out, key, buf.join("\n").trim());
      continue;
    }
    if (value === "") {
      // Either a bulleted-list array OR a nested mapping (negative:).
      const arr: string[] = [];
      const mapping: Record<string, string> = {};
      i++;
      while (i < lines.length) {
        const nx = lines[i]!;
        if (nx.trim() === "") {
          i++;
          continue;
        }
        const am = /^\s+-\s+(.+)$/.exec(nx);
        const mm = /^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(nx);
        if (am) {
          arr.push(am[1]!.trim());
          i++;
        } else if (mm) {
          mapping[mm[1]!] = mm[2]!.trim();
          i++;
        } else if (/^\S/.test(nx)) {
          break;
        } else {
          i++;
        }
      }
      // As above: `i` already points at the next top-level line; the
      // outer loop's next iteration handles it. Use `continue`.
      if (arr.length > 0) assign(out, key, arr);
      else if (Object.keys(mapping).length > 0) assign(out, key, mapping);
      // If neither, the key was a bare `key:` with no body — skip it.
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      // Inline array: [a, b, c]
      const inner = value.slice(1, -1).trim();
      value = inner.length === 0
        ? []
        : inner.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    }
    assign(out, key, value);
    i++;
  }
  return out;
}

function assign(
  out: Test262Frontmatter,
  key: string,
  value: string | string[] | Record<string, string>,
): void {
  if (key === "esid" && typeof value === "string") out.esid = value;
  else if (key === "description" && typeof value === "string") out.description = value;
  else if (key === "info" && typeof value === "string") out.info = value;
  else if (key === "features" && Array.isArray(value)) out.features = value;
  else if (key === "flags" && Array.isArray(value)) out.flags = value;
  else if (key === "includes" && Array.isArray(value)) out.includes = value;
  else if (key === "negative" && typeof value === "object" && !Array.isArray(value)) {
    out.negative = {
      ...(value.phase ? { phase: value.phase } : {}),
      ...(value.type ? { type: value.type } : {}),
    };
  } else {
    if (!out.raw) out.raw = {};
    if (typeof value === "string" || Array.isArray(value)) out.raw[key] = value;
  }
}
