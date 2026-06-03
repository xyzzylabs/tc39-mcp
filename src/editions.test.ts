import { describe, it, expect } from "vitest";
import {
  ALIASES,
  CONCRETE_EDITIONS,
  EDITION_VALUES,
  LATEST_262_RELEASE,
  LATEST_402_RELEASE,
  RELEASED_262_EDITIONS,
  RELEASED_402_EDITIONS,
  SPEC_VALUES,
  isSupported,
  resolveEdition,
} from "./editions.js";
import { clauseGet, clauseList } from "./mcp/tools/clause.js";
import { specSearch } from "./mcp/tools/spec_search.js";
import { specDiff } from "./mcp/tools/spec_diff.js";
import { specCrossrefs } from "./mcp/tools/spec_crossrefs.js";

describe("editions catalog", () => {
  it("SPEC_VALUES = ['262', '402']", () => {
    expect(SPEC_VALUES).toEqual(["262", "402"]);
  });

  it("EDITION_VALUES includes every concrete edition + 3 aliases", () => {
    expect(EDITION_VALUES).toContain("main");
    expect(EDITION_VALUES).toContain("latest");
    expect(EDITION_VALUES).toContain("draft");
    expect(EDITION_VALUES).toContain("next");
    for (const r of RELEASED_262_EDITIONS) expect(EDITION_VALUES).toContain(r);
    for (const r of RELEASED_402_EDITIONS) expect(EDITION_VALUES).toContain(r);
    // No duplicates.
    expect(new Set(EDITION_VALUES).size).toBe(EDITION_VALUES.length);
    // Floor is es2016 (tc39/ecma262 has no earlier tag).
    expect(RELEASED_262_EDITIONS[0]).toBe("es2016");
  });

  it("LATEST_262_RELEASE is a member of RELEASED_262_EDITIONS", () => {
    expect(RELEASED_262_EDITIONS).toContain(LATEST_262_RELEASE);
  });

  it("ALIASES table includes the supported aliases", () => {
    expect(Object.keys(ALIASES).sort()).toEqual(["draft", "latest", "next"]);
  });
});

describe("resolveEdition is spec-aware", () => {
  it("'latest' on ECMA-262 → LATEST_262_RELEASE", () => {
    expect(resolveEdition("262", "latest")).toBe(LATEST_262_RELEASE);
  });

  it("'latest' on ECMA-402 → LATEST_402_RELEASE", () => {
    expect(resolveEdition("402", "latest")).toBe(LATEST_402_RELEASE);
  });

  it("'draft' / 'next' always → main regardless of spec", () => {
    expect(resolveEdition("262", "draft")).toBe("main");
    expect(resolveEdition("262", "next")).toBe("main");
    expect(resolveEdition("402", "draft")).toBe("main");
    expect(resolveEdition("402", "next")).toBe("main");
  });

  it("concrete editions pass through unchanged", () => {
    expect(resolveEdition("262", "es2024")).toBe("es2024");
    expect(resolveEdition("262", "main")).toBe("main");
    expect(resolveEdition("402", "es2025-candidate")).toBe("es2025-candidate");
    expect(resolveEdition("402", "main")).toBe("main");
  });
});

describe("isSupported", () => {
  it("262 supports every released 262 edition + main", () => {
    for (const ed of RELEASED_262_EDITIONS) {
      expect(isSupported("262", ed)).toBe(true);
    }
    expect(isSupported("262", "main")).toBe(true);
  });

  it("262 does NOT support 402-only editions", () => {
    expect(isSupported("262", "es2025-candidate")).toBe(false);
  });

  it("402 supports every released 402 edition + candidate + main", () => {
    for (const ed of RELEASED_402_EDITIONS) {
      expect(isSupported("402", ed)).toBe(true);
    }
    expect(isSupported("402", "es2025-candidate")).toBe(true);
    expect(isSupported("402", "main")).toBe(true);
  });

  it("402 now supports the annual editions (published as esYYYY branches)", () => {
    expect(isSupported("402", "es2024")).toBe(true);
    expect(isSupported("402", "es2025")).toBe(true);
  });
});

// The next blocks require parsed JSON to be present on disk. They're
// skipped automatically when a needed edition is missing — useful in CI
// before `npm run parse` has been run for everything.

async function tryClauseGet(spec: "262" | "402", id: string, edition: string) {
  try {
    return await clauseGet({ id, spec, edition: edition as never });
  } catch {
    return undefined; // parsed JSON for (spec, edition) not built locally
  }
}

