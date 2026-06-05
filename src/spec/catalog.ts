// Canonical TC39 spec + edition catalog: the released-edition lists,
// alias resolution, and the (spec, edition) support check. This module
// is intentionally dependency-free — no `node:fs` / `node:path` — so it
// can be shared by both the stdio server (via `../editions.ts`, which
// layers the filesystem path helpers on top) and the bundled Cloudflare
// Worker (which bundles it directly).
//
// Adding a new ECMA-262 release (e.g. es2027 once cut):
//   1. Add the edition to RELEASED_262_EDITIONS below.
//   2. Bump LATEST_262_RELEASE.
//   3. `npm run fetch-spec && npm run parse`.
//
// Adding a new ECMA-402 release: same recipe against
// RELEASED_402_EDITIONS / LATEST_402_RELEASE. ECMA-402 publishes each
// annual edition as an `esYYYY` branch (not a tag like ECMA-262), but
// the fetch step resolves a branch or a tag interchangeably, so the
// catalog shape is identical across the two specs.

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
  "es2026",
] as const;
export type Released262Edition = (typeof RELEASED_262_EDITIONS)[number];

/** Floor is es2016: tc39/ecma262 has no earlier release tag. ES5/ES5.1
 *  predate the GitHub repo entirely; ES2015/ES6 was authored there but
 *  never tagged. */
export const LATEST_262_RELEASE: Released262Edition = "es2026";

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
  "es2026",
] as const;
export type Released402Edition = (typeof RELEASED_402_EDITIONS)[number];

/** Newest ECMA-402 annual edition. `latest` on 402 resolves here, the
 *  same way it resolves to `LATEST_262_RELEASE` on 262. */
export const LATEST_402_RELEASE: Released402Edition = "es2026";

// ─── joint catalog ─────────────────────────────────────────────────

/** All concrete editions across all specs. The cache + path helpers
 *  key on (spec, concrete-edition). */
export const CONCRETE_EDITIONS = [
  ...RELEASED_262_EDITIONS,
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
 *    - ECMA-262 → `LATEST_262_RELEASE` (es2026 today).
 *    - ECMA-402 → `LATEST_402_RELEASE` (es2026 today).
 *  `draft` / `next` → `main` on both. */
export function resolveEdition(spec: Spec, e: Edition): ConcreteEdition {
  if (e === "latest") {
    return spec === "262" ? LATEST_262_RELEASE : LATEST_402_RELEASE;
  }
  if (e === "draft" || e === "next") return "main";
  return e;
}

/** True if (spec, concrete edition) is a supported combination. Both
 *  specs cover the same annual range (es2016 … es2026) + `main`, so every
 *  concrete edition is currently valid on both; the check stays as a
 *  guard against future per-spec divergence. */
export function isSupported(spec: Spec, concrete: ConcreteEdition): boolean {
  if (concrete === "main") return true;
  if (spec === "262") {
    return (RELEASED_262_EDITIONS as readonly string[]).includes(concrete);
  }
  return (RELEASED_402_EDITIONS as readonly string[]).includes(concrete);
}
