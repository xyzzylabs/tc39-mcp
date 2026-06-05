import { describe, it, expect } from "vitest";
import { filterProposals, type FilterableProposal } from "./proposals_filter.js";

const P = (o: Partial<FilterableProposal>): FilterableProposal => ({
  slug: "x",
  name: "X",
  stage: "3",
  champions: [],
  spec: "262",
  ...o,
});

const ALL = [
  P({ slug: "temporal", name: "Temporal", stage: "3", champions: ["Philipp"], spec: "262" }),
  P({ slug: "intl-thing", name: "Intl Thing", stage: "2", champions: ["Ujjwal"], spec: "402" }),
  P({ slug: "decorators", name: "Decorators", stage: "3", champions: ["Kristen"], spec: "262" }),
];
const slugs = (ps: FilterableProposal[]) => ps.map((p) => p.slug);

describe("filterProposals", () => {
  it("filters by spec (the filter the Worker was missing)", () => {
    expect(slugs(filterProposals(ALL, { spec: "402" }))).toEqual(["intl-thing"]);
  });

  it("filters by exact stage", () => {
    expect(slugs(filterProposals(ALL, { stage: "3" }))).toEqual(["temporal", "decorators"]);
  });

  it("filters by champion (case-insensitive substring)", () => {
    expect(slugs(filterProposals(ALL, { champion: "phil" }))).toEqual(["temporal"]);
  });

  it("filters by `contains` over name + slug", () => {
    expect(slugs(filterProposals(ALL, { contains: "decorat" }))).toEqual(["decorators"]);
  });

  it("combines filters with AND and preserves index order", () => {
    expect(slugs(filterProposals(ALL, { spec: "262", stage: "3" }))).toEqual([
      "temporal",
      "decorators",
    ]);
  });

  it("returns everything when no filter is set", () => {
    expect(filterProposals(ALL, {})).toHaveLength(3);
  });
});
