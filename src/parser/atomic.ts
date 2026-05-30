// Atomic file write: stage to `.tmp`, then `rename` over the target.
// rename(2) is atomic on POSIX (and on macOS / Linux file systems we
// care about). The net effect: a crash mid-write leaves either the
// previous good copy or no file at all — never a half-written one
// that JSON.parse would later choke on.

import { renameSync, unlinkSync, writeFileSync } from "node:fs";

/** Write `payload` as JSON to `targetPath` via a `.tmp` rename dance. */
export function writeJsonAtomic(targetPath: string, payload: unknown): void {
  const tmpPath = targetPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  try {
    renameSync(tmpPath, targetPath);
  } catch (e) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* best-effort cleanup */
    }
    throw e;
  }
}
