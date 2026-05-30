#!/usr/bin/env node
// Smoke test for the stdio MCP server. Used by both:
//   - test.yml after `npm pack` → validates the local tarball
//   - release.yml after `npm publish` → validates the registry artifact
//
// Usage:
//   node scripts/smoke-stdio.mjs ./tc39-mcp-0.1.0.tgz
//   node scripts/smoke-stdio.mjs tc39-mcp@0.1.42
//
// What it does:
//   1. Installs the given package spec into a scratch directory.
//   2. Spawns the bin and speaks MCP over stdio.
//   3. Sends initialize, tools/list, and tools/call(spec.about).
//   4. Verifies each response shape.
//   5. Exits non-zero on any failure.
//
// Designed for CI: no interactive prompts, deterministic output,
// captures stderr from the child for debugging on failure.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const argSpec = process.argv[2];
if (!argSpec) {
  console.error("usage: smoke-stdio.mjs <tarball-path-or-package-spec>");
  console.error("examples:");
  console.error("  smoke-stdio.mjs ./tc39-mcp-0.1.0.tgz");
  console.error("  smoke-stdio.mjs tc39-mcp@0.1.42");
  process.exit(2);
}

// Resolve relative paths to a local tarball BEFORE switching cwd to the
// scratch dir — otherwise npm would look for the file inside scratch.
// Package specs like `tc39-mcp@X.Y.Z` are passed through unchanged.
let spec = argSpec;
if (argSpec.endsWith(".tgz") || argSpec.endsWith(".tar.gz")) {
  spec = isAbsolute(argSpec) ? argSpec : resolve(process.cwd(), argSpec);
  if (!existsSync(spec)) {
    console.error(`Tarball not found: ${spec}`);
    process.exit(2);
  }
}

const scratch = mkdtempSync(join(tmpdir(), "tc39-mcp-smoke-"));
let exitCode = 0;

