// Extract every `<emu-table id="...">` from a loaded cheerio document.
//
// ecmarkup's table convention: `<emu-table>` wraps a regular `<table>`
// with `<thead><tr><th>...</th></tr></thead>` for column headers and
// `<tbody><tr><td>...</td></tr></tbody>` for data rows. The caption
// can live in a `<emu-caption>` child or the `caption` attribute.
// Tables without an `id` are skipped (they aren't addressable).

import type { CheerioAPI } from "cheerio";
import type { SpecTable } from "./schema.js";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function extractTables($: CheerioAPI): Record<string, SpecTable> {
  const out: Record<string, SpecTable> = {};

  $("emu-table[id]").each((_, el) => {
    const $el = $(el);
    const id = $el.attr("id");
    if (!id) return;

    // Caption: prefer <emu-caption>, fall back to caption= attribute.
    let caption = normalizeWhitespace($el.children("emu-caption").first().text());
    if (!caption) caption = $el.attr("caption") ?? "";

    // Find the contained <table>. The wrapping <emu-table> may have a
    // <emu-caption> sibling and one <table> child.
    const $table = $el.find("table").first();
    if ($table.length === 0) return;

    // Columns: pull <th> from the thead (preferred) or the first row.
    const columns: string[] = [];
    const $thead = $table.find("thead").first();
    if ($thead.length > 0) {
      $thead.find("th").each((_, th) => {
        columns.push(normalizeWhitespace($(th).text()));
      });
    } else {
      // Some tables use <th> in the first tbody row.
      const $firstRow = $table.find("tr").first();
      $firstRow.find("th").each((_, th) => {
        columns.push(normalizeWhitespace($(th).text()));
      });
    }

    // Rows: every <tr> inside <tbody>, or every <tr> after the header
    // if there's no <tbody>. Each row's cells come from <td>.
    const rows: string[][] = [];
    const rowSel = $table.find("tbody").length > 0
      ? $table.find("tbody tr")
      : $table.find("tr");
    rowSel.each((_, tr) => {
      const $tr = $(tr);
      // Skip rows whose only cells are <th> (those are header rows
      // already captured above).
      const tds = $tr.find("td");
      if (tds.length === 0) return;
      const cells: string[] = [];
      tds.each((_, td) => {
        cells.push(normalizeWhitespace($(td).text()));
      });
      rows.push(cells);
    });

    // Find the containing emu-clause / emu-annex (if any) for
    // cross-reference.
    const $clause = $el.parents("emu-clause, emu-annex").first();
    const clauseId = $clause.attr("id");

    out[id] = {
      id,
      caption,
      columns,
      rows,
      ...(clauseId ? { clause_id: clauseId } : {}),
    };
  });

  return out;
}
