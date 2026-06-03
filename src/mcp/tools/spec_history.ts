// MCP tool: spec.history — recent commits in the vendored spec checkout
// that touched a clause's `id="..."` token. Uses `git log -S` (pickaxe
// search), so it catches clause creation, deletion, and edits to the
// opening tag reliably; interior-text-only edits won't show.
//
// The default `fetch-spec.sh` uses `--depth=1` to keep clone size
// small; in that case we surface a `shallow: true` flag + a hint
// telling the caller to run `git fetch --unshallow` for full history.

import { z } from "zod";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  EDITION_VALUES,
  SPEC_VALUES,
  resolveEdition,
  vendorDir,
  type ConcreteEdition,
  type Edition,
  type Spec,
} from "../../editions.js";

// Real ECMA-262 / ECMA-402 clause ids are ASCII: letters, digits,
// '.', '_', '%', and '-'. The longest observed in the vendored spec
// is 88 chars; the 200-char cap leaves margin without admitting
// pathological pickaxe patterns that would make `git log -S` scan
// expensive needles on every commit in the subprocess below.
const CLAUSE_ID_PATTERN = /^[a-zA-Z0-9._%-]+$/;

export const specHistorySchema = {
  id: z
    .string()
    .min(1)
    .max(200)
    .regex(
      CLAUSE_ID_PATTERN,
      "Spec clause ids use ASCII letters, digits, '.', '_', '%', '-'",
    )
    .describe("Spec clause id."),
  spec: z
    .enum(SPEC_VALUES)
    .default("262")
    .describe(
      "Which TC39 spec to read: '262' (core language, default) or '402' (Internationalization API).",
    ),
  edition: z
    .enum(EDITION_VALUES)
    .default("latest")
    .describe(
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: es2016 … es2025, main. Aliases: latest, draft, next.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Max commits returned from the vendored spec checkout's git log."),
};

export const specHistoryExamples = [
  {
    q: "Recent edits to ToNumber's clause tag",
    input: { id: "sec-tonumber" },
  },
] as const;

/** One commit touching the requested clause's `id="..."` token in
 *  the vendored spec checkout. */
export interface SpecHistoryCommit {
  /** Full 40-char commit SHA. */
  sha: string;
  /** First 8 chars of `sha`, for compact display. */
  short_sha: string;
  /** ISO-8601 author date. */
  date: string;
  /** Commit author name. */
  author: string;
  /** Commit subject line (`git log --format=%s`). */
  subject: string;
}

/** Output of `spec.history`: commits in the vendored spec checkout
 *  that touched the opening tag of a given clause id. */
export interface SpecHistoryResult {
  /** Clause id that was queried. */
  id: string;
  /** Which TC39 spec was queried. */
  spec: Spec;
  /** Concrete edition the `edition` arg resolved to. */
  edition: ConcreteEdition;
  /** `false` when no vendored checkout exists for this (spec, edition);
   *  `commits` will be empty and `hint` may explain how to fetch. */
  vendor_present: boolean;
  /** `true` when the vendored checkout is a shallow clone; the commit
   *  list may be truncated. `hint` suggests `git fetch --unshallow`. */
  shallow: boolean;
  /** Commits returned, newest first, capped at `limit`. */
  commits: SpecHistoryCommit[];
  /** Human-readable note (e.g. setup or shallow-clone hint). */
  hint?: string;
}

export function specHistory(args: {
  id: string;
  spec?: Spec;
  edition?: Edition;
  limit?: number;
}): SpecHistoryResult {
  const spec = args.spec ?? "262";
  const edition = resolveEdition(spec, args.edition ?? "latest");
  const limit = args.limit ?? 20;
  const dir = vendorDir(spec, edition);

  if (!existsSync(join(dir, ".git"))) {
    return {
      id: args.id,
      spec,
      edition,
      vendor_present: false,
      shallow: false,
      commits: [],
    };
  }

  const shallow = existsSync(join(dir, ".git", "shallow"));
  const token = `id="${args.id}"`;
  const r = spawnSync(
    "git",
    [
      "log",
      `-S${token}`,
      "--",
      "spec.html",
      `-n`,
      String(limit),
      "--pretty=format:%H%x09%h%x09%aI%x09%an%x09%s",
    ],
    { cwd: dir, encoding: "utf8", timeout: 30_000 },
  );

  const commits: SpecHistoryCommit[] = [];
  if (r.status === 0 && r.stdout) {
    for (const line of r.stdout.split("\n")) {
      const parts = line.split("\t");
      if (parts.length < 5) continue;
      commits.push({
        sha: parts[0]!,
        short_sha: parts[1]!,
        date: parts[2]!,
        author: parts[3]!,
        subject: parts[4]!,
      });
    }
  }
  const result: SpecHistoryResult = {
    id: args.id,
    spec,
    edition,
    vendor_present: true,
    shallow,
    commits,
  };
  // Surface spawn-level errors (e.g. ENOENT when git isn't installed)
  // and non-zero exits (e.g. corrupt repo) as a hint. spawnSync sets
  // `r.error` for the former and `r.status !== 0` for the latter; both
  // leave `commits` empty.
  if (r.error) {
    result.hint = `git invocation failed: ${r.error.message}. Is git installed and on PATH?`;
  } else if (r.status !== 0) {
    const stderr = (r.stderr ?? "").toString().trim();
    result.hint = `git log returned status ${r.status}${stderr ? `: ${stderr}` : ""}.`;
  } else if (shallow) {
    result.hint = `vendor/ecma${spec}-${edition} is a shallow clone (depth=1 from fetch-spec.sh); only HEAD is visible. Run \`git -C vendor/ecma${spec}-${edition} fetch --unshallow\` to enable full history.`;
  }
  return result;
}
