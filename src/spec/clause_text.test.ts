import { describe, it, expect } from "vitest";
import {
  flatClauseText,
  walkSteps,
  flattenStepText,
  type ClauseTextInput,
  type ClauseTextStep,
} from "./clause_text.js";

function step(text: string, substeps: ClauseTextStep[] = []): ClauseTextStep {
  return { text, substeps };
}

function clause(overrides: Partial<ClauseTextInput> = {}): ClauseTextInput {
  return {
    meta: { title: "Test Clause" },
    signatureRaw: "sig",
    algorithms: [{ steps: [step("step-1"), step("step-2", [step("step-2a")])] }],
    notes: [{ text: "n1" }, { text: "n2" }],
    ...overrides,
  };
}

describe("flatClauseText", () => {
  it("concatenates signature + title + notes + steps, including substeps", () => {
    const text = flatClauseText(clause());
    for (const part of ["sig", "Test Clause", "n1", "n2", "step-1", "step-2", "step-2a"]) {
      expect(text).toContain(part);
    }
  });

  it("omits signature when null", () => {
    expect(flatClauseText(clause({ signatureRaw: null }))).not.toContain("sig");
  });

  it("works on clauses with no algorithms", () => {
    const text = flatClauseText(clause({ algorithms: [] }));
    expect(text).toContain("Test Clause");
    expect(text).not.toContain("step-");
  });
});

const tree: ClauseTextStep[] = [
  step("A", [step("A.1"), step("A.2", [step("A.2.1"), step("A.2.2")])]),
  step("B"),
];

describe("walkSteps", () => {
  it("visits every step depth-first, pre-order", () => {
    const visited: string[] = [];
    walkSteps(tree, (s) => visited.push(s.text));
    expect(visited).toEqual(["A", "A.1", "A.2", "A.2.1", "A.2.2", "B"]);
  });

  it("doesn't recurse on an empty array", () => {
    let called = 0;
    walkSteps([], () => called++);
    expect(called).toBe(0);
  });
});

describe("flattenStepText", () => {
  it("returns every step's text in DFS order", () => {
    expect(flattenStepText(tree)).toEqual(["A", "A.1", "A.2", "A.2.1", "A.2.2", "B"]);
  });

  it("returns [] for empty input", () => {
    expect(flattenStepText([])).toEqual([]);
  });
});
