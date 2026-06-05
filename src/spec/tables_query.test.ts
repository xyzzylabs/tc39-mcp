import { describe, it, expect } from "vitest";
import { queryTables, type TableRow } from "./tables_query.js";

const TABLES: Record<string, TableRow> = {
  "table-wki": {
    id: "table-wki",
    caption: "Well-Known Intrinsic Objects",
    columns: ["Intrinsic Name", "Global Name"],
    rows: [
      ["%Array%", "Array"],
      ["%Object%", "Object"],
    ],
    clause_id: "sec-well-known-intrinsic-objects",
  },
  "table-locale": {
    id: "table-locale",
    caption: "Locale Data",
    columns: ["Key"],
    rows: [["nu"]],
  },
};

describe("queryTables — get mode", () => {
  it("returns exactly the requested table", () => {
    const r = queryTables(TABLES, { id: "table-wki" });
    if (r.mode !== "get") throw new Error("expected get mode");
    expect(r.table).not.toBeNull();
    expect(r.table!.id).toBe("table-wki");
    expect(r.table!.rows.length).toBe(2);
    expect(r.table!.columns).toEqual(["Intrinsic Name", "Global Name"]);
  });

  it("returns null for an unknown id", () => {
    const r = queryTables(TABLES, { id: "table-nope" });
    if (r.mode !== "get") throw new Error("expected get mode");
    expect(r.table).toBeNull();
  });
});

describe("queryTables — list mode", () => {
  it("summarizes every table, sorted by id, with row_count", () => {
    const r = queryTables(TABLES, {});
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.total).toBe(2);
    expect(r.tables.map((t) => t.id)).toEqual(["table-locale", "table-wki"]);
    const wki = r.tables.find((t) => t.id === "table-wki")!;
    expect(wki.row_count).toBe(2);
    expect(wki.clause_id).toBe("sec-well-known-intrinsic-objects");
  });

  it("filters on caption (case-insensitive)", () => {
    const r = queryTables(TABLES, { filter: "LOCALE" });
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.total).toBe(1);
    expect(r.tables[0]!.id).toBe("table-locale");
  });

  it("filters on id substring", () => {
    const r = queryTables(TABLES, { filter: "wki" });
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.total).toBe(1);
    expect(r.tables[0]!.id).toBe("table-wki");
  });

  it("respects the limit", () => {
    const r = queryTables(TABLES, { limit: 1 });
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.tables.length).toBe(1);
    expect(r.total).toBe(2); // total is pre-cap
  });
});
