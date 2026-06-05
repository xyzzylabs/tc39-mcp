import { describe, it, expect, beforeEach } from "vitest";
import {
  clauseGet,
  clauseList,
  clauseOutline,
  proposalGet,
  proposalList,
  specAbout,
  specCrossrefs,
  specDiff,
  specGlobalSearch,
  specGrammar,
  specSdoIndex,
  specSearch,
  specSnapshots,
  specSymbolResolve,
  specTables,
  specWellKnownIntrinsics,
} from "./tools.js";
import { __resetCachesForTests } from "./r2.js";
import { __resetCrossrefCacheForTests } from "../../src/spec/crossrefs.js";
import { RELEASED_262_EDITIONS } from "../../src/spec/catalog.js";
import {
  asFakeR2,
  createFakeR2,
  fakeProposalsIndexJson,
  fakeSpecJson,
  fakeTest262IndexJson,
} from "./__fixtures__/fakeR2.js";

beforeEach(() => {
  __resetCachesForTests();
  // The crossref index memo lives in the shared module, not r2.ts, so
  // reset it too — otherwise a `262:es2026` index built from one test's
  // fixture would leak into the next.
  __resetCrossrefCacheForTests();
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

  it("scan never evicts a concurrent caller's hot LRU entry", async () => {
    // The introspection scan full-parses every present snapshot just to
    // report counts. If it populated the capacity-4 specCache, walking
    // the ~24 editions would evict whatever a concurrent clause.get /
    // spec.search had warmed. Here we warm 262/main, then run a scan
    // that also walks all 402 editions — far more sets than the LRU
    // holds under the old getSpec/loadParsedSpec path — and confirm
    // 262/main is still served from cache (zero R2 reads).
    const contents: Record<string, string> = {
      "spec-262-main.json": fakeSpecJson({
        spec: "262",
        edition: "main",
        clauses: { "sec-x": { id: "sec-x" } },
      }),
    };
    for (const ed of [...RELEASED_262_EDITIONS, "main"]) {
      contents[`spec-402-${ed}.json`] = fakeSpecJson({ spec: "402", edition: ed });
    }
    const env = { SPECS: createFakeR2({ contents }) };

    // Warm 262/main into the per-isolate LRU.
    await clauseGet(env, { id: "sec-x", spec: "262", edition: "main" });

    // Run the introspection scan, then isolate the post-scan reads.
    await specAbout(env, "0.1.0");
    asFakeR2(env.SPECS).__reset_counts();

    // 262/main must still be hot: a follow-up clause.get hits the LRU
    // and touches R2 zero times. Under the old path the scan would have
    // evicted it, forcing a re-read here.
    await clauseGet(env, { id: "sec-x", spec: "262", edition: "main" });
    expect(asFakeR2(env.SPECS).__get_count("spec-262-main.json")).toBe(0);
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

// ─── specGrammar ──────────────────────────────────────────────────

describe("specGrammar", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          grammar: [
            { nonterminal: "Statement", rhs: ["BlockStatement"], clause_id: "sec-statements" },
            {
              nonterminal: "BindingIdentifier",
              parameters: ["Yield"],
              rhs: ["Identifier", "yield"],
              clause_id: "sec-identifiers",
            },
            { nonterminal: "SdoAttached", rhs: ["x"], standalone: false },
          ],
        }),
      },
    }),
  });

  it("lists standalone non-terminals by default and echoes spec", async () => {
    const r = await specGrammar(env(), {});
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.spec).toBe("262");
    expect(r.total).toBe(2); // SdoAttached excluded (standalone:false)
  });

  it("returns productions for a non-terminal", async () => {
    const r = await specGrammar(env(), { nonterminal: "BindingIdentifier" });
    if (r.mode !== "by_nonterminal") throw new Error("expected by_nonterminal");
    expect(r.productions[0]!.nonterminal).toBe("BindingIdentifier");
  });

  it("filters by RHS substring with contains", async () => {
    const r = await specGrammar(env(), { contains: "yield" });
    if (r.mode !== "contains") throw new Error("expected contains mode");
    expect(r.total).toBe(1);
  });

  it("returns an empty list when the snapshot predates grammar extraction", async () => {
    // An old snapshot may have no `grammar` key at all; the `?? []` guard
    // must keep it from throwing.
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": JSON.stringify({
            pin: { spec: "262", edition: "es2026", sha: "x" },
            clauses: {},
          }),
        },
      }),
    };
    const r = await specGrammar(env, {});
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.total).toBe(0);
  });
});

