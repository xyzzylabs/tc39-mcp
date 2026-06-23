// MCP App URIs + MIME type for the clause viewer and edition-diff viewer.
// Shared by the stdio server and the Cloudflare Worker so both transports
// advertise the same ui:// resources and tool _meta.

/** MIME type hosts use to recognise MCP App HTML resources. */
export const APP_MIME_TYPE = "text/html;profile=mcp-app";

/** Clause viewer App — renders `clause.get` results as readable steps. */
export const CLAUSE_VIEWER_URI = "ui://tc39-mcp/clause-viewer.html";

/** Edition-diff viewer App — renders `spec.diff` results side-by-side. */
export const DIFF_VIEWER_URI = "ui://tc39-mcp/diff-viewer.html";

export interface AppDescriptor {
  /** Resource URI advertised in tools/list `_meta.ui.resourceUri`. */
  uri: string;
  /** Human title for resources/list. */
  title: string;
  /** Short description for resources/list. */
  description: string;
  /** Basename under `src/mcp/apps/` and `worker/public/apps/`. */
  file: string;
}

export const APP_DESCRIPTORS: readonly AppDescriptor[] = [
  {
    uri: CLAUSE_VIEWER_URI,
    title: "TC39 Clause Viewer",
    description:
      "Interactive clause viewer: signature, numbered algorithm steps, notes, and cross-references from clause.get results.",
    file: "clause-viewer.html",
  },
  {
    uri: DIFF_VIEWER_URI,
    title: "TC39 Edition Diff Viewer",
    description:
      "Interactive edition-diff viewer: status, from/to summaries, and field-level changes from spec.diff results.",
    file: "diff-viewer.html",
  },
] as const;

/** Resource-level `_meta.ui` advertised for every MCP App, at both the
 *  resources/list and resources/read layers. The viewers are fully
 *  self-contained — they render the tool's JSON result and make no
 *  network calls — so the CSP locks out every external resource +
 *  connect domain; `prefersBorder` is a host rendering hint. Shared by
 *  the stdio resource registration and the Worker so the two can't drift. */
export const APP_RESOURCE_META = {
  ui: {
    csp: { resourceDomains: [] as string[], connectDomains: [] as string[] },
    prefersBorder: true,
  },
};

/** Tool name → UI resource URI for tools that render an MCP App. */
export const TOOL_APP_URI: Readonly<Record<string, string>> = {
  "clause.get": CLAUSE_VIEWER_URI,
  "spec.diff": DIFF_VIEWER_URI,
};

/** Build `_meta` for a tool that has an associated MCP App. */
export function toolUiMeta(toolName: string):
  | { ui: { resourceUri: string }; "ui/resourceUri": string }
  | undefined {
  const uri = TOOL_APP_URI[toolName];
  if (!uri) return undefined;
  // Advertise both modern (`ui.resourceUri`) and legacy (`ui/resourceUri`)
  // keys so older and newer hosts both pick up the App.
  return {
    ui: { resourceUri: uri },
    "ui/resourceUri": uri,
  };
}
