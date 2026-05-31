import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  parseServerTools,
  parseToolFile,
  findToolFileExporting,
  readStringConstArrays,
  renderApiReference,
} from "./build_api_reference.js";

const ROOT = resolve(__dirname, "..", "..");

describe("docs/build_api_reference", () => {
  describe("parseServerTools", () => {
    const tools = parseServerTools(join(ROOT, "src", "mcp", "server.ts"));

    it("finds every server.tool() registration", () => {
      // The current server registers exactly the tools listed in
      // docs/tools.md plus any newer additions. There must be at least
      // the headline set.
      const names = tools.map((t) => t.name);
      for (const required of [
        "clause.get",
        "clause.list",
        "clause.outline",
        "spec.search",
        "spec.crossrefs",
        "spec.diff",
        "spec.history",
        "spec.about",
        "spec.snapshots",
        "test262.search",
        "test262.get",
        "proposal.list",
        "proposal.get",
      ]) {
        expect(names).toContain(required);
      }
    });

    it("captures each tool's description verbatim", () => {
      const get = tools.find((t) => t.name === "clause.get");
      expect(get?.description).toMatch(/Fetch a parsed TC39 clause/);
      expect(get?.schemaIdent).toBe("clauseGetSchema");
    });
  });

  describe("readStringConstArrays", () => {
    it("resolves SPEC_VALUES into the literal pair", () => {
      const map = readStringConstArrays(join(ROOT, "src", "editions.ts"));
      expect(map.get("SPEC_VALUES")).toEqual(["262", "402"]);
    });
  });

  describe("parseToolFile", () => {
    it("extracts input schema fields with describe() text", () => {
      const path = findToolFileExporting(
        join(ROOT, "src", "mcp", "tools"),
        "clauseGetSchema",
      );
      expect(path).toBeTruthy();
      const parsed = parseToolFile(path!, "clauseGetSchema");
      const id = parsed.inputFields.find((f) => f.name === "id");
      expect(id?.type).toBe("string");
      expect(id?.description).toMatch(/Spec clause id/);
      const spec = parsed.inputFields.find((f) => f.name === "spec");
      expect(spec?.defaultValue).toBe('"262"');
    });

    it("captures handler return type and exported interfaces", () => {
      const path = findToolFileExporting(
        join(ROOT, "src", "mcp", "tools"),
        "clauseListSchema",
      );
      const parsed = parseToolFile(path!, "clauseListSchema");
      // The handler exists and returns the local hit array.
      expect(parsed.functionReturnTypes.get("clauseList")).toMatch(
        /ClauseListHit\[\]/,
      );
      // The exported interface ClauseListHit is captured with field JSDoc.
      const hit = parsed.interfaces.find((i) => i.name === "ClauseListHit");
      expect(hit).toBeTruthy();
      const aoid = hit!.fields.find((f) => f.name === "aoid");
      expect(aoid?.type).toMatch(/string \| null/);
      expect(aoid?.description).toMatch(/Abstract Operation ID/);
    });
  });

  describe("renderApiReference", () => {
    const md = renderApiReference(ROOT);

    it("renders headers for every registered tool", () => {
      const tools = parseServerTools(join(ROOT, "src", "mcp", "server.ts"));
      for (const t of tools) {
        expect(md).toContain(`## \`${t.name}\``);
      }
    });

    it("expands SPEC_VALUES inline rather than leaving the identifier", () => {
      expect(md).toMatch(/`"262"` \\\| `"402"`/);
      expect(md).not.toMatch(/`spec` \| SPEC_VALUES/);
    });

    it("shows a Returns line with the handler return type", () => {
      expect(md).toMatch(/Returns `Clause \| null`/);
    });
  });
});
