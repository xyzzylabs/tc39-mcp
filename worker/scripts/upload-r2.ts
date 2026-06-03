#!/usr/bin/env tsx
// Upload every parsed JSON artifact in ../build/ to the R2 bucket
// bound to the deployed Worker.
//
// Run from worker/ via `npm run upload-r2`. Requires:
//   - wrangler CLI authenticated to the right Cloudflare account
//   - The bucket from wrangler.toml's [[r2_buckets]] binding exists
//
// Uses `wrangler r2 object put` rather than the Cloudflare REST API so
// it picks up the same auth that `wrangler deploy` will use.
//
// Historical retention: for every `spec-*-main.json` we also upload
// `spec-*-main-{sha10}.json` as an immutable historical pin. The
// pin SHA is read from the JSON's `pin.sha` field. These let the
// Worker serve a query like `clause.get { at: "abcdef1234" }` for
// reproducibility after the live `main` has moved on.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./classify.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BUILD_DIR = resolve(HERE, "..", "..", "build");
const BUCKET = "tc39-mcp-specs";

function listJsonArtifacts(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(BUILD_DIR)) {
    if (!name.endsWith(".json")) continue;
    const full = join(BUILD_DIR, name);
    if (!statSync(full).isFile()) continue;
    out.push(name);
  }
  return out.sort();
}

function uploadOne(localPath: string, remoteKey: string): void {
  const size = statSync(localPath).size;
  const sizeMb = (size / 1024 / 1024).toFixed(1);
  process.stdout.write(`uploading ${remoteKey} (${sizeMb} MB) ... `);
  const r = spawnSync(
    "wrangler",
    [
      "r2",
      "object",
      "put",
      `${BUCKET}/${remoteKey}`,
      "--file",
      localPath,
      "--remote",
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) {
    process.stdout.write(`FAILED (exit ${r.status})\n`);
    process.exit(1);
  }
  process.stdout.write("ok\n");
}

/** Extract the SHA from a parsed-spec JSON without loading the full
 *  clauses tree. We only need the first ~200 bytes that contain the
 *  `pin` object. */
function readPinSha(jsonPath: string): string | null {
  try {
    // The pin is the first property of the parsed JSON, so a small
    // head-read suffices. We do a full read for simplicity since
    // the upload script isn't perf-critical.
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      pin?: { sha?: string };
    };
    return parsed.pin?.sha ?? null;
  } catch {
    return null;
  }
}

const files = listJsonArtifacts();
if (files.length === 0) {
  console.error(
    `No JSON artifacts found in ${BUILD_DIR}. Run \`npm run parse && npm run build-test262-index && npm run build-proposals-index\` from the repo root first.`,
  );
  process.exit(1);
}

// Deploy ordering matters for read consistency. A naive
// "upload everything in name order" leaves a window where the Worker
// might serve a fresh test262-index alongside a stale spec-262-main,
// or vice versa. We minimize that window by uploading in dependency
// order: immutable historical pins + side indices first, then pinned
// editions, then the live `main` snapshots LAST. A request arriving
// mid-deploy either sees the OLD live state (consistent with itself)
// or the NEW live state (consistent with itself); the mixed window
// is reduced to the duration of the final live-main puts (~2-5 s).

interface UploadPlan {
  /** Files we already have on disk + their derived remote-key plan. */
  histPins: { local: string; remote: string }[];
  indices: { local: string; remote: string }[];
  pinned: { local: string; remote: string }[];
  liveMains: { local: string; remote: string }[];
}

function plan(files: string[]): UploadPlan {
  const histPins: UploadPlan["histPins"] = [];
  const indices: UploadPlan["indices"] = [];
  const pinned: UploadPlan["pinned"] = [];
  const liveMains: UploadPlan["liveMains"] = [];

  for (const name of files) {
    const local = join(BUILD_DIR, name);
    const kind = classify(name);
    if (kind === "live-main") {
      liveMains.push({ local, remote: name });
      // Also generate the SHA-pinned immutable copy from the same
      // source file. The pin name embeds the first 10 hex chars of
      // pin.sha so subsequent at: queries can find it.
      const sha = readPinSha(local);
      if (sha) {
        const short = sha.slice(0, 10);
        const remote = name.replace(/\.json$/, `-${short}.json`);
        histPins.push({ local, remote });
      } else {
        console.warn(
          `  (skipped historical pin for ${name}: pin.sha missing)`,
        );
      }
    } else if (kind === "historical-pin") {
      // Defensive: shouldn't happen since build/ doesn't contain
      // pre-suffixed files, but pass through if so.
      histPins.push({ local, remote: name });
    } else if (kind === "pinned-edition") {
      pinned.push({ local, remote: name });
    } else if (kind === "side-index") {
      indices.push({ local, remote: name });
    } else {
      console.warn(`  (unknown artifact kind: ${name}; uploading as-is last)`);
      pinned.push({ local, remote: name });
    }
  }
  return { histPins, indices, pinned, liveMains };
}

const p = plan(files);
const total =
  p.histPins.length + p.indices.length + p.pinned.length + p.liveMains.length;

console.log(`Uploading ${total} artifacts to r2://${BUCKET}/`);
console.log(`  Phase 1: ${p.histPins.length} historical SHA pins (immutable)`);
console.log(`  Phase 2: ${p.indices.length} side indices`);
console.log(`  Phase 3: ${p.pinned.length} pinned-edition snapshots`);
console.log(`  Phase 4: ${p.liveMains.length} live main snapshots (last — flips the live pointer)`);
console.log("");

console.log("--- Phase 1: historical SHA pins ---");
for (const u of p.histPins) uploadOne(u.local, u.remote);
console.log("--- Phase 2: side indices ---");
for (const u of p.indices) uploadOne(u.local, u.remote);
console.log("--- Phase 3: pinned-edition snapshots ---");
for (const u of p.pinned) uploadOne(u.local, u.remote);
console.log("--- Phase 4: live main snapshots ---");
for (const u of p.liveMains) uploadOne(u.local, u.remote);

console.log("");
console.log(
  `Done. Uploaded ${p.histPins.length} historical + ${p.indices.length} indices + ${p.pinned.length} pinned + ${p.liveMains.length} live.`,
);
