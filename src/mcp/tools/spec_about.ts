// MCP tool: spec.about — return self-description of this MCP server
// instance plus the per-snapshot pin metadata for every parsed spec
// it's loaded (or could load).
//
// Used by callers to verify freshness — "what SHA of 262/main am I
// reading?" — and reproducibility — "this finding was produced
// against server v0.1.42 / 262/main @ SHA X".
//
// Cheap to call: scans on-disk parsed JSONs for their `pin` field
// only, without loading the full clause tree.

import { z } from "zod";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import {
  CONCRETE_EDITIONS,
  SPEC_VALUES,
  isSupported,
  specJsonPath,
  type ConcreteEdition,
  type Spec,
} from "../../editions.js";
import { BUILD_DIR } from "../../paths.js";
import { join } from "node:path";

const req = createRequire(import.meta.url);

export const specAboutSchema = {
  // Intentionally empty — `spec.about` is a parameter-free description
  // of the running server. Validation passes through any input as-is.
};

export const specAboutExamples = [
  {
    q: "How fresh is this server's data, and what version is it?",
    input: {},
    note: "Cheap call — no clause trees loaded. Each snapshot reports its upstream SHA + `fetched_at` so downstream callers can pin reproducibility.",
  },
] as const;

export interface SnapshotInfo {
  spec: Spec;
  edition: ConcreteEdition;
  /** Whether the parsed JSON exists on disk for this (spec, edition). */
  present: boolean;
  /** Upstream git SHA the snapshot was parsed from. */
  sha?: string;
  /** ISO-8601 timestamp recording when the parser ran. */
  fetched_at?: string;
  /** The biblio package commit driving the parse. */
  biblio_commit?: string;
  /** Number of clauses captured. */
  clause_count?: number;
  /** Whether the snapshot includes structured `<emu-table>` data. */
  has_tables?: boolean;
  /** Whether the snapshot includes parsed `<emu-grammar>` productions. */
  has_grammar?: boolean;
  /** Size of the parsed JSON on disk, in bytes. */
  bytes_on_disk?: number;
}

export interface AboutResult {
  /** Package name + version of this MCP server. */
  server: {
    name: string;
    version: string;
  };
  /** When this `spec.about` response was assembled. */
  generated_at: string;
  /** One entry per supported (spec, edition) pair, regardless of
   *  whether the snapshot is present locally. */
  snapshots: SnapshotInfo[];
  /** test262 index metadata, when present. */
  test262_index?: {
    test262_sha: string;
    generated_at: string;
    test_count: number;
    bytes_on_disk: number;
  };
  /** tc39/proposals index metadata, when present. */
  proposals_index?: {
    proposals_sha: string;
    generated_at: string;
    proposal_count: number;
    bytes_on_disk: number;
  };
}

interface ServerPackageJson {
  name?: string;
  version?: string;
}

function serverInfo(): { name: string; version: string } {
  try {
    const path = req.resolve("../../../package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8")) as ServerPackageJson;
    return { name: pkg.name ?? "tc39-mcp", version: pkg.version ?? "0.0.0" };
  } catch {
    return { name: "tc39-mcp", version: "unknown" };
  }
}

/** Read a parsed-spec JSON file's metadata without loading its full
 *  clauses tree. Reads the on-disk bytes once and parses; the
 *  intermediate object is dropped after we extract just the
 *  inexpensive bits. */
function snapshotInfo(spec: Spec, edition: ConcreteEdition): SnapshotInfo {
  const path = specJsonPath(spec, edition);
  if (!existsSync(path)) {
    return { spec, edition, present: false };
  }
  try {
    const bytes = statSync(path).size;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      pin?: {
        sha?: string;
        fetched_at?: string;
        biblio_commit?: string;
      };
      clauses?: Record<string, unknown>;
      tables?: Record<string, unknown>;
      grammar?: unknown[];
    };
    return {
      spec,
      edition,
      present: true,
      sha: parsed.pin?.sha,
      fetched_at: parsed.pin?.fetched_at,
      biblio_commit: parsed.pin?.biblio_commit,
      clause_count: parsed.clauses ? Object.keys(parsed.clauses).length : 0,
      has_tables: Boolean(parsed.tables && Object.keys(parsed.tables).length > 0),
      has_grammar: Boolean(parsed.grammar && Array.isArray(parsed.grammar) && parsed.grammar.length > 0),
      bytes_on_disk: bytes,
    };
  } catch {
    return { spec, edition, present: false };
  }
}

interface Test262IndexHeader {
  test262_sha: string;
  generated_at: string;
  tests: unknown[];
}

interface ProposalsIndexHeader {
  proposals_sha: string;
  generated_at: string;
  proposals: unknown[];
}

function test262IndexInfo(): AboutResult["test262_index"] {
  const path = join(BUILD_DIR, "test262-index.json");
  if (!existsSync(path)) return undefined;
  try {
    const bytes = statSync(path).size;
    const idx = JSON.parse(readFileSync(path, "utf8")) as Test262IndexHeader;
    return {
      test262_sha: idx.test262_sha,
      generated_at: idx.generated_at,
      test_count: Array.isArray(idx.tests) ? idx.tests.length : 0,
      bytes_on_disk: bytes,
    };
  } catch {
    return undefined;
  }
}

function proposalsIndexInfo(): AboutResult["proposals_index"] {
  const path = join(BUILD_DIR, "proposals-index.json");
  if (!existsSync(path)) return undefined;
  try {
    const bytes = statSync(path).size;
    const idx = JSON.parse(readFileSync(path, "utf8")) as ProposalsIndexHeader;
    return {
      proposals_sha: idx.proposals_sha,
      generated_at: idx.generated_at,
      proposal_count: Array.isArray(idx.proposals) ? idx.proposals.length : 0,
      bytes_on_disk: bytes,
    };
  } catch {
    return undefined;
  }
}

export function specAbout(): AboutResult {
  const snapshots: SnapshotInfo[] = [];
  for (const spec of SPEC_VALUES) {
    for (const edition of CONCRETE_EDITIONS) {
      if (!isSupported(spec, edition)) continue;
      snapshots.push(snapshotInfo(spec, edition));
    }
  }
  const t262 = test262IndexInfo();
  const props = proposalsIndexInfo();
  return {
    server: serverInfo(),
    generated_at: new Date().toISOString(),
    snapshots,
    ...(t262 ? { test262_index: t262 } : {}),
    ...(props ? { proposals_index: props } : {}),
  };
}
