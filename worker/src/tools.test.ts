import { describe, it, expect, beforeEach } from "vitest";
import {
  clauseGet,
  clauseList,
  proposalGet,
  proposalList,
  specAbout,
  specSearch,
} from "./tools.js";
import { __resetCachesForTests } from "./r2.js";
import {
  createFakeR2,
  fakeProposalsIndexJson,
  fakeSpecJson,
  fakeTest262IndexJson,
} from "./__fixtures__/fakeR2.js";

beforeEach(() => {
  __resetCachesForTests();
});

// ─── specAbout ────────────────────────────────────────────────────

describe("specAbout", () => {
  it("returns server name + version", async () => {
    const env = { SPECS: createFakeR2() };
    const r = (await specAbout(env, "9.9.9")) as {
      server: { name: string; version: string };
    };
    expect(r.server.name).toBe("tc39-mcp");
    expect(r.server.version).toBe("9.9.9");
  });

  it("tags transport + backed_by so callers know what they're hitting", async () => {
    const env = { SPECS: createFakeR2() };
    const r = (await specAbout(env, "0.1.0")) as {
      transport: string;
      backed_by: string;
    };
    expect(r.transport).toBe("http-streamable");
    expect(r.backed_by).toBe("cloudflare-r2");
  });

  it("enumerates 24 snapshot slots (12×262 + 12×402)", async () => {
    const env = { SPECS: createFakeR2() };
    const r = (await specAbout(env, "0.1.0")) as {
      snapshots: { present: boolean }[];
    };
    expect(r.snapshots.length).toBe(24);
  });

  it("marks snapshots present:false when R2 doesn't have them", async () => {
    const env = { SPECS: createFakeR2() };
    const r = (await specAbout(env, "0.1.0")) as {
      snapshots: { spec: string; edition: string; present: boolean }[];
    };
    for (const s of r.snapshots) expect(s.present).toBe(false);
  });

  it("populates pin metadata for present snapshots", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-main.json": fakeSpecJson({
            spec: "262",
            edition: "main",
            sha: "abc1234",
            clauses: { "sec-x": { id: "sec-x", title: "X" }, "sec-y": { id: "sec-y", title: "Y" } },
          }),
        },
      }),
    };
    const r = (await specAbout(env, "0.1.0")) as {
      snapshots: { spec: string; edition: string; present: boolean; sha?: string; clause_count?: number }[];
    };
    const main = r.snapshots.find((s) => s.spec === "262" && s.edition === "main");
    expect(main).toBeDefined();
    expect(main!.present).toBe(true);
    expect(main!.sha).toBe("abc1234");
    expect(main!.clause_count).toBe(2);
  });

  it("includes test262_index header when the index is present", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "test262-index.json": fakeTest262IndexJson({ sha: "t1", testCount: 7 }),
        },
      }),
    };
    const r = (await specAbout(env, "0.1.0")) as {
      test262_index?: { test262_sha: string; test_count: number };
    };
    expect(r.test262_index).toBeDefined();
    expect(r.test262_index!.test262_sha).toBe("t1");
    expect(r.test262_index!.test_count).toBe(7);
  });

  it("omits test262_index when missing", async () => {
    const env = { SPECS: createFakeR2() };
    const r = (await specAbout(env, "0.1.0")) as {
      test262_index?: unknown;
    };
    expect(r.test262_index).toBeUndefined();
  });
});

// ─── clauseGet ────────────────────────────────────────────────────

