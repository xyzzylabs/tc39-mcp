// Per-(spec, edition) vendor/build path lookup, layered on the
// dependency-free spec/edition catalog in `./spec/catalog.ts`. The
// catalog (released-edition lists, alias resolution, support check) is
// split out so the Cloudflare Worker can bundle it without pulling in
// `node:path` / `node:fs`; this module re-exports all of it and adds the
// filesystem-bound path helpers the stdio server needs.
//
// To add a new ECMA-262 / ECMA-402 release, edit `./spec/catalog.ts`.

import { join } from "node:path";
import { BUILD_DIR, VENDOR_ROOT } from "./paths.js";
import type { Spec, ConcreteEdition } from "./spec/catalog.js";

export * from "./spec/catalog.js";

// ─── path helpers ──────────────────────────────────────────────────

/** Vendor checkout directory for a given (spec, concrete edition). */
export function vendorDir(spec: Spec, e: ConcreteEdition): string {
  return join(VENDOR_ROOT, `ecma${spec}-${e}`);
}

/** Parsed JSON path for a given (spec, concrete edition). */
export function specJsonPath(spec: Spec, e: ConcreteEdition): string {
  return join(BUILD_DIR, `spec-${spec}-${e}.json`);
}
