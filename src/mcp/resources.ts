// MCP `resources` capability — exposes parsed clauses as URI-
// addressable static documents. Clients that prefer fetching content
// by URI rather than calling tools get a parallel surface to
// `clause.get`.
//
// URI shape:
//   tc39://<spec>/<edition>/<clause-id>
//
// Examples:
//   tc39://262/latest/sec-tonumber
//   tc39://262/main/sec-typedarray
//   tc39://402/main/sec-intl.numberformat
//
// Resource listing (`resources/list`) returns the top-level clauses
// of each loaded snapshot — listing every clause across all editions
// would explode (~30,000 entries). Clients walk into nested clauses
// via templates or by reading the parent's `crossrefs`.

import {
  CONCRETE_EDITIONS,
  SPEC_VALUES,
  resolveEdition,
  type Edition,
  type Spec,
} from "../editions.js";
import { loadSpec } from "./tools/clause.js";

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

const URI_RE = /^tc39:\/\/(\d+)\/([a-z0-9-]+)\/(.+)$/;

/** Parse a tc39:// URI into its parts. Returns null on malformed
 *  input so the caller can surface a clear error. */
export function parseResourceUri(
  uri: string,
): { spec: string; edition: string; id: string } | null {
  const m = URI_RE.exec(uri);
  if (!m) return null;
  return { spec: m[1]!, edition: m[2]!, id: m[3]! };
}

/** Build the canonical URI for a (spec, edition, clause id). The
 *  edition is left as the caller-provided alias (`latest`, `main`,
 *  `es2025` …) — we don't force resolution here so the URI a client
 *  saved last week still points where they expect it to. */
export function buildResourceUri(
  spec: Spec,
  edition: Edition,
  id: string,
): string {
  return `tc39://${spec}/${edition}/${id}`;
}

/** List resources: one entry per top-level clause across every
 *  supported (spec, edition). Top-level = section number with no
 *  dot, i.e. "1", "16", "A". Limits the result to the first N
 *  clauses per snapshot so the response stays under MCP's normal
 *  message-size budget. */
export async function listResources(args: { per_snapshot?: number } = {}): Promise<{
  resources: ResourceDescriptor[];
}> {
  const cap = args.per_snapshot ?? 50;
  const out: ResourceDescriptor[] = [];
  for (const spec of SPEC_VALUES) {
    for (const edition of CONCRETE_EDITIONS) {
      let parsed;
      try {
        parsed = await loadSpec(spec, edition);
      } catch {
        continue;
      }
      const tops = Object.entries(parsed.clauses).filter(
        ([, c]) =>
          (c.meta.number ?? "").length > 0 &&
          !(c.meta.number ?? "").includes("."),
      );
      let added = 0;
      for (const [id, c] of tops) {
        out.push({
          uri: buildResourceUri(spec, edition, id),
          name: `${c.meta.number} ${c.meta.title}`,
          description: `Top-level clause in ECMA-${spec} (${edition})`,
          mimeType: "application/json",
        });
        added++;
        if (added >= cap) break;
      }
    }
  }
  return { resources: out };
}

/** Fetch a single resource. Returns the parsed clause as JSON. */
export async function readResource(uri: string): Promise<{
  contents: { uri: string; mimeType: string; text: string }[];
}> {
  const parts = parseResourceUri(uri);
  if (!parts) {
    throw new Error(
      `Invalid tc39:// URI: ${uri}. Expected tc39://<spec>/<edition>/<clause-id>.`,
    );
  }
  if (!SPEC_VALUES.includes(parts.spec as Spec)) {
    throw new Error(`Unknown spec in URI: ${parts.spec}`);
  }
  const spec = parts.spec as Spec;
  const edition = parts.edition as Edition;
  const concrete = resolveEdition(spec, edition);
  const parsed = await loadSpec(spec, concrete);
  const clause = parsed.clauses[parts.id];
  if (!clause) {
    throw new Error(`No such clause in ${spec}/${concrete}: ${parts.id}`);
  }
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(clause, null, 2),
      },
    ],
  };
}
