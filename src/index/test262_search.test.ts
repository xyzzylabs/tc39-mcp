import { describe, it, expect } from "vitest";
import {
  searchTest262,
  runTest262Search,
  type Test262IndexFile,
} from "./test262_search.js";

const idx: Test262IndexFile = {
  version: 1,
  test262_sha: "abc123def0",
  generated_at: "2026-01-01T00:00:00.000Z",
  tests: [
    {
      path: "test/built-ins/Number/toNumber.js",
      esid: "sec-tonumber",
      description: "ToNumber basic",
      features: ["BigInt"],
      flags: ["onlyStrict"],
    },
    {
      path: "test/language/statements/for-await.js",
      esid: "sec-for-await",
      description: "for-await-of loop",
    },
    {
      path: "test/built-ins/Number/nested.js",
      esid: "sec-tonumber-applied-to-the-string-type",
      description: "nested conversion",
    },
    { path: "test/other.js", description: "no esid here" },
  ],
};

describe("searchTest262", () => {
  it("esid is prefix-matched (catches nested ids), case-insensitive", () => {
    const r = searchTest262(idx, { esid: "SEC-TONUMBER" });
    expect(r.hits.map((h) => h.path)).toEqual([
      "test/built-ins/Number/toNumber.js",
      "test/built-ins/Number/nested.js",
    ]);
    expect(r.source).toBe("index");
    expect(r.index_sha).toBe("abc123def0");
  });

  it("query AND-matches whitespace tokens across description + path", () => {
    // Both tokens must appear somewhere in (description + path).
    const r = searchTest262(idx, { query: "tonumber basic" });
    expect(r.hits.map((h) => h.path)).toEqual(["test/built-ins/Number/toNumber.js"]);
  });

  it("query matches on path alone when the description doesn't", () => {
    const r = searchTest262(idx, { query: "for-await" });
    expect(r.hits.map((h) => h.path)).toEqual(["test/language/statements/for-await.js"]);
  });

  it("query + esid AND-narrow together", () => {
    const r = searchTest262(idx, { esid: "sec-tonumber", query: "basic" });
    expect(r.hits.map((h) => h.path)).toEqual(["test/built-ins/Number/toNumber.js"]);
  });

  it("caps at limit", () => {
    const r = searchTest262(idx, { esid: "sec-tonumber", limit: 1 });
    expect(r.hits).toHaveLength(1);
  });

  it("builds the GitHub permalink + carries optional front-matter only when present", () => {
    const hit = searchTest262(idx, { esid: "sec-tonumber", limit: 1 }).hits[0]!;
    expect(hit.url).toBe(
      "https://github.com/tc39/test262/blob/abc123def0/test/built-ins/Number/toNumber.js",
    );
    expect(hit.features).toEqual(["BigInt"]);
    expect(hit.flags).toEqual(["onlyStrict"]);

    const forAwait = searchTest262(idx, { query: "for-await" }).hits[0]!;
    expect(forAwait.features).toBeUndefined();
    expect(forAwait.flags).toBeUndefined();
  });
});

describe("runTest262Search", () => {
  const load = async () => idx;

  it("requires at least one of query / esid", async () => {
    const r = await runTest262Search({}, load, "hint-unused");
    expect(r.source).toBe("none");
    expect(r.hits).toEqual([]);
    expect(r.hint).toBe("Provide either `query` or `esid` (or both).");
  });

  it("returns source:none with the caller's hint when the index is missing", async () => {
    const r = await runTest262Search({ query: "x" }, async () => null, "no index here");
    expect(r.source).toBe("none");
    expect(r.hits).toEqual([]);
    expect(r.hint).toBe("no index here");
    expect(r.query).toBe("x");
  });

  it("ranks via searchTest262 when the index loads", async () => {
    const r = await runTest262Search({ esid: "sec-for-await" }, load, "hint-unused");
    expect(r.source).toBe("index");
    expect(r.hits.map((h) => h.path)).toEqual(["test/language/statements/for-await.js"]);
  });
});
