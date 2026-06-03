import { describe, it, expect } from "vitest";
import { bucketize, classify, PHASE_ORDER } from "./classify.js";

describe("classify", () => {
  it("recognizes live main snapshots", () => {
    expect(classify("spec-262-main.json")).toBe("live-main");
    expect(classify("spec-402-main.json")).toBe("live-main");
  });

  it("recognizes historical SHA-pinned snapshots", () => {
    expect(classify("spec-262-main-abc1234567.json")).toBe("historical-pin");
    expect(classify("spec-402-main-deadbeef00.json")).toBe("historical-pin");
  });

  it("recognizes pinned-edition snapshots (262 + 402)", () => {
    expect(classify("spec-262-es2016.json")).toBe("pinned-edition");
    expect(classify("spec-262-es2025.json")).toBe("pinned-edition");
    expect(classify("spec-402-es2024.json")).toBe("pinned-edition");
  });

  it("recognizes side indices", () => {
    expect(classify("test262-index.json")).toBe("side-index");
    expect(classify("proposals-index.json")).toBe("side-index");
  });

  it("returns 'unknown' for files outside the known taxonomy", () => {
    expect(classify("readme.json")).toBe("unknown");
    expect(classify("spec-262-main.json.tmp")).toBe("unknown");
    expect(classify("spec-262-nightly.json")).toBe("unknown");
    expect(classify("spec-263-main.json")).toBe("unknown"); // wrong spec number
  });

  it("doesn't confuse historical-pin keys with live main", () => {
    // Defensive: hist-pin pattern has a hex suffix; live-main doesn't.
    expect(classify("spec-262-main-abc.json")).toBe("historical-pin");
    expect(classify("spec-262-main.json")).toBe("live-main");
  });
});

describe("PHASE_ORDER", () => {
  it("places historical pins + indices first, live mains last", () => {
    expect(PHASE_ORDER).toEqual([
      "historical-pin",
      "side-index",
      "pinned-edition",
      "live-main",
    ]);
  });

  it("'live-main' is the FINAL phase (atomic-ish pointer flip)", () => {
    expect(PHASE_ORDER[PHASE_ORDER.length - 1]).toBe("live-main");
  });
});

describe("bucketize", () => {
  it("groups every file by its classified kind", () => {
    const names = [
      "spec-262-main.json",
      "spec-262-main-abc1234567.json",
      "spec-262-es2025.json",
      "test262-index.json",
      "spec-402-main.json",
      "spec-402-main-deadbeef00.json",
      "spec-402-es2024.json",
      "proposals-index.json",
    ];
    const r = bucketize(names);
    expect(r["live-main"].sort()).toEqual([
      "spec-262-main.json",
      "spec-402-main.json",
    ]);
    expect(r["historical-pin"].sort()).toEqual([
      "spec-262-main-abc1234567.json",
      "spec-402-main-deadbeef00.json",
    ]);
    expect(r["pinned-edition"].sort()).toEqual([
      "spec-262-es2025.json",
      "spec-402-es2024.json",
    ]);
    expect(r["side-index"].sort()).toEqual([
      "proposals-index.json",
      "test262-index.json",
    ]);
    expect(r.unknown).toEqual([]);
  });

  it("isolates unknown files instead of dropping them", () => {
    const r = bucketize(["junk.json", "spec-262-main.json"]);
    expect(r.unknown).toEqual(["junk.json"]);
    expect(r["live-main"]).toEqual(["spec-262-main.json"]);
  });

  it("returns empty buckets when given no input", () => {
    const r = bucketize([]);
    for (const k of Object.keys(r) as (keyof typeof r)[]) {
      expect(r[k]).toEqual([]);
    }
  });
});
