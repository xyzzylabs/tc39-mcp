// HTTP fetcher for parsed-snapshot artifacts served by the hosted
// Worker's `/r2/<key>` proxy.
//
// The fetcher's only job is to turn an R2 key into either bytes + a
// fresh-pointer record, or a `null` "not available right now" signal
// that the caller can treat as "fall back to cache or bundled." It
// never throws on network failures or non-2xx responses — the loader
// chain is supposed to be best-effort.

import type { LatestPointer } from "./cache.js";

/** Default origin for the public /r2/ proxy. Pointed at the canonical
 *  hosted deployment. Overridable via `TC39_MCP_BASE_URL` (e.g. to
 *  test against a staging Worker or a self-hosted copy). */
const DEFAULT_BASE_URL = "https://tc39-mcp.chicoxyzzy.workers.dev";

/** Resolve the base URL to fetch snapshots from. */
export function resolveBaseUrl(envBaseUrl?: string): string {
  const raw = envBaseUrl ?? process.env.TC39_MCP_BASE_URL;
  if (raw && raw.length > 0) {
    return raw.replace(/\/+$/, "");
  }
  return DEFAULT_BASE_URL;
}

/** Result of a successful fetch: the body bytes + a pointer record
 *  the cache layer can persist. */
export interface FetchedSnapshot {
  /** Raw response body. JSON, but returned as a string so the cache
   *  can persist verbatim bytes without an extra serialize step. */
  body: string;
  /** Pointer record describing when this snapshot was fetched. */
  pointer: LatestPointer;
}

export interface FetchOptions {
  /** Override the base URL. Defaults to `resolveBaseUrl()`. */
  baseUrl?: string;
  /** Override the `fetch` implementation (tests inject a fake). */
  fetchImpl?: typeof fetch;
  /** Override the clock for pointer timestamps (tests). */
  nowMs?: () => number;
  /** Per-request timeout in ms. Defaults to 10_000 (10 s). */
  timeoutMs?: number;
  /** Existing pointer for `If-None-Match` so the server can answer
   *  304 instead of re-sending the body. The cache layer hands this
   *  in to avoid redundant network bytes on a re-validation request. */
  ifNoneMatch?: string;
}

export type FetchResult =
  /** Successful 200 with body + pointer. */
  | { kind: "ok"; snapshot: FetchedSnapshot }
  /** Server confirmed the cached copy is still current. The cache
   *  layer should refresh its pointer timestamp without rewriting the
   *  snapshot body. */
  | { kind: "not-modified"; etag: string; nowIso: string }
  /** Key is allowlisted but no longer in R2 (deleted upstream). */
  | { kind: "not-found" }
  /** Anything else — network error, 5xx, timeout. Caller falls back. */
  | { kind: "unavailable"; reason: string };

/** Fetch a snapshot from the public `/r2/<key>` proxy. Never throws. */
export async function fetchSnapshot(
  key: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const fetcher = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.nowMs ?? Date.now;
  const baseUrl = opts.baseUrl ?? resolveBaseUrl();
  const url = `${baseUrl}/r2/${encodeURIComponent(key)}`;
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (opts.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch (e) {
    return {
      kind: "unavailable",
      reason: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }

  const nowIso = new Date(now()).toISOString();

  if (response.status === 304) {
    const etag = stripWeak(response.headers.get("etag") ?? opts.ifNoneMatch ?? "");
    return { kind: "not-modified", etag, nowIso };
  }
  if (response.status === 404) {
    return { kind: "not-found" };
  }
  if (!response.ok) {
    return {
      kind: "unavailable",
      reason: `HTTP ${response.status}`,
    };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (e) {
    return {
      kind: "unavailable",
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  return {
    kind: "ok",
    snapshot: {
      body,
      pointer: {
        key,
        etag: stripWeak(response.headers.get("etag") ?? ""),
        resolved_at: nowIso,
      },
    },
  };
}

/** Strip the `W/` weak-validator prefix and the surrounding quotes
 *  off an ETag value so cached etags compare on canonical form. */
function stripWeak(etag: string): string {
  return etag.replace(/^W\//, "").replace(/^"|"$/g, "");
}
