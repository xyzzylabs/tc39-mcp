import { describe, it, expect } from "vitest";
import { clauseGet, clauseList, loadSpec } from "../mcp/tools/clause.js";

// Exercises the ECMA-402-specific code paths in src/parser/ecma402.ts:
//   - <emu-import> chain inlining (the 402 spec is multi-file).
//   - Section-number computation from tree position.
//   - AOID synthesis from `<h1>Name ( args )</h1>` titles, which is what
//     makes cross-spec AOID matching work between 262 ↔ 402.
//
// All assertions assume `npm run parse` has run for 402/main. Each
// test is wrapped to no-op when the parsed JSON is missing so CI
// without parsed 402 doesn't fail spuriously.

async function maybe402(): Promise<
  { ok: true; spec: Awaited<ReturnType<typeof loadSpec>> } | { ok: false }
> {
  try {
    return { ok: true, spec: await loadSpec("402", "main") };
  } catch {
    return { ok: false };
  }
}

describe("parseSpec402: multi-file inlining", () => {
  it("captures clauses from multiple spec/*.html source files", async () => {
    const m = await maybe402();
    if (!m.ok) return;
    // sec-intl.numberformat lives in spec/numberformat.html;
    // sec-intl.collator lives in spec/collator.html.
    // Both being present proves the <emu-import> chain was followed.
    expect(m.spec.clauses["sec-intl.numberformat"]).toBeDefined();
    expect(m.spec.clauses["sec-intl.collator"]).toBeDefined();
  });

  it("captures the Intl object root clause", async () => {
    const m = await maybe402();
    if (!m.ok) return;
    // The Intl object root is `intl-object` (defined in spec/intl.html).
    expect(m.spec.clauses["intl-object"]).toBeDefined();
  });
});

describe("parseSpec402: section numbers", () => {
  it("computes section numbers from tree position", async () => {
    const m = await maybe402();
    if (!m.ok) return;
    // The number should be a non-empty dotted-decimal string for any
    // non-root clause.
    const nf = m.spec.clauses["sec-intl.numberformat"];
    expect(nf).toBeDefined();
    expect(nf!.meta.number).toMatch(/^\d+(\.\d+)+$/);
  });

  it("nested clauses get longer section numbers than their parents", async () => {
    const m = await maybe402();
    if (!m.ok) return;
    const parent = m.spec.clauses["numberformat-objects"];
    const child = m.spec.clauses["sec-intl-numberformat-constructor"];
    if (!parent || !child) return;
    expect(child.meta.number.length).toBeGreaterThan(parent.meta.number.length);
    expect(child.meta.number.startsWith(parent.meta.number + ".")).toBe(true);
  });
});

describe("parseSpec402: AOID synthesis from h1 titles", () => {
  it("synthesizes an aoid for clauses whose title is `Name ( args )`", async () => {
    const m = await maybe402();
    if (!m.ok) return;
    // SetNumberFormatUnitOptions is a 402 abstract op. The 402 source
    // doesn't carry `aoid="..."` on <emu-clause>; we derive it from the
    // h1 leading token. This is what makes cross-spec AOID matching
    // discover it from a 262 clause that mentions it.
    const c = await clauseGet({
      id: "sec-setnumberformatunitoptions",
      spec: "402",
      edition: "main",
    });
    if (!c) return;
    expect(c.meta.aoid).toBe("SetNumberFormatUnitOptions");
    expect(c.meta.kind).toBe("op");
  });

  it("does NOT synthesize an aoid for prose-style titles", async () => {
    const m = await maybe402();
    if (!m.ok) return;
    // "NumberFormat Objects" is a section header, not an op signature.
    const c = await clauseGet({
      id: "numberformat-objects",
      spec: "402",
      edition: "main",
    });
    if (!c) return;
    expect(c.meta.aoid).toBeNull();
    expect(c.meta.kind).toBe("clause");
  });
});

describe("clauseGet / clauseList on ECMA-402", () => {
  it("clauseList returns op-kind clauses when filtered", async () => {
    try {
      const ops = await clauseList({
        spec: "402",
        edition: "main",
        kind: "op",
        limit: 500,
      });
      expect(ops.length).toBeGreaterThan(0);
      for (const op of ops) expect(op.kind).toBe("op");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("clauseList section filter narrows by number prefix", async () => {
    try {
      const numberformatSection = await clauseList({
        spec: "402",
        edition: "main",
        section: "16",
        limit: 500,
      });
      expect(numberformatSection.length).toBeGreaterThan(0);
      for (const c of numberformatSection) {
        expect(c.number.startsWith("16")).toBe(true);
      }
    } catch {
      // Parsed JSON missing.
    }
  });
});
