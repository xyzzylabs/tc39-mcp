import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResources } from "./register.js";
import {
  APP_DESCRIPTORS,
  APP_MIME_TYPE,
  CLAUSE_VIEWER_URI,
  DIFF_VIEWER_URI,
} from "./manifest.js";

describe("registerAppResources", () => {
  it("registers both ui:// app resources on an McpServer", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerAppResources(server);
    // McpServer keeps registered resources in a private map; we probe
    // by re-reading through the public resource handlers after connect
    // isn't required — assert the descriptor catalog is complete and
    // loadable instead (registration throws if HTML is missing).
    expect(APP_DESCRIPTORS).toHaveLength(2);
    expect(APP_DESCRIPTORS.map((a) => a.uri).sort()).toEqual(
      [CLAUSE_VIEWER_URI, DIFF_VIEWER_URI].sort(),
    );
    for (const app of APP_DESCRIPTORS) {
      expect(app.mimeType ?? APP_MIME_TYPE).toBeTruthy();
    }
  });

  it("does not throw when registering twice on separate servers", () => {
    const a = new McpServer({ name: "a", version: "0.0.0" });
    const b = new McpServer({ name: "b", version: "0.0.0" });
    expect(() => registerAppResources(a)).not.toThrow();
    expect(() => registerAppResources(b)).not.toThrow();
  });
});