// ─── specTables ───────────────────────────────────────────────────

describe("specTables", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          tables: {
            "table-wki": {
              id: "table-wki",
              caption: "Well-Known Intrinsic Objects",
              columns: ["Name"],
              rows: [["%Array%"], ["%Object%"]],
            },
            "table-locale": {
              id: "table-locale",
              caption: "Locale Data",
              columns: ["Key"],
              rows: [["nu"]],
            },
          },
        }),
      },
    }),
  });

  it("fetches a table by id", async () => {
    const r = await specTables(env(), { id: "table-wki" });
    if (r.mode !== "get") throw new Error("expected get mode");
    expect(r.spec).toBe("262");
    expect(r.table!.rows.length).toBe(2);
  });

  it("lists tables when no id is given", async () => {
    const r = await specTables(env(), {});
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.total).toBe(2);
  });

  it("filters the list by caption substring", async () => {
    const r = await specTables(env(), { filter: "locale" });
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.total).toBe(1);
    expect(r.tables[0]!.id).toBe("table-locale");
  });

  it("returns an empty list when the snapshot predates table extraction", async () => {
    // An old snapshot may have no `tables` key at all; the `?? {}` guard
    // must keep it from throwing.
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": JSON.stringify({
            pin: { spec: "262", edition: "es2026", sha: "x" },
            clauses: {},
          }),
        },
      }),
    };
    const r = await specTables(env, {});
    if (r.mode !== "list") throw new Error("expected list mode");
    expect(r.total).toBe(0);
  });
});

// ─── specSdoIndex ─────────────────────────────────────────────────

describe("specSdoIndex", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          clauses: {
            "sec-eval-a": {
              id: "sec-eval-a",
              title: "Evaluation",
              algorithms: [{ production: "BindingIdentifier : Identifier" }],
            },
            "sec-eval-b": {
              id: "sec-eval-b",
              title: "Evaluation",
              algorithms: [{ production: "Statement : BlockStatement" }],
            },
            "sec-prose": { id: "sec-prose", title: "Prose" },
          },
        }),
      },
    }),
  });

  it("indexes by production by default", async () => {
    const r = await specSdoIndex(env(), {});
    expect(r.spec).toBe("262");
    expect(r.by).toBe("production");
    expect(r.pair_count).toBe(2); // sec-prose has no production
    expect(r.group_count).toBe(2);
  });

  it("indexes by sdo title", async () => {
    const r = await specSdoIndex(env(), { by: "sdo" });
    expect(r.by).toBe("sdo");
    expect(r.groups["Evaluation"]!.length).toBe(2);
  });
});

// ─── clauseOutline ────────────────────────────────────────────────

describe("clauseOutline", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          clauses: {
            "sec-7": { id: "sec-7", title: "Abstract Operations", number: "7" },
            "sec-7-1": { id: "sec-7-1", title: "Type Conversion", number: "7.1" },
            "sec-7-1-4": { id: "sec-7-1-4", title: "ToNumber", number: "7.1.4" },
            "sec-8": { id: "sec-8", title: "Executable Code", number: "8" },
          },
        }),
      },
    }),
  });

  it("builds the full section tree and echoes spec", async () => {
    const r = await clauseOutline(env(), {});
    expect(r.spec).toBe("262");
    expect(r.node_count).toBe(4);
    expect(r.roots.map((n) => n.number)).toEqual(["7", "8"]);
    const seven = r.roots.find((n) => n.number === "7")!;
    expect(seven.children[0]!.number).toBe("7.1");
  });

  it("respects depth", async () => {
    const r = await clauseOutline(env(), { depth: 1 });
    expect(r.node_count).toBe(2); // 7, 8 only
  });

  it("scopes to a clause with under", async () => {
    const r = await clauseOutline(env(), { under: "sec-7" });
    expect(r.roots.map((n) => n.number)).toEqual(["7.1"]);
    expect(r.node_count).toBe(2); // 7.1, 7.1.4
  });
});

