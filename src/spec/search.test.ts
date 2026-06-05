import { describe, it, expect } from "vitest";
import { searchClauses, type SearchableClause } from "./search.js";

const mk = (
  meta: Partial<SearchableClause["meta"]>,
  steps: string[] = [],
): SearchableClause => ({
  meta: { aoid: null, title: "", number: "", kind: "op", ...meta },
  algorithms: steps.length
    ? [{ steps: steps.map((text) => ({ text, substeps: [] })) }]
    : [],
});

const CLAUSES: Record<string, SearchableClause> = {
  "sec-tonumber": mk({ aoid: "ToNumber", title: "ToNumber ( argument )", number: "7.1.4" }),
  "sec-tonumeric": mk({ aoid: "ToNumeric", title: "ToNumeric ( value )", number: "7.1.3" }),
  "sec-foo": mk({ title: "Foo Bar", number: "9.9" }, ["Let x be the WidgetCount of O."]),
};

describe("searchClauses", () => {
  it("ranks aoid-exact (100) > aoid (80) > title (60) > id (40)", () => {
    expect(searchClauses(CLAUSES, { query: "ToNumber" })[0]).toMatchObject({
      id: "sec-tonumber",
      matched_on: "aoid-exact",
      score: 100,
    });
    expect(
      searchClauses(CLAUSES, { query: "ToNum" }).find((h) => h.id === "sec-tonumeric")
        ?.matched_on,
    ).toBe("aoid");
    expect(searchClauses(CLAUSES, { query: "Foo" })[0]).toMatchObject({
      matched_on: "title",
      score: 60,
    });
    expect(searchClauses(CLAUSES, { query: "sec-foo" })[0]).toMatchObject({
      matched_on: "id",
      score: 40,
    });
  });

  it("matches step text only when searchSteps is true (score 20, matched_on 'steps')", () => {
    // 'WidgetCount' appears only in step text — no aoid/title/id hit.
    expect(searchClauses(CLAUSES, { query: "WidgetCount" })).toEqual([]);
    const hits = searchClauses(CLAUSES, { query: "WidgetCount", searchSteps: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "sec-foo", matched_on: "steps", score: 20 });
  });

  it("sorts by score, then section number, and respects limit", () => {
    // 'to' hits both ToNumber + ToNumeric (aoid substring, score 80); the
    // lower section number sorts first, and limit caps the result.
    const hits = searchClauses(CLAUSES, { query: "to", limit: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe("sec-tonumeric"); // 7.1.3 < 7.1.4
  });
});
