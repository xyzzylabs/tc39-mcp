#!/usr/bin/env node
/**
 * `npm run parse` entry point. Iterates every (spec, edition) pair
 * that has a vendored checkout and writes the parsed JSON to
 * `build/spec-{spec}-{edition}.json`.
 *
 * Per-spec entrypoint files:
 *   ECMA-262 → vendor/ecma262-<edition>/spec.html     (single-file)
 *   ECMA-402 → vendor/ecma402-<edition>/spec/index.html
 *              (multi-file; the 402 parser inlines <emu-import> chains)
 *
 * Missing checkouts are skipped with a warning so partial setups
 * (e.g. just ECMA-262 main) still produce something usable.
 */

import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseSpec } from "./index.js";
import { parseSpec402 } from "./ecma402.js";
import { biblioCommit } from "./biblio.js";
import { writeJsonAtomic } from "./atomic.js";
import type { ParsedSpec, SpecPin } from "./schema.js";
import {
  CONCRETE_EDITIONS,
  SPEC_VALUES,
  isSupported,
  specJsonPath,
  vendorDir,
  type ConcreteEdition,
  type Spec,
} from "../editions.js";
import { BUILD_DIR } from "../paths.js";

function pinOf(
  spec: Spec,
  dir: string,
  edition: string,
  biblio_commit: string,
): SpecPin {
  let sha = "unknown";
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
  } catch (e) {
    console.warn(
      `(warning: git rev-parse failed in ${dir}, sha=unknown: ${e instanceof Error ? e.message : String(e)})`,
    );
  }
  return {
    spec,
    edition,
    sha,
    fetched_at: new Date().toISOString(),
    biblio_commit,
  };
}

interface Target {
  spec: Spec;
  edition: ConcreteEdition;
  dir: string;
  /** The spec entrypoint file to read for this target. */
  entrypoint: string;
}

const targets: Target[] = [];
for (const spec of SPEC_VALUES) {
  for (const edition of CONCRETE_EDITIONS) {
    if (!isSupported(spec, edition)) continue;
    const dir = vendorDir(spec, edition);
    const entrypoint =
      spec === "262"
        ? join(dir, "spec.html")
        : join(dir, "spec", "index.html");
    if (!existsSync(entrypoint)) {
      console.warn(`(skipping ${spec}/${edition}: ${entrypoint} not found)`);
      continue;
    }
    targets.push({ spec, edition, dir, entrypoint });
  }
}

mkdirSync(BUILD_DIR, { recursive: true });

const biblio_commit = biblioCommit();
console.log(`biblio commit: ${biblio_commit}`);

for (const { spec, edition, dir, entrypoint } of targets) {
  const pin = pinOf(spec, dir, edition, biblio_commit);
  const t0 = performance.now();
  const parsed: ParsedSpec =
    spec === "262" ? parseSpec(entrypoint, pin) : parseSpec402(entrypoint, pin);
  const elapsed = Math.round(performance.now() - t0);
  const outPath = specJsonPath(spec, edition);
  writeJsonAtomic(outPath, parsed);
  const clauseCount = Object.keys(parsed.clauses).length;
  console.log(
    `${spec}/${edition.padEnd(16)} sha=${pin.sha.slice(0, 10)}  ${String(clauseCount).padStart(5)} clauses  ${String(elapsed).padStart(5)}ms`,
  );
}
