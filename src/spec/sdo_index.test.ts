import { describe, it, expect } from "vitest";
import { buildSdoIndex, type SdoIndexClause } from "./sdo_index.js";

const CLAUSES: Record<string, SdoIndexClause> = {
  "sec-eval-bindingid": {
    meta: { title: "Evaluation" },
    algorithms: [{ production: "BindingIdentifier : Identifier" }],
  },
  "sec-eval-statement": {
    meta: { title: "Evaluation" },
    algorithms: [{ production: "Statement : BlockStatement" }],
  },
  "sec-named-eval": {
    meta: { title: "NamedEvaluation" },
    algorithms: [{ production: "BindingIdentifier : Identifier" }],
  },
  "sec-prose": {
    meta: { title: "Some Prose" },
    algorithms: [],
  },
  "sec-boundnames": {
    meta: { title: "BoundNames" },
    // One SDO algorithm + one regular algorithm with no production.
    algorithms: [{ production: "Statement : BlockStatement" }, {}],
  },
};

describe("buildSdoIndex — by production (default)", () => {
  it("groups SDO definitions under the production they handle", () => {
    const r = buildSdoIndex(CLAUSES, {});
    expect(r.by).toBe("production");
    // 4 algorithms carry a production (the prose + the bare algorithm
    // are skipped).
    expect(r.pair_count).toBe(4);
    expect(r.group_count).toBe(2);
    expect(r.groups["BindingIdentifier : Identifier"]!.map((e) => e.title).sort()).toEqual([
      "Evaluation",
      "NamedEvaluation",
    ]);
  });
});

describe("buildSdoIndex — by sdo", () => {
  it("groups productions under each SDO title", () => {
    const r = buildSdoIndex(CLAUSES, { by: "sdo" });
    expect(r.by).toBe("sdo");
    expect(r.group_count).toBe(3); // Evaluation, NamedEvaluation, BoundNames
    expect(r.groups["Evaluation"]!.map((e) => e.production).sort()).toEqual([
      "BindingIdentifier : Identifier",
      "Statement : BlockStatement",
    ]);
  });
});

describe("buildSdoIndex — filter + limit", () => {
  it("filters to keys containing the substring (case-insensitive)", () => {
    const r = buildSdoIndex(CLAUSES, { filter: "bindingidentifier" });
    expect(r.group_count).toBe(1);
    expect(Object.keys(r.groups)).toEqual(["BindingIdentifier : Identifier"]);
    expect(r.pair_count).toBe(4); // pair_count is pre-filter
  });

  it("caps the number of groups but reports the pre-cap count", () => {
    const r = buildSdoIndex(CLAUSES, { by: "sdo", limit: 2 });
    // Sorted SDO titles: BoundNames, Evaluation, NamedEvaluation → first 2.
    expect(Object.keys(r.groups)).toEqual(["BoundNames", "Evaluation"]);
    expect(r.group_count).toBe(3);
  });
});
