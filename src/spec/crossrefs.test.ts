import { describe, it, expect, afterEach } from "vitest";
import {
  buildCrossrefIndices,
  computeCrossrefs,
  __resetCrossrefCacheForTests,
  type CrossrefClause,
  type CrossrefSpec,
} from "./crossrefs.js";
import type { ClauseTextStep } from "./clause_text.js";

// Pure unit coverage for the shared crossref core. The stdio + Worker
// tool tests exercise the same logic against real parsed specs; these
// pin the densification + assembly behavior on small hand-built
// fixtures, with no filesystem or R2 dependency.

function step(text: string, substeps: ClauseTextStep[] = []): ClauseTextStep {
  return { text, substeps };
}

function clause(
  meta: { aoid?: string | null; title?: string; number?: string },
  opts: { steps?: string[]; notes?: string[]; crossrefs?: string[]; signatureRaw?: string | null } = {},
): CrossrefClause {
  return {
    meta,
    signatureRaw: opts.signatureRaw ?? null,
    notes: (opts.notes ?? []).map((text) => ({ text })),
    algorithms: [{ steps: (opts.steps ?? []).map((t) => step(t)) }],
    crossrefs: opts.crossrefs,
  };
}

// A small 262-like spec: Foo is an AO; Bar calls Foo() in a step; Baz
// links Foo via an explicit <emu-xref> href; Self call-sites itself
// (must not self-link); Caller exercises call-site precision against
// the `Set` AOID (the prose "Set the value" must NOT match, only the
// genuine `Set(` call site).
const spec262: CrossrefSpec = {
  clauses: {
    "sec-foo": clause({ aoid: "Foo", title: "Foo", number: "1" }),
    "sec-bar": clause(
      { aoid: "Bar", title: "Bar", number: "2" },
      { steps: ["Let x be Foo(y)."] },
    ),
    "sec-baz": clause({ title: "Baz", number: "3" }, { crossrefs: ["#sec-foo"] }),
    "sec-self": clause(
      { aoid: "Self", title: "Self", number: "4" },
      { steps: ["Return Self(1)."] },
    ),
    "sec-set": clause({ aoid: "Set", title: "Set", number: "5" }),
    "sec-caller": clause(
      { title: "Caller", number: "6" },
      { steps: ["Set the value of x to 1.", "Perform Set(o, p, v)."] },
    ),
  },
};

afterEach(() => {
  __resetCrossrefCacheForTests();
});

describe("buildCrossrefIndices", () => {
  it("densifies forward + reverse from an AOID call site in step text", () => {
    const { forward, reverse } = buildCrossrefIndices(spec262);
    expect(forward.get("sec-bar")?.has("sec-foo")).toBe(true);
    expect(reverse.get("sec-foo")?.has("sec-bar")).toBe(true);
  });

  it("captures explicit <emu-xref> hrefs (with leading #)", () => {
    const { forward } = buildCrossrefIndices(spec262);
    expect(forward.get("sec-baz")?.has("sec-foo")).toBe(true);
  });

  it("never links a clause to itself", () => {
    const { forward, reverse } = buildCrossrefIndices(spec262);
    expect(forward.get("sec-self")?.has("sec-self") ?? false).toBe(false);
    expect(reverse.get("sec-self")?.has("sec-self") ?? false).toBe(false);
  });

  it("call-site precision: prose `Set the value` doesn't link, `Set(` does", () => {
    const { forward } = buildCrossrefIndices(spec262);
    // The link exists — but via the genuine `Set(o, p, v)` call site,
    // which is the same one the prose `Set the value` would have created
    // had we matched bare words. The discriminator is that ONLY the
    // paren form is counted, so a clause with only prose wouldn't link.
    expect(forward.get("sec-caller")?.has("sec-set")).toBe(true);

    const proseOnly: CrossrefSpec = {
      clauses: {
        "sec-set": clause({ aoid: "Set", number: "1" }),
        "sec-prose": clause({ number: "2" }, { steps: ["Set the value of x to 1."] }),
      },
    };
    expect(buildCrossrefIndices(proseOnly).forward.get("sec-prose")).toBeUndefined();
  });
});

const noOther = async () => null;

