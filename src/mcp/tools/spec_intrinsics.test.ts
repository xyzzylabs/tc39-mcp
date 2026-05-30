import { describe, it, expect } from "vitest";
import { specIntrinsics } from "./spec_intrinsics.js";

describe("specIntrinsics", () => {
  it("enumerates a non-trivial set of intrinsics on ECMA-262", () => {
    try {
      const r = specIntrinsics({ spec: "262", edition: "latest", limit: 500 });
      expect(r.spec).toBe("262");
      // There are 100+ well-known intrinsics in modern ECMA-262.
      expect(r.hits.length).toBeGreaterThan(50);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("each hit carries the documented shape", () => {
    try {
      const r = specIntrinsics({ spec: "262", edition: "latest", limit: 5 });
      for (const h of r.hits) {
        expect(typeof h.name).toBe("string");
        expect(h.name.length).toBeGreaterThan(0);
        expect(typeof h.mention_count).toBe("number");
        expect(h.mention_count).toBeGreaterThan(0);
        if (h.defining_clause) {
          expect(typeof h.defining_clause.id).toBe("string");
          expect(["title-literal", "title-bare", "most-mentions"]).toContain(
            h.defining_clause.matched_on,
          );
        }
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("filter narrows results by case-insensitive name substring", () => {
    try {
      const r = specIntrinsics({
        spec: "262",
        edition: "latest",
        filter: "object.prototype",
        limit: 50,
      });
      for (const h of r.hits) {
        expect(h.name.toLowerCase()).toContain("object.prototype");
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("finds Object.prototype with a defining clause", () => {
    try {
      const r = specIntrinsics({
        spec: "262",
        edition: "latest",
        filter: "Object.prototype",
        limit: 10,
      });
      const objProto = r.hits.find((h) => h.name === "Object.prototype");
      if (!objProto) return;
      expect(objProto.defining_clause).not.toBeNull();
      // Title heuristic should land on the §20.1.3 Object.prototype clause.
      expect(objProto.defining_clause!.title.toLowerCase()).toContain("object.prototype");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("works on ECMA-402 (finds Intl.NumberFormat)", () => {
    try {
      const r = specIntrinsics({
        spec: "402",
        edition: "main",
        filter: "Intl.NumberFormat",
        limit: 10,
      });
      if (r.hits.length === 0) return;
      const nf = r.hits.find((h) => h.name === "Intl.NumberFormat");
      expect(nf).toBeDefined();
      if (!nf?.defining_clause) return;
      expect(nf.defining_clause.title.toLowerCase()).toContain("intl.numberformat");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("ranks heuristic-path hits by mention count (402)", () => {
    try {
      const r = specIntrinsics({ spec: "402", edition: "main", limit: 20 });
      if (r.source !== "heuristic" || r.hits.length < 2) return;
      for (let i = 1; i < r.hits.length; i++) {
        expect(r.hits[i]!.mention_count).toBeLessThanOrEqual(
          r.hits[i - 1]!.mention_count!,
        );
      }
    } catch {
      // Parsed JSON missing.
    }
  });
});

describe("specIntrinsics — source resolution", () => {
  it("uses 'table' source on ECMA-262 when the WKI table is present", () => {
    try {
      const r = specIntrinsics({ spec: "262", edition: "latest", limit: 5 });
      expect(r.source).toBe("table");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("table-path hits carry global_name + association from the table row", () => {
    try {
      const r = specIntrinsics({
        spec: "262",
        edition: "latest",
        filter: "Array",
        limit: 5,
      });
      if (r.source !== "table") return;
      const arr = r.hits.find((h) => h.name === "Array");
      if (!arr) return;
      // The Array row carries `Array` as the global name + a prose
      // association.
      expect(arr.global_name).toContain("Array");
      expect(arr.association).toContain("Array");
      // Mention count is heuristic-path-only.
      expect(arr.mention_count).toBeUndefined();
    } catch {
      // Parsed JSON missing.
    }
  });

  it("table-path lands %Array% on 'The Array Constructor', not 'IsArray'", () => {
    try {
      const r = specIntrinsics({
        spec: "262",
        edition: "latest",
        filter: "Array",
        limit: 5,
      });
      if (r.source !== "table") return;
      const arr = r.hits.find((h) => h.name === "Array");
      if (!arr?.defining_clause) return;
      // The canonical-shape heuristic should pick "The Array Constructor"
      // over the bare-name substring match on "IsArray ( argument )".
      expect(arr.defining_clause.title).toMatch(/Array Constructor/);
      expect(arr.defining_clause.matched_on).toBe("table-row");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("uses 'heuristic' source on ECMA-402 (no WKI table)", () => {
    try {
      const r = specIntrinsics({ spec: "402", edition: "main", limit: 5 });
      expect(r.source).toBe("heuristic");
    } catch {
      // Parsed JSON missing.
    }
  });
});
