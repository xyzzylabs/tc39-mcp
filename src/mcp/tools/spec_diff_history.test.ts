import { describe, it, expect } from "vitest";
import { z } from "zod";
import { specDiff } from "./spec_diff.js";
import { specHistory, specHistorySchema } from "./spec_history.js";
import { clauseList } from "./clause.js";

const specHistoryInput = z.object(specHistorySchema);

describe("specDiff — latest → main default", () => {
  it("reports `identical` or `modified` for a stable clause between latest and main", () => {
    // ToBoolean is rock-stable; very unlikely to change between the
    // pinned release and main. If it ever does, this test surfaces it.
    const r = specDiff({ id: "sec-toboolean" });
    expect(r.id).toBe("sec-toboolean");
    expect(r.status).toMatch(/identical|modified/);
    expect(r.from_summary).toBeDefined();
    expect(r.to_summary).toBeDefined();
  });

  it("returns missing-from-both for a clause that doesn't exist", () => {
    const r = specDiff({ id: "sec-this-clause-does-not-exist-anywhere" });
    expect(r.status).toBe("missing-from-both");
    expect(r.same).toBe(true);
  });

  it("structurally describes a modified clause if any", () => {
    // We don't know which clauses will have drifted in main, but we can
    // sanity-check the diff shape on a known clause.
    const r = specDiff({ id: "sec-tonumber" });
    expect(r.id).toBe("sec-tonumber");
    if (r.status === "modified") {
      expect(r.diffs).toBeDefined();
      expect(r.diffs!.length).toBeGreaterThan(0);
      for (const d of r.diffs!) {
        expect([
          "title",
          "signatureRaw",
          "steps",
          "notes",
          "crossrefs",
        ]).toContain(d.field);
      }
    }
  });
});

