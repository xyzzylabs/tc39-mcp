// MCP tool: spec.snapshots — list every (spec, edition, sha,
// fetched_at) snapshot the server has available, including any
// historical `main` pins discoverable from the deployment.
//
// On the stdio server, "available" means "parsed JSON exists in
// build/". A user who installed `tc39-mcp@0.1.42` sees exactly the
// snapshots that version baked in — version-pinned reproducibility
// without any extra plumbing.
//
// On the Worker, the analog tool iterates R2 keys matching
// `spec-{spec}-{edition}-{sha10}.json` so callers can discover
// historical pins they can reach via `at: "<sha>"`.

import { z } from "zod";
import {
  CONCRETE_EDITIONS,
  SPEC_VALUES,
  isSupported,
  type ConcreteEdition,
  type Spec,
} from "../../editions.js";
import { loadSnapshot } from "../../data/loader.js";

export const specSnapshotsSchema = {
  spec: z
    .enum(SPEC_VALUES)
    .optional()
    .describe("Filter to one spec. Omit for both."),
  edition: z
    .string()
    .optional()
    .describe(
      "Filter to one edition (concrete name like 'main' or 'es2025'). Omit for all.",
    ),
};

export const specSnapshotsExamples = [
  {
    q: "List every (spec, edition) the server has parsed",
    input: {},
  },
  {
    q: "Just the ECMA-402 snapshots",
    input: { spec: "402" },
  },
] as const;

export interface SnapshotRow {
  spec: Spec;
  edition: ConcreteEdition;
  sha: string;
  fetched_at?: string;
  biblio_commit?: string;
  /** Whether this is the current live snapshot for (spec, edition). On
   *  stdio this is always true because only the live copy ships in
   *  build/. On the Worker, false for historical SHA-pinned copies. */
  live: boolean;
}

/** Output of `spec.snapshots`: every parsed (spec, edition, sha,
 *  fetched_at) snapshot the server has available, plus the filters
 *  the call narrowed to. */
export interface SnapshotsResult {
  /** Echo of the `spec` argument, if one was supplied. */
  spec_filter?: Spec;
  /** Echo of the `edition` argument, if one was supplied. */
  edition_filter?: string;
  /** Matching snapshot rows. On the stdio server this is whatever
   *  the installed package version baked in; on the Worker this can
   *  include historical SHA-pinned copies. */
  snapshots: SnapshotRow[];
}

interface SnapshotJsonHeader {
  pin?: {
    sha?: string;
    fetched_at?: string;
    biblio_commit?: string;
  };
}

/** Read just the `pin` block out of a parsed-spec snapshot body. Skip
 *  the full clauses tree to keep the listing cheap. */
function readPin(body: string): {
  sha?: string;
  fetched_at?: string;
  biblio_commit?: string;
} | null {
  try {
    const parsed = JSON.parse(body) as SnapshotJsonHeader;
    return parsed.pin ?? null;
  } catch {
    return null;
  }
}

export async function specSnapshots(args: {
  spec?: Spec;
  edition?: string;
}): Promise<SnapshotsResult> {
  const probes: Promise<SnapshotRow | null>[] = [];
  for (const spec of SPEC_VALUES) {
    if (args.spec && args.spec !== spec) continue;
    for (const edition of CONCRETE_EDITIONS) {
      if (!isSupported(spec, edition)) continue;
      if (args.edition && args.edition !== edition) continue;
      probes.push(
        (async (): Promise<SnapshotRow | null> => {
          const outcome = await loadSnapshot(`spec-${spec}-${edition}.json`);
          if (outcome.kind === "missing") return null;
          const pin = readPin(outcome.body);
          if (!pin?.sha) return null;
          return {
            spec,
            edition,
            sha: pin.sha,
            live: true,
            ...(pin.fetched_at ? { fetched_at: pin.fetched_at } : {}),
            ...(pin.biblio_commit ? { biblio_commit: pin.biblio_commit } : {}),
          };
        })(),
      );
    }
  }
  const rows = await Promise.all(probes);
  const out: SnapshotRow[] = rows.filter((r): r is SnapshotRow => r !== null);
  // Sort: spec → edition → sha for deterministic output.
  out.sort(
    (a, b) =>
      a.spec.localeCompare(b.spec) ||
      a.edition.localeCompare(b.edition) ||
      a.sha.localeCompare(b.sha),
  );
  return {
    ...(args.spec ? { spec_filter: args.spec } : {}),
    ...(args.edition ? { edition_filter: args.edition } : {}),
    snapshots: out,
  };
}