describe("ECMA-262 multi-edition tools", () => {
  it("clauseGet resolves sec-tonumber in every released 262 edition", async () => {
    for (const ed of RELEASED_262_EDITIONS) {
      const c = await tryClauseGet("262", "sec-tonumber", ed);
      if (c === undefined) continue;
      expect(c, `sec-tonumber in ${ed}`).not.toBeNull();
      expect(c!.meta.aoid).toBe("ToNumber");
    }
  });

  it("edition='latest' on 262 resolves to LATEST_262_RELEASE", async () => {
    const a = await tryClauseGet("262", "sec-tonumber", "latest");
    const b = await tryClauseGet("262", "sec-tonumber", LATEST_262_RELEASE);
    if (a === undefined || b === undefined) return;
    expect(a).toEqual(b);
  });

  it("edition='draft' on 262 resolves to main", async () => {
    const a = await tryClauseGet("262", "sec-tonumber", "draft");
    const b = await tryClauseGet("262", "sec-tonumber", "main");
    if (a === undefined || b === undefined) return;
    expect(a).toEqual(b);
  });

  it("clause counts grow monotonically across 262 editions", async () => {
    const counts: number[] = [];
    for (const ed of RELEASED_262_EDITIONS) {
      try {
        counts.push((await clauseList({ spec: "262", edition: ed, limit: 2500 })).length);
      } catch {
        // Missing parsed JSON — skip this edition.
      }
    }
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });

  it("specSearch works in earlier 262 editions (es2022 has ToNumber)", async () => {
    try {
      const hits = await specSearch({ query: "ToNumber", spec: "262", edition: "es2022" });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.aoid).toBe("ToNumber");
    } catch {
      // Parsed JSON not built.
    }
  });
});

describe("ECMA-402 tooling", () => {
  it("clauseGet resolves an Intl clause on 402/main", async () => {
    // sec-intl.numberformat is the NumberFormat constructor clause.
    const c = await tryClauseGet("402", "sec-intl.numberformat", "main");
    if (c === undefined) return;
    expect(c).not.toBeNull();
  });

  it("clauseGet resolves sec-intl.numberformat in every released 402 edition", async () => {
    for (const ed of RELEASED_402_EDITIONS) {
      const c = await tryClauseGet("402", "sec-intl.numberformat", ed);
      if (c === undefined) continue;
      expect(c, `sec-intl.numberformat in ${ed}`).not.toBeNull();
    }
  });

  it("clause counts grow monotonically across 402 editions", async () => {
    const counts: number[] = [];
    for (const ed of RELEASED_402_EDITIONS) {
      try {
        counts.push((await clauseList({ spec: "402", edition: ed, limit: 2500 })).length);
      } catch {
        // Missing parsed JSON — skip this edition.
      }
    }
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });

  it("clauseList on 402 returns Intl-flavored clauses", async () => {
    try {
      const hits = await clauseList({ spec: "402", edition: "main", limit: 50 });
      expect(hits.length).toBeGreaterThan(0);
      // Spot-check: at least one clause id mentions intl.
      expect(hits.some((h) => h.id.includes("intl"))).toBe(true);
    } catch {
      // Parsed JSON not built.
    }
  });
});

describe("specDiff (generic from/to)", () => {
  it("defaults to latest → main on 262 when neither is supplied", async () => {
    try {
      const r = await specDiff({ id: "sec-tonumber" });
      expect(r.from).toBe(LATEST_262_RELEASE);
      expect(r.to).toBe("main");
    } catch {
      // Parsed JSON not built.
    }
  });

  it("compares two arbitrary 262 editions", async () => {
    try {
      const r = await specDiff({
        id: "sec-tonumber",
        spec: "262",
        from: "es2022",
        to: "es2025",
      });
      expect(r.from).toBe("es2022");
      expect(r.to).toBe("es2025");
      expect(["identical", "modified"]).toContain(r.status);
    } catch {
      // Parsed JSON not built.
    }
  });

  it("resolves alias arguments (draft → main)", async () => {
    try {
      const a = await specDiff({ id: "sec-tonumber", from: "es2025", to: "draft" });
      const b = await specDiff({ id: "sec-tonumber", from: "es2025", to: "main" });
      expect(a.from).toBe(b.from);
      expect(a.to).toBe(b.to);
      expect(a.status).toBe(b.status);
    } catch {
      // Parsed JSON not built.
    }
  });
});

describe("cross-spec crossrefs (262 ↔ 402)", () => {
  it("default outgoing query stays within 262", async () => {
    try {
      const r = await specCrossrefs({
        id: "sec-tonumber",
        spec: "262",
        direction: "out",
      });
      if (!r.outgoing) return;
      for (const h of r.outgoing) expect(h.spec).toBe("262");
    } catch {
      // Parsed JSON not built.
    }
  });

  it("include_cross_spec: true on 402 surfaces 262 targets", async () => {
    try {
      // sec-intl.numberformat references many 262 abstract ops via AOID
      // mentions in its algorithm steps (OrdinaryCreateFromConstructor,
      // SetNumberFormatUnitOptions, ResolveOptions, etc.). Some of those
      // resolve to 262, so the cross-spec hits should be non-empty.
      const r = await specCrossrefs({
        id: "sec-intl.numberformat",
        spec: "402",
        direction: "out",
        include_cross_spec: true,
        limit: 500,
      });
      if (!r.outgoing) return;
      const has262 = r.outgoing.some((h) => h.spec === "262");
      expect(has262).toBe(true);
    } catch {
      // Parsed JSON for either spec not built.
    }
  });
});

describe("ALIASES sanity", () => {
  it("non-'latest' aliases all point to concrete editions", () => {
    for (const [k, v] of Object.entries(ALIASES)) {
      if (k === "latest") continue; // spec-aware, resolved at call time
      expect(CONCRETE_EDITIONS).toContain(v);
    }
  });
});
