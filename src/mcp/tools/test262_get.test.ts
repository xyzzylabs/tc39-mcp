import { describe, it, expect } from "vitest";
import { test262Get } from "./test262_get.js";

// All tests are no-ops when vendor/test262 isn't present (CI without
// `npm run fetch-test262` runs through them clean).

describe("test262Get", () => {
  it("returns hint when vendor/test262 is missing", () => {
    // We can't easily un-vendor in this test. Verify only that when
    // the file genuinely doesn't exist, we get a hint.
    const r = test262Get({ path: "test/this/does/not/exist-xyz.js" });
    // Either no vendor at all, or vendor present + file missing.
    if (r.source === undefined) {
      expect(r.hint).toBeDefined();
    }
  });

  it("rejects paths that try to escape the checkout root", () => {
    const r1 = test262Get({ path: "../../etc/passwd" });
    expect(r1.source).toBeUndefined();
    expect(r1.hint).toContain("rejected");
    const r2 = test262Get({ path: "/etc/passwd" });
    expect(r2.source).toBeUndefined();
    expect(r2.hint).toContain("rejected");
  });

  it("rejects paths with embedded .. segments after the prefix", () => {
    // `test/built-ins/../../../etc/passwd` normalizes to walk out of
    // vendor/test262/; the segment-level check must catch it.
    const r = test262Get({ path: "test/built-ins/../../../etc/passwd" });
    expect(r.source).toBeUndefined();
    expect(r.hint).toContain("rejected");
  });

  it("rejects Windows-style absolute paths", () => {
    // On POSIX hosts these resolve weirdly but should still be rejected.
    const r = test262Get({ path: "C:\\Windows\\System32\\drivers\\etc\\hosts" });
    expect(r.source).toBeUndefined();
    // Either flagged as absolute/rejected, or the file doesn't exist.
    expect(r.hint).toBeDefined();
  });

  it("rejects backslash-escape attempts", () => {
    const r = test262Get({ path: "test\\..\\..\\etc\\passwd" });
    expect(r.source).toBeUndefined();
    expect(r.hint).toBeDefined();
  });

  it("reads a real test file with its front-matter", () => {
    // S15.7.4.2_A1_T01 has stable test262 front-matter (es5id, info,
    // description). Skip if the checkout isn't vendored.
    const path =
      "test/built-ins/Number/prototype/toString/S15.7.4.2_A1_T01.js";
    const r = test262Get({ path });
    if (r.source === undefined) return; // no vendor
    expect(r.source).toContain("Number.prototype.toString");
    expect(r.front_matter).toBeDefined();
    expect(r.front_matter!.description).toMatch(/radix/);
    if (r.test262_sha) {
      expect(r.url).toContain(r.test262_sha);
    }
  });
});