describe("clauseGet", () => {
  it("returns the clause when present", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({
            spec: "262",
            edition: "es2026",
            clauses: { "sec-tonumber": { id: "sec-tonumber", aoid: "ToNumber", title: "ToNumber ( argument )" } },
          }),
        },
      }),
    };
    const c = (await clauseGet(env, { id: "sec-tonumber" })) as {
      meta: { aoid: string };
    };
    expect(c.meta.aoid).toBe("ToNumber");
  });

  it("returns null for an unknown id", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({ spec: "262", edition: "es2026" }),
        },
      }),
    };
    const c = await clauseGet(env, { id: "sec-no-such-clause" });
    expect(c).toBeNull();
  });

  it("defaults spec=262 and edition=latest", async () => {
    // latest on 262 → es2026
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({
            spec: "262",
            edition: "es2026",
            clauses: { "sec-x": { id: "sec-x" } },
          }),
        },
      }),
    };
    const c = await clauseGet(env, { id: "sec-x" });
    expect(c).not.toBeNull();
  });

  it("resolves edition='latest' to es2026 on spec=402", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-402-es2026.json": fakeSpecJson({
            spec: "402",
            edition: "es2026",
            clauses: { "sec-intl": { id: "sec-intl" } },
          }),
        },
      }),
    };
    const c = await clauseGet(env, { id: "sec-intl", spec: "402", edition: "latest" });
    expect(c).not.toBeNull();
  });

  it("throws on unsupported (spec, edition) combo", async () => {
    const env = { SPECS: createFakeR2() };
    // es2015 predates the catalog floor (es2016) on both specs.
    await expect(
      clauseGet(env, { id: "sec-x", spec: "402", edition: "es2015" }),
    ).rejects.toThrow(/Unsupported/);
  });

  it("with `at` loads from the SHA-pinned R2 key", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          // Live key (unused)
          "spec-262-main.json": fakeSpecJson({
            spec: "262",
            edition: "main",
            sha: "newer",
            clauses: { "sec-new": { id: "sec-new" } },
          }),
          // Historical SHA-pinned key
          "spec-262-main-abc1234567.json": fakeSpecJson({
            spec: "262",
            edition: "main",
            sha: "abc1234567abcdef000000000000000000000000",
            clauses: { "sec-historical": { id: "sec-historical", title: "old" } },
          }),
        },
      }),
    };
    const c = (await clauseGet(env, {
      id: "sec-historical",
      spec: "262",
      edition: "main",
      at: "abc1234567",
    })) as { meta: { title: string } } | null;
    expect(c).not.toBeNull();
    expect(c!.meta.title).toBe("old");
  });

  it("with `at` truncates a 40-char SHA to 10 for the R2 key", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-main-abc1234567.json": fakeSpecJson({
            spec: "262",
            edition: "main",
            sha: "abc1234567abcdef000000000000000000000000",
            clauses: { "sec-x": { id: "sec-x" } },
          }),
        },
      }),
    };
    const c = await clauseGet(env, {
      id: "sec-x",
      spec: "262",
      edition: "main",
      at: "abc1234567abcdef000000000000000000000000",
    });
    expect(c).not.toBeNull();
  });

  it("rejects `at` on non-main editions (served at a single snapshot)", async () => {
    const env = { SPECS: createFakeR2() };
    await expect(
      clauseGet(env, {
        id: "sec-x",
        spec: "262",
        edition: "es2026",
        at: "abc1234567",
      }),
    ).rejects.toThrow(/only valid for the 'main' edition/);
  });

  it("rejects `at` that isn't a valid hex SHA", async () => {
    const env = { SPECS: createFakeR2() };
    await expect(
      clauseGet(env, { id: "sec-x", edition: "main", at: "not-a-sha-xyz" }),
    ).rejects.toThrow(/must be a hex SHA/);
  });

  it("missing historical pin returns a clearer error", async () => {
    const env = { SPECS: createFakeR2() };
    await expect(
      clauseGet(env, { id: "sec-x", edition: "main", at: "deadbeefab" }),
    ).rejects.toThrow(/historical snapshot/);
  });
});

// ─── clauseList ───────────────────────────────────────────────────

describe("clauseList", () => {
  it("returns rows for every clause", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({
            spec: "262",
            edition: "es2026",
            clauses: {
              "sec-a": { id: "sec-a" },
              "sec-b": { id: "sec-b" },
              "sec-c": { id: "sec-c" },
            },
          }),
        },
      }),
    };
    const r = (await clauseList(env, {})) as { hits: { id: string }[] };
    expect(r.hits.length).toBe(3);
  });

  it("respects the limit", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({
            spec: "262",
            edition: "es2026",
            clauses: Object.fromEntries(
              Array.from({ length: 10 }, (_, i) => [`sec-${i}`, { id: `sec-${i}` }]),
            ),
          }),
        },
      }),
    };
    const r = (await clauseList(env, { limit: 3 })) as { hits: unknown[] };
    expect(r.hits.length).toBe(3);
  });
});

// ─── specSearch ───────────────────────────────────────────────────

