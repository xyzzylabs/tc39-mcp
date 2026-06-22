// Load MCP App HTML from disk. Works in both the tsx-dev (`src/mcp/apps/`)
// and compiled (`dist/mcp/apps/`) layouts; falls back to a sibling path
// relative to this module so the published npm tarball only needs the
// files shipped under `dist/mcp/apps/`.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_DESCRIPTORS, type AppDescriptor } from "./manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Candidate directories that may hold the App HTML files. */
function candidateDirs(): string[] {
  return [
    HERE, // dist/mcp/apps or src/mcp/apps (tsx)
    join(HERE, "..", "..", "..", "src", "mcp", "apps"), // dist → src fallback
  ];
}

/** Read one App's HTML, or throw with a clear message if missing. */
export function loadAppHtml(file: string): string {
  for (const dir of candidateDirs()) {
    const path = join(dir, file);
    if (existsSync(path)) {
      return readFileSync(path, "utf8");
    }
  }
  throw new Error(
    `MCP App HTML not found: ${file}. Looked in: ${candidateDirs().join(", ")}`,
  );
}

/** Resolve an App descriptor by its ui:// URI. */
export function findAppByUri(uri: string): AppDescriptor | undefined {
  return APP_DESCRIPTORS.find((a) => a.uri === uri);
}

/** Load HTML for a ui:// URI. Returns null if the URI is not one of ours. */
export function loadAppHtmlByUri(uri: string): string | null {
  const app = findAppByUri(uri);
  if (!app) return null;
  return loadAppHtml(app.file);
}
