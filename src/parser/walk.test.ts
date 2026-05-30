import { describe, it, expect } from "vitest";
import { walkSteps, flattenStepText, joinStepText, flatClauseText } from "./walk.js";
import type { AlgorithmStep, Clause } from "./schema.js";

function step(text: string, substeps: AlgorithmStep[] = []): AlgorithmStep {
  return { text, substeps };
}

const tree: AlgorithmStep[] = [
  step("A", [
    step("A.1"),
    step("A.2", [step("A.2.1"), step("A.2.2")]),
  ]),
  step("B"),
];

describe("walkSteps", () => {
  it("visits every step depth-first, pre-order", () => {
    const visited: string[] = [];
    walkSteps(tree, (s) => visited.push(s.text));
    expect(visited).toEqual(["A", "A.1", "A.2", "A.2.1", "A.2.2", "B"]);
  });

  it("doesn't recurse when given an empty array", () => {
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

describe("joinStepText", () => {
  it("joins flattened steps with newlines", () => {
    expect(joinStepText(tree)).toBe("A\nA.1\nA.2\nA.2.1\nA.2.2\nB");
  });
});

describe("flatClauseText", () => {
  function clause(overrides: Partial<Clause> = {}): Clause {
    return {
      meta: {
        id: "sec-x",
        aoid: null,
        title: "Test Clause",
        number: "1.1",
        kind: "clause",
      },
      signatureRaw: "sig",
      algorithms: [{ steps: [step("step-1"), step("step-2")] }],
      notes: [{ text: "n1" }, { text: "n2" }],
      crossrefs: [],
      ...overrides,
    };
  }

  it("concatenates signature + title + notes + steps", () => {
    const text = flatClauseText(clause());
    expect(text).toContain("sig");
    expect(text).toContain("Test Clause");
    expect(text).toContain("n1");
    expect(text).toContain("n2");
    expect(text).toContain("step-1");
    expect(text).toContain("step-2");
  });

  it("omits signature when null", () => {
    const text = flatClauseText(clause({ signatureRaw: null }));
    expect(text).not.toContain("sig");
  });

  it("works on clauses with no algorithms", () => {
    const text = flatClauseText(clause({ algorithms: [] }));
    expect(text).toContain("Test Clause");
    expect(text).not.toContain("step-");
  });
});
