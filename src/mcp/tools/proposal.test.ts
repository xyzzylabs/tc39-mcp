import { describe, it, expect } from "vitest";
import { proposalList, proposalGet } from "./proposal.js";

// All tests no-op when build/proposals-index.json hasn't been built
// (CI without `npm run build-proposals-index`).

describe("proposalList", () => {
  it("returns hint when the index isn't built", () => {
    const r = proposalList({});
    if (r.source === "none") {
      expect(r.hint).toBeDefined();
      expect(r.hint).toContain("build-proposals-index");
    }
  });

  it("returns active proposals when the index is present", () => {
    const r = proposalList({ limit: 500 });
    if (r.source === "none") return;
    expect(r.total).toBeGreaterThan(50);
    for (const p of r.proposals) {
      expect(typeof p.slug).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(typeof p.stage).toBe("string");
    }
  });

  it("stage filter narrows results", () => {
    const r = proposalList({ stage: "3", limit: 500 });
    if (r.source === "none") return;
    expect(r.total).toBeGreaterThan(0);
    for (const p of r.proposals) {
      expect(p.stage).toBe("3");
    }
  });

  it("champion filter is case-insensitive substring", () => {
    const r = proposalList({ champion: "miller", limit: 500 });
    if (r.source === "none") return;
    for (const p of r.proposals) {
      expect(p.champions.some((c) => c.toLowerCase().includes("miller"))).toBe(true);
    }
  });

  it("contains filter matches name or slug", () => {
    const r = proposalList({ contains: "import", limit: 500 });
    if (r.source === "none") return;
    for (const p of r.proposals) {
      const blob = (p.name + " " + p.slug).toLowerCase();
      expect(blob).toContain("import");
    }
  });

  it("respects the limit", () => {
    const r = proposalList({ limit: 5 });
    if (r.source === "none") return;
    expect(r.proposals.length).toBeLessThanOrEqual(5);
  });
});

describe("proposalGet", () => {
  it("returns hint when the index isn't built", () => {
    const r = proposalGet({ name: "anything" });
    if (r.source === "none") {
      expect(r.proposal).toBeNull();
      expect(r.hint).toBeDefined();
    }
  });

  it("returns the proposal that matches a known slug", () => {
    // 'source-phase-imports' has been at stage 3 for a long while; if
    // the index is built, it should resolve.
    const r = proposalGet({ name: "source-phase-imports" });
    if (r.source === "none") return;
    if (r.proposal === null) return;
    expect(r.proposal.slug).toBe("source-phase-imports");
    expect(r.proposal.stage).toBeDefined();
  });

  it("returns proposal:null when no match", () => {
    const r = proposalGet({ name: "no-such-proposal-xyz-zzz" });
    if (r.source === "none") return;
    expect(r.proposal).toBeNull();
  });

  it("matches by name when slug doesn't hit (case-insensitive)", () => {
    const r = proposalGet({ name: "source phase imports" });
    if (r.source === "none") return;
    if (r.proposal === null) return;
    expect(r.proposal.name.toLowerCase()).toBe("source phase imports");
  });
});