// ─── specGlobalSearch ─────────────────────────────────────────────

describe("specGlobalSearch", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          clauses: {
            "sec-canon": { id: "sec-canon", aoid: "Canonicalize", title: "Canonicalize ( ch )" },
          },
        }),
        "spec-402-es2026.json": fakeSpecJson({
          spec: "402",
          edition: "es2026",
          clauses: {
            "sec-canon-locale": {
              id: "sec-canon-locale",
              aoid: "CanonicalizeLocaleList",
              title: "CanonicalizeLocaleList ( locales )",
            },
          },
        }),
      },
    }),
  });

  it("returns hits from both specs, tagged and ranked by score", async () => {
    const hits = await specGlobalSearch(env(), { query: "Canonicalize" });
    expect(hits.map((h) => h.spec).sort()).toEqual(["262", "402"]);
    // 262 Canonicalize is aoid-exact (score 100) → ranks first.
    expect(hits[0]!.spec).toBe("262");
    expect(hits[0]!.score).toBe(100);
  });

  it("skips a spec whose snapshot is missing rather than failing", async () => {
    const env262Only = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({
            spec: "262",
            edition: "es2026",
            clauses: {
              "sec-canon": { id: "sec-canon", aoid: "Canonicalize", title: "Canonicalize ( ch )" },
            },
          }),
        },
      }),
    };
    const hits = await specGlobalSearch(env262Only, { query: "Canonicalize" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.spec).toBe("262");
  });
});

// ─── specSnapshots ────────────────────────────────────────────────

describe("specSnapshots", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({ spec: "262", edition: "es2026", sha: "abc262" }),
        "spec-262-main.json": fakeSpecJson({ spec: "262", edition: "main", sha: "main262" }),
        "spec-402-es2026.json": fakeSpecJson({ spec: "402", edition: "es2026", sha: "abc402" }),
        // Historical SHA-pinned copy — must NOT be enumerated.
        "spec-262-main-abc1234567.json": fakeSpecJson({ spec: "262", edition: "main", sha: "old262" }),
      },
    }),
  });

  it("lists live snapshots with pin metadata, sorted, skipping historical pins", async () => {
    const r = await specSnapshots(env(), {});
    expect(r.snapshots.length).toBe(3); // the -abc1234567 historical pin is skipped
    expect(r.snapshots.every((s) => s.live)).toBe(true);
    expect(r.snapshots.map((s) => `${s.spec}/${s.edition}`)).toEqual([
      "262/es2026",
      "262/main",
      "402/es2026",
    ]);
    expect(r.snapshots[0]!.sha).toBe("abc262");
  });

  it("filters by spec and echoes the filter", async () => {
    const r = await specSnapshots(env(), { spec: "402" });
    expect(r.spec_filter).toBe("402");
    expect(r.snapshots.map((s) => s.spec)).toEqual(["402"]);
  });

  it("filters by edition and echoes the filter", async () => {
    const r = await specSnapshots(env(), { edition: "es2026" });
    expect(r.edition_filter).toBe("es2026");
    expect(r.snapshots.map((s) => `${s.spec}/${s.edition}`)).toEqual([
      "262/es2026",
      "402/es2026",
    ]);
  });

  it("returns empty snapshots when R2 is empty", async () => {
    const r = await specSnapshots({ SPECS: createFakeR2() }, {});
    expect(r.snapshots).toEqual([]);
  });

  it("skips a snapshot whose pin has no sha", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-main.json": fakeSpecJson({ spec: "262", edition: "main", sha: "good" }),
          // A pin with no `sha` must be skipped, not emitted as a row
          // with sha: undefined.
          "spec-402-main.json": JSON.stringify({
            pin: { spec: "402", edition: "main" },
            clauses: {},
          }),
        },
      }),
    };
    const r = await specSnapshots(env, {});
    expect(r.snapshots.map((s) => `${s.spec}/${s.edition}`)).toEqual(["262/main"]);
  });
});

