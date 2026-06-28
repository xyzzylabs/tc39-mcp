// Register MCP App ui:// resources on the stdio McpServer. Tools themselves
// get `_meta.ui.resourceUri` at registerTool time (see server.ts) so hosts
// that support MCP Apps render the matching HTML iframe beside the tool result.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_DESCRIPTORS, APP_MIME_TYPE, APP_RESOURCE_META } from "./manifest.js";
import { loadAppHtml } from "./load.js";

/** Register every MCP App as a `ui://` resource on the given server. */
export function registerAppResources(server: McpServer): void {
  for (const app of APP_DESCRIPTORS) {
    server.registerResource(
      app.file.replace(/\.html$/, ""),
      app.uri,
      {
        description: app.description,
        mimeType: APP_MIME_TYPE,
        // Listing-level UI metadata: strict CSP, no network, read-only view.
        _meta: APP_RESOURCE_META,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: APP_MIME_TYPE,
            text: loadAppHtml(app.file),
            _meta: APP_RESOURCE_META,
          },
        ],
      }),
    );
  }
}
