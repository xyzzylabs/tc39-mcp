// Minimal in-memory R2Bucket impl for tests. Covers exactly the
// subset of the R2 API the Worker uses: `get(key)` returning an
// object with `text()`, and `list({ prefix, cursor })` returning
// `{ objects, truncated, cursor }`. Anything else throws.

import type { R2Bucket, R2Object, R2ObjectBody, R2Objects } from "@cloudflare/workers-types";

export interface FakeR2Options {
  /** initial contents, keyed by object name */
  contents?: Record<string, string>;
}

interface FakeR2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  list(args?: { prefix?: string; cursor?: string; limit?: number }): Promise<R2Objects>;
  put(key: string, value: string): Promise<R2Object>;
  delete(key: string): Promise<void>;
  /** test-only inspection helpers */
  __get_count(key: string): number;
  __list_count(): number;
  __reset_counts(): void;
}

export function createFakeR2(opts: FakeR2Options = {}): R2Bucket {
  const store = new Map<string, string>(Object.entries(opts.contents ?? {}));
  const getCounts = new Map<string, number>();
  let listCount = 0;

  const bucket: FakeR2Bucket = {
    async get(key: string) {
      getCounts.set(key, (getCounts.get(key) ?? 0) + 1);
      const value = store.get(key);
      if (value === undefined) return null;
      // Minimal R2ObjectBody surface: `.text()` plus a `body`
      // ReadableStream. The /r2/ proxy returns `obj.body` directly so
      // production responses stream; tests need the stream too.
      const bytes = new TextEncoder().encode(value);
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      return {
        key,
        size: value.length,
        etag: `etag-${key}`,
        body,
        async text() {
          return value;
        },
      } as unknown as R2ObjectBody;
    },
    async list(args = {}) {
      listCount++;
      const prefix = args.prefix ?? "";
      const matching = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .sort();
      // No pagination in fake — return everything at once.
      const objects: R2Object[] = matching.map(
        (key) =>
          ({
            key,
            size: store.get(key)!.length,
          }) as unknown as R2Object,
      );
      return {
        objects,
        truncated: false,
        cursor: undefined,
        delimitedPrefixes: [],
      } as unknown as R2Objects;
    },
    async put(key: string, value: string) {
      store.set(key, value);
      return { key, size: value.length } as unknown as R2Object;
    },
    async delete(key: string) {
      store.delete(key);
    },
    __get_count(key) {
      return getCounts.get(key) ?? 0;
    },
    __list_count() {
      return listCount;
    },
    __reset_counts() {
      getCounts.clear();
      listCount = 0;
    },
  };

  return bucket as unknown as R2Bucket;
}

/** Type-narrow helper for tests that want the inspection helpers. */
export function asFakeR2(bucket: R2Bucket): {
  __get_count: (key: string) => number;
  __list_count: () => number;
  __reset_counts: () => void;
} {
  return bucket as unknown as {
    __get_count: (key: string) => number;
    __list_count: () => number;
    __reset_counts: () => void;
  };
}

/** A scriptable rate limiter for tests. Defaults to always-allow;
 *  call `.deny()` to flip into deny-mode for the next N requests. */
export function createFakeRateLimiter(opts: { denyAll?: boolean } = {}): {
  limit(args: { key: string }): Promise<{ success: boolean }>;
  /** Tracks every key that was checked, for assertions. */
  __calls: string[];
} {
  const calls: string[] = [];
  return {
    async limit({ key }: { key: string }) {
      calls.push(key);
      return { success: !opts.denyAll };
    },
    __calls: calls,
  };
}

/** Build a syntactically-valid `ParsedSpec`-shape JSON string. */
export function fakeSpecJson(opts: {
  spec: string;
  edition: string;
  sha?: string;
  clauses?: Record<string, { id: string; aoid?: string | null; title?: string }>;
  fetched_at?: string;
  biblio_commit?: string;
}): string {
  const clauses: Record<string, unknown> = {};
  for (const [id, c] of Object.entries(opts.clauses ?? {})) {
    clauses[id] = {
      meta: {
        id,
        aoid: c.aoid ?? null,
        title: c.title ?? "",
        number: "0",
        kind: "clause",
      },
      signatureRaw: null,
      algorithms: [],
      notes: [],
      crossrefs: [],
    };
  }
  return JSON.stringify({
    pin: {
      spec: opts.spec,
      edition: opts.edition,
      sha: opts.sha ?? "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      fetched_at: opts.fetched_at ?? "2026-05-30T00:00:00.000Z",
      biblio_commit: opts.biblio_commit,
    },
    clauses,
    tables: {},
    grammar: [],
  });
}

/** Build a syntactically-valid test262 index JSON string. */
export function fakeTest262IndexJson(opts: {
  sha: string;
  testCount?: number;
  generatedAt?: string;
}): string {
  const tests = Array.from({ length: opts.testCount ?? 3 }, (_, i) => ({
    path: `test/built-ins/x${i}.js`,
    esid: `sec-x${i}`,
    description: `Test ${i}`,
  }));
  return JSON.stringify({
    version: 1,
    test262_sha: opts.sha,
    generated_at: opts.generatedAt ?? "2026-05-30T00:00:00.000Z",
    tests,
  });
}

/** Build a syntactically-valid proposals index JSON string. */
export function fakeProposalsIndexJson(opts: {
  sha: string;
  proposals?: { slug: string; name: string; stage: string; champions?: string[] }[];
  generatedAt?: string;
}): string {
  return JSON.stringify({
    version: 1,
    proposals_sha: opts.sha,
    generated_at: opts.generatedAt ?? "2026-05-30T00:00:00.000Z",
    proposals: (opts.proposals ?? []).map((p) => ({
      slug: p.slug,
      name: p.name,
      stage: p.stage,
      authors: [],
      champions: p.champions ?? [],
      source_file: "README.md",
    })),
  });
}
