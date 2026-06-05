import { describe, it, expect } from "vitest";
import { HOSTED_TOOLS, STDIO_ONLY_TOOLS, TOTAL_TOOL_COUNT } from "./tool_inventory.js";

describe("tool inventory", () => {
  it("hosted + stdio-only don't overlap", () => {
    const stdioOnly = new Set<string>(STDIO_ONLY_TOOLS);
    expect(HOSTED_TOOLS.filter((t) => stdioOnly.has(t))).toEqual([]);
  });

  it("has no duplicate tool names", () => {
    const all = [...HOSTED_TOOLS, ...STDIO_ONLY_TOOLS];
    expect(new Set(all).size).toBe(all.length);
  });

  it("totals the full 19-tool surface", () => {
    expect(TOTAL_TOOL_COUNT).toBe(19);
  });
});
