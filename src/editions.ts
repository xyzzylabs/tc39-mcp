// Canonical TC39 spec + edition catalog, alias resolution, and
// per-(spec, edition) vendor/build path lookup. Every MCP tool that
// accepts `spec` / `edition` arguments imports `SPEC_VALUES` and
// `EDITION_VALUES` from here so the enums stay in sync.
//
// Adding a new ECMA-262 release (e.g. es2026 once tagged):
//   1. Add the tag to RELEASED_262_EDITIONS below.
//   2. Bump LATEST_262_RELEASE.
//   3. `npm run fetch-spec && npm run parse`.
//
// Adding a new ECMA-402 candidate (the only kind tc39/ecma402 actually
// tags): add it to RELEASED_402_EDITIONS. The candidates are the
// closest thing to "release" pins ECMA-402 publishes.

import { join } from "node:path";
import { BUILD_DIR, VENDOR_ROOT } from "./paths.js";

// ─── specs ─────────────────────────────────────────────────────────

/** The TC39 specs this server covers.
 *
 *  - "262" → ECMA-262, the core ECMAScript language spec
 *  - "402" → ECMA-402, the Internationalization API spec (Intl) */
export const SPEC_VALUES = ["262", "402"] as const;
export type Spec = (typeof SPEC_VALUES)[number];

// ─── ECMA-262 editions ─────────────────────────────────────────────

/** ECMA-262 released editions, oldest → newest. tc39/ecma262 tags
 *  every annual release with `esYYYY`. */
export const RELEASED_262_EDITIONS = [
  "es2016",
  "es2017",
  "es2018",
  "es2019",
  "es2020",
  "es2021",
  "es2022",
  "es2023",
  "es2024",
  "es2025",
] as const;
export type Released262Edition = (typeof RELEASED_262_EDITIONS)[number];

/** Floor is es2016: tc39/ecma262 has no earlier release tag. ES5/ES5.1
 *  predate the GitHub repo entirely; ES2015/ES6 was authored there but
 *  never tagged. */
export const LATEST_262_RELEASE: Released262Edition = "es2025";

// ─── ECMA-402 editions ─────────────────────────────────────────────

/** ECMA-402 doesn't tag annual releases the way ECMA-262 does — the
 *  only refs the upstream repo publishes are a handful of
 *  `esYYYY-candidate-*` tags (release candidates) plus `main`.
 *  We expose only what's actually tagged; the rest of the time you
 *  should be reading `main`, which is the current draft. */
export const RELEASED_402_EDITIONS = ["es2025-candidate"] as const;
export type Released402Edition = (typeof RELEASED_402_EDITIONS)[number];

// ─── joint catalog ─────────────────────────────────────────────────

/** All concrete editions across all specs. The cache + path helpers
 *  key on (spec, concrete-edition). */
export const CONCRETE_EDITIONS = [
  ...RELEASED_262_EDITIONS,
  "es2025-candidate",
  "main",
] as const;
export type ConcreteEdition = (typeof CONCRETE_EDITIONS)[number];

/** Aliases that resolve to a concrete edition. `latest` is
 *  spec-aware — it points at the current stable release for whichever
 *  spec you're addressing. */
export const ALIASES = {
  latest: "latest",
  draft: "main",
  next: "main",
} as const;
export type Alias = keyof typeof ALIASES;

/** Everything the `edition` argument accepts. */
export const EDITION_VALUES = [
  ...CONCRETE_EDITIONS,
  ...(Object.keys(ALIASES) as Alias[]),
] as const;
export type Edition = (typeof EDITION_VALUES)[number];

/** Resolve aliases + spec context to a concrete edition. `latest`
 *  rebinds depending on which spec you're querying because the two
 *  specs have different release-tagging conventions:
 *    - For ECMA-262, `latest` → `LATEST_262_RELEASE` (es2025 today).
 *    - For ECMA-402, `latest` → `main` (no annual final-release tag
 *      exists upstream). */
export function resolveEdition(spec: Spec, e: Edition): ConcreteEdition {
  if (e === "latest") {
    return spec === "262" ? LATEST_262_RELEASE : "main";
  }
  if (e === "draft" || e === "next") return "main";
  return e;
}

/** True if (spec, concrete edition) is a supported combination. Used
 *  by the loader to reject `clause.get { spec: "402", edition: "es2018" }`
 *  with a clear error rather than a silent miss. */
export function isSupported(spec: Spec, concrete: ConcreteEdition): boolean {
  if (concrete === "main") return true;
  if (spec === "262") {
    return (RELEASED_262_EDITIONS as readonly string[]).includes(concrete);
  }
  // spec === "402"
  return concrete === "es2025-candidate";
}

// ─── path helpers ──────────────────────────────────────────────────

/** Vendor checkout directory for a given (spec, concrete edition). */
export function vendorDir(spec: Spec, e: ConcreteEdition): string {
  return join(VENDOR_ROOT, `ecma${spec}-${e}`);
}

/** Parsed JSON path for a given (spec, concrete edition). */
export function specJsonPath(spec: Spec, e: ConcreteEdition): string {
  return join(BUILD_DIR, `spec-${spec}-${e}.json`);
}
