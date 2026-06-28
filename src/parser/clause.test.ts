import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { extractClause } from "./clause.js";
import type { ClauseMeta } from "./schema.js";

// Synthetic-HTML unit tests for extractClause(). Focuses on the
// <emu-grammar> ↔ <emu-alg> pairing FSM, multiple algorithms,
// note capture, crossref capture, and edge cases like dotted ids.

function $(html: string) {
  return load(html, { xmlMode: false });
}

function meta(id: string, overrides: Partial<ClauseMeta> = {}): ClauseMeta {
  return {
    id,
    aoid: null,
    title: "",
    number: "",
    kind: "clause",
    ...overrides,
  };
}

describe("extractClause — null cases", () => {
  it("returns null when no matching emu-clause exists", () => {
    const r = extractClause($(`<p>nothing here</p>`), meta("sec-missing"));
    expect(r).toBeNull();
  });

  it("matches emu-clause by id attribute (not CSS #id)", () => {
    // Real spec ids contain dots ('sec-array.prototype.includes'); CSS
    // `#id` would treat the dots as class selectors. extractClause uses
    // an attribute selector so dotted ids resolve correctly.
    const r = extractClause(
      $(`<emu-clause id="sec-array.prototype.includes"><h1>x</h1></emu-clause>`),
      meta("sec-array.prototype.includes"),
    );
    expect(r).not.toBeNull();
    expect(r!.meta.id).toBe("sec-array.prototype.includes");
  });

  it("matches emu-annex by id too", () => {
    const r = extractClause(
      $(`<emu-annex id="sec-annex-x"><h1>Annex</h1></emu-annex>`),
      meta("sec-annex-x"),
    );
    expect(r).not.toBeNull();
  });
});

describe("extractClause — signature", () => {
  it("captures the <h1> text as signatureRaw, normalized", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x"><h1>  ToNumber ( _x_ )  </h1></emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.signatureRaw).toBe("ToNumber ( _x_ )");
  });

  it("returns null signatureRaw when there's no <h1>", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x"><p>no header</p></emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.signatureRaw).toBeNull();
  });
});

describe("extractClause — algorithm capture", () => {
  it("captures a single emu-alg without preceding grammar", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x">
        <h1>X</h1>
        <emu-alg>1. Return _x_.</emu-alg>
      </emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.algorithms).toHaveLength(1);
    expect(r!.algorithms[0]!.steps).toHaveLength(1);
    expect(r!.algorithms[0]!.production).toBeUndefined();
  });

  it("pairs a preceding emu-grammar with the next emu-alg (SDO)", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-sdo">
        <h1>SDO</h1>
        <emu-grammar>Foo : Bar</emu-grammar>
        <emu-alg>1. Return _Bar_.</emu-alg>
      </emu-clause>`),
      meta("sec-sdo"),
    );
    expect(r!.algorithms).toHaveLength(1);
    expect(r!.algorithms[0]!.production).toBe("Foo : Bar");
  });

  it("captures multiple SDO algorithm pairs", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-sdo">
        <h1>SDO</h1>
        <emu-grammar>A : x</emu-grammar>
        <emu-alg>1. From A.</emu-alg>
        <emu-grammar>B : y</emu-grammar>
        <emu-alg>1. From B.</emu-alg>
      </emu-clause>`),
      meta("sec-sdo"),
    );
    expect(r!.algorithms).toHaveLength(2);
    expect(r!.algorithms[0]!.production).toBe("A : x");
    expect(r!.algorithms[1]!.production).toBe("B : y");
  });

  it("drops a dangling emu-grammar with no following emu-alg", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x">
        <h1>X</h1>
        <emu-grammar>Orphan : Z</emu-grammar>
        <p>Some prose, no alg.</p>
      </emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.algorithms).toHaveLength(0);
  });

  it("non-grammar tag between grammar and alg breaks the chain", () => {
    // The pairing chain breaks at <p>: the emu-alg is captured but
    // without the production. That's the documented behavior.
    const r = extractClause(
      $(`<emu-clause id="sec-x">
        <h1>X</h1>
        <emu-grammar>A : x</emu-grammar>
        <p>Interrupting prose.</p>
        <emu-alg>1. After prose.</emu-alg>
      </emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.algorithms).toHaveLength(1);
    expect(r!.algorithms[0]!.production).toBeUndefined();
  });
});

describe("extractClause — notes", () => {
  it("captures direct-child emu-note elements", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x">
        <h1>X</h1>
        <emu-note>A first note.</emu-note>
        <emu-note id="note-foo">A second note with id.</emu-note>
      </emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.notes).toHaveLength(2);
    expect(r!.notes[0]!.text).toBe("A first note.");
    expect(r!.notes[0]!.id).toBeUndefined();
    expect(r!.notes[1]!.text).toBe("A second note with id.");
    expect(r!.notes[1]!.id).toBe("note-foo");
  });

  it("captures the emu-note type attribute when set", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x">
        <h1>X</h1>
        <emu-note type="editor">An editor note.</emu-note>
      </emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.notes[0]!.type).toBe("editor");
  });

  it("skips empty (whitespace-only) emu-note bodies", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x">
        <h1>X</h1>
        <emu-note>   </emu-note>
      </emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.notes).toEqual([]);
  });

  it("does NOT capture emu-notes inside nested emu-clause children", () => {
    // Notes belonging to a child clause should be its responsibility,
    // not parented to the outer clause's notes list.
    const r = extractClause(
      $(`<emu-clause id="sec-outer">
        <h1>Outer</h1>
        <emu-note>Outer note.</emu-note>
        <emu-clause id="sec-inner">
          <h1>Inner</h1>
          <emu-note>Inner note (belongs to inner).</emu-note>
        </emu-clause>
      </emu-clause>`),
      meta("sec-outer"),
    );
    expect(r!.notes).toHaveLength(1);
    expect(r!.notes[0]!.text).toBe("Outer note.");
  });
});

describe("extractClause — crossrefs", () => {
  it("captures emu-xref hrefs anywhere inside the clause", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x">
        <h1>X</h1>
        <p>See <emu-xref href="#sec-tonumber"></emu-xref>.</p>
        <emu-alg>1. Call <emu-xref href="#sec-tostring"></emu-xref>.</emu-alg>
      </emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.crossrefs).toContain("#sec-tonumber");
    expect(r!.crossrefs).toContain("#sec-tostring");
  });

  it("captures crossrefs from nested children too (deep find)", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-x">
        <h1>X</h1>
        <emu-clause id="sec-inner">
          <h1>Inner</h1>
          <emu-xref href="#sec-deep"></emu-xref>
        </emu-clause>
      </emu-clause>`),
      meta("sec-x"),
    );
    expect(r!.crossrefs).toContain("#sec-deep");
  });
});