describe("computeCrossrefs — directions", () => {
  it("direction 'out' returns only outgoing, sorted by clause number", async () => {
    const r = await computeCrossrefs({
      spec: "262",
      edition: "fixture-out",
      parsed: spec262,
      id: "sec-bar",
      direction: "out",
      limit: 100,
      includeCrossSpec: false,
      loadOther: noOther,
    });
    expect(r.incoming).toBeUndefined();
    expect(r.outgoing?.map((h) => h.id)).toEqual(["sec-foo"]);
    expect(r.outgoing?.[0]?.spec).toBe("262");
  });

  it("direction 'in' returns only incoming back-refs", async () => {
    const r = await computeCrossrefs({
      spec: "262",
      edition: "fixture-in",
      parsed: spec262,
      id: "sec-foo",
      direction: "in",
      limit: 100,
      includeCrossSpec: false,
      loadOther: noOther,
    });
    expect(r.outgoing).toBeUndefined();
    // Both the call-site (Bar) and the explicit href (Baz) cite Foo.
    expect(r.incoming?.map((h) => h.id).sort()).toEqual(["sec-bar", "sec-baz"]);
  });

  it("direction 'both' populates incoming + outgoing", async () => {
    const r = await computeCrossrefs({
      spec: "262",
      edition: "fixture-both",
      parsed: spec262,
      id: "sec-foo",
      direction: "both",
      limit: 100,
      includeCrossSpec: false,
      loadOther: noOther,
    });
    expect(r.outgoing).toEqual([]);
    expect(r.incoming?.length).toBe(2);
  });

  it("missing id yields empty arrays, not undefined", async () => {
    const r = await computeCrossrefs({
      spec: "262",
      edition: "fixture-missing",
      parsed: spec262,
      id: "sec-does-not-exist",
      direction: "both",
      limit: 100,
      includeCrossSpec: false,
      loadOther: noOther,
    });
    expect(r.outgoing).toEqual([]);
    expect(r.incoming).toEqual([]);
  });
});

describe("computeCrossrefs — cross-spec", () => {
  const spec402: CrossrefSpec = {
    clauses: {
      "sec-nf": clause(
        { aoid: "InitializeNumberFormat", title: "NF", number: "1" },
        { steps: ["Let O be OrdinaryCreateFromConstructor(nf)."] },
      ),
    },
  };
  const other262: CrossrefSpec = {
    clauses: {
      "sec-ordinarycreate": clause({
        aoid: "OrdinaryCreateFromConstructor",
        title: "OrdinaryCreateFromConstructor",
        number: "10",
      }),
    },
  };

  it("include_cross_spec surfaces other-spec targets tagged with their spec", async () => {
    let loaded: string | null = null;
    const r = await computeCrossrefs({
      spec: "402",
      edition: "fixture-cross",
      parsed: spec402,
      id: "sec-nf",
      direction: "out",
      limit: 100,
      includeCrossSpec: true,
      loadOther: async (otherSpec) => {
        loaded = otherSpec;
        return other262;
      },
    });
    expect(loaded).toBe("262");
    const cross = r.outgoing?.filter((h) => h.spec === "262") ?? [];
    expect(cross.map((h) => h.id)).toEqual(["sec-ordinarycreate"]);
  });

  it("does not call loadOther when include_cross_spec is false", async () => {
    let called = false;
    await computeCrossrefs({
      spec: "402",
      edition: "fixture-nocross",
      parsed: spec402,
      id: "sec-nf",
      direction: "out",
      limit: 100,
      includeCrossSpec: false,
      loadOther: async () => {
        called = true;
        return other262;
      },
    });
    expect(called).toBe(false);
  });

  it("is one-way: direction 'in' never loads the other spec", async () => {
    let called = false;
    await computeCrossrefs({
      spec: "402",
      edition: "fixture-oneway",
      parsed: spec402,
      id: "sec-nf",
      direction: "in",
      limit: 100,
      includeCrossSpec: true,
      loadOther: async () => {
        called = true;
        return other262;
      },
    });
    expect(called).toBe(false);
  });

  it("tolerates loadOther returning null (other spec unavailable)", async () => {
    const r = await computeCrossrefs({
      spec: "402",
      edition: "fixture-null",
      parsed: spec402,
      id: "sec-nf",
      direction: "out",
      limit: 100,
      includeCrossSpec: true,
      loadOther: noOther,
    });
    // No cross-spec hits, but the call still succeeds with same-spec out.
    expect(r.outgoing?.every((h) => h.spec === "402")).toBe(true);
  });
});
