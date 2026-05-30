// Central path resolution. Everything else imports from here.
//
// `ROOT` resolves via `import.meta.url`, so the server runs correctly
// regardless of the caller's working directory — `node dist/mcp/server.js`,
// `npx tc39-mcp`, or being invoked with a `cwd` field in another
// project's MCP config all work the same way.
//
// Per-(spec, edition) paths are computed by `editions.ts` (`vendorDir`,
// `specJsonPath`) — keep that the source of truth so the catalog and
// the filesystem stay in sync.

import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const ROOT = resolve(HERE, "..");

export const BUILD_DIR = join(ROOT, "build");
export const VENDOR_ROOT = join(ROOT, "vendor");
