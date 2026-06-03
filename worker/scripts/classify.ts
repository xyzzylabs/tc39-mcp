// Pure classification of build/ artifacts → R2 upload phase. Extracted
// from upload-r2.ts so the deploy-ordering logic is testable without
// shelling out to wrangler.

export type ArtifactKind =
  | "live-main"      // spec-{262|402}-main.json — moving live pointer
  | "historical-pin" // spec-{262|402}-main-{sha}.json — immutable
  | "pinned-edition" // spec-{262|402}-esYYYY.json
  | "side-index"     // test262-index.json | proposals-index.json
  | "unknown";

const LIVE_MAIN_RE = /^spec-(?:262|402)-main\.json$/;
const HIST_PIN_RE = /^spec-(?:262|402)-main-[a-f0-9]+\.json$/;
const PINNED_EDITION_RE = /^spec-(?:262|402)-es\d{4}\.json$/;
const SIDE_INDEX_RE = /^(?:test262|proposals)-index\.json$/;

export function classify(name: string): ArtifactKind {
  if (LIVE_MAIN_RE.test(name)) return "live-main";
  if (HIST_PIN_RE.test(name)) return "historical-pin";
  if (PINNED_EDITION_RE.test(name)) return "pinned-edition";
  if (SIDE_INDEX_RE.test(name)) return "side-index";
  return "unknown";
}

/** Upload phases in dependency order. Files within a phase upload in
 *  any order; phase N completes before phase N+1 starts. */
export const PHASE_ORDER: ArtifactKind[] = [
  "historical-pin",
  "side-index",
  "pinned-edition",
  "live-main",
];

/** Group a flat list of artifact names into the 4-phase ordered plan. */
export function bucketize(names: string[]): Record<ArtifactKind, string[]> {
  const out: Record<ArtifactKind, string[]> = {
    "live-main": [],
    "historical-pin": [],
    "pinned-edition": [],
    "side-index": [],
    "unknown": [],
  };
  for (const name of names) out[classify(name)].push(name);
  return out;
}
