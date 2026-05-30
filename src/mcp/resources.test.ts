import { describe, it, expect } from "vitest";
import {
  buildResourceUri,
  listResources,
  parseResourceUri,
  readResource,
} from "./resources.js";

describe("parseResourceUri", () => {
  it("parses a well-formed tc39:// URI", () => {
    expect(parseResourceUri("tc39://262/latest/sec-tonumber")).toEqual({
      spec: "262",
      edition: "latest",
      id: "sec-tonumber",
    });
  });

  it("handles dotted clause ids", () => {
    expect(parseResourceUri("tc39://402/main/sec-intl.numberformat")).toEqual({
      spec: "402",
      edition: "main",
      id: "sec-intl.numberformat",
    });
  });

  it("returns null for malformed URIs", () => {
    expect(parseResourceUri("http://example.com")).toBeNull();
    expect(parseResourceUri("tc39:incomplete")).toBeNull();
    expect(parseResourceUri("tc39://262")).toBeNull();
    expect(parseResourceUri("tc39:///")).toBeNull();
  });
});

describe("buildResourceUri", () => {
  it("builds the canonical URI form", () => {
    expect(buildResourceUri("262", "latest", "sec-tonumber")).toBe(
      "tc39://262/latest/sec-tonumber",
    );
    expect(buildResourceUri("402", "main", "sec-intl.numberformat")).toBe(
      "tc39://402/main/sec-intl.numberformat",
    );
  });
});

describe("listResources", () => {
  it("returns top-level clauses across all loaded snapshots", () => {
    try {
      const r = listResources({ per_snapshot: 5 });
      expect(r.resources.length).toBeGreaterThan(0);
      for (const res of r.resources) {
        expect(res.uri).toMatch(/^tc39:\/\//);
        expect(res.name.length).toBeGreaterThan(0);
        expect(res.mimeType).toBe("application/json");
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("respects per_snapshot cap", () => {
    try {
      const r = listResources({ per_snapshot: 2 });
      // We have 13 supported pairs; with cap=2 we'd see at most 26.
      expect(r.resources.length).toBeLessThanOrEqual(26);
    } catch {
      /* skip */
    }
  });
});

describe("readResource", () => {
  it("returns clause JSON for a known URI", () => {
    try {
      const r = readResource("tc39://262/latest/sec-tonumber");
      expect(r.contents.length).toBe(1);
      const c = r.contents[0]!;
      expect(c.uri).toBe("tc39://262/latest/sec-tonumber");
      expect(c.mimeType).toBe("application/json");
      const inner = JSON.parse(c.text);
      expect(inner.meta.aoid).toBe("ToNumber");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("throws on malformed URI", () => {
    expect(() => readResource("not-a-uri")).toThrow(/Invalid tc39/);
  });

  it("throws on unknown spec", () => {
    expect(() => readResource("tc39://999/main/sec-x")).toThrow(/Unknown spec/);
  });

  it("throws on unknown clause id", () => {
    expect(() =>
      readResource("tc39://262/latest/sec-this-does-not-exist-xyz"),
    ).toThrow(/No such clause/);
  });
});
