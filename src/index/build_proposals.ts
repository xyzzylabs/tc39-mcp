#!/usr/bin/env node
// Build build/proposals-index.json from vendor/proposals/.
//
// The tc39/proposals repo organizes proposals across several markdown
// files:
//
//   README.md                — Stages 2 / 2.7 / 3 (active)
//   stage-1-proposals.md     — Stage 1
//   stage-0-proposals.md     — Stage 0
//   finished-proposals.md    — Stage 4 (advanced into the spec)
//   inactive-proposals.md    — withdrawn / rejected
//
// Each file uses the same markdown-table shape — `### Stage N` followed
// by a table with rows like `| [Name][slug] | Author<br />... | ... |`
// — and the file's link references `[slug]: <url>` near the bottom.
// We extract every row across every file, resolve the slug to a URL,
// and write a compact index.

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

/** Source files + their default stage labels (per-table headings can
 *  override, but the file establishes the broad category). */
const SOURCES: { file: string; defaultStage: string }[] = [
  { file: "README.md", defaultStage: "active" },
  { file: "stage-1-proposals.md", defaultStage: "1" },
  { file: "stage-0-proposals.md", defaultStage: "0" },
  { file: "finished-proposals.md", defaultStage: "finished" },
  { file: "inactive-proposals.md", defaultStage: "inactive" },
];

const t0 = performance.now();
const proposals: ProposalEntry[] = [];
const seen = new Set<string>();
for (const src of SOURCES) {
  const path = join(VENDOR, src.file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const row of parseProposalsMarkdown(text, src.file, src.defaultStage)) {
    // Dedupe by slug — a proposal occasionally appears in both the
    // active README and a stage-specific file.
    const key = `${row.slug}@${row.stage}`;
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
  version: 1,
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
