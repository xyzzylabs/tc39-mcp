#!/usr/bin/env node
// Build build/proposals-index.json from vendor/proposals/.
//
// The tc39/proposals repo tracks ECMA-262 and ECMA-402 proposals in
// two parallel file sets with identical markdown-table shapes:
//
//   ECMA-262 (root):
//     README.md                — Stages 2 / 2.7 / 3 (active)
//     stage-1-proposals.md     — Stage 1
//     stage-0-proposals.md     — Stage 0
//     finished-proposals.md    — Stage 4 (advanced into the spec)
//     inactive-proposals.md    — withdrawn / rejected
//
//   ECMA-402 (ecma402/ subdirectory):
//     ecma402/README.md            — active (Stages 1 / 2 / 2.7 / 3)
//     ecma402/finished-proposals.md
//     ecma402/stage-0-proposals.md
//     ecma402/inactive-proposals.md
//
// Each file uses the same shape — `### Stage N` followed by a table
// with rows like `| [Name][slug] | Author<br />... | ... |` — and the
// file's link references `[slug]: <url>` near the bottom. We extract
// every row across every file, tag it with the spec it targets,
// resolve the slug to a URL, and write a compact index.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProposalsMarkdown,
  type ProposalEntry,
} from "./proposals_parser.js";
import type { Spec } from "../editions.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const VENDOR = join(ROOT, "vendor", "proposals");
const OUT = join(ROOT, "build", "proposals-index.json");

if (!existsSync(VENDOR)) {
  console.error(
    `vendor/proposals not found. Clone it first:\n` +
      `  git clone --depth=1 https://github.com/tc39/proposals vendor/proposals`,
  );
  process.exit(1);
}

interface IndexFile {
  version: number;
  proposals_sha: string;
  generated_at: string;
  proposals: ProposalEntry[];
}

/** Source files + their default stage labels + the spec they belong
 *  to (per-table headings can override the stage, but the file
 *  establishes the broad category and the spec). Root files are
 *  ECMA-262; the `ecma402/` subdirectory mirrors the same structure
 *  for ECMA-402. */
const SOURCES: { file: string; defaultStage: string; spec: Spec }[] = [
  { file: "README.md", defaultStage: "active", spec: "262" },
  { file: "stage-1-proposals.md", defaultStage: "1", spec: "262" },
  { file: "stage-0-proposals.md", defaultStage: "0", spec: "262" },
  { file: "finished-proposals.md", defaultStage: "finished", spec: "262" },
  { file: "inactive-proposals.md", defaultStage: "inactive", spec: "262" },
  { file: "ecma402/README.md", defaultStage: "active", spec: "402" },
  { file: "ecma402/finished-proposals.md", defaultStage: "finished", spec: "402" },
  { file: "ecma402/stage-0-proposals.md", defaultStage: "0", spec: "402" },
  { file: "ecma402/inactive-proposals.md", defaultStage: "inactive", spec: "402" },
];

const t0 = performance.now();
const proposals: ProposalEntry[] = [];
const seen = new Set<string>();
for (const src of SOURCES) {
  const path = join(VENDOR, src.file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const row of parseProposalsMarkdown(text, src.file, src.defaultStage, src.spec)) {
    // Dedupe by (spec, slug, stage) — a proposal occasionally appears
    // in both the active README and a stage-specific file. Keying on
    // spec too keeps a 262 and 402 slug collision (unlikely, but cheap
    // to guard) from clobbering each other.
    const key = `${row.spec}:${row.slug}@${row.stage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push(row);
  }
}

const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: VENDOR,
  encoding: "utf8",
}).trim();

mkdirSync(join(ROOT, "build"), { recursive: true });
const payload: IndexFile = {
  version: 2,
  proposals_sha: sha,
  generated_at: new Date().toISOString(),
  proposals,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2));
const ms = Math.round(performance.now() - t0);
const sizeKb = Math.round(statSync(OUT).size / 1024);
console.log(
  `wrote ${OUT.replace(ROOT + "/", "")}  (${proposals.length} proposals, ${sizeKb} KB, ${ms}ms)`,
);
