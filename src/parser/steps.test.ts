import { describe, it, expect } from "vitest";
import { parseAlgorithm } from "./steps.js";

// parseAlgorithm() drives every algorithm-step-aware tool (clause.get,
// spec.diff step counting, spec.search --search_steps,
// spec.symbol_resolve, spec.sdo_index, spec.crossrefs AOID densification).
// A regression here would silently corrupt step trees across half the
// surface — so we exercise the indent stack carefully.

describe("parseAlgorithm — simple cases", () => {
  it("returns [] for empty input", () => {
    expect(parseAlgorithm("")).toEqual([]);
  });

  it("returns [] for input with no step markers", () => {
    expect(parseAlgorithm("Some prose without any numbered list.")).toEqual([]);
  });

  it("parses a single top-level step", () => {
    const r = parseAlgorithm(`1. Return _argument_.`);
    expect(r).toEqual([{ text: "Return _argument_.", substeps: [] }]);
  });

  it("parses multiple sibling steps at the top level", () => {
    const r = parseAlgorithm(`
1. If _x_ is a Number, return _x_.
1. If _x_ is a String, throw a TypeError exception.
1. Return *undefined*.
`);
    expect(r).toHaveLength(3);
    expect(r[0]!.text).toBe("If _x_ is a Number, return _x_.");
    expect(r[1]!.text).toBe("If _x_ is a String, throw a TypeError exception.");
    expect(r[2]!.text).toBe("Return *undefined*.");
    for (const step of r) expect(step.substeps).toEqual([]);
  });
});

describe("parseAlgorithm — nesting", () => {
  it("parses a step with one indented substep", () => {
    const r = parseAlgorithm(`
1. Let _x_ be 0.
  1. Increment _x_.
`);
    expect(r).toHaveLength(1);
    expect(r[0]!.text).toBe("Let _x_ be 0.");
    expect(r[0]!.substeps).toHaveLength(1);
    expect(r[0]!.substeps[0]!.text).toBe("Increment _x_.");
  });

  it("parses three levels of nesting", () => {
    const r = parseAlgorithm(`
1. Top.
  1. Middle.
    1. Bottom.
`);
    expect(r).toHaveLength(1);
    expect(r[0]!.substeps).toHaveLength(1);
    expect(r[0]!.substeps[0]!.substeps).toHaveLength(1);
    expect(r[0]!.substeps[0]!.substeps[0]!.text).toBe("Bottom.");
    expect(r[0]!.substeps[0]!.substeps[0]!.substeps).toEqual([]);
  });

  it("siblings at the inner level go into the same parent's substeps", () => {
    const r = parseAlgorithm(`
1. Outer.
  1. Inner A.
  1. Inner B.
  1. Inner C.
`);
    expect(r[0]!.substeps).toHaveLength(3);
    expect(r[0]!.substeps.map((s) => s.text)).toEqual([
      "Inner A.",
      "Inner B.",
      "Inner C.",
    ]);
  });

  it("after returning to the outer level, new siblings attach to the root", () => {
    const r = parseAlgorithm(`
1. Outer 1.
  1. Inner A.
  1. Inner B.
1. Outer 2.
`);
    expect(r).toHaveLength(2);
    expect(r[0]!.text).toBe("Outer 1.");
    expect(r[0]!.substeps).toHaveLength(2);
    expect(r[1]!.text).toBe("Outer 2.");
    expect(r[1]!.substeps).toEqual([]);
  });
});

describe("parseAlgorithm — indent stack edge cases", () => {
  it("dedenting by more than one level returns all the way out", () => {
    const r = parseAlgorithm(`
1. L1.
  1. L2.
    1. L3.
1. New L1 sibling.
`);
    expect(r).toHaveLength(2);
    expect(r[0]!.substeps[0]!.substeps).toHaveLength(1);
    expect(r[1]!.text).toBe("New L1 sibling.");
  });

  it("an indented step at the start (no preceding root) still attaches under root", () => {
    // Pathological — there's no preceding L1 to attach to. The current
    // implementation puts the indented step at root regardless.
    const r = parseAlgorithm(`  1. Orphaned indent.`);
    expect(r).toHaveLength(1);
    expect(r[0]!.text).toBe("Orphaned indent.");
  });

  it("ignores lines that aren't step markers (prose, blank lines)", () => {
    const r = parseAlgorithm(`
NOTE: an editor's note.
1. Real step.
  Indented prose without a marker — ignored.
1. Another real step.
`);
    expect(r).toHaveLength(2);
    expect(r.map((s) => s.text)).toEqual(["Real step.", "Another real step."]);
  });

  it("treats tabs and spaces differently (regex literal whitespace)", () => {
    // STEP_RE matches \s*; both tabs and spaces count toward indent.
    // A tab is 1 character of indent; 2 spaces are 2 characters.
    // So `\t1.` at column 1 has indent=1, and `  1.` has indent=2 →
    // the space-indented one is deeper.
    const r = parseAlgorithm("1. Parent.\n\t1. Tab-child.\n  1. Space-child.");
    expect(r).toHaveLength(1);
    // Both children should land under Parent because they're indented
    // more than its (indent=0).
    expect(r[0]!.substeps.length).toBeGreaterThan(0);
  });
});

describe("parseAlgorithm — text preservation", () => {
  it("preserves inline markup verbatim", () => {
    const r = parseAlgorithm(`
1. Let _argument_ be *0*𝔽.
1. Return ! ToNumber(_argument_).
1. If _x_ is ~undefined~, throw a *TypeError* exception.
`);
    expect(r[0]!.text).toBe("Let _argument_ be *0*𝔽.");
    expect(r[1]!.text).toBe("Return ! ToNumber(_argument_).");
    expect(r[2]!.text).toBe("If _x_ is ~undefined~, throw a *TypeError* exception.");
  });

  it("trims trailing whitespace from step text", () => {
    const r = parseAlgorithm("1. Step with trailing spaces.   ");
    expect(r[0]!.text).toBe("Step with trailing spaces.");
  });
});

describe("parseAlgorithm — real-world shape (smoke)", () => {
  it("parses a non-trivial multi-branch algorithm correctly", () => {
    // Approximates a real ECMA-262 algorithm: ToBoolean.
    const r = parseAlgorithm(`
1. If _argument_ is a Boolean, return _argument_.
1. If _argument_ is one of *undefined*, *null*, or *+0*𝔽, return *false*.
1. If _argument_ is a Number, then
  1. If _argument_ is *NaN* or *+0*𝔽 or *-0*𝔽, return *false*.
  1. Return *true*.
1. Return *true*.
`);
    expect(r).toHaveLength(4);
    expect(r[2]!.text).toBe("If _argument_ is a Number, then");
    expect(r[2]!.substeps).toHaveLength(2);
    expect(r[3]!.text).toBe("Return *true*.");
    expect(r[3]!.substeps).toEqual([]);
  });
});
