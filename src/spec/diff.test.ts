import { describe, it, expect } from "vitest";
import { diffClause, type DiffClause } from "./diff.js";

function clause(o: {
  title?: string;
  signatureRaw?: string | null;
  notes?: { text: string }[];
  algorithms?: { steps: { text: string; substeps: [] }[] }[];
  crossrefs?: string[];
}): DiffClause {
  return {
    meta: { title: o.title ?? "X" },
    signatureRaw: o.signatureRaw ?? null,
    notes: o.notes ?? [],
    algorithms: o.algorithms ?? [],
    crossrefs: o.crossrefs,
  };
}
function steps(...texts: string[]) {
  return [{ steps: texts.map((t) => ({ text: t, substeps: [] as [] })) }];
}

describe("diffClause", () => {
  it("identical clauses → status identical, no diffs", () => {
    const mk = () => clause({ title: "ToNumber", signatureRaw: "ToNumber ( x )", algorithms: steps("s1", "s2") });
    const r = diffClause(mk(), mk());
    expect(r.status).toBe("identical");
    expect(r.same).toBe(true);
    expect(r.diffs).toBeUndefined();
  });

  it("handles added / removed / missing-from-both", () => {
    const c = clause({ title: "X" });
    expect(diffClause(undefined, c).status).toBe("added");
    expect(diffClause(c, undefined).status).toBe("removed");
    expect(diffClause(undefined, undefined).status).toBe("missing-from-both");
  });

  it("title change → a title diff", () => {
    const r = diffClause(clause({ title: "Old" }), clause({ title: "New" }));
    expect(r.status).toBe("modified");
    expect(r.diffs!.find((d) => d.field === "title")).toMatchObject({ before: "Old", after: "New" });
  });

  it("step-count change → a steps diff with a signed detail", () => {
    const d = diffClause(clause({ algorithms: steps("s1") }), clause({ algorithms: steps("s1", "s2", "s3") }))
      .diffs!.find((x) => x.field === "steps")!;
    expect(d.before).toBe(1);
    expect(d.after).toBe(3);
    expect(d.detail).toContain("+2 step");
  });

  it("same step count but reworded → reports the changed step index", () => {
    const d = diffClause(clause({ algorithms: steps("keep", "old") }), clause({ algorithms: steps("keep", "new") }))
      .diffs!.find((x) => x.field === "steps")!;
    expect(d.detail).toContain("#2");
  });

  it("compares crossrefs order-insensitively", () => {
    const a = clause({ crossrefs: ["#a", "#b"] });
    const reordered = clause({ crossrefs: ["#b", "#a"] });
    expect(diffClause(a, reordered).status).toBe("identical");
    const added = clause({ crossrefs: ["#a", "#b", "#c"] });
    expect(diffClause(a, added).diffs!.some((d) => d.field === "crossrefs")).toBe(true);
  });
});
