#!/usr/bin/env node
// Build build/test262-index.json from vendor/test262/.
//
// Walks every test/**/*.js, parses the YAML front-matter between
// `/*---` and `---*/`, and writes a compact index:
//
//   {
//     version, test262_sha, generated_at,
//     tests: [ { path, esid?, description?, features?, flags? }, ... ]
//   }
//
// We deliberately don't ship the full test source — just the metadata
// needed for esid lookups + free-text search over descriptions. ~5 MB
// JSON instead of ~300 MB checkout.

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFrontmatter, parseTest262Yaml } from "./test262_frontmatter.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const VENDOR = join(ROOT, "vendor", "test262");
const TEST_DIR = join(VENDOR, "test");
const OUT = join(ROOT, "build", "test262-index.json");

if (!existsSync(TEST_DIR)) {
  console.error(
    `vendor/test262/test not found. Run \`npm run fetch-test262\` first.`,
  );
  process.exit(1);
}

interface TestEntry {
  path: string;
  esid?: string;
  description?: string;
  features?: string[];
  flags?: string[];
}

function walk(dir: string, acc: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (st.isFile() && name.endsWith(".js") && !name.endsWith("_FIXTURE.js")) {
      acc.push(full);
    }
  }
}

const t0 = performance.now();
const files: string[] = [];
walk(TEST_DIR, files);
console.log(`found ${files.length} test files; parsing front-matter...`);

const tests: TestEntry[] = [];
let parsed = 0;
let withoutFrontmatter = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const fm = readFrontmatter(text);
  if (!fm) {
    withoutFrontmatter++;
    continue;
  }
  const parsedFm = parseTest262Yaml(fm);
  const entry: TestEntry = { path: relative(VENDOR, f) };
  if (parsedFm.esid) entry.esid = parsedFm.esid;
  // Trim description to 240 chars to keep the index small; the full
  // text is reachable via test262.get once the path is known.
  if (parsedFm.description) entry.description = parsedFm.description.slice(0, 240);
  if (parsedFm.features) entry.features = parsedFm.features;
  if (parsedFm.flags) entry.flags = parsedFm.flags;
  tests.push(entry);
  parsed++;
}

// execFile (no shell) — args are passed directly to git, so the cwd
// is the only thing controlling which repo we read from.
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: VENDOR,
  encoding: "utf8",
}).trim();

mkdirSync(join(ROOT, "build"), { recursive: true });
const payload = {
  version: 1,
  test262_sha: sha,
  generated_at: new Date().toISOString(),
  tests,
};
writeFileSync(OUT, JSON.stringify(payload));
const ms = Math.round(performance.now() - t0);
const sizeKb = Math.round(statSync(OUT).size / 1024);
console.log(
  `wrote ${OUT.replace(ROOT + "/", "")}  (${parsed} entries, ${sizeKb} KB, ${ms}ms)`,
);
if (withoutFrontmatter > 0) {
  console.log(`(${withoutFrontmatter} files had no /*---...---*/ block; skipped)`);
}