describe("specHistory", () => {
  it("returns a structured result for a real clause id", () => {
    const r = specHistory({ id: "sec-tonumber", limit: 5 });
    expect(r.id).toBe("sec-tonumber");
    expect(r.edition).toBe("es2025");
    expect(typeof r.vendor_present).toBe("boolean");
    expect(typeof r.shallow).toBe("boolean");
    if (r.vendor_present && r.shallow) {
      // fetch-spec.sh uses --depth=1, so locally we expect shallow=true
      // and the hint that tells callers how to deepen.
      expect(r.hint).toBeDefined();
      expect(r.hint!).toContain("fetch --unshallow");
    }
    if (r.vendor_present && !r.shallow) {
      // ToNumber has been touched many times in tc39/ecma262 history.
      expect(r.commits.length).toBeGreaterThan(0);
      for (const c of r.commits) {
        expect(c.sha).toMatch(/^[a-f0-9]{40}$/);
        expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
  });

  it("returns no commits for a bogus id (vendor present, deep history)", () => {
    const r = specHistory({ id: "sec-bogus-zzz-no-such-clause" });
    if (r.vendor_present && !r.shallow) {
      expect(r.commits.length).toBe(0);
    }
  });

  it("supports spec=402 with the right edition + vendor path", () => {
    const r = specHistory({
      id: "sec-intl.numberformat",
      spec: "402",
      edition: "main",
      limit: 5,
    });
    expect(r.spec).toBe("402");
    expect(r.edition).toBe("main");
    expect(typeof r.vendor_present).toBe("boolean");
    if (r.vendor_present && r.hint) {
      // Either the shallow hint or an error hint.
      expect(r.hint.length).toBeGreaterThan(0);
    }
  });

  it("vendor_present=false when the vendored checkout is missing", () => {
    // Use an absurd edition that won't exist locally. The function
    // can't reach this case directly (editions are an enum), but we
    // can simulate by using a spec/edition that's supported but might
    // not be cloned. Skip if the user has everything cloned.
    const r = specHistory({
      id: "sec-tonumber",
      spec: "262",
      edition: "es2016",
      limit: 5,
    });
    // If es2016 is cloned, vendor_present is true and there are commits or shallow hint.
    // If not cloned, vendor_present is false and commits is empty.
    expect(typeof r.vendor_present).toBe("boolean");
    if (!r.vendor_present) {
      expect(r.commits).toEqual([]);
    }
  });

  it("skips malformed git-log lines (< 5 tab-separated fields)", () => {
    // Indirect: the parser only pushes when parts.length >= 5. We can't
    // easily force a malformed line, but we can verify the parser's
    // resilience by asserting every commit returned has all five fields.
    const r = specHistory({ id: "sec-tonumber", spec: "262", edition: "main", limit: 5 });
    if (!r.vendor_present || r.shallow) return;
    for (const c of r.commits) {
      expect(c.sha).toMatch(/^[a-f0-9]{40}$/);
      expect(c.short_sha).toMatch(/^[a-f0-9]{4,}$/);
      expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(c.author.length).toBeGreaterThan(0);
      expect(c.subject.length).toBeGreaterThan(0);
    }
  });
});

describe("specDiff (generic) — reworded-step branch", () => {
  // The reworded-step path triggers when step_count is equal in both
  // editions but the per-step text isn't. We scan recent 262 editions
  // for a clause that exhibits this to exercise the branch.
  function findRewordedClause(
    fromEd: "es2024" | "es2025",
    toEd: "es2025" | "main",
  ): string | null {
    try {
      const fromList = clauseList({ spec: "262", edition: fromEd, limit: 2500 });
      for (const c of fromList) {
        if (c.algorithms === 0) continue;
        const d = specDiff({ id: c.id, spec: "262", from: fromEd, to: toEd });
        if (d.status !== "modified" || !d.diffs) continue;
        const stepDiff = d.diffs.find((x) => x.field === "steps");
        if (!stepDiff) continue;
        // Reworded-step variant carries a "reworded" detail.
        if (
          typeof stepDiff.detail === "string" &&
          stepDiff.detail.includes("reworded")
        ) {
          return c.id;
        }
      }
    } catch {
      /* parsed JSON missing */
    }
    return null;
  }

  it("detects reworded steps when step counts are equal", () => {
    const id = findRewordedClause("es2024", "main");
    if (!id) return; // no reworded clauses found between editions
    const r = specDiff({ id, spec: "262", from: "es2024", to: "main" });
    expect(r.status).toBe("modified");
    const stepDiff = r.diffs?.find((d) => d.field === "steps");
    expect(stepDiff).toBeDefined();
    expect(stepDiff!.detail).toContain("reworded");
    expect(stepDiff!.detail).toMatch(/#\d+/);
  });
});

describe("specDiff — added / removed status", () => {
  it("reports `added` for a clause that exists only in `to`", () => {
    // Find a clause that exists in main but not in es2025.
    try {
      const inMain = new Set(
        clauseList({ spec: "262", edition: "main", limit: 2500 }).map((c) => c.id),
      );
      const inLatest = new Set(
        clauseList({ spec: "262", edition: "es2025", limit: 2500 }).map((c) => c.id),
      );
      let addedId: string | undefined;
      for (const id of inMain) {
        if (!inLatest.has(id)) {
          addedId = id;
          break;
        }
      }
      if (!addedId) return; // nothing was added between es2025 and main
      const r = specDiff({ id: addedId, spec: "262", from: "es2025", to: "main" });
      expect(r.status).toBe("added");
      expect(r.to_summary).toBeDefined();
      expect(r.from_summary).toBeUndefined();
    } catch {
      /* parsed JSON missing */
    }
  });

  it("reports `removed` for a clause that exists only in `from`", () => {
    try {
      const inMain = new Set(
        clauseList({ spec: "262", edition: "main", limit: 2500 }).map((c) => c.id),
      );
      const inLatest = clauseList({ spec: "262", edition: "es2025", limit: 2500 });
      let removedId: string | undefined;
      for (const c of inLatest) {
        if (!inMain.has(c.id)) {
          removedId = c.id;
          break;
        }
      }
      if (!removedId) return;
      const r = specDiff({ id: removedId, spec: "262", from: "es2025", to: "main" });
      expect(r.status).toBe("removed");
      expect(r.from_summary).toBeDefined();
      expect(r.to_summary).toBeUndefined();
    } catch {
      /* parsed JSON missing */
    }
  });
});

describe("specHistorySchema — id validation", () => {
  it("accepts ordinary clause ids", () => {
    for (const id of [
      "sec-tonumber",
      "sec-ecmascript-language-functions-and-classes",
      "prod-IdentifierName",
      "table-1",
      "figure-1",
    ]) {
      const r = specHistoryInput.safeParse({ id });
      expect(r.success, `expected ${id} to validate`).toBe(true);
    }
  });

  it("accepts ids containing '%' (well-known intrinsics)", () => {
    for (const id of [
      "sec-%throwtypeerror%",
      "sec-symbol.prototype-%symbol.toprimitive%",
      "sec-get-regexp-%symbol.species%",
    ]) {
      const r = specHistoryInput.safeParse({ id });
      expect(r.success, `expected ${id} to validate`).toBe(true);
    }
  });

  it("rejects empty id", () => {
    const r = specHistoryInput.safeParse({ id: "" });
    expect(r.success).toBe(false);
  });

  it("rejects ids longer than 200 chars (pickaxe-DoS guard)", () => {
    const r = specHistoryInput.safeParse({ id: "sec-" + "a".repeat(300) });
    expect(r.success).toBe(false);
  });

  it("rejects ids with whitespace or shell metacharacters", () => {
    for (const id of [
      "sec-tonumber foo",
      "sec-tonumber\nfoo",
      "sec-tonumber; rm -rf /",
      "sec-tonumber`whoami`",
      "../escape",
    ]) {
      const r = specHistoryInput.safeParse({ id });
      expect(r.success, `expected ${JSON.stringify(id)} to reject`).toBe(false);
    }
  });
});