describe("specSearch", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          clauses: {
            "sec-tonumber": { id: "sec-tonumber", aoid: "ToNumber", title: "ToNumber ( argument )" },
            "sec-tonumeric": { id: "sec-tonumeric", aoid: "ToNumeric", title: "ToNumeric ( value )" },
            "sec-tostring": { id: "sec-tostring", aoid: "ToString", title: "ToString ( argument )" },
          },
        }),
      },
    }),
  });

  it("ranks aoid-exact match first (score 100)", async () => {
    const r = (await specSearch(env(), { query: "ToNumber" })) as {
      hits: { aoid: string; matched_on: string; score: number }[];
    };
    expect(r.hits[0]!.aoid).toBe("ToNumber");
    expect(r.hits[0]!.matched_on).toBe("aoid-exact");
    expect(r.hits[0]!.score).toBe(100);
  });

  it("returns aoid-substring matches with score 80", async () => {
    const r = (await specSearch(env(), { query: "ToNum" })) as {
      hits: { aoid: string; matched_on: string }[];
    };
    // Both ToNumber and ToNumeric match the prefix.
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
  });

  it("respects the limit", async () => {
    const r = (await specSearch(env(), { query: "To", limit: 1 })) as {
      hits: unknown[];
    };
    expect(r.hits.length).toBe(1);
  });

  it("returns [] when nothing matches", async () => {
    const r = (await specSearch(env(), { query: "no-such-symbol-xyz" })) as {
      hits: unknown[];
    };
    expect(r.hits).toEqual([]);
  });
});

// ─── proposalList ─────────────────────────────────────────────────

describe("proposalList", () => {
  it("returns hint when the index isn't in R2", async () => {
    const env = { SPECS: createFakeR2() };
    const r = (await proposalList(env, {})) as { source: string; hint?: string };
    expect(r.source).toBe("none");
    expect(r.hint).toContain("Proposals index not present");
  });

  it("returns all proposals when no filter", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "x",
            proposals: [
              { slug: "a", name: "Alpha", stage: "3", champions: ["Alice"] },
              { slug: "b", name: "Beta", stage: "2", champions: ["Bob"] },
            ],
          }),
        },
      }),
    };
    const r = (await proposalList(env, {})) as { total: number; proposals: { slug: string }[] };
    expect(r.total).toBe(2);
  });

  it("filters by stage", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "x",
            proposals: [
              { slug: "a", name: "A", stage: "3" },
              { slug: "b", name: "B", stage: "2.7" },
              { slug: "c", name: "C", stage: "3" },
            ],
          }),
        },
      }),
    };
    const r = (await proposalList(env, { stage: "3" })) as { total: number };
    expect(r.total).toBe(2);
  });

  it("filters by champion (case-insensitive substring)", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "x",
            proposals: [
              { slug: "a", name: "A", stage: "3", champions: ["Mark Miller"] },
              { slug: "b", name: "B", stage: "3", champions: ["Alice"] },
            ],
          }),
        },
      }),
    };
    const r = (await proposalList(env, { champion: "miller" })) as { total: number };
    expect(r.total).toBe(1);
  });

  it("filters by contains (name + slug substring, case-insensitive)", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "x",
            proposals: [
              { slug: "temporal", name: "Temporal", stage: "3" },
              { slug: "regex-x", name: "Regex Extension", stage: "3" },
            ],
          }),
        },
      }),
    };
    const r = (await proposalList(env, { contains: "TEMP" })) as { total: number };
    expect(r.total).toBe(1);
  });
});

// ─── proposalGet ──────────────────────────────────────────────────

describe("proposalGet", () => {
  it("returns hint when the index isn't in R2", async () => {
    const env = { SPECS: createFakeR2() };
    const r = (await proposalGet(env, { name: "temporal" })) as { source: string; hint?: string };
    expect(r.source).toBe("none");
    expect(r.hint).toBeDefined();
  });

  it("finds by slug (exact)", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "x",
            proposals: [{ slug: "temporal", name: "Temporal", stage: "3" }],
          }),
        },
      }),
    };
    const r = (await proposalGet(env, { name: "temporal" })) as {
      proposal: { slug: string } | null;
    };
    expect(r.proposal?.slug).toBe("temporal");
  });

  it("falls back to name (case-insensitive)", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "x",
            proposals: [{ slug: "temporal", name: "Temporal", stage: "3" }],
          }),
        },
      }),
    };
    const r = (await proposalGet(env, { name: "TEMPORAL" })) as {
      proposal: { slug: string } | null;
    };
    expect(r.proposal?.slug).toBe("temporal");
  });

  it("returns proposal:null when nothing matches", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "x",
            proposals: [{ slug: "temporal", name: "Temporal", stage: "3" }],
          }),
        },
      }),
    };
    const r = (await proposalGet(env, { name: "no-such-proposal" })) as {
      proposal: unknown;
    };
    expect(r.proposal).toBeNull();
  });
});
