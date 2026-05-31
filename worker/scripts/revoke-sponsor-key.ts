// Revoke an issued sponsor key.
//
// Usage:
//   npm run revoke-sponsor-key -- --hash=<sha256hex> [--reason=<text>] [--dry-run]
//   npm run revoke-sponsor-key -- --github=<login> [--reason=<text>] [--dry-run]
//
// What it does:
//   - If --hash is given, deletes the KV entry at that key directly.
//   - If --github is given, lists every key under the SPONSORS binding,
//     fetches each value, finds matching `github_login` records, and
//     deletes the first match. (At sponsorship volume this scan is
//     cheap; refactor to a secondary index if it ever isn't.)
//
// The raw API key cannot be recovered or reverse-derived from the
// hash. If a sponsor lost their key, run this with --github + then
// re-run `issue-sponsor-key.ts` to mint a new one.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    hash: { type: "string" },
    github: { type: "string" },
    reason: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: false,
});

if (!opts.hash && !opts.github) {
  console.error(
    "usage: npm run revoke-sponsor-key -- (--hash=<sha256> | --github=<login>) " +
      "[--reason=<text>] [--dry-run]",
  );
  process.exit(2);
}

function wrangler(args: string[]): { status: number; stdout: string } {
  const r = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

let targetHash = opts.hash;

if (!targetHash && opts.github) {
  console.log(`→ Scanning SPONSORS KV for github_login=${opts.github} …`);
  const list = wrangler(["kv", "key", "list", "--binding=SPONSORS", "--remote"]);
  if (list.status !== 0) {
    console.error("wrangler kv key list failed — check binding + auth.");
    process.exit(list.status);
  }
  // The list output is JSON: [{name: "<hash>", expiration?: ...}, ...]
  let names: { name: string }[] = [];
  try {
    names = JSON.parse(list.stdout) as { name: string }[];
  } catch {
    console.error("Could not parse `wrangler kv key list` output as JSON.");
    process.exit(1);
  }
  for (const { name } of names) {
    const get = wrangler([
      "kv",
      "key",
      "get",
      "--binding=SPONSORS",
      "--remote",
      name,
    ]);
    if (get.status !== 0) continue;
    try {
      const meta = JSON.parse(get.stdout) as { github_login?: string };
      if (meta.github_login === opts.github) {
        targetHash = name;
        console.log(`→ Match: SPONSORS/${name.slice(0, 12)}…`);
        break;
      }
    } catch {
      continue;
    }
  }
  if (!targetHash) {
    console.error(`No sponsor record found for github_login=${opts.github}.`);
    process.exit(1);
  }
}

console.log(
  `→ wrangler invocation: npx wrangler kv key delete --binding=SPONSORS --remote ${targetHash!.slice(0, 12)}…`,
);

if (opts["dry-run"]) {
  console.log("[dry-run] Skipping delete.");
  process.exit(0);
}

const del = wrangler([
  "kv",
  "key",
  "delete",
  "--binding=SPONSORS",
  "--remote",
  targetHash!,
]);
if (del.status !== 0) {
  console.error("wrangler kv key delete failed.");
  process.exit(del.status);
}

console.log("");
console.log("─".repeat(72));
console.log(`Revoked SPONSORS/${targetHash!.slice(0, 12)}…`);
if (opts.reason) console.log(`Reason: ${opts.reason}`);
console.log(
  "The next request carrying that key will be treated as anonymous " +
    "and rate-limited per-IP at the free-tier cap.",
);
console.log("─".repeat(72));
