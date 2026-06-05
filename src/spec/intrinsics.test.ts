import { describe, it, expect } from "vitest";
import { wellKnownIntrinsics, type IntrinsicsClause } from "./intrinsics.js";

function clause(title: string, number: string, stepText = ""): IntrinsicsClause {
  return {
    meta: { title, number },
    signatureRaw: title,
    notes: [],
    algorithms: stepText ? [{ steps: [{ text: stepText, substeps: [] }] }] : [],
  };
}

describe("wellKnownIntrinsics — table path", () => {
  const clauses: Record<string, IntrinsicsClause> = {
    "sec-array-ctor": clause("The Array Constructor", "23.1.1"),
    "sec-object-proto": clause("Object.prototype.toString ( )", "20.1.3.6"),
  };
  const table = {
    rows: [
      ["%Array%", "Array", "The Array constructor"],
      ["%Object.prototype%", "", "The Object prototype object"],
    ],
  };

  it("drives from the table and matches defining clauses", () => {
    const r = wellKnownIntrinsics(clauses, table, {});
    expect(r.source).toBe("table");
    const arr = r.hits.find((h) => h.name === "Array")!;
    expect(arr.global_name).toBe("Array");
    expect(arr.association).toBe("The Array constructor");
    // "%Array%" → "The Array Constructor" via the canonical-shape match.
    expect(arr.defining_clause?.id).toBe("sec-array-ctor");
    expect(arr.defining_clause?.matched_on).toBe("table-row");
  });

  it("filters by bare name", () => {
    const r = wellKnownIntrinsics(clauses, table, { filter: "object" });
    expect(r.hits.map((h) => h.name)).toEqual(["Object.prototype"]);
  });
});

describe("wellKnownIntrinsics — heuristic path", () => {
  const clauses: Record<string, IntrinsicsClause> = {
    "sec-a": clause("Some Clause", "1.1", "Uses %Array% and %Array% again."),
    "sec-b": clause("%Object.prototype% holder", "2.1", "Mentions %Object.prototype%."),
  };

  it("falls back to scanning %X% notation when there's no table", () => {
    const r = wellKnownIntrinsics(clauses, undefined, {});
    expect(r.source).toBe("heuristic");
    expect(r.hits.find((h) => h.name === "Array")!.mention_count).toBe(2);
    // sec-b's title carries the literal %Object.prototype% → title-literal.
    expect(r.hits.find((h) => h.name === "Object.prototype")!.defining_clause?.matched_on).toBe(
      "title-literal",
    );
  });

  it("treats an empty table as no table (heuristic)", () => {
    const r = wellKnownIntrinsics({}, { rows: [] }, {});
    expect(r.source).toBe("heuristic");
    expect(r.hits).toEqual([]);
  });
});
