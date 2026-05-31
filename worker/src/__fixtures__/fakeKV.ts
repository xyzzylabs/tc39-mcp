// Minimal in-memory KVNamespace impl for tests. Covers exactly the
// subset of the Cloudflare KV API the sponsor auth middleware uses:
// `get(key, "json")` returning either a parsed value or `null`.
//
// Construct with `createFakeKV({ entries: { "<hash>": { ... } } })`.

import type { KVNamespace } from "@cloudflare/workers-types";

export interface FakeKVOptions {
  /** initial entries, keyed by stored key. Values can be raw JSON
   *  blobs (already JSON-stringified) OR plain objects — the helper
   *  serializes objects automatically. */
  entries?: Record<string, unknown>;
  /** When set, every get() call rejects with this error — useful for
   *  asserting the auth middleware's KV-outage path is graceful. */
  throwOnGet?: Error;
}

interface FakeKVStore {
  get(key: string, type?: "json" | "text"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  __get_count(key: string): number;
  __reset_counts(): void;
}

export function createFakeKV(opts: FakeKVOptions = {}): KVNamespace {
  const store = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const [k, v] of Object.entries(opts.entries ?? {})) {
    store.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const ns: FakeKVStore = {
    async get(key, type) {
      if (opts.throwOnGet) throw opts.throwOnGet;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (type === "json") return JSON.parse(raw);
      return raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    __get_count(key) {
      return counts.get(key) ?? 0;
    },
    __reset_counts() {
      counts.clear();
    },
  };
  return ns as unknown as KVNamespace;
}

export function asFakeKV(ns: KVNamespace): FakeKVStore {
  return ns as unknown as FakeKVStore;
}