// ─── specSymbolResolve ────────────────────────────────────────────

describe("specSymbolResolve", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          clauses: {
            "sec-proto": {
              id: "sec-proto",
              title: "Object Type",
              number: "6.1.7",
              algorithms: [{ steps: [{ text: "The [[Prototype]] internal slot." }] }],
            },
            "sec-unrelated": { id: "sec-unrelated", title: "ToString", number: "7.1.17" },
          },
        }),
      },
    }),
  });

  it("classifies + resolves a notation, echoing notation/kind/name", async () => {
    const r = await specSymbolResolve(env(), { notation: "[[Prototype]]" });
    expect(r.notation).toBe("[[Prototype]]");
    expect(r.kind).toBe("internal-slot");
    expect(r.name).toBe("Prototype");
    expect(r.hits[0]!.id).toBe("sec-proto");
    expect(r.hits[0]!.match_count).toBe(1);
    expect(r.hits.map((h) => h.id)).not.toContain("sec-unrelated");
  });
});

// ─── specWellKnownIntrinsics ──────────────────────────────────────

describe("specWellKnownIntrinsics", () => {
  it("drives from the WKI table when present", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({
            spec: "262",
            edition: "es2026",
            clauses: {
              "sec-array-ctor": { id: "sec-array-ctor", title: "The Array Constructor", number: "23.1.1" },
            },
            tables: {
              "table-well-known-intrinsic-objects": {
                id: "table-well-known-intrinsic-objects",
                caption: "Well-Known Intrinsic Objects",
                columns: ["Intrinsic Name", "Global Name", "ECMAScript Language Association"],
                rows: [["%Array%", "Array", "The Array constructor"]],
              },
            },
          }),
        },
      }),
    };
    const r = await specWellKnownIntrinsics(env, {});
    expect(r.spec).toBe("262");
    expect(r.source).toBe("table");
    expect(r.hits.find((h) => h.name === "Array")!.defining_clause?.id).toBe("sec-array-ctor");
  });

  it("falls back to a heuristic %X% scan when there's no table", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-402-es2026.json": fakeSpecJson({
            spec: "402",
            edition: "es2026",
            clauses: {
              "sec-x": {
                id: "sec-x",
                title: "Some Clause",
                number: "1.1",
                algorithms: [
                  { steps: [{ text: "Mentions %Array.prototype% twice: %Array.prototype%." }] },
                ],
              },
            },
          }),
        },
      }),
    };
    const r = await specWellKnownIntrinsics(env, { spec: "402" });
    expect(r.source).toBe("heuristic");
    expect(r.hits.find((h) => h.name === "Array.prototype")!.mention_count).toBe(2);
  });
});

// ─── specDiff ─────────────────────────────────────────────────────

describe("specDiff", () => {
  const env = () => ({
    SPECS: createFakeR2({
      contents: {
        // `from` defaults to latest → es2026 on 262.
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          clauses: {
            "sec-x": {
              id: "sec-x",
              title: "ToNumber",
              algorithms: [{ steps: [{ text: "Step one." }, { text: "Step two." }] }],
            },
          },
        }),
        // `to` defaults to main.
        "spec-262-main.json": fakeSpecJson({
          spec: "262",
          edition: "main",
          clauses: {
            "sec-x": {
              id: "sec-x",
              title: "ToNumber",
              algorithms: [{ steps: [{ text: "Step one." }, { text: "Step two REWORDED." }] }],
            },
          },
        }),
      },
    }),
  });

  it("diffs a clause across the default from/to editions", async () => {
    const r = await specDiff(env(), { id: "sec-x" });
    expect(r.id).toBe("sec-x");
    expect(r.from).toBe("es2026");
    expect(r.to).toBe("main");
    expect(r.status).toBe("modified");
    expect(r.diffs!.find((d) => d.field === "steps")!.detail).toContain("#2");
  });

  it("reports `added` when the clause is only in the `to` edition", async () => {
    const env2 = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2026.json": fakeSpecJson({ spec: "262", edition: "es2026", clauses: {} }),
          "spec-262-main.json": fakeSpecJson({
            spec: "262",
            edition: "main",
            clauses: { "sec-new": { id: "sec-new", title: "New Clause" } },
          }),
        },
      }),
    };
    const r = await specDiff(env2, { id: "sec-new" });
    expect(r.status).toBe("added");
    expect(r.to_summary?.title).toBe("New Clause");
  });
});

