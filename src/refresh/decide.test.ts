import { describe, it, expect } from "vitest";
import { bumpPatch, decideRefresh } from "./decide.js";

const UPSTREAM = {
  spec_262_main: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  spec_402_main: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  test262: "cccccccccccccccccccccccccccccccccccccccc",
  proposals: "dddddddddddddddddddddddddddddddddddddddd",
};

const FIXED_NOW = () => new Date("2026-05-30T10:00:00.000Z");

describe("bumpPatch", () => {
  it("increments the PATCH segment", () => {
    expect(bumpPatch("0.1.0")).toBe("0.1.1");
    expect(bumpPatch("1.2.42")).toBe("1.2.43");
    expect(bumpPatch("10.20.30")).toBe("10.20.31");
  });

  it("preserves MAJOR + MINOR", () => {
    expect(bumpPatch("5.7.0")).toBe("5.7.1");
  });

  it("throws on non-semver input", () => {
    expect(() => bumpPatch("not-a-version")).toThrow();
    expect(() => bumpPatch("")).toThrow();
  });
});

describe("decideRefresh — fresh-start (no sentinel)", () => {
  it("triggers a refresh when last is null", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: null,
      current_version: "0.1.0",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true);
    expect(d.moved).toEqual({
      spec_262_main: true,
      spec_402_main: true,
      test262: true,
      proposals: true,
    });
    expect(d.next_version).toBe("0.1.1");
    expect(d.new_sentinel.version).toBe("0.1.1");
    expect(d.new_sentinel.refreshed_at).toBe("2026-05-30T10:00:00.000Z");
    expect(d.new_sentinel.specs).toEqual({
      "262/main": UPSTREAM.spec_262_main,
      "402/main": UPSTREAM.spec_402_main,
    });
  });
});

describe("decideRefresh — nothing moved", () => {
  it("does not refresh when every SHA matches", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        version: "0.1.5",
        specs: {
          "262/main": UPSTREAM.spec_262_main,
          "402/main": UPSTREAM.spec_402_main,
        },
        test262: UPSTREAM.test262,
        proposals: UPSTREAM.proposals,
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(false);
    // When there's no refresh, next_version mirrors current.
    expect(d.next_version).toBe("0.1.5");
    for (const k of Object.keys(d.moved) as (keyof typeof d.moved)[]) {
      expect(d.moved[k]).toBe(false);
    }
  });
});

describe("decideRefresh — single SHA moved", () => {
  it("triggers a refresh on 262/main movement only", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        version: "0.1.5",
        specs: {
          "262/main": "ffffffffffffffffffffffffffffffffffffffff", // different
          "402/main": UPSTREAM.spec_402_main,
        },
        test262: UPSTREAM.test262,
        proposals: UPSTREAM.proposals,
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true);
    expect(d.moved.spec_262_main).toBe(true);
    expect(d.moved.spec_402_main).toBe(false);
    expect(d.moved.test262).toBe(false);
    expect(d.moved.proposals).toBe(false);
    expect(d.next_version).toBe("0.1.6");
  });

  it("triggers a refresh on test262 movement only", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        version: "0.1.5",
        specs: {
          "262/main": UPSTREAM.spec_262_main,
          "402/main": UPSTREAM.spec_402_main,
        },
        test262: "ffffffffffffffffffffffffffffffffffffffff",
        proposals: UPSTREAM.proposals,
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true);
    expect(d.moved.test262).toBe(true);
    expect(d.next_version).toBe("0.1.6");
  });
});

describe("decideRefresh — multiple SHAs moved", () => {
  it("still bumps PATCH only once (not per-SHA)", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        version: "0.1.5",
        specs: {
          "262/main": "ffffffffffffffffffffffffffffffffffffffff",
          "402/main": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        },
        test262: "dddddddddddddddddddddddddddddddddddddddd",
        proposals: "cccccccccccccccccccccccccccccccccccccccc",
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true);
    expect(d.moved.spec_262_main).toBe(true);
    expect(d.moved.spec_402_main).toBe(true);
    expect(d.moved.test262).toBe(true);
    expect(d.moved.proposals).toBe(true);
    // Multiple movements still produce ONE patch bump, not four.
    expect(d.next_version).toBe("0.1.6");
  });
});

describe("decideRefresh — sentinel write", () => {
  it("writes the new sentinel with current upstream SHAs (not last)", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        version: "0.1.5",
        specs: {
          "262/main": "old-262",
          "402/main": "old-402",
        },
        test262: "old-test262",
        proposals: "old-proposals",
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.new_sentinel.specs!["262/main"]).toBe(UPSTREAM.spec_262_main);
    expect(d.new_sentinel.test262).toBe(UPSTREAM.test262);
  });

  it("stamps refreshed_at with the supplied `now`", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: null,
      current_version: "0.1.0",
      now: () => new Date("2030-01-15T08:30:00.000Z"),
    });
    expect(d.new_sentinel.refreshed_at).toBe("2030-01-15T08:30:00.000Z");
  });
});
