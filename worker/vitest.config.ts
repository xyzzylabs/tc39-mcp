import { defineConfig } from "vitest/config";

// Worker tests run in Node (not in a real Worker isolate) — we
// mock R2 with an in-memory implementation. The Worker source uses
// only types from @cloudflare/workers-types (R2Bucket etc.) and
// global Request/Response, so a Node test environment suffices.

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.wrangler/**"],
  },
});
