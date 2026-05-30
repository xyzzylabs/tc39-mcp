#!/usr/bin/env node
// Lightweight load test for the hosted Worker.
//
// Fires N requests over C parallel connections, measures latency
// per-request, prints p50/p95/p99 + error rate. No external deps.
//
// Usage:
//   node scripts/load-test.mjs                                # local wrangler dev
//   node scripts/load-test.mjs --url https://<worker>/mcp     # hosted endpoint
//   node scripts/load-test.mjs --n 1000 --c 50                # heavier run
//   node scripts/load-test.mjs --method tools/call            # exercise a real tool
//
// Default config picks a query (initialize) that exercises the
// dispatcher without R2 reads, so it baselines pure handler latency.
// Add `--method tools/call --tool spec.about` to include an R2 read.

import { argv, exit, stderr, stdout } from "node:process";

function parseArgs() {
  const out = {
    url: "http://localhost:8787/mcp",
    n: 200,
    c: 10,
    method: "initialize",
    tool: undefined,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") out.url = argv[++i];
    else if (a === "--n") out.n = parseInt(argv[++i], 10);
    else if (a === "--c") out.c = parseInt(argv[++i], 10);
    else if (a === "--method") out.method = argv[++i];
    else if (a === "--tool") out.tool = argv[++i];
    else if (a === "--help") {
      stdout.write(`Usage:\n  load-test.mjs [--url URL] [--n N] [--c C] [--method M] [--tool T]\n`);
      exit(0);
    } else {
      stderr.write(`Unknown arg: ${a}\n`);
      exit(2);
    }
  }
  return out;
}

const args = parseArgs();

function buildBody(i) {
  if (args.method === "tools/call") {
    return {
      jsonrpc: "2.0",
      id: i,
      method: "tools/call",
      params: { name: args.tool ?? "spec.about", arguments: {} },
    };
  }
  return { jsonrpc: "2.0", id: i, method: args.method };
}

const samples = [];
let errors = 0;
let rateLimited = 0;

async function oneRequest(i) {
  const body = JSON.stringify(buildBody(i));
  const t0 = performance.now();
  try {
    const r = await fetch(args.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const text = await r.text();
    const dt = performance.now() - t0;
    if (r.status === 429) {
      rateLimited++;
      return;
    }
    if (!r.ok) {
      errors++;
      return;
    }
    try {
      const msg = JSON.parse(text);
      if (msg.error) errors++;
    } catch {
      errors++;
      return;
    }
    samples.push(dt);
  } catch {
    errors++;
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

stdout.write(
  `Load test → ${args.url}\n` +
    `  method: ${args.method}${args.tool ? ` tool=${args.tool}` : ""}\n` +
    `  N=${args.n}, concurrency=${args.c}\n\n`,
);

const t0 = performance.now();
// Drive C parallel "workers" that each pull from a shared counter.
let next = 0;
async function worker() {
  while (true) {
    const i = next++;
    if (i >= args.n) return;
    await oneRequest(i);
  }
}
await Promise.all(Array.from({ length: args.c }, () => worker()));
const totalMs = performance.now() - t0;

stdout.write(`Done in ${totalMs.toFixed(0)} ms\n`);
stdout.write(`  requests:     ${args.n}\n`);
stdout.write(`  successful:   ${samples.length}\n`);
stdout.write(`  rate-limited: ${rateLimited}\n`);
stdout.write(`  errors:       ${errors}\n`);
if (samples.length > 0) {
  stdout.write(
    `  throughput:   ${(samples.length / (totalMs / 1000)).toFixed(1)} req/s\n`,
  );
  stdout.write(`  latency p50:  ${percentile(samples, 0.5).toFixed(1)} ms\n`);
  stdout.write(`  latency p95:  ${percentile(samples, 0.95).toFixed(1)} ms\n`);
  stdout.write(`  latency p99:  ${percentile(samples, 0.99).toFixed(1)} ms\n`);
}

// Exit non-zero only on actual failures, not on rate-limited responses.
if (errors > 0) exit(1);
