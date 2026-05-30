// Refresh-pipeline decision logic, extracted from refresh.yml's
// bash for unit-testability.
//
// Given the current upstream SHAs + the SHAs we last refreshed
// against (read from .last-refresh.json), decide:
//   - Whether anything changed
//   - If so, what the next package version should be
//   - What the new .last-refresh.json sentinel should look like

/** Upstream SHAs observed at decision time, fetched by the caller via
 *  `git ls-remote` against tc39/* repos. */
export interface UpstreamSnapshot {
  spec_262_main: string;
  spec_402_main: string;
  test262: string;
  proposals: string;
}

/** Shape of the on-disk .last-refresh.json. Fields default to "none"
 *  to signal first-ever refresh. */
export interface LastRefresh {
  version?: string;
  refreshed_at?: string;
  specs?: { "262/main"?: string; "402/main"?: string };
  test262?: string;
  proposals?: string;
}

export interface RefreshDecision {
  /** Whether any upstream SHA differs from the last-refresh sentinel. */
  needs_refresh: boolean;
  /** Per-target diff for logging. */
  moved: {
    spec_262_main: boolean;
    spec_402_main: boolean;
    test262: boolean;
    proposals: boolean;
  };
  /** The current published version. */
  current_version: string;
  /** The next version to publish (= current with PATCH+1). Only valid
   *  when `needs_refresh` is true. */
  next_version: string;
  /** The sentinel that should be written after a successful publish. */
  new_sentinel: LastRefresh;
}

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
  const last = args.last ?? {};
  const lastSpecs = last.specs ?? {};
  const moved = {
    spec_262_main: args.upstream.spec_262_main !== (lastSpecs["262/main"] ?? "none"),
    spec_402_main: args.upstream.spec_402_main !== (lastSpecs["402/main"] ?? "none"),
    test262: args.upstream.test262 !== (last.test262 ?? "none"),
    proposals: args.upstream.proposals !== (last.proposals ?? "none"),
  };
  const needs_refresh = Object.values(moved).some(Boolean);
  const next_version = needs_refresh ? bumpPatch(args.current_version) : args.current_version;
  const now = (args.now ?? (() => new Date()))();
  return {
    needs_refresh,
    moved,
    current_version: args.current_version,
    next_version,
    new_sentinel: {
      version: next_version,
      refreshed_at: now.toISOString(),
      specs: {
        "262/main": args.upstream.spec_262_main,
        "402/main": args.upstream.spec_402_main,
      },
      test262: args.upstream.test262,
      proposals: args.upstream.proposals,
    },
  };
}
