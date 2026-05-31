import { defineConfig } from "vitepress";
import pkg from "../../package.json";

// Docs site for tc39-mcp. Bundled into the Cloudflare Worker as
// static assets (see `worker/wrangler.toml` `[assets]` block).
// Rebuilt + redeployed by `.github/workflows/deploy-worker.yml` on
// every tag push and on every `refresh.yml` PATCH bump — so the
// auto-generated `/snapshots` page always reflects the currently-
// deployed parsed JSONs.
//
// Source content: the existing markdown files in this directory,
// plus three auto-generated pages produced by `npm run docs:data`:
//   - `/snapshots` — table of every parsed (spec, edition, SHA,
//     fetched_at) snapshot, read from `build/spec-*.json`.
//   - `/changelog` — verbatim copy of the repo-root `CHANGELOG.md`.
//   - `/api-reference` — every tool's input + output schema rendered
//     from `src/mcp/server.ts` + `src/mcp/tools/*.ts` via the
//     TypeScript Compiler API. Complements the hand-written `/tools`.

export default defineConfig({
  title: "tc39-mcp",
  description:
    "Structured MCP server for the TC39 specs (ECMA-262 + ECMA-402) — SHA-pinned clauses, AOID-aware search, in+out cross-references, edition diffs, history.",

  // Served from the Worker origin root (e.g. tc39-mcp.workers.dev/),
  // so no path prefix is needed.
  base: "/",

  // Clean URLs (no .html suffix) — VitePress emits them as
  // directory-with-index pages so static hosts serve them right.
  cleanUrls: true,

  // Don't break the build on intentional outbound links that may
  // 404 briefly (e.g., tc39.es link rot).
  ignoreDeadLinks: [/^https?:\/\/(?!github\.com\/xyzzylabs\/tc39-mcp)/],

  head: [
    ["meta", { name: "theme-color", content: "#3c8772" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "tc39-mcp" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Structured MCP server for the TC39 specs.",
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "Tools", link: "/tools" },
      { text: "Snapshots", link: "/snapshots" },
      { text: "Editions", link: "/editions" },
      { text: "Architecture", link: "/architecture" },
      { text: "Deployment", link: "/deployment" },
    ],

    sidebar: [
      {
        text: "Get started",
        items: [
          { text: "Overview", link: "/" },
          { text: "Editions + specs", link: "/editions" },
          { text: "Live snapshots", link: "/snapshots" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Tool reference (all 19)", link: "/tools" },
          { text: "API reference (auto)", link: "/api-reference" },
          { text: "Changelog", link: "/changelog" },
        ],
      },
      {
        text: "Under the hood",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Deployment", link: "/deployment" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/xyzzylabs/tc39-mcp" },
    ],

    editLink: {
      pattern:
        "https://github.com/xyzzylabs/tc39-mcp/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      // The version is injected at build time from package.json so the
      // footer reflects whatever PATCH the refresh workflow last
      // published.
      copyright: `tc39-mcp v${pkg.version} · © 2026 xyzzylabs`,
    },

    search: {
      provider: "local",
    },

    outline: {
      level: [2, 3],
      label: "On this page",
    },
  },
});
