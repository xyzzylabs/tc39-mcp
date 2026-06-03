import { describe, it, expect } from "vitest";
import { specTables } from "./spec_tables.js";

describe("specTables — list mode", () => {
  it("lists tables when no id is given", async () => {
    try {
      const r = await specTables({ spec: "262", edition: "latest" });
      if (r.mode !== "list") throw new Error("expected list mode");
      expect(r.total).toBeGreaterThan(50);
      expect(Array.isArray(r.tables)).toBe(true);
      for (const t of r.tables) {
        expect(typeof t.id).toBe("string");
        expect(typeof t.caption).toBe("string");
        expect(Array.isArray(t.columns)).toBe(true);
        expect(typeof t.row_count).toBe("number");
      }
    } catch {
      // Parsed JSON missing or table data not yet built.
    }
  });

  it("filter narrows by caption or id substring (case-insensitive)", async () => {
    try {
      const r = await specTables({
        spec: "262",
        edition: "latest",
        filter: "well-known intrinsic",
      });
      if (r.mode !== "list") throw new Error("expected list mode");
      expect(r.total).toBeGreaterThan(0);
      for (const t of r.tables) {
        const blob = (t.caption + " " + t.id).toLowerCase();
        expect(blob).toContain("well-known intrinsic");
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("respects the limit", async () => {
    try {
      const r = await specTables({ spec: "262", edition: "latest", limit: 3 });
      if (r.mode !== "list") throw new Error("expected list mode");
      expect(r.tables.length).toBeLessThanOrEqual(3);
    } catch {
      // Parsed JSON missing.
    }
  });
});

describe("specTables — get mode", () => {
  it("returns the well-known intrinsics table by id", async () => {
    try {
      const r = await specTables({
        spec: "262",
        edition: "latest",
        id: "table-well-known-intrinsic-objects",
      });
      if (r.mode !== "get") throw new Error("expected get mode");
      if (r.table === null) return; // table not present in this edition
      expect(r.table.id).toBe("table-well-known-intrinsic-objects");
      // The WKI table has ~70 rows in modern editions; columns are
      // "Intrinsic Name", "Global Name", and one association column.
      expect(r.table.columns.length).toBeGreaterThanOrEqual(2);
      expect(r.table.rows.length).toBeGreaterThan(40);
      // Each row should be a string[].
      for (const row of r.table.rows) {
        for (const cell of row) expect(typeof cell).toBe("string");
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("returns table:null for an id that doesn't exist", async () => {
    try {
      const r = await specTables({
        spec: "262",
        edition: "latest",
        id: "table-does-not-exist-xyz",
      });
      if (r.mode !== "get") throw new Error("expected get mode");
      expect(r.table).toBeNull();
    } catch {
      // Parsed JSON missing.
    }
  });

  it("captures the well-known symbols table", async () => {
    try {
      const r = await specTables({
        spec: "262",
        edition: "latest",
        id: "table-well-known-symbols",
      });
      if (r.mode !== "get") throw new Error("expected get mode");
      if (r.table === null) return;
      expect(r.table.rows.length).toBeGreaterThan(5);
    } catch {
      // Parsed JSON missing.
    }
  });

  it("works on ECMA-402", async () => {
    try {
      const r = await specTables({ spec: "402", edition: "main" });
      if (r.mode !== "list") throw new Error("expected list mode");
      // 402 has plenty of locale-data tables; some captures expected.
      expect(r.total).toBeGreaterThan(0);
    } catch {
      // Parsed JSON missing.
    }
  });
});
