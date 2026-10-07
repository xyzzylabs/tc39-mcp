#!/usr/bin/env node
// Cut a code release: changelog, version fields, commit, tag, push.
//
// Usage:
//   npm run release -- patch              # 0.6.4 -> 0.6.5
//   npm run release -- minor              # 0.6.4 -> 0.7.0
//   npm run release -- 0.7.0              # an explicit version
//   npm run release -- patch --dry-run    # print the plan, change nothing
//
// In order:
//   1. Preflight — on `main`, clean tree, in sync with `origin/main`,
//      target version not already tagged.
//   2. CHANGELOG.md must have a non-empty `## [Unreleased]` section: a
//      code release always has an entry. Data-only rebakes don't come
//      through here — refresh.yml cuts those and skips the changelog by
//      policy.
//   3. Retitle `[Unreleased]` to `[X.Y.Z] — YYYY-MM-DD` and leave a fresh
//      empty `[Unreleased]` above it, so the next change has a home
//      without anyone remembering to add the heading.
//   4. Bump the version in package.json + package-lock.json (through
//      `npm version --no-git-tag-version`) and both fields in server.json.
//   5. Commit `release: vX.Y.Z`, create a lightweight tag, push the
//      commit and then the tag. The tag push fires release.yml (npm, MCP
//      Registry, GitHub release) and deploy-worker.yml.
//
// The tag is created with `--no-sign` on purpose: every release tag in
// this repo is lightweight (refresh.yml's are too), and a local
// `tag.gpgSign = true` would otherwise turn it into an annotated tag and
// stop to ask for a message.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const spec = args.find((a) => !a.startsWith("--"));

if (!spec || !/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(spec)) {
  console.error("usage: npm run release -- <patch|minor|major|X.Y.Z> [--dry-run]");
  process.exit(2);
}

function git(...gitArgs) {
  return execFileSync("git", gitArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function bump(version, kind) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function compare(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

function repoUrl() {
  const remote = git("remote", "get-url", "origin");
  const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote);
  return m ? `https://github.com/${m[1]}` : remote;
}

// ─── 1. preflight ────────────────────────────────────────────────────
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") fail(`on branch ${branch}; releases are cut from main`);
if (git("status", "--porcelain") !== "") fail("working tree is not clean");
git("fetch", "--quiet", "--tags", "origin", "main");
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) {
  fail("main is not in sync with origin/main — pull or push first");
}
ok("on a clean main, in sync with origin");

const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const next = /^\d/.test(spec) ? spec : bump(current, spec);
if (compare(next, current) <= 0) fail(`${next} is not greater than the current ${current}`);
if (git("tag", "-l", `v${next}`) !== "") fail(`v${next} is already tagged`);

// ─── 2. the changelog must carry an entry ────────────────────────────
const changelogPath = "CHANGELOG.md";
const changelog = readFileSync(changelogPath, "utf8");
const heading = /^## \[Unreleased\][ \t]*\n/m.exec(changelog);
if (!heading) fail(`${changelogPath} has no "## [Unreleased]" section to release`);

const bodyStart = heading.index + heading[0].length;
const rest = changelog.slice(bodyStart);
const nextHeading = rest.search(/^## /m);
const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
if (body.trim() === "") {
  fail(
    `the "## [Unreleased]" section is empty — a code release needs an entry.\n` +
      "  (Data-only rebakes are cut by refresh.yml and skip the changelog.)",
  );
}

const date = new Date().toISOString().slice(0, 10);
const versionHeading = `## [${next}] — ${date}`;
ok(`changelog: "## [Unreleased]" -> "${versionHeading}", fresh [Unreleased] above it`);

console.log(`  ${current} -> ${next} in package.json, package-lock.json, server.json`);
console.log(`  commit "release: v${next}", lightweight tag v${next}, push both`);
if (dryRun) {
  console.log("dry run — nothing changed.");
  process.exit(0);
}

// ─── 3. changelog ────────────────────────────────────────────────────
writeFileSync(
  changelogPath,
  changelog.slice(0, heading.index) +
    `## [Unreleased]\n\n${versionHeading}\n` +
    changelog.slice(bodyStart),
);

// ─── 4. version fields ───────────────────────────────────────────────
execFileSync("npm", ["version", next, "--no-git-tag-version", "--no-commit-hooks"], {
  stdio: ["ignore", "ignore", "inherit"],
});
const serverPath = "server.json";
const server = JSON.parse(readFileSync(serverPath, "utf8"));
server.version = next;
for (const pkg of server.packages ?? []) pkg.version = next;
writeFileSync(serverPath, JSON.stringify(server, null, 2) + "\n");
ok(`version fields set to ${next}`);

// ─── 5. commit, tag, push ────────────────────────────────────────────
git("add", changelogPath, "package.json", "package-lock.json", serverPath);
git("commit", "--quiet", "-m", `release: v${next}`);
git("tag", "--no-sign", `v${next}`);
ok(`committed and tagged v${next}`);

try {
  git("push", "--quiet", "origin", "HEAD:main");
} catch {
  fail(
    "pushing main was rejected — a commit probably landed in the meantime. Recover with:\n" +
      `  git pull --rebase && git tag -d v${next} && git tag --no-sign v${next} && ` +
      `git push origin HEAD:main && git push origin v${next}`,
  );
}
git("push", "--quiet", "origin", `v${next}`);
ok(`pushed main and v${next}`);

const url = repoUrl();
if (url.startsWith("https://github.com/")) {
  console.log(`\n  release.yml:       ${url}/actions/workflows/release.yml`);
  console.log(`  deploy-worker.yml: ${url}/actions/workflows/deploy-worker.yml`);
}
