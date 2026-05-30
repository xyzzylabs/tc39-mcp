import { describe, it, expect } from "vitest";
import { specSymbolResolve } from "./spec_symbol.js";
import { test262Search } from "./test262_search.js";

describe("specSymbolResolve", () => {
  it("classifies [[Name]] as internal-slot and finds Prototype", () => {
    const r = specSymbolResolve({ notation: "[[Prototype]]", limit: 5 });
    expect(r.kind).toBe("internal-slot");
    expect(r.name).toBe("Prototype");
    expect(r.hits.length).toBeGreaterThan(0);
    // §10 (ordinary + exotic objects) hosts the slot definition table;
    // the bump means an early §10 entry should rank near the top.
    const sectionNumbers = r.hits.map((h) => h.number);
    expect(sectionNumbers.some((n) => n.startsWith("10."))).toBe(true);
  });

  it("classifies %X% as intrinsic and finds Object.prototype", () => {
    const r = specSymbolResolve({
      notation: "%Object.prototype%",
      limit: 5,
    });
    expect(r.kind).toBe("intrinsic");
    expect(r.name).toBe("Object.prototype");
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("classifies ~X~ as sigil-enum and finds ~number~", () => {
    const r = specSymbolResolve({ notation: "~number~", limit: 5 });
    expect(r.kind).toBe("sigil-enum");
    expect(r.name).toBe("number");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0]?.match_count).toBeGreaterThan(0);
  });

  it("returns kind=unrecognized when no sigils match", () => {
    const r = specSymbolResolve({ notation: "ToNumber", limit: 5 });
    expect(r.kind).toBe("unrecognized");
    expect(r.name).toBe("ToNumber");
  });
});

describe("test262Search", () => {
  it("errors out with hint when neither query nor esid is provided", () => {
    const r = test262Search({});
    expect(r.hits).toEqual([]);
    expect(r.source).toBe("none");
    expect(r.hint).toBeDefined();
  });

  it("returns a structured result tagged with a `source`", () => {
    // Two valid environments: index built (`index`) or not (`none`).
    // The gh subprocess fallback was removed in 0.1.x.
    const r = test262Search({ esid: "sec-tonumber", limit: 1 });
    expect(["index", "none"]).toContain(r.source);
    expect(Array.isArray(r.hits)).toBe(true);
  });

  it("uses the local index when present (offline, no auth)", () => {
    // Asserts only when an index has been built. CI without
    // `npm run fetch-test262 && npm run build-test262-index` runs the
    // test as a no-op pass.
    const r = test262Search({ esid: "sec-tonumber", limit: 5 });
    if (r.source === "index") {
      expect(r.index_sha).toBeDefined();
      // esid is a case-insensitive *prefix* match, so 'sec-tonumber'
      // catches both `sec-tonumber` and `sec-tonumber-applied-to-…`.
      for (const h of r.hits) {
        expect(h.esid?.toLowerCase().startsWith("sec-tonumber")).toBe(true);
      }
      for (const h of r.hits) {
        if (h.url) expect(h.url).toContain(r.index_sha!);
      }
    }
  });

  it("free-text query against the index filters by description / path", () => {
    const r = test262Search({ query: "ToNumber", limit: 5 });
    if (r.source === "index") {
      for (const h of r.hits) {
        const blob = `${h.description ?? ""} ${h.path}`.toLowerCase();
        expect(blob).toContain("tonumber");
      }
    }
  });

  it("returns source=none with actionable hint when index is missing", () => {
    // We can't easily un-build the on-disk index in this test, so just
    // verify the `none` branch's hint mentions the setup command.
    // Run when no index is present — otherwise this is a no-op check on
    // the existing index path.
    const r = test262Search({ esid: "sec-tonumber" });
    if (r.source === "none") {
      expect(r.hint).toBeDefined();
      expect(r.hint!).toContain("build-test262-index");
    }
  });
});
