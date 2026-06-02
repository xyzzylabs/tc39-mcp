// Local on-disk cache for snapshots fetched from R2.
//
// Layout under the cache root (default `~/.cache/tc39-mcp/`, override
// via `XDG_CACHE_HOME` or the explicit `root` argument):
//
//   snapshots/spec-262-main.json
//   snapshots/spec-262-main-abc1234567.json    (historical pin)
//   snapshots/test262-index.json
//   pointers/spec-262-main.json                ({ key, etag, resolved_at })
//
// `snapshots/` holds the actual content addressable by R2 key. Per-SHA
// pins are immutable; live `*-main.json` files are overwritten on
// every refresh. `pointers/` holds a per-live-key record of when we
// last verified freshness against R2, so we can short-circuit the
// HEAD-to-Worker call within a TTL window.
//
// Writes are atomic via `<target>.<pid>.tmp` → `rename`, so concurrent
// readers always see either the previous file or the next file, never
// partial bytes.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Pointer recorded for each live (non-immutable) R2 key the loader
 *  has resolved against R2 at least once. The pointer is the only
 *  thing the loader needs to know "do I need to re-check R2 yet?". */
export interface LatestPointer {
  /** The R2 key this pointer is about. */
  key: string;
  /** ETag returned by the last R2 GET. Stored so we can hand it back
   *  as `If-None-Match` for a cheap freshness check. */
  etag: string;
  /** ISO timestamp of the resolution. The pointer goes stale at
   *  `resolved_at + POINTER_TTL_MS`. */
  resolved_at: string;
}

/** TTL for a live-key pointer. Matches the upstream refresh cadence
 *  (every 4 h). Within this window the cached snapshot is treated as
 *  authoritative and no R2 HEAD is issued. */
export const POINTER_TTL_MS = 4 * 60 * 60 * 1000;

/** Resolve the default cache root: `$XDG_CACHE_HOME/tc39-mcp` if the
 *  env var is set (XDG Base Directory spec), else `~/.cache/tc39-mcp`. */
export function defaultCacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache");
  return join(base, "tc39-mcp");
}

/** Local-disk cache for parsed-snapshot artifacts. One instance per
 *  cache root. Tests construct a SnapshotCache pointed at a temp dir
 *  so they don't touch the user's real cache. */
export class SnapshotCache {
  constructor(private readonly root: string = defaultCacheRoot()) {}

  /** Absolute path the snapshot for `key` would live at if cached. */
  snapshotPath(key: string): string {
    return join(this.root, "snapshots", key);
  }

  /** Absolute path of the pointer file for live key `key`. */
  pointerPath(key: string): string {
    return join(this.root, "pointers", `${key}.json`);
  }

  /** Read a cached snapshot's raw text, or null if not cached. */
  readSnapshot(key: string): string | null {
    const p = this.snapshotPath(key);
    if (!existsSync(p)) return null;
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  }

  /** Atomically write a snapshot's bytes to the cache. */
  writeSnapshot(key: string, body: string): void {
    const p = this.snapshotPath(key);
    mkdirSync(dirname(p), { recursive: true });
    atomicWrite(p, body);
  }

  /** Read the pointer for live key `key`, or null if not present or
   *  unparseable. Callers should validate `pointerIsFresh(p)` before
   *  trusting the pointer. */
  readPointer(key: string): LatestPointer | null {
    const p = this.pointerPath(key);
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as LatestPointer;
      if (typeof raw.key !== "string" || typeof raw.etag !== "string") {
        return null;
      }
      if (typeof raw.resolved_at !== "string") return null;
      return raw;
    } catch {
      return null;
    }
  }

  /** Atomically write a pointer for live key `key`. */
  writePointer(key: string, pointer: LatestPointer): void {
    const p = this.pointerPath(key);
    mkdirSync(dirname(p), { recursive: true });
    atomicWrite(p, JSON.stringify(pointer));
  }

  /** Delete a cached snapshot (e.g. on detected corruption). No-op if
   *  it doesn't exist. */
  deleteSnapshot(key: string): void {
    const p = this.snapshotPath(key);
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // Best-effort; ignore. The next write replaces it.
      }
    }
  }
}

/** True when the pointer is younger than POINTER_TTL_MS. Past that,
 *  the loader should re-check R2 before serving from the snapshot. */
export function pointerIsFresh(p: LatestPointer, nowMs: number = Date.now()): boolean {
  const resolvedAt = new Date(p.resolved_at).getTime();
  if (!Number.isFinite(resolvedAt)) return false;
  return nowMs - resolvedAt < POINTER_TTL_MS;
}

/** Write `body` to `target` via a `<target>.<pid>.tmp` + rename so a
 *  concurrent reader never observes a half-written file. */
function atomicWrite(target: string, body: string): void {
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, target);
}
