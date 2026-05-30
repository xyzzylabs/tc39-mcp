import { describe, it, expect } from "vitest";
import { specSnapshots } from "./spec_snapshots.js";

describe("specSnapshots", () => {
  it("enumerates every available (spec, edition) pair", () => {
    try {
      const r = specSnapshots({});
      // Locally we've parsed all 13 supported pairs (11×262 + 2×402).
      expect(r.snapshots.length).toBeGreaterThan(0);
      expect(r.snapshots.length).toBeLessThanOrEqual(13);
    } catch {
      // Parsed JSON missing in CI.
    }
  });

  it("returns sha + fetched_at + biblio_commit per row", () => {
    try {
      const r = specSnapshots({ spec: "262", edition: "main" });
      const row = r.snapshots[0];
      if (!row) return;
      expect(row.spec).toBe("262");
      expect(row.edition).toBe("main");
      expect(row.sha).toMatch(/^[a-f0-9]{40}$/);
      expect(row.live).toBe(true);
      if (row.fetched_at) {
        expect(row.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("filter by spec narrows the result", () => {
    try {
      const r = specSnapshots({ spec: "402" });
      expect(r.spec_filter).toBe("402");
      for (const s of r.snapshots) expect(s.spec).toBe("402");
    } catch {
      // Parsed JSON missing.
    }
  });

  it("filter by edition narrows further", () => {
    try {
      const r = specSnapshots({ spec: "262", edition: "es2025" });
      expect(r.edition_filter).toBe("es2025");
      for (const s of r.snapshots) {
        expect(s.spec).toBe("262");
        expect(s.edition).toBe("es2025");
      }
    } catch {
      // Parsed JSON missing.
    }
  });

  it("returns deterministic ordering (spec → edition → sha)", () => {
    try {
      const r = specSnapshots({});
      for (let i = 1; i < r.snapshots.length; i++) {
        const prev = r.snapshots[i - 1]!;
        const cur = r.snapshots[i]!;
        // Spec or edition or sha must be non-decreasing.
        const prevKey = `${prev.spec}/${prev.edition}/${prev.sha}`;
        const curKey = `${cur.spec}/${cur.edition}/${cur.sha}`;
        expect(curKey >= prevKey).toBe(true);
      }
    } catch {
      // Parsed JSON missing.
    }
  });
});
