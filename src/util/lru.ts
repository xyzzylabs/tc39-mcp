// Minimal LRU map. Used to bound the in-memory parsed-spec cache so a
// long-running server's RSS doesn't drift up as different (spec,
// edition) pairs are touched.
//
// Implementation note: relies on JavaScript Map's insertion-order
// iteration. On a `get` hit we delete + re-set the entry to push it
// to the recently-used end. On a `set` when at capacity we drop the
// oldest entry (iteration's first key). O(1) per operation.

export class LruMap<K, V> {
  private readonly capacity: number;
  private readonly store = new Map<K, V>();

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`LruMap capacity must be a positive integer; got ${capacity}`);
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.store.size;
  }

  get(key: K): V | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    // Bump to MRU position.
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Evict the oldest entry — iteration order's first key.
      const oldest = this.store.keys().next().value as K | undefined;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, value);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Iterate keys in LRU-order (oldest first). */
  keys(): IterableIterator<K> {
    return this.store.keys();
  }
}
