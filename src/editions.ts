// Canonical TC39 spec + edition catalog, alias resolution, and
// per-(spec, edition) vendor/build path lookup. Every MCP tool that
// accepts `spec` / `edition` arguments imports `SPEC_VALUES` and
// `EDITION_VALUES` from here so the enums stay in sync.
//
// Adding a new ECMA-262 release (e.g. es2026 once cut):
//   1. Add the edition to RELEASED_262_EDITIONS below.
//   2. Bump LATEST_262_RELEASE.
//   3. `npm run fetch-spec && npm run parse`.
//
// Adding a new ECMA-402 release: same recipe against
// RELEASED_402_EDITIONS / LATEST_402_RELEASE. ECMA-402 publishes each
// annual edition as an `esYYYY` branch (not a tag like ECMA-262), but
// the fetch step resolves a branch or a tag interchangeably, so the
// catalog shape is identical across the two specs.

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

/** ECMA-402 released editions, oldest → newest. Unlike ECMA-262,
 *  tc39/ecma402 publishes each annual edition as an `esYYYY` *branch*
 *  rather than a tag (its only tags are a handful of `esYYYY-candidate`
 *  release candidates). The fetch step resolves a branch or a tag
 *  interchangeably, so these are pinned the same way as the 262
 *  editions. */
export const RELEASED_402_EDITIONS = [
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
export type Released402Edition = (typeof RELEASED_402_EDITIONS)[number];

/** Newest ECMA-402 annual edition. `latest` on 402 resolves here, the
 *  same way it resolves to `LATEST_262_RELEASE` on 262. */
export const LATEST_402_RELEASE: Released402Edition = "es2025";

/** ECMA-402 also publishes `esYYYY-candidate` release-candidate tags.
 *  `es2025-candidate` predates the final `es2025` branch and is kept
 *  as a still-addressable pin for callers that referenced it before
 *  the final edition existed; new callers should prefer `es2025`. */
export const CANDIDATE_402_EDITIONS = ["es2025-candidate"] as const;

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

/** Resolve aliases + spec context to a concrete edition. `latest` is
 *  spec-aware — it points at each spec's newest annual edition:
 *    - ECMA-262 → `LATEST_262_RELEASE` (es2025 today).
 *    - ECMA-402 → `LATEST_402_RELEASE` (es2025 today).
 *  `draft` / `next` → `main` on both. */
export function resolveEdition(spec: Spec, e: Edition): ConcreteEdition {
  if (e === "latest") {
    return spec === "262" ? LATEST_262_RELEASE : LATEST_402_RELEASE;
  }
  if (e === "draft" || e === "next") return "main";
  return e;
}

/** True if (spec, concrete edition) is a supported combination. Used
 *  by the loader to reject e.g. `clause.get { spec: "402", edition:
 *  "es2025-candidate" }` against 262 with a clear error rather than a
 *  silent miss. */
export function isSupported(spec: Spec, concrete: ConcreteEdition): boolean {
  if (concrete === "main") return true;
  if (spec === "262") {
    return (RELEASED_262_EDITIONS as readonly string[]).includes(concrete);
  }
  // spec === "402": annual editions + the legacy candidate pin.
  return (
    (RELEASED_402_EDITIONS as readonly string[]).includes(concrete) ||
    (CANDIDATE_402_EDITIONS as readonly string[]).includes(concrete)
  );
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
