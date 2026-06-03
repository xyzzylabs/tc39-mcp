#!/usr/bin/env node
// Thin CLI wrapper that lets refresh.yml call the *tested* decision
// logic in decide.ts instead of duplicating it in bash.
//
// Reads:
//   - upstream SHAs from env (UPSTREAM_262_MAIN / _402_MAIN / _TEST262 /
//     _PROPOSALS), which the workflow captures from the vendored checkouts.
//   - the previous sentinel from ./.last-refresh.json (if present).
//   - the current version from ./package.json.
//
// Writes:
//   - the new ./.last-refresh.json sentinel — only when a refresh is
//     needed (a no-op run leaves the file untouched so it produces no
//     commit).
//   - `needs_refresh`, `should_publish`, `next_version` to $GITHUB_OUTPUT
//     so the workflow's later steps can gate on them.
//
// All decision logic — what moved, whether the monthly bundle re-bake is
// due, the next version, the sentinel shape — lives in (and is unit-tested
// via) decide.ts. This file is just IO glue.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { decideRefresh, type LastRefresh } from "./decide.js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`run-decide: missing required env var ${name}`);
  }
  return v;
}

const upstream = {
  spec_262_main: reqEnv("UPSTREAM_262_MAIN"),
  spec_402_main: reqEnv("UPSTREAM_402_MAIN"),
  test262: reqEnv("UPSTREAM_TEST262"),
  proposals: reqEnv("UPSTREAM_PROPOSALS"),
};

const last: LastRefresh | null = existsSync(".last-refresh.json")
  ? (JSON.parse(readFileSync(".last-refresh.json", "utf8")) as LastRefresh)
  : null;

const current_version = (
  JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
).version;

const decision = decideRefresh({ upstream, last, current_version });

// Log a human-readable summary for the Actions run.
console.log(
  `needs_refresh=${decision.needs_refresh} should_publish=${decision.should_publish} next_version=${decision.next_version}`,
);
for (const [target, moved] of Object.entries(decision.moved)) {
  if (moved) console.log(`  moved: ${target}`);
}

// Emit step outputs for the workflow to gate on.
const ghOutput = process.env.GITHUB_OUTPUT;
if (ghOutput) {
  appendFileSync(
    ghOutput,
    `needs_refresh=${decision.needs_refresh}\n` +
      `should_publish=${decision.should_publish}\n` +
      `next_version=${decision.next_version}\n`,
  );
}

// Only rewrite the sentinel when something actually moved — a no-op run
// must not churn `refreshed_at` and produce an empty commit.
if (decision.needs_refresh) {
  writeFileSync(
    ".last-refresh.json",
    JSON.stringify(decision.new_sentinel, null, 2) + "\n",
  );
}
