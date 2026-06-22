import { describe, it, expect } from "vitest";
import {
  APP_DESCRIPTORS,
  APP_MIME_TYPE,
  CLAUSE_VIEWER_URI,
  DIFF_VIEWER_URI,
  TOOL_APP_URI,
  toolUiMeta,
} from "./manifest.js";
import { findAppByUri, loadAppHtml, loadAppHtmlByUri } from "./load.js";

describe("manifest", () => {
  it("uses the MCP App MIME type", () => {
    expect(APP_MIME_TYPE).toBe("text/html;profile=mcp-app");
  });

  it("maps clause.get and spec.diff to distinct App URIs", () => {
    expect(TOOL_APP_URI["clause.get"]).toBe(CLAUSE_VIEWER_URI);
    expect(TOOL_APP_URI["spec.diff"]).toBe(DIFF_VIEWER_URI);
    expect(CLAUSE_VIEWER_URI).not.toBe(DIFF_VIEWER_URI);
  });

  it("toolUiMeta advertises both modern and legacy keys", () => {
    const meta = toolUiMeta("clause.get");
    expect(meta?.ui.resourceUri).toBe(CLAUSE_VIEWER_URI);
    expect(meta?.["ui/resourceUri"]).toBe(CLAUSE_VIEWER_URI);
    expect(toolUiMeta("spec.about")).toBeUndefined();
  });

  it("lists two App descriptors", () => {
    expect(APP_DESCRIPTORS).toHaveLength(2);
    for (const a of APP_DESCRIPTORS) {
      expect(a.uri.startsWith("ui://tc39-mcp/")).toBe(true);
      expect(a.file.endsWith(".html")).toBe(true);
    }
  });
});

describe("load", () => {
  it("loads clause-viewer.html from disk", () => {
    const html = loadAppHtml("clause-viewer.html");
    expect(html).toContain("TC39 Clause Viewer");
    expect(html).toContain("ui/initialize");
  });

  it("loads diff-viewer.html from disk", () => {
    const html = loadAppHtml("diff-viewer.html");
    expect(html).toContain("TC39 Edition Diff Viewer");
    expect(html).toContain("ui/initialize");
  });

  it("resolves by ui:// URI", () => {
    expect(findAppByUri(CLAUSE_VIEWER_URI)?.file).toBe("clause-viewer.html");
    expect(loadAppHtmlByUri(DIFF_VIEWER_URI)).toContain("Edition Diff");
    expect(loadAppHtmlByUri("ui://nope")).toBeNull();
  });
});
