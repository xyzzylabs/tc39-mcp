// Issue a new sponsor API key.
//
// Usage:
//   npm run issue-sponsor-key -- --github=<login> [--tier=sponsor]
//                                [--amount=<usd-per-month>]
//                                [--dry-run]
//
// What it does:
//   1. Generates 32 random bytes, base64url-encodes them, prepends
//      `tcms_`. That's the API key the sponsor will paste into their
//      MCP client's Authorization header.
//   2. SHA-256-hashes the key to get the KV record's primary key.
//   3. Calls `wrangler kv key put --binding=SPONSORS --remote
//      <hash> <metadata-json>` to persist the (hash → metadata)
//      mapping. The raw key is *never* stored anywhere; only the
//      hash is.
//   4. Prints the raw key once to stdout. Copy it into the GitHub
//      Sponsors private thank-you message (or whatever channel the
//      sponsor prefers). It cannot be recovered — if they lose it,
//      revoke + reissue.
//
// `--dry-run` runs everything except the wrangler invocation, so
// you can sanity-check the command shape without touching KV.

import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    github: { type: "string" },
    tier: { type: "string", default: "sponsor" },
    amount: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: false,
});

if (!opts.github) {
  console.error(
    "usage: npm run issue-sponsor-key -- --github=<login> " +
      "[--tier=sponsor] [--amount=<usd-per-month>] [--dry-run]",
  );
  process.exit(2);
}

const apiKey = `tcms_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(apiKey).digest("hex");

const metadata = {
  github_login: opts.github,
  tier: opts.tier ?? "sponsor",
  since: new Date().toISOString().slice(0, 10),
  ...(opts.amount ? { amount_per_month_usd: parseFloat(opts.amount) } : {}),
};
const value = JSON.stringify(metadata);

const wranglerArgs = [
  "wrangler",
  "kv",
  "key",
  "put",
  "--binding=SPONSORS",
  "--remote",
  hash,
  value,
];

console.log(`→ wrangler invocation: npx ${wranglerArgs.join(" ")}`);

if (opts["dry-run"]) {
  console.log("");
  console.log("[dry-run] Skipping wrangler call. Key + metadata:");
  console.log(`  key:      ${apiKey}`);
  console.log(`  hash:     ${hash}`);
  console.log(`  metadata: ${value}`);
  process.exit(0);
}

const result = spawnSync("npx", wranglerArgs, { stdio: "inherit" });
if (result.status !== 0) {
  console.error(
    "wrangler put failed. Key NOT activated. Check the KV binding + " +
      "your wrangler auth, then retry.",
  );
  process.exit(result.status ?? 1);
}

console.log("");
console.log("─".repeat(72));
console.log("API key (deliver to sponsor — they paste this into their MCP client):");
console.log("");
console.log(`  ${apiKey}`);
console.log("");
console.log(`Stored under SPONSORS/${hash.slice(0, 12)}… in the bound KV namespace.`);
console.log(`Metadata: ${value}`);
console.log("─".repeat(72));
