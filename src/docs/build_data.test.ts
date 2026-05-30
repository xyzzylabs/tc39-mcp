import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDocsData,
  copyChangelog,
  readSnapshots,
  renderSnapshotsPage,
  rewriteRelativeLinks,
  type SnapshotRow,
} from "./build_data.js";

describe("docs build_data", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "tc39-mcp-docs-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeSpecFile(
    buildDir: string,
    name: string,
    pin: { spec: string; edition: string; sha: string; fetched_at?: string },
  ): void {
    writeFileSync(
      join(buildDir, name),
      JSON.stringify({ pin, clauses: {} }),
      "utf8",
    );
  }

  describe("readSnapshots", () => {
    it("returns empty when the build directory does not exist", () => {
      expect(readSnapshots(join(tmp, "build"))).toEqual([]);
    });

    it("returns empty when the build directory has no spec-*.json files", () => {
      const buildDir = join(tmp, "build");
      mkdirSync(buildDir);
      writeFileSync(join(buildDir, "test262-index.json"), "{}", "utf8");
      writeFileSync(join(buildDir, "proposals-index.json"), "{}", "utf8");
      expect(readSnapshots(buildDir)).toEqual([]);
    });

    it("extracts pin metadata + computes short_sha + byte size", () => {
      const buildDir = join(tmp, "build");
      mkdirSync(buildDir);
      writeSpecFile(buildDir, "spec-262-es2025.json", {
        spec: "262",
        edition: "es2025",
        sha: "abc1234567890def0000",
        fetched_at: "2026-05-30T17:01:23Z",
      });
      const rows = readSnapshots(buildDir);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        spec: "262",
        edition: "es2025",
        sha: "abc1234567890def0000",
        short_sha: "abc12345",
        fetched_at: "2026-05-30T17:01:23Z",
      });
      expect(rows[0]!.bytes).toBeGreaterThan(0);
    });

    it("skips files whose pin block is missing or incomplete", () => {
      const buildDir = join(tmp, "build");
      mkdirSync(buildDir);
      writeFileSync(
        join(buildDir, "spec-262-broken.json"),
        JSON.stringify({ clauses: {} }),
        "utf8",
      );
      writeFileSync(
        join(buildDir, "spec-262-noSha.json"),
        JSON.stringify({ pin: { spec: "262", edition: "x" }, clauses: {} }),
        "utf8",
      );
      writeFileSync(
        join(buildDir, "spec-262-ok.json"),
        JSON.stringify({
          pin: { spec: "262", edition: "ok", sha: "abc1" },
          clauses: {},
        }),
        "utf8",
      );
      const rows = readSnapshots(buildDir);
      expect(rows.map((r) => r.edition)).toEqual(["ok"]);
    });

    it("ignores files that aren't valid JSON", () => {
      const buildDir = join(tmp, "build");
      mkdirSync(buildDir);
      writeFileSync(join(buildDir, "spec-262-bad.json"), "{not json", "utf8");
      writeSpecFile(buildDir, "spec-262-ok.json", {
        spec: "262",
        edition: "ok",
        sha: "abc",
      });
      const rows = readSnapshots(buildDir);
      expect(rows.map((r) => r.edition)).toEqual(["ok"]);
    });

    it("sorts 262 before 402 and main last per spec", () => {
      const buildDir = join(tmp, "build");
      mkdirSync(buildDir);
      // Write in shuffled order to verify the sort isn't relying on
      // readdir order.
      writeSpecFile(buildDir, "spec-402-main.json", {
        spec: "402",
        edition: "main",
        sha: "402m",
      });
      writeSpecFile(buildDir, "spec-262-main.json", {
        spec: "262",
        edition: "main",
        sha: "262m",
      });
      writeSpecFile(buildDir, "spec-262-es2017.json", {
        spec: "262",
        edition: "es2017",
        sha: "1717",
      });
      writeSpecFile(buildDir, "spec-262-es2016.json", {
        spec: "262",
        edition: "es2016",
        sha: "1616",
      });
      writeSpecFile(buildDir, "spec-402-es2025-candidate.json", {
        spec: "402",
        edition: "es2025-candidate",
        sha: "402c",
      });
      const rows = readSnapshots(buildDir);
      expect(rows.map((r) => `${r.spec}/${r.edition}`)).toEqual([
        "262/es2016",
        "262/es2017",
        "262/main",
        "402/es2025-candidate",
        "402/main",
      ]);
    });
  });

  describe("renderSnapshotsPage", () => {
    it("renders the placeholder content when there are no rows", () => {
      const md = renderSnapshotsPage([]);
      expect(md).toContain("Snapshot data not built yet");
      expect(md).toContain("npm run fetch-spec && npm run parse");
      expect(md).not.toContain("| Spec |");
    });

    it("renders a markdown table with one row per snapshot", () => {
      const rows: SnapshotRow[] = [
        {
          spec: "262",
          edition: "es2025",
          sha: "abc1234567890def",
          short_sha: "abc12345",
          fetched_at: "2026-05-30T17:01:23Z",
          bytes: 4_174_409,
        },
        {
          spec: "402",
          edition: "main",
          sha: "deadbeefdeadbeef",
          short_sha: "deadbeef",
          fetched_at: "2026-05-30T17:02:14Z",
          bytes: 725_359,
        },
      ];
      const md = renderSnapshotsPage(rows);

      // Headline reflects row count.
      expect(md).toContain("**2** SHA-pinned snapshots");
      // Total-bytes accumulation.
      expect(md).toContain("4.7 MB on disk"); // 4174409 + 725359 ≈ 4.67 MB
      // Tabular rows for each entry.
      expect(md).toContain("| 262 | `es2025` |");
      expect(md).toContain("| 402 | `main` |");
      // Short-SHA cells link to the spec-specific commit URL.
      expect(md).toContain("https://github.com/tc39/ecma262/commit/abc1234567890def");
      expect(md).toContain("https://github.com/tc39/ecma402/commit/deadbeefdeadbeef");
      // Byte sizes formatted humanely.
      expect(md).toContain("4.0 MB");
      expect(md).toContain("708 KB");
    });

    it("formats sub-MB sizes as KB and sub-KB as bytes", () => {
      const md = renderSnapshotsPage([
        {
          spec: "262",
          edition: "tiny",
          sha: "x",
          short_sha: "x",
          fetched_at: "now",
          bytes: 800,
        },
      ]);
      expect(md).toContain("800 B");
    });
  });

  describe("rewriteRelativeLinks", () => {
    it("rewrites bare-filename links to GitHub URLs", () => {
      const out = rewriteRelativeLinks("see [`CONTRIBUTING.md`](CONTRIBUTING.md) for details");
      expect(out).toBe(
        "see [`CONTRIBUTING.md`](https://github.com/xyzzylabs/tc39-mcp/blob/main/CONTRIBUTING.md) for details",
      );
    });

    it("rewrites relative paths with subdirectories", () => {
      const out = rewriteRelativeLinks("see [docs](docs/tools.md)");
      expect(out).toContain("github.com/xyzzylabs/tc39-mcp/blob/main/docs/tools.md");
    });

    it("leaves absolute http(s) URLs alone", () => {
      const out = rewriteRelativeLinks("see [tc39](https://github.com/tc39/ecma262)");
      expect(out).toBe("see [tc39](https://github.com/tc39/ecma262)");
    });

    it("leaves fragment anchors alone", () => {
      const out = rewriteRelativeLinks("see [section](#how-it-works)");
      expect(out).toBe("see [section](#how-it-works)");
    });

    it("leaves absolute paths alone", () => {
      const out = rewriteRelativeLinks("see [tools](/tools)");
      expect(out).toBe("see [tools](/tools)");
    });

    it("leaves mailto links alone", () => {
      const out = rewriteRelativeLinks("contact [us](mailto:foo@example.com)");
      expect(out).toBe("contact [us](mailto:foo@example.com)");
    });

    it("rewrites multiple links in one pass", () => {
      const out = rewriteRelativeLinks(
        "see [A](A.md) and [B](sub/B.md) and [C](https://x.example/)",
      );
      expect(out).toContain("blob/main/A.md");
      expect(out).toContain("blob/main/sub/B.md");
      expect(out).toContain("https://x.example/");
    });
  });

  describe("copyChangelog", () => {
    it("copies CHANGELOG.md into docs/changelog.md", () => {
      const docsDir = join(tmp, "docs");
      mkdirSync(docsDir);
      const body = "# Changelog\n\n## [0.1.0]\n\n- thing\n";
      writeFileSync(join(tmp, "CHANGELOG.md"), body, "utf8");
      const ok = copyChangelog(tmp, docsDir);
      expect(ok).toBe(true);
      expect(readFileSync(join(docsDir, "changelog.md"), "utf8")).toBe(body);
    });

    it("rewrites relative links during copy so VitePress doesn't 404", () => {
      const docsDir = join(tmp, "docs");
      mkdirSync(docsDir);
      writeFileSync(
        join(tmp, "CHANGELOG.md"),
        "# Changelog\n\nSee [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidance.\n",
        "utf8",
      );
      copyChangelog(tmp, docsDir);
      const copied = readFileSync(join(docsDir, "changelog.md"), "utf8");
      expect(copied).toContain(
        "https://github.com/xyzzylabs/tc39-mcp/blob/main/CONTRIBUTING.md",
      );
      expect(copied).not.toContain("](CONTRIBUTING.md)");
    });

    it("returns false (without throwing) when CHANGELOG.md is missing", () => {
      const docsDir = join(tmp, "docs");
      mkdirSync(docsDir);
      expect(copyChangelog(tmp, docsDir)).toBe(false);
      expect(existsSync(join(docsDir, "changelog.md"))).toBe(false);
    });
  });

  describe("buildDocsData (integration)", () => {
    it("writes snapshots.md and copies CHANGELOG together", () => {
      const buildDir = join(tmp, "build");
      const docsDir = join(tmp, "docs");
      mkdirSync(buildDir);
      mkdirSync(docsDir);
      writeFileSync(join(tmp, "CHANGELOG.md"), "# Changelog\n", "utf8");
      writeSpecFile(buildDir, "spec-262-es2025.json", {
        spec: "262",
        edition: "es2025",
        sha: "abcd1234",
        fetched_at: "2026-01-01T00:00:00Z",
      });

      buildDocsData(tmp);

      expect(existsSync(join(docsDir, "snapshots.md"))).toBe(true);
      expect(existsSync(join(docsDir, "changelog.md"))).toBe(true);
      const snapshotsMd = readFileSync(join(docsDir, "snapshots.md"), "utf8");
      expect(snapshotsMd).toContain("| 262 | `es2025` |");
    });

    it("writes the placeholder snapshots page when build/ is missing", () => {
      const docsDir = join(tmp, "docs");
      mkdirSync(docsDir);
      writeFileSync(join(tmp, "CHANGELOG.md"), "# Changelog\n", "utf8");

      buildDocsData(tmp);

      const md = readFileSync(join(docsDir, "snapshots.md"), "utf8");
      expect(md).toContain("Snapshot data not built yet");
    });
  });
});
