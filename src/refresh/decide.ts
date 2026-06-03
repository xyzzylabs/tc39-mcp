// Refresh-pipeline decision logic, extracted from refresh.yml's
// bash for unit-testability.
//
// Given the current upstream SHAs + the SHAs we last refreshed
// against (read from .last-refresh.json), decide:
//   - Whether anything moved upstream (`needs_refresh`).
//   - Whether the npm bundle is due for a re-bake (`should_publish`).
//   - The next package version (only when re-baking).
//   - The new .last-refresh.json sentinel.
//
// v0.2.0 model: live freshness rides R2 (refreshed every cycle that
// sees movement), so the npm bundle — the offline fallback — only
// needs re-baking at most monthly. `should_publish` is that gate.

/** Upstream SHAs observed at decision time, supplied by the caller
 *  (run-decide.ts reads them from the `UPSTREAM_*` env vars the refresh
 *  workflow captures from the vendored tc39/* checkouts). */
export interface UpstreamSnapshot {
  spec_262_main: string;
  spec_402_main: string;
  test262: string;
  proposals: string;
}

/** Shape of the on-disk .last-refresh.json. Missing fields default to
 *  "none" to signal first-ever refresh. */
export interface LastRefresh {
  refreshed_at?: string;
  /** When the npm bundle was last re-baked + published. The monthly
   *  cadence gates on this; data-only R2 refreshes don't advance it. */
  last_npm_publish?: { version: string; at: string };
  specs?: { "262/main"?: string; "402/main"?: string };
  test262?: string;
  proposals?: string;
}

export interface RefreshDecision {
  /** Whether any upstream SHA differs from the last-refresh sentinel.
   *  Drives the R2 refresh (every cycle that sees movement). */
  needs_refresh: boolean;
  /** Per-target diff for logging. */
  moved: {
    spec_262_main: boolean;
    spec_402_main: boolean;
    test262: boolean;
    proposals: boolean;
  };
  /** Whether to re-bake + publish the npm bundle this run: a refresh is
   *  needed AND it's been ≥ PUBLISH_INTERVAL_MS since the last data
   *  publish (or there's never been one). A new edition is a *code*
   *  change and publishes off this path, so it isn't modelled here. */
  should_publish: boolean;
  /** The current published version. */
  current_version: string;
  /** The next version (= current with PATCH+1). Only meaningful when
   *  `should_publish` is true. */
  next_version: string;
  /** The sentinel that should be written after this run. */
  new_sentinel: LastRefresh;
}

/** The npm bundle is the offline cold-start fallback, so it's re-baked
 *  at most monthly. Live freshness comes from R2, refreshed every cycle
 *  independent of this gate. */
export const PUBLISH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** Parse a semver into its three integer parts. Throws on
 *  non-conforming input; the workflow always passes
 *  package.json's `version` so the format is controlled. */
function parseSemver(v: string): { major: number; minor: number; patch: number } {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) throw new Error(`Not a parseable semver: ${JSON.stringify(v)}`);
  return {
    major: parseInt(m[1]!, 10),
    minor: parseInt(m[2]!, 10),
    patch: parseInt(m[3]!, 10),
  };
}

/** Bump PATCH. We never touch MAJOR/MINOR on refresh — those are
 *  reserved for intentional schema/tool changes. */
export function bumpPatch(v: string): string {
  const { major, minor, patch } = parseSemver(v);
  return `${major}.${minor}.${patch + 1}`;
}

export function decideRefresh(args: {
  upstream: UpstreamSnapshot;
  last: LastRefresh | null;
  current_version: string;
  now?: () => Date;
}): RefreshDecision {
  const now = (args.now ?? (() => new Date()))();
  const last = args.last ?? {};
  const lastSpecs = last.specs ?? {};
  const moved = {
    spec_262_main: args.upstream.spec_262_main !== (lastSpecs["262/main"] ?? "none"),
    spec_402_main: args.upstream.spec_402_main !== (lastSpecs["402/main"] ?? "none"),
    test262: args.upstream.test262 !== (last.test262 ?? "none"),
    proposals: args.upstream.proposals !== (last.proposals ?? "none"),
  };
  const needs_refresh = Object.values(moved).some(Boolean);

  // Monthly gate: re-bake the bundle only if it's been ≥ 30 days since
  // the last data publish (or never). A malformed/absent timestamp
  // counts as "never" so we publish rather than stall forever.
  const lastPublishMs = last.last_npm_publish?.at
    ? new Date(last.last_npm_publish.at).getTime()
    : NaN;
  const sincePublish = Number.isFinite(lastPublishMs)
    ? now.getTime() - lastPublishMs
    : Infinity;
  const should_publish = needs_refresh && sincePublish >= PUBLISH_INTERVAL_MS;

  const next_version = should_publish
    ? bumpPatch(args.current_version)
    : args.current_version;

  // `last_npm_publish` advances only on a publishing run; a data-only
  // refresh carries the previous value forward unchanged.
  const last_npm_publish = should_publish
    ? { version: next_version, at: now.toISOString() }
    : last.last_npm_publish;

  return {
    needs_refresh,
    moved,
    should_publish,
    current_version: args.current_version,
    next_version,
    new_sentinel: {
      refreshed_at: now.toISOString(),
      ...(last_npm_publish ? { last_npm_publish } : {}),
      specs: {
        "262/main": args.upstream.spec_262_main,
        "402/main": args.upstream.spec_402_main,
      },
      test262: args.upstream.test262,
      proposals: args.upstream.proposals,
    },
  };
}
