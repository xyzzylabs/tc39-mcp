import { defineConfig } from "vitest/config";

// Vitest defaults scan the whole tree for test files, which picks up
// dependency test files inside nested node_modules/ directories
// (notably worker/node_modules/*). Restrict to our own src/ tree.

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/.wrangler-state/**",
      "**/worker/**",
    ],
  },
});
