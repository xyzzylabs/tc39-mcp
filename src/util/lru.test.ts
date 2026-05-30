import { describe, it, expect } from "vitest";
import { LruMap } from "./lru.js";

describe("LruMap — basics", () => {
  it("stores and retrieves values", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1);
    expect(m.get("a")).toBe(1);
    expect(m.has("a")).toBe(true);
    expect(m.size).toBe(1);
  });

  it("returns undefined for unknown keys", () => {
    const m = new LruMap<string, number>(3);
    expect(m.get("nope")).toBeUndefined();
    expect(m.has("nope")).toBe(false);
  });

  it("delete removes a key", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1);
    expect(m.delete("a")).toBe(true);
    expect(m.has("a")).toBe(false);
    expect(m.delete("a")).toBe(false);
  });

  it("clear wipes the map", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1);
    m.set("b", 2);
    m.clear();
    expect(m.size).toBe(0);
  });
});

describe("LruMap — eviction", () => {
  it("evicts the oldest entry when capacity is exceeded", () => {
    const m = new LruMap<string, number>(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("c", 3);
    expect(m.has("a")).toBe(false); // evicted
    expect(m.has("b")).toBe(true);
    expect(m.has("c")).toBe(true);
    expect(m.size).toBe(2);
  });

  it("`get` bumps a key to MRU, sparing it from eviction", () => {
    const m = new LruMap<string, number>(2);
    m.set("a", 1);
    m.set("b", 2);
    m.get("a"); // a is now MRU; b is LRU
    m.set("c", 3); // evicts b
    expect(m.has("a")).toBe(true);
    expect(m.has("b")).toBe(false);
    expect(m.has("c")).toBe(true);
  });

  it("re-`set`ting an existing key updates value + position", () => {
    const m = new LruMap<string, number>(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("a", 10); // a is now MRU; b is LRU
    m.set("c", 3); // evicts b
    expect(m.get("a")).toBe(10);
    expect(m.has("b")).toBe(false);
    expect(m.has("c")).toBe(true);
  });
});

describe("LruMap — validation", () => {
  it("rejects non-positive capacity", () => {
    expect(() => new LruMap<string, number>(0)).toThrow(RangeError);
    expect(() => new LruMap<string, number>(-1)).toThrow(RangeError);
  });

  it("rejects non-integer capacity", () => {
    expect(() => new LruMap<string, number>(1.5)).toThrow(RangeError);
    expect(() => new LruMap<string, number>(NaN)).toThrow(RangeError);
  });
});

describe("LruMap — capacity-1 edge case", () => {
  it("keeps only the most recent entry with capacity 1", () => {
    const m = new LruMap<string, number>(1);
    m.set("a", 1);
    m.set("b", 2);
    expect(m.has("a")).toBe(false);
    expect(m.get("b")).toBe(2);
  });
});
