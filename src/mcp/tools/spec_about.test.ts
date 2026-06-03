import { describe, it, expect } from "vitest";
import { specAbout } from "./spec_about.js";

describe("specAbout", () => {
  it("returns server name + version", async () => {
    const r = await specAbout();
    expect(r.server.name).toBe("tc39-mcp");
    expect(typeof r.server.version).toBe("string");
    expect(r.server.version.length).toBeGreaterThan(0);
  });

  it("emits an ISO-8601 generated_at", async () => {
    const r = await specAbout();
    expect(r.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("lists every supported (spec, edition) snapshot slot", async () => {
    const r = await specAbout();
    // 12 for ECMA-262 (es2016-es2026 + main) + 12 for ECMA-402
    // (es2016-es2026 + main) = 24 supported pairs.
    expect(r.snapshots.length).toBe(24);
    for (const s of r.snapshots) {
      expect(["262", "402"]).toContain(s.spec);
      expect(typeof s.present).toBe("boolean");
    }
  });

  it("populates pin fields for present snapshots", async () => {
    const r = await specAbout();
    const present = r.snapshots.filter((s) => s.present);
    if (present.length === 0) return; // CI without parsed JSON
    for (const s of present) {
      expect(typeof s.sha).toBe("string");
      expect(s.sha!.length).toBeGreaterThan(0);
      expect(typeof s.clause_count).toBe("number");
      expect(s.clause_count!).toBeGreaterThan(0);
      expect(typeof s.bytes_on_disk).toBe("number");
    }
  });

  it("reports has_tables + has_grammar for snapshots with that data", async () => {
    const r = await specAbout();
    const present = r.snapshots.filter((s) => s.present);
    if (present.length === 0) return;
    // After the tables + grammar parser passes, all snapshots should
    // have both true.
    for (const s of present) {
      expect(typeof s.has_tables).toBe("boolean");
      expect(typeof s.has_grammar).toBe("boolean");
    }
  });

  it("includes test262 index header when the index is built", async () => {
    const r = await specAbout();
    if (!r.test262_index) return; // CI without build-test262-index
    expect(typeof r.test262_index.test262_sha).toBe("string");
    expect(r.test262_index.test_count).toBeGreaterThan(0);
    expect(r.test262_index.bytes_on_disk).toBeGreaterThan(0);
  });

  it("includes proposals index header when the index is built", async () => {
    const r = await specAbout();
    if (!r.proposals_index) return;
    expect(typeof r.proposals_index.proposals_sha).toBe("string");
    expect(r.proposals_index.proposal_count).toBeGreaterThan(0);
  });
});