describe("specCrossrefs", () => {
  // sec-bar cites sec-foo via a `Foo(` call site in its step text; the
  // reverse index densifies that into an incoming back-ref on sec-foo.
  const env262 = () => ({
    SPECS: createFakeR2({
      contents: {
        "spec-262-es2026.json": fakeSpecJson({
          spec: "262",
          edition: "es2026",
          clauses: {
            "sec-foo": { id: "sec-foo", aoid: "Foo", title: "Foo", number: "1" },
            "sec-bar": {
              id: "sec-bar",
              aoid: "Bar",
              title: "Bar",
              number: "2",
              algorithms: [{ steps: [{ text: "Let x be Foo(y)." }] }],
            },
          },
        }),
      },
    }),
  });

  it("returns outgoing refs (clauses this one cites), tagged with the spec", async () => {
    const r = await specCrossrefs(env262(), { id: "sec-bar", direction: "out" });
    expect(r.incoming).toBeUndefined();
    expect(r.outgoing?.map((h) => h.id)).toEqual(["sec-foo"]);
    expect(r.outgoing?.[0]?.spec).toBe("262");
  });

  it("returns incoming back-refs densified from step text", async () => {
    const r = await specCrossrefs(env262(), { id: "sec-foo", direction: "in" });
    expect(r.outgoing).toBeUndefined();
    expect(r.incoming?.map((h) => h.id)).toEqual(["sec-bar"]);
  });

  it("direction 'both' populates both; a missing id yields empty arrays", async () => {
    const both = await specCrossrefs(env262(), { id: "sec-foo" });
    expect(both.incoming).toBeDefined();
    expect(both.outgoing).toEqual([]);

    const missing = await specCrossrefs(env262(), { id: "sec-nope", direction: "both" });
    expect(missing.incoming).toEqual([]);
    expect(missing.outgoing).toEqual([]);
  });

  it("include_cross_spec loads the other spec from R2 and tags its hits", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-402-es2026.json": fakeSpecJson({
            spec: "402",
            edition: "es2026",
            clauses: {
              "sec-nf": {
                id: "sec-nf",
                aoid: "InitializeNumberFormat",
                title: "NumberFormat",
                number: "1",
                algorithms: [
                  { steps: [{ text: "Let O be OrdinaryCreateFromConstructor(nf)." }] },
                ],
              },
            },
          }),
          // The other spec, read at its `latest` (es2026) for the
          // cross-spec pass.
          "spec-262-es2026.json": fakeSpecJson({
            spec: "262",
            edition: "es2026",
            clauses: {
              "sec-oc": {
                id: "sec-oc",
                aoid: "OrdinaryCreateFromConstructor",
                title: "OrdinaryCreateFromConstructor",
                number: "10",
              },
            },
          }),
        },
      }),
    };
    const off = await specCrossrefs(env, { id: "sec-nf", spec: "402", direction: "out" });
    expect(off.outgoing?.some((h) => h.spec === "262")).toBe(false);

    const on = await specCrossrefs(env, {
      id: "sec-nf",
      spec: "402",
      direction: "out",
      include_cross_spec: true,
    });
    expect(on.outgoing?.find((h) => h.spec === "262")?.id).toBe("sec-oc");
  });
});
