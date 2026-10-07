import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSpec } from "./index.js";
import { loadBiblioClauses } from "./biblio.js";

// ecmarkup numbers a clause by its position in the document, and the
// biblio's numbers describe only its own `main` snapshot. A released
// edition, or a `main` that has since inserted a clause ahead of this
// one, numbers the same clause differently, so the parser must take the
// number from the HTML it is parsing even for clauses the biblio lists.

describe("parseSpec — section numbers", () => {
  const pin = {
    spec: "262" as const,
    edition: "main",
    sha: "test",
    fetched_at: "test",
  };

  function parseHtml(html: string) {
    const dir = mkdtempSync(join(tmpdir(), "tc39-numbers-"));
    const file = join(dir, "spec.html");
    writeFileSync(file, html);
    return parseSpec(file, pin);
  }

  it("numbers a biblio-listed clause by its position in the parsed HTML", () => {
    const biblioNumber = loadBiblioClauses().get("sec-tonumber")?.number;
    expect(biblioNumber, "the biblio should list sec-tonumber").toBeTruthy();

    const parsed = parseHtml(`<!DOCTYPE html><html><body>
      <emu-clause id="sec-scope"><h1>Scope</h1></emu-clause>
      <emu-clause id="sec-abstract-operations">
        <h1>Abstract Operations</h1>
        <emu-clause id="sec-tonumber" type="abstract operation">
          <h1>ToNumber ( _argument_ )</h1>
          <emu-alg><ol><li>Return _argument_.</li></ol></emu-alg>
        </emu-clause>
      </emu-clause>
      <emu-annex id="sec-grammar-summary"><h1>Grammar Summary</h1></emu-annex>
    </body></html>`);

    const c = parsed.clauses["sec-tonumber"];
    expect(c).toBeDefined();
    expect(c!.meta.number).toBe("2.1");
    expect(c!.meta.number).not.toBe(biblioNumber);
    // Everything else still comes from the biblio.
    expect(c!.meta.aoid).toBe("ToNumber");
    expect(parsed.clauses["sec-abstract-operations"]?.meta.number).toBe("2");
    expect(parsed.clauses["sec-grammar-summary"]?.meta.number).toBe("A");
  });
});
