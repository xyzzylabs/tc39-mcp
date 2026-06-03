import { describe, it, expect } from "vitest";
import { bumpPatch, decideRefresh } from "./decide.js";

const UPSTREAM = {
  spec_262_main: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  spec_402_main: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  spec_402_latest: "9999999999999999999999999999999999999999",
  test262: "cccccccccccccccccccccccccccccccccccccccc",
  proposals: "dddddddddddddddddddddddddddddddddddddddd",
};

const FIXED_NOW = () => new Date("2026-05-30T10:00:00.000Z");
// Relative to FIXED_NOW: 10 days ago (within the 30-day window) and
// 59 days ago (past it).
const RECENT_PUBLISH = "2026-05-20T10:00:00.000Z";
const STALE_PUBLISH = "2026-04-01T10:00:00.000Z";

/** A sentinel whose SHAs all match UPSTREAM (so nothing has moved),
 *  with a configurable last publish time. */
function matchingSentinel(lastPublishAt?: string) {
  return {
    ...(lastPublishAt
      ? { last_npm_publish: { version: "0.1.5", at: lastPublishAt } }
      : {}),
    specs: {
      "262/main": UPSTREAM.spec_262_main,
      "402/main": UPSTREAM.spec_402_main,
      "402/latest": UPSTREAM.spec_402_latest,
    },
    test262: UPSTREAM.test262,
    proposals: UPSTREAM.proposals,
  };
}

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
  it("refreshes and publishes when last is null", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: null,
      current_version: "0.1.0",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true);
    // Never published → the monthly gate is open.
    expect(d.should_publish).toBe(true);
    expect(d.moved).toEqual({
      spec_262_main: true,
      spec_402_main: true,
      spec_402_latest: true,
      test262: true,
      proposals: true,
    });
    expect(d.next_version).toBe("0.1.1");
    expect(d.new_sentinel.last_npm_publish).toEqual({
      version: "0.1.1",
      at: "2026-05-30T10:00:00.000Z",
    });
    expect(d.new_sentinel.refreshed_at).toBe("2026-05-30T10:00:00.000Z");
    expect(d.new_sentinel.specs).toEqual({
      "262/main": UPSTREAM.spec_262_main,
      "402/main": UPSTREAM.spec_402_main,
      "402/latest": UPSTREAM.spec_402_latest,
    });
  });
});

describe("decideRefresh — nothing moved", () => {
  it("neither refreshes nor publishes when every SHA matches", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: matchingSentinel(RECENT_PUBLISH),
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(false);
    expect(d.should_publish).toBe(false);
    expect(d.next_version).toBe("0.1.5");
    for (const k of Object.keys(d.moved) as (keyof typeof d.moved)[]) {
      expect(d.moved[k]).toBe(false);
    }
  });
});

describe("decideRefresh — current 402 release branch drifts", () => {
  it("refreshes when only 402/latest moved (the branch took editorial commits)", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        last_npm_publish: { version: "0.1.5", at: RECENT_PUBLISH },
        specs: {
          "262/main": UPSTREAM.spec_262_main,
          "402/main": UPSTREAM.spec_402_main,
          "402/latest": "0000000000000000000000000000000000000000", // moved
        },
        test262: UPSTREAM.test262,
        proposals: UPSTREAM.proposals,
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true);
    expect(d.moved.spec_402_latest).toBe(true);
    expect(d.moved.spec_262_main).toBe(false);
    expect(d.moved.spec_402_main).toBe(false);
    // R2 refreshes, but a branch tweak alone doesn't re-bake the npm
    // bundle inside the monthly window.
    expect(d.should_publish).toBe(false);
    expect(d.new_sentinel.specs!["402/latest"]).toBe(UPSTREAM.spec_402_latest);
  });
});

describe("decideRefresh — moved, but published recently (< 30 days)", () => {
  it("refreshes R2 but does NOT re-bake the npm bundle", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        last_npm_publish: { version: "0.1.5", at: RECENT_PUBLISH },
        specs: {
          "262/main": "ffffffffffffffffffffffffffffffffffffffff", // moved
          "402/main": UPSTREAM.spec_402_main,
          "402/latest": UPSTREAM.spec_402_latest,
        },
        test262: UPSTREAM.test262,
        proposals: UPSTREAM.proposals,
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true); // R2 still refreshes
    expect(d.should_publish).toBe(false); // bundle stays put
    expect(d.next_version).toBe("0.1.5"); // no bump
    // The sentinel records the new SHA + refreshed_at, but carries the
    // previous publish marker forward unchanged.
    expect(d.new_sentinel.specs!["262/main"]).toBe(UPSTREAM.spec_262_main);
    expect(d.new_sentinel.last_npm_publish).toEqual({
      version: "0.1.5",
      at: RECENT_PUBLISH,
    });
  });
});

describe("decideRefresh — moved, last publish is stale (≥ 30 days)", () => {
  it("refreshes AND re-bakes the npm bundle", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        last_npm_publish: { version: "0.1.5", at: STALE_PUBLISH },
        specs: {
          "262/main": "ffffffffffffffffffffffffffffffffffffffff",
          "402/main": UPSTREAM.spec_402_main,
          "402/latest": UPSTREAM.spec_402_latest,
        },
        test262: UPSTREAM.test262,
        proposals: UPSTREAM.proposals,
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true);
    expect(d.should_publish).toBe(true);
    expect(d.next_version).toBe("0.1.6");
    expect(d.new_sentinel.last_npm_publish).toEqual({
      version: "0.1.6",
      at: "2026-05-30T10:00:00.000Z",
    });
  });

  it("exactly 30 days counts as due", () => {
    const thirtyDaysAgo = "2026-04-30T10:00:00.000Z";
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        last_npm_publish: { version: "0.1.5", at: thirtyDaysAgo },
        specs: { "262/main": "moved", "402/main": UPSTREAM.spec_402_main, "402/latest": UPSTREAM.spec_402_latest },
        test262: UPSTREAM.test262,
        proposals: UPSTREAM.proposals,
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.should_publish).toBe(true);
  });
});

describe("decideRefresh — multiple SHAs moved", () => {
  it("still bumps PATCH only once (not per-SHA) when due", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        last_npm_publish: { version: "0.1.5", at: STALE_PUBLISH },
        specs: {
          "262/main": "ffffffffffffffffffffffffffffffffffffffff",
          "402/main": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          "402/latest": "7777777777777777777777777777777777777777",
        },
        test262: "1111111111111111111111111111111111111111",
        proposals: "2222222222222222222222222222222222222222",
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.needs_refresh).toBe(true);
    expect(d.moved).toEqual({
      spec_262_main: true,
      spec_402_main: true,
      spec_402_latest: true,
      test262: true,
      proposals: true,
    });
    expect(d.should_publish).toBe(true);
    expect(d.next_version).toBe("0.1.6");
  });
});

describe("decideRefresh — sentinel write", () => {
  it("writes current upstream SHAs (not the stale ones)", () => {
    const d = decideRefresh({
      upstream: UPSTREAM,
      last: {
        last_npm_publish: { version: "0.1.5", at: STALE_PUBLISH },
        specs: { "262/main": "old-262", "402/main": "old-402", "402/latest": "old-402-latest" },
        test262: "old-test262",
        proposals: "old-proposals",
      },
      current_version: "0.1.5",
      now: FIXED_NOW,
    });
    expect(d.new_sentinel.specs!["262/main"]).toBe(UPSTREAM.spec_262_main);
    expect(d.new_sentinel.specs!["402/latest"]).toBe(UPSTREAM.spec_402_latest);
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
