import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { computeSectionNumbers, metaFromElement } from "./synthesize.js";

describe("computeSectionNumbers", () => {
  const $ = load(`
    <emu-intro id="sec-intro"><h1>Introduction</h1></emu-intro>
    <emu-clause id="sec-a"><h1>A</h1>
      <emu-clause id="sec-a-1"><h1>A1</h1></emu-clause>
      <emu-clause id="sec-a-2"><h1>A2</h1>
        <emu-clause id="sec-a-2-1"><h1>A21</h1></emu-clause>
      </emu-clause>
    </emu-clause>
    <emu-clause id="sec-b"><h1>B</h1></emu-clause>
    <emu-annex id="annex-x"><h1>X</h1></emu-annex>
    <emu-annex id="annex-y"><h1>Y</h1></emu-annex>
  `);
  const nums = computeSectionNumbers($);

  it("numbers top-level clauses 1, 2, …", () => {
    expect(nums.get("sec-a")).toBe("1");
    expect(nums.get("sec-b")).toBe("2");
  });

  it("numbers nested clauses hierarchically", () => {
    expect(nums.get("sec-a-1")).toBe("1.1");
    expect(nums.get("sec-a-2")).toBe("1.2");
    expect(nums.get("sec-a-2-1")).toBe("1.2.1");
  });

  it("letters annexes A, B, … (continuing past the numbered clauses)", () => {
    expect(nums.get("annex-x")).toBe("A");
    expect(nums.get("annex-y")).toBe("B");
  });

  it("excludes <emu-intro> from numbering", () => {
    expect(nums.has("sec-intro")).toBe(false);
  });
});

describe("metaFromElement", () => {
  const $ = load(`
    <emu-clause id="sec-op" aoid="ToNumber"><h1>ToNumber ( argument )</h1></emu-clause>
    <emu-clause id="sec-derived"><h1>SetNumberFormatUnitOptions ( nf, options )</h1></emu-clause>
    <emu-clause id="sec-prose"><h1>NumberFormat Objects</h1></emu-clause>
    <emu-clause id="sec-internal"><h1>[[Get]] ( P, Receiver )</h1></emu-clause>
    <emu-clause><h1>No id here</h1></emu-clause>
  `);
  const meta = (sel: string) => metaFromElement($, $(sel)[0]!, "1.1");

  it("uses the aoid attribute when present (kind=op)", () => {
    expect(meta("#sec-op")).toMatchObject({
      id: "sec-op",
      aoid: "ToNumber",
      kind: "op",
      number: "1.1",
      title: "ToNumber ( argument )",
    });
  });

  it("derives the aoid from a 'Name ( args )' title when the attribute is absent", () => {
    expect(meta("#sec-derived")).toMatchObject({
      aoid: "SetNumberFormatUnitOptions",
      kind: "op",
    });
  });

  it("leaves a prose title (no leading 'Name (') without an aoid (kind=clause)", () => {
    expect(meta("#sec-prose")).toMatchObject({
      aoid: null,
      kind: "clause",
      title: "NumberFormat Objects",
    });
  });

  it("classifies a [[…]] title as an internal method", () => {
    expect(meta("#sec-internal")).toMatchObject({
      aoid: null,
      kind: "internal method",
    });
  });

  it("returns null for an element without an id", () => {
    const noId = $("emu-clause").filter((_, e) => !$(e).attr("id"))[0]!;
    expect(metaFromElement($, noId, "9")).toBeNull();
  });
});
