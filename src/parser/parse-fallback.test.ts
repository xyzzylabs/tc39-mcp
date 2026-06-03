import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSpec } from "./index.js";

// The biblio is a pinned snapshot of `main` and can lag the HTML being
// parsed, so the 262 parser has an HTML-discovery fallback: any
// <emu-clause> the biblio doesn't list is still captured, with metadata
// synthesized from the element. This test pins that behaviour with a
// clause id guaranteed never to appear in @tc39/ecma262-biblio.

describe("parseSpec — HTML-discovery fallback", () => {
  const pin = {
    spec: "262" as const,
    edition: "main",
    sha: "test",
    fetched_at: "test",
  };

  function parseHtml(html: string) {
    const dir = mkdtempSync(join(tmpdir(), "tc39-fallback-"));
    const file = join(dir, "spec.html");
    writeFileSync(file, html);
    return parseSpec(file, pin);
  }

  it("captures a clause absent from the biblio, synthesizing its aoid", () => {
    // No `aoid` attribute — the fallback must derive it from the h1.
    const parsed = parseHtml(`<!DOCTYPE html><html><body>
      <emu-clause id="sec-fallbackprobexyz">
        <h1>FallbackProbeXYZ ( _x_ )</h1>
        <emu-alg><ol><li>Return _x_.</li></ol></emu-alg>
      </emu-clause>
    </body></html>`);

    const c = parsed.clauses["sec-fallbackprobexyz"];
    expect(c, "biblio-absent clause should still be captured").toBeDefined();
    expect(c!.meta.aoid).toBe("FallbackProbeXYZ");
    expect(c!.meta.kind).toBe("op");
    expect(c!.meta.number).toBe("1"); // first top-level clause
    expect(c!.algorithms.length).toBeGreaterThan(0);
  });

  it("does not synthesize an aoid for a prose-titled clause", () => {
    const parsed = parseHtml(`<!DOCTYPE html><html><body>
      <emu-clause id="sec-fallbackprobeprose">
        <h1>Fallback Probe Objects</h1>
        <p>Prose only.</p>
      </emu-clause>
    </body></html>`);

    const c = parsed.clauses["sec-fallbackprobeprose"];
    expect(c).toBeDefined();
    expect(c!.meta.aoid).toBeNull();
    expect(c!.meta.kind).toBe("clause");
  });
});