describe("extractClause — preserves meta", () => {
  it("returns the meta argument as-is on the result", () => {
    const m = meta("sec-x", {
      aoid: "ToNumber",
      title: "ToNumber ( _x_ )",
      number: "7.1.4",
      kind: "op",
    });
    const r = extractClause($(`<emu-clause id="sec-x"></emu-clause>`), m);
    expect(r!.meta).toEqual(m);
  });
});

describe("extractClause — external_refs", () => {
  it("captures normative external links, filtered by host allowlist", () => {
    const r = extractClause(
      $(
        `<emu-clause id="sec-x"><h1>x</h1><p>See ` +
          `<a href="https://unicode.org/reports/tr15/">UAX #15</a> and ` +
          `<a href="https://www.rfc-editor.org/rfc/rfc8259">RFC 8259</a>. ` +
          `Thanks <a href="https://github.com/tc39/ecma262">repo</a> and ` +
          `<a href="https://twitter.com/x">someone</a>.</p></emu-clause>`,
      ),
      meta("sec-x"),
    );
    const urls = r!.external_refs?.map((e) => e.url) ?? [];
    expect(urls).toContain("https://unicode.org/reports/tr15/");
    expect(urls).toContain("https://www.rfc-editor.org/rfc/rfc8259");
    // Acknowledgment / community links are filtered out.
    expect(urls).not.toContain("https://github.com/tc39/ecma262");
    expect(urls.some((u) => u.includes("twitter"))).toBe(false);
    // Link text is captured.
    expect(r!.external_refs?.find((e) => e.url.includes("tr15"))?.text).toBe(
      "UAX #15",
    );
  });

  it("omits external_refs when the clause cites nothing external", () => {
    const r = extractClause(
      $(`<emu-clause id="sec-y"><h1>y</h1><p>no links</p></emu-clause>`),
      meta("sec-y"),
    );
    expect(r!.external_refs).toBeUndefined();
  });

  it("dedupes a repeated external link", () => {
    const r = extractClause(
      $(
        `<emu-clause id="sec-z"><h1>z</h1>` +
          `<a href="https://unicode.org/reports/tr10/">UTS10</a>` +
          `<a href="https://unicode.org/reports/tr10/">again</a></emu-clause>`,
      ),
      meta("sec-z"),
    );
    expect(r!.external_refs).toHaveLength(1);
  });
});
