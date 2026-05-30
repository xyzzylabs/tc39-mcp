import { describe, it, expect } from "vitest";
import { readFrontmatter, parseTest262Yaml } from "./test262_frontmatter.js";

// Synthetic-input unit tests for the test262 front-matter parser.
// Each test covers one shape the YAML subset has to handle.

describe("readFrontmatter", () => {
  it("extracts the block between /*--- and ---*/", () => {
    const src = `// copyright header
/*---
esid: sec-tonumber
description: x
---*/
const x = 1;`;
    const fm = readFrontmatter(src);
    expect(fm).toBe("esid: sec-tonumber\ndescription: x");
  });

  it("returns null when there is no front-matter block", () => {
    expect(readFrontmatter("const x = 1;")).toBeNull();
  });

  it("returns null when the closing delimiter is missing", () => {
    expect(readFrontmatter("/*---\nesid: foo\nconst x = 1;")).toBeNull();
  });
});

describe("parseTest262Yaml — scalar values", () => {
  it("parses simple `key: value` pairs", () => {
    const fm = parseTest262Yaml("esid: sec-tonumber\ndescription: A test");
    expect(fm.esid).toBe("sec-tonumber");
    expect(fm.description).toBe("A test");
  });

  it("trims surrounding whitespace from values", () => {
    const fm = parseTest262Yaml("esid:    sec-tonumber   ");
    expect(fm.esid).toBe("sec-tonumber");
  });

  it("stashes unrecognized scalar keys in `raw`", () => {
    const fm = parseTest262Yaml("custom: hello");
    expect(fm.raw?.custom).toBe("hello");
  });
});

describe("parseTest262Yaml — inline arrays", () => {
  it("parses `key: [a, b, c]`", () => {
    const fm = parseTest262Yaml("features: [BigInt, async-iteration]");
    expect(fm.features).toEqual(["BigInt", "async-iteration"]);
  });

  it("handles an empty inline array", () => {
    const fm = parseTest262Yaml("features: []");
    expect(fm.features).toEqual([]);
  });

  it("trims whitespace inside inline arrays", () => {
    const fm = parseTest262Yaml("flags: [  strict  ,  noStrict  ]");
    expect(fm.flags).toEqual(["strict", "noStrict"]);
  });
});

describe("parseTest262Yaml — bulleted arrays", () => {
  it("parses `key:\\n  - item\\n  - item`", () => {
    const fm = parseTest262Yaml(`features:
  - BigInt
  - async-iteration`);
    expect(fm.features).toEqual(["BigInt", "async-iteration"]);
  });

  it("handles a single-item bulleted list", () => {
    const fm = parseTest262Yaml(`flags:
  - strict`);
    expect(fm.flags).toEqual(["strict"]);
  });
});

describe("parseTest262Yaml — literal block scalars", () => {
  it("parses `key: |` with indented continuation", () => {
    const fm = parseTest262Yaml(`info: |
  Line one of info.
  Line two of info.
esid: sec-x`);
    expect(fm.info).toBe("Line one of info.\nLine two of info.");
    // The `esid` after the block should still parse.
    expect(fm.esid).toBe("sec-x");
  });

  it("parses `key: >` block scalars too", () => {
    const fm = parseTest262Yaml(`info: >
  Some folded text.`);
    expect(fm.info).toBe("Some folded text.");
  });
});

describe("parseTest262Yaml — negative mapping", () => {
  it("parses the `negative:` nested mapping into { phase, type }", () => {
    const fm = parseTest262Yaml(`negative:
  phase: parse
  type: SyntaxError`);
    expect(fm.negative).toEqual({ phase: "parse", type: "SyntaxError" });
  });

  it("handles a partial negative mapping (type only)", () => {
    const fm = parseTest262Yaml(`negative:
  type: TypeError`);
    expect(fm.negative).toEqual({ type: "TypeError" });
  });
});

describe("parseTest262Yaml — multiple keys interleaved", () => {
  it("parses a realistic combined front-matter block", () => {
    const fm = parseTest262Yaml(`esid: sec-tonumber
description: BigInt coercion via ToNumber
info: |
  ToNumber throws a TypeError for BigInts unless...
features: [BigInt]
flags:
  - noStrict
negative:
  phase: runtime
  type: TypeError`);
    expect(fm.esid).toBe("sec-tonumber");
    expect(fm.description).toBe("BigInt coercion via ToNumber");
    expect(fm.info).toMatch(/^ToNumber throws/);
    expect(fm.features).toEqual(["BigInt"]);
    expect(fm.flags).toEqual(["noStrict"]);
    expect(fm.negative).toEqual({ phase: "runtime", type: "TypeError" });
  });
});
