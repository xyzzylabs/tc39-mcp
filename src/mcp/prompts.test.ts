import { describe, it, expect } from "vitest";
import { getPrompt, listPrompts, PROMPT_DEFS } from "./prompts.js";

describe("listPrompts", () => {
  it("returns the full catalog", () => {
    const r = listPrompts();
    expect(r.prompts.length).toBe(PROMPT_DEFS.length);
    expect(r.prompts.map((p) => p.name).sort()).toEqual(
      [
        "cite-reproducibly",
        "compare-editions",
        "explain-clause",
        "find-and-read",
        "proposal-status",
        "test262-for-feature",
        "trace-crossrefs",
      ].sort(),
    );
  });

  it("every prompt has a title, description, and arguments array", () => {
    for (const p of PROMPT_DEFS) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(20);
      expect(Array.isArray(p.arguments)).toBe(true);
    }
  });
});

describe("getPrompt", () => {
  it("explain-clause requires id and mentions clause.get", () => {
    expect(() => getPrompt("explain-clause", {})).toThrow(/id/);
    const r = getPrompt("explain-clause", { id: "sec-tonumber", spec: "262" });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.role).toBe("user");
    expect(r.messages[0]!.content.text).toMatch(/clause\.get/);
    expect(r.messages[0]!.content.text).toMatch(/sec-tonumber/);
    expect(r.messages[0]!.content.text).toMatch(/spec\.about/);
  });

  it("compare-editions defaults from/to", () => {
    const r = getPrompt("compare-editions", { id: "sec-tonumber" });
    expect(r.messages[0]!.content.text).toMatch(/spec\.diff/);
    expect(r.messages[0]!.content.text).toMatch(/latest/);
    expect(r.messages[0]!.content.text).toMatch(/main/);
  });

  it("find-and-read uses global_search when spec omitted", () => {
    const r = getPrompt("find-and-read", { query: "ToNumber" });
    expect(r.messages[0]!.content.text).toMatch(/spec\.global_search/);
  });

  it("find-and-read uses spec.search when spec set", () => {
    const r = getPrompt("find-and-read", { query: "ToNumber", spec: "262" });
    expect(r.messages[0]!.content.text).toMatch(/spec\.search/);
    expect(r.messages[0]!.content.text).not.toMatch(/spec\.global_search/);
  });

  it("trace-crossrefs mentions direction", () => {
    const r = getPrompt("trace-crossrefs", { id: "sec-tonumber", direction: "in" });
    expect(r.messages[0]!.content.text).toMatch(/spec\.crossrefs/);
  });

  it("proposal-status prefers proposal.get for slug-like query", () => {
    const r = getPrompt("proposal-status", { query: "temporal" });
    expect(r.messages[0]!.content.text).toMatch(/proposal\.get/);
  });

  it("proposal-status uses proposal.list for multi-word query", () => {
    const r = getPrompt("proposal-status", { query: "pipeline operator" });
    expect(r.messages[0]!.content.text).toMatch(/proposal\.list/);
  });

  it("test262-for-feature requires query or esid", () => {
    expect(() => getPrompt("test262-for-feature", {})).toThrow(/query|esid/);
    const r = getPrompt("test262-for-feature", { esid: "sec-tonumber" });
    expect(r.messages[0]!.content.text).toMatch(/test262\.search/);
  });

  it("cite-reproducibly asks for spec.about + citation block", () => {
    const r = getPrompt("cite-reproducibly", { id: "sec-tonumber" });
    expect(r.messages[0]!.content.text).toMatch(/spec\.about/);
    expect(r.messages[0]!.content.text).toMatch(/sha:/);
  });

  it("throws on unknown prompt", () => {
    expect(() => getPrompt("nope", {})).toThrow(/Unknown prompt/);
  });
});
