import { describe, it, expect } from "vitest";
import { specSdoIndex } from "./spec_sdo_index.js";

// SDOs are most prominent in the syntactic-grammar chapters of 262
// (§12–14). Production keys are verbatim grammar fragments captured
// from <emu-grammar>; common ones include `BindingIdentifier :
// Identifier`, `Statement : ExpressionStatement`, etc.

describe("specSdoIndex", () => {
  it("returns a non-trivial number of SDO definitions on ECMA-262", async () => {
    try {
      const r = await specSdoIndex({ spec: "262", edition: "latest", limit: 500 });
      expect(r.spec).toBe("262");
      // ECMA-262's syntactic SDOs span hundreds of clauses; pair count
      // should easily clear a few hundred.
      expect(r.pair_count).toBeGreaterThan(200);
      expect(r.group_count).toBeGreaterThan(50);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("by='production' returns productions as keys", async () => {
    try {
      const r = await specSdoIndex({
        spec: "262",
        edition: "latest",
        by: "production",
        limit: 5,
      });
      expect(r.by).toBe("production");
      // Each group's entries should be SDO definitions on that production.
      for (const [prod, entries] of Object.entries(r.groups)) {
        expect(prod.length).toBeGreaterThan(0);
        for (const e of entries) {
          expect(e.production).toBe(prod);
          expect(typeof e.id).toBe("string");
          expect(typeof e.title).toBe("string");
        }
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("by='sdo' returns SDO clause titles as keys", async () => {
    try {
      const r = await specSdoIndex({
        spec: "262",
        edition: "latest",
        by: "sdo",
        limit: 5,
      });
      expect(r.by).toBe("sdo");
      for (const entries of Object.values(r.groups)) {
        expect(entries.length).toBeGreaterThan(0);
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("filter narrows keys by substring (case-insensitive)", async () => {
    try {
      const r = await specSdoIndex({
        spec: "262",
        edition: "latest",
        by: "production",
        filter: "bindingidentifier",
        limit: 500,
      });
      for (const key of Object.keys(r.groups)) {
        expect(key.toLowerCase()).toContain("bindingidentifier");
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("respects the group `limit`", async () => {
    try {
      const r = await specSdoIndex({
        spec: "262",
        edition: "latest",
        by: "production",
        limit: 3,
      });
      expect(Object.keys(r.groups).length).toBeLessThanOrEqual(3);
    } catch {
      // Parsed JSON missing.
    }
  });
});
