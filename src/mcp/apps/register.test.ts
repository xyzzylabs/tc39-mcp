import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResources } from "./register.js";
import { loadAppHtml } from "./load.js";
import {
  APP_DESCRIPTORS,
  APP_MIME_TYPE,
  CLAUSE_VIEWER_URI,
  DIFF_VIEWER_URI,
} from "./manifest.js";

describe("registerAppResources", () => {
  it("registers both ui:// app resources on an McpServer", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerAppResources(server)).not.toThrow();
    // McpServer keeps registered resources in a private map; assert the
    // descriptor catalog is complete and each App's HTML is loadable
    // (registration succeeds even if HTML is missing — the handler
    // loads at resources/read time).
    expect(APP_DESCRIPTORS).toHaveLength(2);
    expect(APP_DESCRIPTORS.map((a) => a.uri).sort()).toEqual(
      [CLAUSE_VIEWER_URI, DIFF_VIEWER_URI].sort(),
    );
    for (const app of APP_DESCRIPTORS) {
      const html = loadAppHtml(app.file);
      expect(html.length).toBeGreaterThan(100);
      expect(html).toMatch(/mcp-app|tc39-/);
      expect(APP_MIME_TYPE).toBe("text/html;profile=mcp-app");
    }
  });

  it("does not throw when registering twice on separate servers", () => {
    const a = new McpServer({ name: "a", version: "0.0.0" });
    const b = new McpServer({ name: "b", version: "0.0.0" });
    expect(() => registerAppResources(a)).not.toThrow();
    expect(() => registerAppResources(b)).not.toThrow();
  });
});
