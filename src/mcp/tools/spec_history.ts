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

export const specHistorySchema = {
  id: z.string().describe("Spec clause id."),
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
      "Edition within the chosen spec. ECMA-262: es2016 … es2025, main. ECMA-402: main, es2025-candidate. Aliases: latest, draft, next.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Max commits returned from the vendored spec checkout's git log."),
};

export interface SpecHistoryCommit {
  sha: string;
  short_sha: string;
  date: string;
  author: string;
  subject: string;
}

export interface SpecHistoryResult {
  id: string;
  spec: Spec;
  edition: ConcreteEdition;
  vendor_present: boolean;
  shallow: boolean;
  commits: SpecHistoryCommit[];
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
