import { describe, it, expect } from "vitest";
import {
  buildSlugMap,
  cellText,
  parseProposalsMarkdown,
  splitPeople,
} from "./proposals_parser.js";

describe("buildSlugMap", () => {
  it("extracts `[slug]: url` reference links", () => {
    const m = buildSlugMap(`
intro paragraph

[temporal]: https://github.com/tc39/proposal-temporal
[decorators]: https://github.com/tc39/proposal-decorators
`);
    expect(m.get("temporal")).toBe("https://github.com/tc39/proposal-temporal");
    expect(m.get("decorators")).toBe("https://github.com/tc39/proposal-decorators");
  });

  it("handles `[slug]: <url>` (angle-bracket variant)", () => {
    const m = buildSlugMap("[x]: <https://example.com/x>");
    expect(m.get("x")).toBe("https://example.com/x");
  });

  it("ignores non-reference-link lines", () => {
    const m = buildSlugMap(`
# Heading
| Cell | Cell |
[link](https://example.com)
`);
    expect(m.size).toBe(0);
  });
});

describe("cellText", () => {
  it("converts <br /> to newlines and trims", () => {
    expect(cellText("  one<br />two  ")).toBe("one two");
  });

  it("decodes &nbsp; and &#8209; (non-breaking hyphen)", () => {
    expect(cellText("2024&#8209;06&nbsp;date")).toBe("2024-06 date");
  });

  it("collapses internal whitespace", () => {
    expect(cellText("a   b\nc\td")).toBe("a b c d");
  });
});

describe("splitPeople", () => {
  it("splits on <br />", () => {
    expect(splitPeople("Alice<br />Bob<br />Carol")).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });

  it("splits on commas (but not inside HTML tag content)", () => {
    expect(splitPeople("Alice, Bob, Carol")).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("strips <sub> wrapping", () => {
    expect(splitPeople("<sub>Alice<br />Bob</sub>")).toEqual(["Alice", "Bob"]);
  });

  it("returns [] for an empty cell", () => {
    expect(splitPeople("")).toEqual([]);
    expect(splitPeople("   ")).toEqual([]);
  });
});

describe("parseProposalsMarkdown", () => {
  const sample = `# Heading

### Stage 3

| Proposal | Author | Champion | Test262 Feature Flag |
| --- | --- | --- | --- |
| [Temporal][temporal] | Maggie Pint<br />Philipp Dunkel | Maggie Pint | <sub>[Temporal][temporal-tests]</sub> |
| [Source Phase Imports][spi] | Luca Casonato | Guy Bedford<br />Luca Casonato | <sub>[source-phase-imports][spi-tests]</sub> |

### Stage 2.7

| Proposal | Author | Champion | Test262 Feature Flag |
| --- | --- | --- | --- |
| [Decorators][decorators] | Daniel Ehrenberg | Kristen Hewell Garrett | <sub>[decorators][dec-tests]</sub> |

## Inactive content (should stop the table parser)

[temporal]: https://github.com/tc39/proposal-temporal
[spi]: https://github.com/tc39/proposal-source-phase-imports
[decorators]: https://github.com/tc39/proposal-decorators
[temporal-tests]: https://github.com/tc39/test262/...
[spi-tests]: https://github.com/tc39/test262/...
[dec-tests]: https://github.com/tc39/test262/...
`;

  it("extracts rows from each stage table", () => {
    const rows = parseProposalsMarkdown(sample, "README.md", "active", "262");
    expect(rows.length).toBe(3);
    const slugs = rows.map((r) => r.slug);
    expect(slugs).toEqual(["temporal", "spi", "decorators"]);
  });

  it("captures the stage from the `### Stage X` heading", () => {
    const rows = parseProposalsMarkdown(sample, "README.md", "active", "262");
    expect(rows.find((r) => r.slug === "temporal")!.stage).toBe("3");
    expect(rows.find((r) => r.slug === "decorators")!.stage).toBe("2.7");
  });

  it("resolves URLs from the slug reference map", () => {
    const rows = parseProposalsMarkdown(sample, "README.md", "active", "262");
    const temporal = rows.find((r) => r.slug === "temporal")!;
    expect(temporal.url).toBe("https://github.com/tc39/proposal-temporal");
  });

  it("captures authors and champions split on <br />", () => {
    const rows = parseProposalsMarkdown(sample, "README.md", "active", "262");
    const temporal = rows.find((r) => r.slug === "temporal")!;
    expect(temporal.authors).toEqual(["Maggie Pint", "Philipp Dunkel"]);
    expect(temporal.champions).toEqual(["Maggie Pint"]);
  });

  it("captures the test262 feature flag column", () => {
    const rows = parseProposalsMarkdown(sample, "README.md", "active", "262");
    const temporal = rows.find((r) => r.slug === "temporal")!;
    expect(temporal.test262_flag).toBeDefined();
    expect(temporal.test262_flag).toContain("Temporal");
  });

  it("tags each row with the source_file argument", () => {
    const rows = parseProposalsMarkdown(sample, "stage-3-only.md", "3", "262");
    for (const r of rows) expect(r.source_file).toBe("stage-3-only.md");
  });

  it("tags each row with the spec argument", () => {
    const r262 = parseProposalsMarkdown(sample, "README.md", "active", "262");
    for (const r of r262) expect(r.spec).toBe("262");
    const r402 = parseProposalsMarkdown(sample, "ecma402/README.md", "active", "402");
    for (const r of r402) expect(r.spec).toBe("402");
  });

  it("falls back to defaultStage when no `### Stage X` heading appears", () => {
    const noHeading = `
| Proposal | Author | Champion |
| --- | --- | --- |
| [Foo][foo] | A | B |

[foo]: https://example.com
`;
    const rows = parseProposalsMarkdown(noHeading, "x.md", "finished", "262");
    expect(rows[0]!.stage).toBe("finished");
  });

  it("stops table parsing at a `##` heading", () => {
    // The sample's `## Inactive content` line should terminate the
    // table; no rogue rows past it. The 3 expected rows + zero stragglers.
    const rows = parseProposalsMarkdown(sample, "README.md", "active", "262");
    expect(rows.length).toBe(3);
  });
});
