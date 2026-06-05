// Pure `clause.outline` tree-building, shared by the stdio server and
// the Cloudflare Worker so both transports build the section tree
// identically. Dependency-free (no node:fs / parser imports) so the
// Worker bundles it directly, like ./search.ts and ./catalog.ts.

/** The minimal clause shape the outline reads: just the section number,
 *  title, and kind. Structurally satisfied by both transports' clause
 *  metadata. */
export interface OutlineClause {
  meta: { number?: string | null; title?: string | null; kind?: string | null };
}

/** One node in the section tree. Children are sub-sections nested under
 *  this clause's section number. */
export interface OutlineNode {
  id: string;
  number: string;
  title: string;
  kind: string;
  children: OutlineNode[];
}

/** The built section tree, without the echoed `spec` field (each
 *  transport adds that). */
export interface OutlineTree {
  node_count: number;
  roots: OutlineNode[];
}

/** Section-number comparator. Numeric segments compare numerically;
 *  annex letters (A, B, …) sort after any numeric prefix. */
export function compareSectionNumbers(a: string, b: string): number {
  const aP = a.split(".");
  const bP = b.split(".");
  const n = Math.min(aP.length, bP.length);
  for (let i = 0; i < n; i++) {
    const aS = aP[i]!;
    const bS = bP[i]!;
    const aIsAnnex = /^[A-Z]+$/.test(aS);
    const bIsAnnex = /^[A-Z]+$/.test(bS);
    if (aIsAnnex !== bIsAnnex) return aIsAnnex ? 1 : -1;
    if (aIsAnnex && bIsAnnex) {
      if (aS !== bS) return aS < bS ? -1 : 1;
      continue;
    }
    const aN = parseInt(aS, 10);
    const bN = parseInt(bS, 10);
    if (aN !== bN) return aN - bN;
  }
  return aP.length - bP.length;
}

/** Build the section tree from a spec's clauses. `depth` caps how deep
 *  the tree descends (1 = top-level only); `under` limits the tree to
 *  descendants of one clause id. */
export function buildOutline(
  clauses: Record<string, OutlineClause>,
  opts: { depth?: number; under?: string },
): OutlineTree {
  const maxDepth = opts.depth;

  interface Row {
    id: string;
    number: string;
    title: string;
    kind: string;
    parts: string[];
  }
  const rows: Row[] = [];
  for (const [id, c] of Object.entries(clauses)) {
    const number = c.meta.number ?? "";
    if (!number) continue;
    rows.push({
      id,
      number,
      title: c.meta.title ?? "",
      kind: c.meta.kind ?? "unknown",
      parts: number.split("."),
    });
  }
  rows.sort((a, b) => compareSectionNumbers(a.number, b.number));

  // If `under` is set, find the anchor's number prefix; only keep rows
  // whose parts begin with the same prefix (and skip the anchor itself
  // from its own descendant list).
  let anchorParts: string[] | null = null;
  if (opts.under) {
    const anchor = clauses[opts.under];
    if (anchor && anchor.meta.number) {
      anchorParts = anchor.meta.number.split(".");
    } else {
      return { node_count: 0, roots: [] };
    }
  }

  // Build the tree. Walk rows in section order and attach each to its
  // parent via a depth-indexed stack so the parent lookup is O(1).
  const stack: { parts: string[]; node: OutlineNode }[] = [];
  const roots: OutlineNode[] = [];
  let nodeCount = 0;

  for (const row of rows) {
    if (anchorParts) {
      if (row.parts.length <= anchorParts.length) continue;
      let ok = true;
      for (let i = 0; i < anchorParts.length; i++) {
        if (row.parts[i] !== anchorParts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    // Effective depth: relative to anchor (or absolute).
    const effDepth = anchorParts
      ? row.parts.length - anchorParts.length
      : row.parts.length;
    if (maxDepth && effDepth > maxDepth) continue;

    const node: OutlineNode = {
      id: row.id,
      number: row.number,
      title: row.title,
      kind: row.kind,
      children: [],
    };

    // Pop stack frames that aren't on the current path. A parent's parts
    // must be a strict prefix of the current row's parts.
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const tp = top.parts;
      if (tp.length < row.parts.length && tp.every((s, i) => row.parts[i] === s)) {
        break;
      }
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1]!.node.children.push(node);
    }
    stack.push({ parts: row.parts, node });
    nodeCount++;
  }

  return { node_count: nodeCount, roots };
}
