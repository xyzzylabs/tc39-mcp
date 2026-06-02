// Orchestrator for the cache → fetch → bundled fallback chain.
//
// Given an R2 key, returns the body bytes following this strategy:
//
//   Immutable key (per-SHA, matches /-[a-f0-9]{10}\.json$/):
//     1. Cache hit → return cached.
//     2. Else fetch → cache + return.
//     3. Else bundled fallback (only meaningful for the very
//        snapshot SHAs the tarball happened to ship).
//
//   Live key (live `*-main.json` / `*-<edition>.json` / index files):
//     1. Pointer fresh (< POINTER_TTL_MS) + cache hit → return cached.
//     2. Pointer stale or missing:
//        a. Fetch with If-None-Match if a previous etag is known.
//        b. On 200 → write snapshot + pointer, return new bytes.
//        c. On 304 → refresh pointer timestamp, return cached.
//        d. On not-found / unavailable → return cached if present,
//           else bundled fallback, else null.
//
// The loader never throws on network or filesystem failure. Callers
// expect best-effort and handle null as "no data available."

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POINTER_TTL_MS,
  SnapshotCache,
  defaultCacheRoot,
  pointerIsFresh,
  type LatestPointer,
} from "./cache.js";
import { fetchSnapshot, type FetchOptions, type FetchResult } from "./fetcher.js";

/** Bundled-fallback directory. The npm tarball ships a minimal set of
 *  snapshots under `<root>/build/` so a cold-start with no network
 *  still returns _something_ for the most-used (spec, edition) pairs. */
export interface LoaderOptions {
  /** Cache instance; defaults to one rooted at `defaultCacheRoot()`. */
  cache?: SnapshotCache;
  /** Bundled fallback directory; defaults to `<package>/build`. */
  bundleDir?: string;
  /** Base URL passed to the fetcher. */
  baseUrl?: string;
  /** `fetch` implementation (tests inject a fake). */
  fetchImpl?: typeof fetch;
  /** Clock for pointer freshness checks + new pointer timestamps. */
  nowMs?: () => number;
  /** Per-request timeout in ms, passed to the fetcher. */
  timeoutMs?: number;
}

/** True when `key` is content-addressed (per-SHA) and therefore
 *  immutable once fetched. */
export function isImmutableKey(key: string): boolean {
  return /-[a-f0-9]{10}\.json$/.test(key);
}

export type LoadOutcome =
  /** Bytes available — from cache, network, or bundle. */
  | { kind: "ok"; body: string; source: "cache" | "network" | "bundle" }
  /** Nothing reachable. Caller decides whether to throw or return empty. */
  | { kind: "missing"; reason: string };

/** Top-level loader. Returns bytes plus a source tag so the caller
 *  can log which layer served the request (useful for tests + ops). */
export async function loadSnapshot(
  key: string,
  opts: LoaderOptions = {},
): Promise<LoadOutcome> {
  const cache = opts.cache ?? new SnapshotCache(defaultCacheRoot());
  const bundleDir = opts.bundleDir ?? defaultBundleDir();
  const fetchOpts: FetchOptions = {
    baseUrl: opts.baseUrl,
    fetchImpl: opts.fetchImpl,
    nowMs: opts.nowMs,
    timeoutMs: opts.timeoutMs,
  };

  if (isImmutableKey(key)) {
    return loadImmutable(key, cache, bundleDir, fetchOpts);
  }
  return loadLive(key, cache, bundleDir, fetchOpts, opts.nowMs ?? Date.now);
}

async function loadImmutable(
  key: string,
  cache: SnapshotCache,
  bundleDir: string,
  fetchOpts: FetchOptions,
): Promise<LoadOutcome> {
  // Per-SHA pins never change once written. Cache → fetch → bundle.
  const cached = cache.readSnapshot(key);
  if (cached !== null) return { kind: "ok", body: cached, source: "cache" };

  const fetched = await fetchSnapshot(key, fetchOpts);
  if (fetched.kind === "ok") {
    cache.writeSnapshot(key, fetched.snapshot.body);
    return { kind: "ok", body: fetched.snapshot.body, source: "network" };
  }

  const fromBundle = readBundle(bundleDir, key);
  if (fromBundle !== null) {
    return { kind: "ok", body: fromBundle, source: "bundle" };
  }

  return {
    kind: "missing",
    reason:
      fetched.kind === "not-found"
        ? `Snapshot ${key} is not in R2 and not bundled.`
        : `Snapshot ${key}: network unavailable (${
            fetched.kind === "unavailable" ? fetched.reason : fetched.kind
          }) and no bundled copy.`,
  };
}

async function loadLive(
  key: string,
  cache: SnapshotCache,
  bundleDir: string,
  fetchOpts: FetchOptions,
  now: () => number,
): Promise<LoadOutcome> {
  const cached = cache.readSnapshot(key);
  const pointer = cache.readPointer(key);

  // Fast path: pointer is fresh and we have the bytes locally.
  if (cached !== null && pointer !== null && pointerIsFresh(pointer, now())) {
    return { kind: "ok", body: cached, source: "cache" };
  }

  // Stale or missing pointer — try the network. Hand the existing
  // etag along so the server can answer 304.
  const fetched = await fetchSnapshot(key, {
    ...fetchOpts,
    ifNoneMatch: pointer?.etag,
  });

  if (fetched.kind === "ok") {
    cache.writeSnapshot(key, fetched.snapshot.body);
    cache.writePointer(key, fetched.snapshot.pointer);
    return { kind: "ok", body: fetched.snapshot.body, source: "network" };
  }

  if (fetched.kind === "not-modified" && cached !== null) {
    // Server confirmed cache is current — refresh the pointer's
    // timestamp so we don't re-probe on every load.
    cache.writePointer(key, {
      key,
      etag: fetched.etag,
      resolved_at: fetched.nowIso,
    });
    return { kind: "ok", body: cached, source: "cache" };
  }

  // Network failed in some way. Try cache, then bundle.
  if (cached !== null) {
    return { kind: "ok", body: cached, source: "cache" };
  }
  const fromBundle = readBundle(bundleDir, key);
  if (fromBundle !== null) {
    return { kind: "ok", body: fromBundle, source: "bundle" };
  }

  return {
    kind: "missing",
    reason: describeFailure(key, fetched),
  };
}

function readBundle(bundleDir: string, key: string): string | null {
  const p = join(bundleDir, key);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function describeFailure(key: string, fetched: FetchResult): string {
  switch (fetched.kind) {
    case "not-found":
      return `Snapshot ${key} is not in R2 and not bundled.`;
    case "unavailable":
      return `Snapshot ${key}: network unavailable (${fetched.reason}) and no cached or bundled copy.`;
    case "not-modified":
      return `Snapshot ${key}: server returned 304 but no cached copy to serve.`;
    case "ok":
      return `Snapshot ${key}: unreachable.`;
  }
}

function defaultBundleDir(): string {
  // ESM-safe resolution of the package root → ./build.
  const here = new URL("..", import.meta.url).pathname;
  return join(here, "..", "build");
}

export { POINTER_TTL_MS, pointerIsFresh, SnapshotCache, type LatestPointer };
