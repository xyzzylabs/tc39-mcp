import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetCachesForTests,
  loadParsedSpec,
  loadProposalsIndex,
  loadTest262Index,
  listSnapshots,
} from "./r2.js";

// Module-level caches in r2.ts persist across imports; reset before
// each test so we exercise cold-load behavior in isolation.
beforeEach(() => {
  __resetCachesForTests();
});
import {
  asFakeR2,
  createFakeR2,
  fakeProposalsIndexJson,
  fakeSpecJson,
  fakeTest262IndexJson,
} from "./__fixtures__/fakeR2.js";

// r2.ts uses module-level caches keyed on the import. To get clean
// state per test we re-import via `vi.resetModules()` would normally
// be needed; instead we structure tests to use distinct (spec, edition)
// keys per test so cache effects are observable but localized.

describe("loadParsedSpec", () => {
  it("returns the parsed JSON from R2", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2016.json": fakeSpecJson({
            spec: "262",
            edition: "es2016",
            clauses: { "sec-x": { id: "sec-x", title: "X" } },
          }),
        },
      }),
    };
    const p = await loadParsedSpec(env, "262", "es2016");
    expect(p.pin.spec).toBe("262");
    expect(p.pin.edition).toBe("es2016");
    expect(Object.keys(p.clauses)).toEqual(["sec-x"]);
  });

  it("caches the result — second call doesn't hit R2 again", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-es2017.json": fakeSpecJson({ spec: "262", edition: "es2017" }),
        },
      }),
    };
    await loadParsedSpec(env, "262", "es2017");
    await loadParsedSpec(env, "262", "es2017");
    await loadParsedSpec(env, "262", "es2017");
    // The fake R2 counts get() calls per key.
    expect(asFakeR2(env.SPECS).__get_count("spec-262-es2017.json")).toBe(1);
  });

  it("throws a clear error when the object is missing", async () => {
    const env = { SPECS: createFakeR2() }; // empty
    await expect(loadParsedSpec(env, "262", "es2018")).rejects.toThrow(
      /Missing parsed spec object in R2/,
    );
  });

  it("includes the key name in the missing-object error", async () => {
    const env = { SPECS: createFakeR2() };
    await expect(loadParsedSpec(env, "402", "main")).rejects.toThrow(
      /spec-402-main\.json/,
    );
  });
});

describe("loadTest262Index", () => {
  it("returns the parsed index when present", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "test262-index.json": fakeTest262IndexJson({ sha: "abc1234", testCount: 5 }),
        },
      }),
    };
    const idx = await loadTest262Index(env);
    expect(idx).not.toBeNull();
    expect(idx!.test262_sha).toBe("abc1234");
    expect(idx!.tests.length).toBe(5);
  });

  it("returns null when the index is missing", async () => {
    const env = { SPECS: createFakeR2() };
    const idx = await loadTest262Index(env);
    expect(idx).toBeNull();
  });

  it("returns null when the index JSON is malformed", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: { "test262-index.json": "not valid json" },
      }),
    };
    const idx = await loadTest262Index(env);
    expect(idx).toBeNull();
  });
});

describe("loadProposalsIndex", () => {
  it("returns the parsed index when present", async () => {
    const env = {
      SPECS: createFakeR2({
        contents: {
          "proposals-index.json": fakeProposalsIndexJson({
            sha: "feed1234",
            proposals: [
              { slug: "temporal", name: "Temporal", stage: "3" },
            ],
          }),
        },
      }),
    };
    const idx = await loadProposalsIndex(env);
    expect(idx).not.toBeNull();
    expect(idx!.proposals_sha).toBe("feed1234");
    expect(idx!.proposals.length).toBe(1);
  });

  it("returns null when the index is missing", async () => {
    const env = { SPECS: createFakeR2() };
    expect(await loadProposalsIndex(env)).toBeNull();
  });
});

describe("listSnapshots", () => {
  let env: { SPECS: ReturnType<typeof createFakeR2> };

  beforeEach(() => {
    env = {
      SPECS: createFakeR2({
        contents: {
          "spec-262-main.json": fakeSpecJson({ spec: "262", edition: "main" }),
          "spec-262-es2025.json": fakeSpecJson({ spec: "262", edition: "es2025" }),
          "spec-402-main.json": fakeSpecJson({ spec: "402", edition: "main" }),
          // Non-snapshot files should be excluded by the prefix.
          "test262-index.json": fakeTest262IndexJson({ sha: "x" }),
        },
      }),
    };
  });

  it("returns keys with the spec- prefix only", async () => {
    const keys = await listSnapshots(env);
    expect(keys.sort()).toEqual([
      "spec-262-es2025.json",
      "spec-262-main.json",
      "spec-402-main.json",
    ]);
    expect(keys).not.toContain("test262-index.json");
  });

  it("caches list results inside the TTL window", async () => {
    // Two consecutive calls should produce only one underlying list().
    asFakeR2(env.SPECS).__reset_counts();
    await listSnapshots(env);
    await listSnapshots(env);
    expect(asFakeR2(env.SPECS).__list_count()).toBe(1);
  });
});
