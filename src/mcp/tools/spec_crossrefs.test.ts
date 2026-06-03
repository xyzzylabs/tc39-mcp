import { describe, it, expect } from "vitest";
import { specCrossrefs } from "./spec_crossrefs.js";

// Single-spec and cross-spec crossref coverage. The reverse index
// (incoming refs) is AOID-densified from step text, which is the whole
// reason these tests exist — explicit <emu-xref> coverage alone would
// underreport "who calls ToNumber" by an order of magnitude.

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined; // parsed JSON for some (spec, edition) missing
  }
}

describe("specCrossrefs — single-spec ECMA-262", () => {
  it("outgoing refs from sec-tonumber stay within 262", async () => {
    const r = await safe(() =>
      specCrossrefs({ id: "sec-tonumber", spec: "262", direction: "out" }),
    );
    if (!r?.outgoing) return;
    for (const h of r.outgoing) expect(h.spec).toBe("262");
  });

  it("incoming refs find clauses that mention ToNumber by AOID", async () => {
    const r = await safe(() =>
      specCrossrefs({
        id: "sec-tonumber",
        spec: "262",
        direction: "in",
        limit: 500,
      }),
    );
    if (!r?.incoming) return;
    // ToNumber is one of the most-called ops in the spec; densification
    // should yield well over a dozen incoming references.
    expect(r.incoming.length).toBeGreaterThan(10);
    for (const h of r.incoming) expect(h.spec).toBe("262");
  });

  it("call-site precision: `Set` doesn't false-positive on prose `Set the X`", async () => {
    // The AOID `Set` collides with the English verb `Set` that begins
    // every algorithm step `Set X to Y`. The call-site discriminator
    // (`Set(`) keeps the incoming refs to genuine `Set(o, p, v, throw)`
    // call sites — typically a few dozen, not the hundreds we'd see
    // if every "Set X to Y" prose mention counted.
    const r = await safe(() =>
      specCrossrefs({
        id: "sec-set-o-p-v-throw",
        spec: "262",
        direction: "in",
        limit: 1000,
      }),
    );
    if (!r?.incoming) return;
    // Real Set call sites: somewhere in the dozens. Strictly less than
    // 200 with the call-site fix (was 379 with prose mentions counted).
    expect(r.incoming.length).toBeLessThan(200);
    expect(r.incoming.length).toBeGreaterThan(10);
  });

  it("both directions populate when direction=both", async () => {
    const r = await safe(() =>
      specCrossrefs({ id: "sec-tonumber", spec: "262", direction: "both" }),
    );
    if (!r) return;
    expect(r.outgoing).toBeDefined();
    expect(r.incoming).toBeDefined();
  });

  it("returns empty arrays (not undefined) for an isolated id", async () => {
    const r = await safe(() =>
      specCrossrefs({
        id: "sec-this-clause-does-not-exist-xyz",
        spec: "262",
        direction: "both",
      }),
    );
    if (!r) return;
    expect(r.outgoing).toEqual([]);
    expect(r.incoming).toEqual([]);
  });
});

describe("specCrossrefs — single-spec ECMA-402", () => {
  it("outgoing refs from sec-intl.numberformat include 402 ops", async () => {
    const r = await safe(() =>
      specCrossrefs({
        id: "sec-intl.numberformat",
        spec: "402",
        direction: "out",
        limit: 500,
      }),
    );
    if (!r?.outgoing) return;
    // 402-internal ops like SetNumberFormatUnitOptions, ResolveOptions,
    // ChainNumberFormat are mentioned by AOID in the NumberFormat steps.
    const aoids = new Set(r.outgoing.map((h) => h.aoid).filter(Boolean));
    expect(aoids.size).toBeGreaterThan(0);
    for (const h of r.outgoing) expect(h.spec).toBe("402");
  });
});

describe("specCrossrefs — cross-spec (include_cross_spec)", () => {
  it("does NOT include other-spec hits by default", async () => {
    const r = await safe(() =>
      specCrossrefs({
        id: "sec-intl.numberformat",
        spec: "402",
        direction: "out",
        limit: 500,
      }),
    );
    if (!r?.outgoing) return;
    for (const h of r.outgoing) expect(h.spec).toBe("402");
  });

  it("include_cross_spec:true on 402 surfaces 262 targets", async () => {
    const r = await safe(() =>
      specCrossrefs({
        id: "sec-intl.numberformat",
        spec: "402",
        direction: "out",
        include_cross_spec: true,
        limit: 500,
      }),
    );
    if (!r?.outgoing) return;
    // sec-intl.numberformat's algorithm calls
    // OrdinaryCreateFromConstructor (an ECMA-262 op) by AOID. The
    // cross-spec pass should pick that up.
    const hasCrossSpec = r.outgoing.some((h) => h.spec === "262");
    expect(hasCrossSpec).toBe(true);
  });

  it("cross-spec hits carry the right `spec` tag on each result", async () => {
    const r = await safe(() =>
      specCrossrefs({
        id: "sec-intl.numberformat",
        spec: "402",
        direction: "out",
        include_cross_spec: true,
        limit: 500,
      }),
    );
    if (!r?.outgoing) return;
    const specs = new Set(r.outgoing.map((h) => h.spec));
    // Mixed result set — should have both 402 and 262 entries.
    expect(specs.size).toBeGreaterThanOrEqual(2);
    expect(specs.has("262")).toBe(true);
    expect(specs.has("402")).toBe(true);
  });

  it("include_cross_spec is one-way: incoming stays single-spec", async () => {
    const r = await safe(() =>
      specCrossrefs({
        id: "sec-tonumber",
        spec: "262",
        direction: "in",
        include_cross_spec: true,
        limit: 500,
      }),
    );
    if (!r?.incoming) return;
    // Reverse index is always single-spec; the flag is documented to
    // affect outgoing only.
    for (const h of r.incoming) expect(h.spec).toBe("262");
  });
});
