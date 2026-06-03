// MCP tool: test262.get — fetch one test's full source + parsed
// front-matter by its path within the vendored tc39/test262 checkout.
//
// Pairs with test262.search: search returns paths, `get` returns the
// actual test source so an agent can read it. Same offline-only
// constraint as test262.search — operates entirely against the
// vendored checkout, no network.

import { z } from "zod";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { VENDOR_ROOT } from "../../paths.js";
import {
  readFrontmatter,
  parseTest262Yaml,
  type Test262Frontmatter,
} from "../../index/test262_frontmatter.js";

export const test262GetSchema = {
  path: z
    .string()
    .min(1)
    .describe(
      "Path within the test262 checkout, relative to the repo root. Example: 'test/built-ins/Number/prototype/toString/S15.7.4.2_A1_T01.js'. The values returned by test262.search go here directly.",
    ),
};

export const test262GetExamples = [
  {
    q: "Read one specific test262 file",
    input: {
      path: "test/built-ins/Number/prototype/toString/S15.7.4.2_A1_T01.js",
    },
  },
] as const;

/** Output of `test262.get`: one test262 file's contents plus its
 *  structured front-matter, served from the vendored checkout. */
export interface Test262GetResult {
  /** Echo of the requested path, relative to the test262 repo root. */
  path: string;
  /** SHA of the vendored test262 checkout that served this file. */
  test262_sha?: string;
  /** Permanent URL to the file on GitHub at the vendored SHA. */
  url?: string;
  /** Verbatim file source, including the front-matter comment block. */
  source?: string;
  /** Front-matter parsed into structured fields (esid, description,
   *  info, features, flags, includes, negative, plus any other keys
   *  under `raw`). Absent if the file has no front-matter block. */
  front_matter?: Test262Frontmatter;
  /** Empty when found; populated when something went wrong. */
  hint?: string;
}

/** Reject paths that try to escape the vendored test262 root via `..`,
 *  absolute paths, or symlinks. We only allow reads of files actually
 *  inside vendor/test262/. Cross-platform — uses `path.relative` +
 *  segment check rather than the POSIX-only `startsWith("/")` test. */
function safeResolve(reqPath: string): string | null {
  // Reject absolute paths up front (both POSIX `/x` and Windows `C:\x`).
  if (isAbsolute(reqPath) || reqPath.startsWith("/")) return null;
  // Reject explicit parent-dir segments before resolving.
  const normalized = normalize(reqPath);
  const parts = normalized.split(/[\\/]/);
  if (parts.includes("..")) return null;
  const vendorAbs = resolve(VENDOR_ROOT, "test262");
  const candidate = resolve(vendorAbs, normalized);
  // Resolve symlinks before the prefix check so a symlink under
  // vendor/test262/ that points outside is rejected. realpathSync
  // throws if the path doesn't exist — fall back to the lexical
  // candidate in that case so non-existent files get a clean "not
  // found" hint from the caller, not a security rejection.
  let real = candidate;
  try {
    real = realpathSync(candidate);
  } catch {
    /* file doesn't exist; lexical candidate is fine */
  }
  const rel = relative(vendorAbs, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  // Final defense: explicit segment-level check on the relative path.
  if (rel.split(/[\\/]/).some((p) => p === "..")) return null;
  // Return the lexical candidate (caller will readFileSync it; if the
  // symlink resolved elsewhere the prefix check above caught it).
  return candidate;
}

let cachedSha: string | null = null;
function vendorSha(): string | null {
  if (cachedSha) return cachedSha;
  const vendor = join(VENDOR_ROOT, "test262");
  if (!existsSync(join(vendor, ".git"))) return null;
  try {
    cachedSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: vendor,
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    return cachedSha;
  } catch {
    return null;
  }
}

export function test262Get(args: { path: string }): Test262GetResult {
  // Path validation runs first: rejecting `..` / absolute / symlink
  // escapes is a pure-input check that must not depend on whether
  // vendor/test262 happens to be present. Otherwise a malicious path
  // received in a fresh install (no vendor yet) would silently look
  // like an ordinary "missing data" response instead of a rejection.
  const abs = safeResolve(args.path);
  if (!abs) {
    return {
      path: args.path,
      hint:
        "Path rejected: must be relative and within the test262 checkout. " +
        "Example: 'test/built-ins/Number/prototype/toString/S15.7.4.2_A1_T01.js'.",
    };
  }
  const vendor = join(VENDOR_ROOT, "test262");
  if (!existsSync(vendor)) {
    return {
      path: args.path,
      hint:
        "vendor/test262 not present. Run `npm run fetch-test262` to clone the suite locally.",
    };
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return {
      path: args.path,
      hint: `No such test file in the vendored checkout: ${args.path}.`,
    };
  }
  const source = readFileSync(abs, "utf8");
  const fm = readFrontmatter(source);
  const sha = vendorSha();
  const result: Test262GetResult = {
    path: args.path,
    source,
    ...(sha ? { test262_sha: sha } : {}),
    ...(sha
      ? { url: `https://github.com/tc39/test262/blob/${sha}/${args.path}` }
      : {}),
    ...(fm ? { front_matter: parseTest262Yaml(fm) } : {}),
  };
  return result;
}
