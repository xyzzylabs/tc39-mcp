import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { extractTables } from "./tables.js";

// Unit tests for the <emu-table> extractor with synthetic HTML.
// Covers the structural variations real ecmarkup output uses.

function $(html: string) {
  return load(html, { xmlMode: false });
}

describe("extractTables", () => {
  it("returns {} when there are no emu-tables in the doc", () => {
    const out = extractTables($("<p>hello</p>"));
    expect(out).toEqual({});
  });

  it("skips emu-tables without an id (they're not addressable)", () => {
    const out = extractTables($(`
      <emu-table>
        <emu-caption>Untitled</emu-caption>
        <table><tbody><tr><td>x</td></tr></tbody></table>
      </emu-table>
    `));
    expect(Object.keys(out)).toEqual([]);
  });

  it("captures id, caption, columns (from thead), rows (from tbody)", () => {
    const out = extractTables($(`
      <emu-table id="table-x">
        <emu-caption>Some Caption</emu-caption>
        <table>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>foo</td><td>1</td></tr>
            <tr><td>bar</td><td>2</td></tr>
          </tbody>
        </table>
      </emu-table>
    `));
    expect(out["table-x"]).toBeDefined();
    const t = out["table-x"]!;
    expect(t.id).toBe("table-x");
    expect(t.caption).toBe("Some Caption");
    expect(t.columns).toEqual(["Name", "Value"]);
    expect(t.rows).toEqual([
      ["foo", "1"],
      ["bar", "2"],
    ]);
  });

  it("falls back to caption= attribute when no <emu-caption>", () => {
    const out = extractTables($(`
      <emu-table id="t1" caption="Attr Caption">
        <table>
          <thead><tr><th>A</th></tr></thead>
          <tbody><tr><td>x</td></tr></tbody>
        </table>
      </emu-table>
    `));
    expect(out["t1"]?.caption).toBe("Attr Caption");
  });

  it("normalizes whitespace inside cells", () => {
    const out = extractTables($(`
      <emu-table id="t1">
        <emu-caption>  multiline   caption  </emu-caption>
        <table>
          <thead><tr><th>  Col   One </th></tr></thead>
          <tbody><tr><td>
            cell
            with
            wrapping
          </td></tr></tbody>
        </table>
      </emu-table>
    `));
    expect(out["t1"]?.caption).toBe("multiline caption");
    expect(out["t1"]?.columns).toEqual(["Col One"]);
    expect(out["t1"]?.rows).toEqual([["cell with wrapping"]]);
  });

  it("captures clause_id from the containing emu-clause", () => {
    const out = extractTables($(`
      <emu-clause id="sec-my-clause">
        <h1>My Clause</h1>
        <emu-table id="table-nested">
          <emu-caption>Nested</emu-caption>
          <table>
            <thead><tr><th>C</th></tr></thead>
            <tbody><tr><td>v</td></tr></tbody>
          </table>
        </emu-table>
      </emu-clause>
    `));
    expect(out["table-nested"]?.clause_id).toBe("sec-my-clause");
  });

  it("falls back to first-row <th> when there's no <thead>", () => {
    const out = extractTables($(`
      <emu-table id="t1">
        <emu-caption>X</emu-caption>
        <table>
          <tr><th>A</th><th>B</th></tr>
          <tr><td>1</td><td>2</td></tr>
        </table>
      </emu-table>
    `));
    expect(out["t1"]?.columns).toEqual(["A", "B"]);
    // The row containing <th> is skipped from data rows (it has no <td>).
    expect(out["t1"]?.rows).toEqual([["1", "2"]]);
  });

  it("preserves empty cells as empty strings", () => {
    const out = extractTables($(`
      <emu-table id="t1">
        <emu-caption>X</emu-caption>
        <table>
          <thead><tr><th>A</th><th>B</th></tr></thead>
          <tbody><tr><td>x</td><td></td></tr></tbody>
        </table>
      </emu-table>
    `));
    expect(out["t1"]?.rows).toEqual([["x", ""]]);
  });
});
