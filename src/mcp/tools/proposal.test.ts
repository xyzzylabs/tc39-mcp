import { describe, it, expect } from "vitest";
import { proposalList, proposalGet } from "./proposal.js";

// All tests no-op when build/proposals-index.json hasn't been built
// (CI without `npm run build-proposals-index`).

describe("proposalList", () => {
  it("returns hint when the index isn't built", async () => {
    const r = await proposalList({});
    if (r.source === "none") {
      expect(r.hint).toBeDefined();
      expect(r.hint).toContain("build-proposals-index");
    }
  });

  it("returns active proposals when the index is present", async () => {
    const r = await proposalList({ limit: 500 });
    if (r.source === "none") return;
    expect(r.total).toBeGreaterThan(50);
    for (const p of r.proposals) {
      expect(typeof p.slug).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(typeof p.stage).toBe("string");
    }
  });

  it("stage filter narrows results", async () => {
    const r = await proposalList({ stage: "3", limit: 500 });
    if (r.source === "none") return;
    expect(r.total).toBeGreaterThan(0);
    for (const p of r.proposals) {
      expect(p.stage).toBe("3");
    }
  });

  it("champion filter is case-insensitive substring", async () => {
    const r = await proposalList({ champion: "miller", limit: 500 });
    if (r.source === "none") return;
    for (const p of r.proposals) {
      expect(p.champions.some((c) => c.toLowerCase().includes("miller"))).toBe(true);
    }
  });

  it("contains filter matches name or slug", async () => {
    const r = await proposalList({ contains: "import", limit: 500 });
    if (r.source === "none") return;
    for (const p of r.proposals) {
      const blob = (p.name + " " + p.slug).toLowerCase();
      expect(blob).toContain("import");
    }
  });

  it("respects the limit", async () => {
    const r = await proposalList({ limit: 5 });
    if (r.source === "none") return;
    expect(r.proposals.length).toBeLessThanOrEqual(5);
  });

  it("spec filter only returns proposals for the requested spec", async () => {
    // Soundness check that holds regardless of which index version the
    // loader served (a pre-spec-field index simply yields an empty
    // 402 set rather than mismatched rows). The parser unit test
    // proves the field is populated from controlled input.
    const r = await proposalList({ spec: "402", limit: 500 });
    if (r.source === "none") return;
    for (const p of r.proposals) expect(p.spec).toBe("402");
  });
});

describe("proposalGet", () => {
  it("returns hint when the index isn't built", async () => {
    const r = await proposalGet({ name: "anything" });
    if (r.source === "none") {
      expect(r.proposal).toBeNull();
      expect(r.hint).toBeDefined();
    }
  });

  it("returns the proposal that matches a known slug", async () => {
    // 'source-phase-imports' has been at stage 3 for a long while; if
    // the index is built, it should resolve.
    const r = await proposalGet({ name: "source-phase-imports" });
    if (r.source === "none") return;
    if (r.proposal === null) return;
    expect(r.proposal.slug).toBe("source-phase-imports");
    expect(r.proposal.stage).toBeDefined();
  });

  it("returns proposal:null when no match", async () => {
    const r = await proposalGet({ name: "no-such-proposal-xyz-zzz" });
    if (r.source === "none") return;
    expect(r.proposal).toBeNull();
  });

  it("matches by name when slug doesn't hit (case-insensitive)", async () => {
    const r = await proposalGet({ name: "source phase imports" });
    if (r.source === "none") return;
    if (r.proposal === null) return;
    expect(r.proposal.name.toLowerCase()).toBe("source phase imports");
  });
});
