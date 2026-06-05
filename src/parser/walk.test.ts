import { describe, it, expect } from "vitest";
import { walkSteps, flattenStepText, joinStepText } from "./walk.js";
import type { AlgorithmStep } from "./schema.js";

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
