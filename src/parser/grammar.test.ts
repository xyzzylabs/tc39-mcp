import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { extractGrammar } from "./grammar.js";

function $(html: string) {
  return load(html, { xmlMode: false });
}

describe("extractGrammar — basic shape", () => {
  it("returns [] when no emu-grammar blocks exist", () => {
    expect(extractGrammar($("<p>nothing here</p>"))).toEqual([]);
  });

  it("parses a single non-terminal with one RHS line", () => {
    const out = extractGrammar($(`
      <emu-clause id="sec-x">
        <h1>X</h1>
        <emu-grammar>
          Foo : Bar
        </emu-grammar>
      </emu-clause>
    `));
    expect(out.length).toBe(1);
    expect(out[0]!.nonterminal).toBe("Foo");
    expect(out[0]!.parameters).toEqual([]);
    expect(out[0]!.rhs).toEqual(["Bar"]);
    expect(out[0]!.clause_id).toBe("sec-x");
    expect(out[0]!.standalone).toBe(true);
  });

  it("parses a non-terminal with parameters", () => {
    const out = extractGrammar($(`
      <emu-grammar>
        BindingIdentifier[Yield, Await] :
          Identifier
          \`yield\`
          \`await\`
      </emu-grammar>
    `));
    expect(out.length).toBe(1);
    expect(out[0]!.nonterminal).toBe("BindingIdentifier");
    expect(out[0]!.parameters).toEqual(["Yield", "Await"]);
    expect(out[0]!.rhs).toEqual(["Identifier", "`yield`", "`await`"]);
  });

  it("parses multiple non-terminals in one block", () => {
    const out = extractGrammar($(`
      <emu-grammar>
        Foo :
          A
          B
        Bar :
          C
      </emu-grammar>
    `));
    expect(out.length).toBe(2);
    expect(out[0]!.nonterminal).toBe("Foo");
    expect(out[0]!.rhs).toEqual(["A", "B"]);
    expect(out[1]!.nonterminal).toBe("Bar");
    expect(out[1]!.rhs).toEqual(["C"]);
  });
});

describe("extractGrammar — SDO disambiguation", () => {
  it("marks emu-grammar before <emu-alg> as standalone=false (SDO)", () => {
    const out = extractGrammar($(`
      <emu-clause id="sec-sdo">
        <h1>SDO</h1>
        <emu-grammar>
          BindingIdentifier : Identifier
        </emu-grammar>
        <emu-alg>1. Return _Identifier_.</emu-alg>
      </emu-clause>
    `));
    expect(out.length).toBe(1);
    expect(out[0]!.standalone).toBe(false);
  });

  it("marks emu-grammar not followed by emu-alg as standalone=true", () => {
    const out = extractGrammar($(`
      <emu-clause id="sec-grammar">
        <h1>Grammar</h1>
        <emu-grammar>
          BindingIdentifier : Identifier
        </emu-grammar>
        <p>This is descriptive prose, not an algorithm.</p>
      </emu-clause>
    `));
    expect(out.length).toBe(1);
    expect(out[0]!.standalone).toBe(true);
  });

  it("ignores <p>, <emu-note>, <emu-xref>, <h2> between grammar and alg", () => {
    // The SDO disambiguation walks past prose elements that the spec
    // sometimes inserts between the grammar header and the algorithm.
    const out = extractGrammar($(`
      <emu-clause id="sec-sdo">
        <h1>SDO</h1>
        <emu-grammar>
          BindingIdentifier : Identifier
        </emu-grammar>
        <p>Some prose.</p>
        <emu-note>An informative note.</emu-note>
        <emu-alg>1. Return _Identifier_.</emu-alg>
      </emu-clause>
    `));
    expect(out[0]!.standalone).toBe(false);
  });
});

describe("extractGrammar — clause_id inheritance", () => {
  it("captures the closest containing emu-clause id", () => {
    const out = extractGrammar($(`
      <emu-clause id="sec-outer">
        <emu-clause id="sec-inner">
          <emu-grammar>
            Inner : X
          </emu-grammar>
        </emu-clause>
      </emu-clause>
    `));
    expect(out[0]!.clause_id).toBe("sec-inner");
  });

  it("omits clause_id when the grammar has no enclosing clause", () => {
    const out = extractGrammar($(`
      <emu-grammar>
        TopLevel : X
      </emu-grammar>
    `));
    expect(out[0]!.clause_id).toBeUndefined();
  });
});

describe("extractGrammar — robustness", () => {
  it("skips header-less blocks gracefully", () => {
    // A block with no `Name :` line shouldn't crash; it just yields
    // nothing.
    const out = extractGrammar($(`
      <emu-grammar>
        just some loose tokens
      </emu-grammar>
    `));
    expect(out).toEqual([]);
  });

  it("skips blank lines between productions", () => {
    const out = extractGrammar($(`
      <emu-grammar>
        Foo :

          A

          B
      </emu-grammar>
    `));
    expect(out[0]!.rhs).toEqual(["A", "B"]);
  });
});