function fail(msg) {
  console.error(`✗ ${msg}`);
  exitCode = 1;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

try {
  // ─── 1. install ──────────────────────────────────────────────────
  writeFileSync(join(scratch, "package.json"), '{"private":true}');
  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", spec], {
    cwd: scratch,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (install.status !== 0) {
    console.error(install.stderr || install.stdout);
    fail(`npm install ${spec} failed (status ${install.status})`);
    process.exit(exitCode);
  }
  ok(`installed ${spec}`);

  const bin = join(scratch, "node_modules", ".bin", "tc39-mcp");
  if (!existsSync(bin)) {
    fail(`bin entry missing: ${bin}`);
    process.exit(exitCode);
  }
  ok(`bin entry present at ${bin}`);

  // ─── 2. drive MCP over stdio ─────────────────────────────────────
  const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
  const stderrBuf = [];
  child.stderr.on("data", (d) => stderrBuf.push(d));

  const responses = new Map();
  let partial = "";
  child.stdout.on("data", (d) => {
    partial += d.toString();
    let nl;
    while ((nl = partial.indexOf("\n")) !== -1) {
      const line = partial.slice(0, nl).trim();
      partial = partial.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.id !== null) responses.set(msg.id, msg);
      } catch {
        /* non-JSON line — ignore */
      }
    }
  });

  function send(id, method, params) {
    const req = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
    child.stdin.write(JSON.stringify(req) + "\n");
  }

  async function waitFor(id, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (responses.has(id)) return responses.get(id);
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for response id=${id}`);
  }

  // initialize
  send(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-stdio", version: "0" },
  });
  send(undefined, "notifications/initialized");
  const init = await waitFor(1);
  if (!init.result || init.result.protocolVersion !== "2024-11-05") {
    fail(`initialize: unexpected protocolVersion (got ${init.result?.protocolVersion})`);
  } else {
    ok(`initialize → protocolVersion ${init.result.protocolVersion}`);
  }
  if (init.result?.serverInfo?.name !== "tc39-mcp") {
    fail(`initialize: serverInfo.name (got ${init.result?.serverInfo?.name})`);
  } else {
    ok(`initialize → serverInfo.name=${init.result.serverInfo.name}, version=${init.result.serverInfo.version}`);
  }
  // The server-level instructions field is the only documentation
  // agents see at handshake time. Verify it's present and non-trivial
  // so an empty / dropped value never silently ships.
  const instr = init.result?.instructions;
  if (typeof instr !== "string" || instr.length < 100) {
    fail(`initialize: instructions field missing or too short (length=${typeof instr === "string" ? instr.length : "n/a"})`);
  } else if (!instr.includes("tc39-mcp")) {
    fail(`initialize: instructions doesn't mention "tc39-mcp"`);
  } else {
    ok(`initialize → instructions field present (${instr.length} chars)`);
  }

  // tools/list
  send(2, "tools/list");
  const list = await waitFor(2);
  const tools = list.result?.tools ?? [];
  if (tools.length < 10) {
    fail(`tools/list: only ${tools.length} tools (expected ≥10)`);
  } else {
    ok(`tools/list → ${tools.length} tools registered`);
  }
  const required = ["spec.about", "clause.get", "clause.list", "spec.search", "spec.tables", "proposal.list"];
  const present = new Set(tools.map((t) => t.name));
  for (const name of required) {
    if (!present.has(name)) fail(`tools/list missing required tool: ${name}`);
  }
  if (required.every((n) => present.has(n))) ok(`tools/list contains the required core set`);

  // resources/list — capability added alongside tools. Catches a
  // dropped registration of the URI-template resource provider.
  send(3, "resources/list");
  const resList = await waitFor(3);
  let sampleUri = null;
  if (resList.error) {
    fail(`resources/list returned error: ${resList.error.message}`);
  } else {
    const resources = resList.result?.resources ?? [];
    if (!Array.isArray(resources)) {
      fail(`resources/list: expected array, got ${typeof resources}`);
    } else if (resources.length === 0) {
      fail(`resources/list: 0 resources advertised`);
    } else {
      const sample = resources[0];
      if (typeof sample?.uri !== "string" || !sample.uri.startsWith("tc39://")) {
        fail(`resources/list: first uri doesn't look like tc39:// (got ${sample?.uri})`);
      } else {
        sampleUri = sample.uri;
        ok(`resources/list → ${resources.length} resources, first=${sample.uri}`);
      }
    }
  }

  // resources/read — the other half of the resources capability.
  // Use a known URI (sec-tonumber) rather than the listed sample so
  // we don't depend on the first-listed clause having useful content.
  // Falls back to the sample if the canonical URI errors (different
  // edition aliases, future spec moves, etc.).
  const readUri = "tc39://262/latest/sec-tonumber";
  send(6, "resources/read", { uri: readUri });
  const read = await waitFor(6);
  if (read.error) {
    if (sampleUri) {
      // Retry with the listed sample so we still verify the protocol
      // path even if our hard-coded uri drifted.
      send(7, "resources/read", { uri: sampleUri });
      const fallback = await waitFor(7);
      if (fallback.error) {
        fail(`resources/read both ${readUri} and ${sampleUri} failed`);
      } else {
        ok(`resources/read ${sampleUri} → fallback ok`);
      }
    } else {
      fail(`resources/read ${readUri}: ${read.error.message}`);
    }
  } else {
    const contents = read.result?.contents ?? [];
    if (!Array.isArray(contents) || contents.length === 0) {
      fail(`resources/read: expected non-empty contents array`);
    } else {
      const first = contents[0];
      if (typeof first?.text !== "string" || first.text.length < 50) {
        fail(`resources/read: first content too short or missing text (got ${first?.text?.length ?? "n/a"} chars)`);
      } else {
        ok(`resources/read ${readUri} → ${first.text.length} chars`);
      }
    }
  }

  // tools/call spec.about — exercises the whole pipeline end-to-end
  send(4, "tools/call", { name: "spec.about", arguments: {} });
  const about = await waitFor(4);
  let aboutInner = null;
  if (about.error) {
    fail(`tools/call spec.about returned error: ${about.error.message}`);
  } else {
    const text = about.result?.content?.[0]?.text;
    if (!text) {
      fail(`tools/call spec.about: no content[0].text`);
    } else {
      aboutInner = JSON.parse(text);
      if (aboutInner?.server?.name !== "tc39-mcp") {
        fail(`spec.about: server.name (got ${aboutInner?.server?.name})`);
      } else {
        ok(`spec.about → ${aboutInner.server.name} v${aboutInner.server.version}, ${aboutInner.snapshots?.length ?? 0} snapshot slots`);
      }
      const presentSnaps = (aboutInner.snapshots ?? []).filter((s) => s.present).length;
      if (presentSnaps === 0) {
        fail(`spec.about: 0 snapshots present — build/ data missing from the package?`);
      } else {
        ok(`spec.about → ${presentSnaps} snapshots loaded`);
      }
    }
  }

  // Cross-check: the version reported by `initialize` must match the
  // version reported by `spec.about`. Catches the failure mode where
  // one path reads package.json dynamically and the other has a
  // hardcoded literal that drifts behind PATCH bumps.
  if (aboutInner?.server?.version && init.result?.serverInfo?.version) {
    const initVer = init.result.serverInfo.version;
    const aboutVer = aboutInner.server.version;
    if (initVer !== aboutVer) {
      fail(`version drift: initialize=${initVer} but spec.about=${aboutVer}`);
    } else {
      ok(`version consistency → ${initVer} across initialize + spec.about`);
    }
  }

  // tools/call clause.get sec-tonumber — the canonical smoke clause
  send(5, "tools/call", {
    name: "clause.get",
    arguments: { id: "sec-tonumber", spec: "262", edition: "latest" },
  });
  const cg = await waitFor(5);
  if (cg.error) {
    fail(`clause.get sec-tonumber: ${cg.error.message}`);
  } else {
    const inner = JSON.parse(cg.result.content[0].text);
    if (inner?.meta?.aoid !== "ToNumber") {
      fail(`clause.get sec-tonumber: aoid (got ${inner?.meta?.aoid})`);
    } else {
      ok(`clause.get sec-tonumber → aoid=${inner.meta.aoid}, algorithms=${inner.algorithms?.length}`);
    }
  }

  // ─── 3. clean shutdown ──────────────────────────────────────────
  child.stdin.end();
  await new Promise((r) => setTimeout(r, 200));
  child.kill();

  if (exitCode !== 0 && stderrBuf.length > 0) {
    console.error("\n--- child stderr ---");
    process.stderr.write(Buffer.concat(stderrBuf));
  }
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

process.exit(exitCode);
