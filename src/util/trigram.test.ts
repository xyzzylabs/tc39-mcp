import { describe, it, expect } from "vitest";
import { trigramSimilarity } from "./trigram.js";

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("foo", "foo")).toBe(1);
    expect(trigramSimilarity("ToNumber", "ToNumber")).toBe(1);
  });

  it("returns 0 for empty input", () => {
    expect(trigramSimilarity("", "foo")).toBe(0);
    expect(trigramSimilarity("foo", "")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(trigramSimilarity("ToNumber", "tonumber")).toBe(1);
    expect(trigramSimilarity("ToNumber", "TONUMBER")).toBe(1);
  });

  it("gives meaningful scores to transposition typos", () => {
    // "tonumebr" vs "tonumber" — transposed last 2 chars. Transpositions
    // are actually one of trigram-similarity's weaker cases because each
    // swap disrupts up to 3 trigrams, but a single such typo should
    // still clear the 0.4 floor we use in spec.search.
    const sim = trigramSimilarity("tonumebr", "tonumber");
    expect(sim).toBeGreaterThan(0.4);
    expect(sim).toBeLessThan(1);
  });

  it("gives high scores to off-by-one variants", () => {
    expect(trigramSimilarity("tonumber", "tonumbr")).toBeGreaterThan(0.5);
    expect(trigramSimilarity("tonumber", "tonumberr")).toBeGreaterThan(0.5);
  });

  it("gives low scores to unrelated strings", () => {
    expect(trigramSimilarity("tonumber", "regexp")).toBeLessThan(0.2);
    expect(trigramSimilarity("foo", "xyz")).toBeLessThan(0.1);
  });

  it("ranks closer matches higher than farther ones", () => {
    const closer = trigramSimilarity("tonumber", "tonumbr");
    const farther = trigramSimilarity("tonumber", "tostring");
    expect(closer).toBeGreaterThan(farther);
  });

  it("is symmetric", () => {
    expect(trigramSimilarity("abc", "abcd")).toBe(
      trigramSimilarity("abcd", "abc"),
    );
  });
});
